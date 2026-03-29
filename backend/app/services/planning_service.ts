import db from '@adonisjs/lucid/services/db'
import claudeService from '#services/claude_service'
import LearningPlan, { PlanWeek } from '#models/learning_plan'
import Topic from '#models/topic'
import Progress from '#models/progress'
import Message from '#models/message'
import type User from '#models/user'
import { DateTime } from 'luxon'

// ─── Types ─────────────────────────────────────────────────────────────────

interface ClaudePlanWeek {
  week_number: number
  theme: string
  objective: string
  intro: string
  topic_slugs: string[]
}

interface ClaudePlanSummary {
  goal: string
  total_weeks: number
  pace: 'lent' | 'modere' | 'rapide'
  daily_structure: string
  special_notes?: string
}

interface ClaudePlanResponse {
  summary: ClaudePlanSummary
  weeks: ClaudePlanWeek[]
}

interface AdjustmentWeek {
  week_number: number
  theme: string
  objective: string
  topic_slugs: string[]
  reason: string
}

interface ClaudeAdjustmentResponse {
  adjustment_summary: string
  weeks_to_update: AdjustmentWeek[]
  message_to_student: string
}

// ─── Service ───────────────────────────────────────────────────────────────

export class PlanningService {

  // ─── Création du planning ─────────────────────────────────────────────────

  /**
   * Génère un planning complet après l'onboarding.
   * 1. Récupère l'historique de l'onboarding
   * 2. Demande à Claude de générer le planning JSON
   * 3. Résout les topic_slugs en topic_ids réels depuis la BDD
   * 4. Sauvegarde le planning et ses semaines en transaction
   */
  async createPlanFromOnboarding(user: User): Promise<LearningPlan> {
    // Récupération de l'historique d'onboarding pour donner le contexte à Claude
    const onboardingHistory = await Message.getOnboardingHistory(user.id)

    if (onboardingHistory.length === 0) {
      throw new Error('Impossible de générer un planning sans historique d\'onboarding.')
    }

    // Génération du planning par Claude
    const claudePlan = await claudeService.generateLearningPlan({
      user,
      onboardingHistory,
    }) as ClaudePlanResponse

    this.validateClaudePlan(claudePlan)

    // Résolution des slugs → IDs en une seule requête
    const allSlugs = [...new Set(claudePlan.weeks.flatMap((w) => w.topic_slugs))]
    const topicMap = await this.resolveTopicSlugs(allSlugs)

    // Création du planning en transaction (tout ou rien)
    const learningPlan = await db.transaction(async (trx) => {
      // Création du plan principal
      const plan = await LearningPlan.create(
        {
          userId: user.id,
          claudeSummary: claudePlan.summary,
          startDate: DateTime.now(),
          status: 'active',
        },
        { client: trx }
      )

      // Création de chaque semaine
      const weeksData = claudePlan.weeks.map((week) => {
        const resolvedTopicIds = week.topic_slugs
          .map((slug) => topicMap.get(slug))
          .filter((id): id is number => id !== undefined)

        return {
          learningPlanId: plan.id,
          weekNumber: week.week_number,
          theme: week.theme,
          objective: week.objective,
          claudeIntro: week.intro,
          topicIds: resolvedTopicIds,
          status: week.week_number === 1 ? 'in_progress' : 'pending',
          progressPercent: 0,
        } as const
      })

      await PlanWeek.createMany(weeksData, { client: trx })

      // Initialisation de la progression pour chaque topic du planning
      const allTopicIds = [...new Set(weeksData.flatMap((w) => w.topicIds))]
      await this.initializeProgressForTopics(user.id, allTopicIds, trx)

      // Marquer l'onboarding comme terminé
      user.onboardingCompleted = true
      await user.useTransaction(trx).save()

      return plan
    })

    return learningPlan
  }

  // ─── Progression dans le planning ────────────────────────────────────────

  /**
   * Marque un topic comme terminé dans la semaine en cours.
   * Si tous les topics de la semaine sont faits, passe à la semaine suivante.
   * Vérifie si un ajustement du planning est nécessaire.
   */
  async markTopicCompleted(params: {
    user: User
    learningPlan: LearningPlan
  }): Promise<{ weekCompleted: boolean; planCompleted: boolean; needsAdjustment: boolean }> {
    const { user, learningPlan } = params

    await learningPlan.load('weeks')
    const currentWeek = await learningPlan.currentWeek()

    if (!currentWeek) {
      return { weekCompleted: false, planCompleted: true, needsAdjustment: false }
    }

    // Récupération de la progression sur tous les topics de la semaine
    const weekTopicIds = currentWeek.topicIds
    const progresses = await Progress.query()
      .where('user_id', user.id)
      .whereIn('topic_id', weekTopicIds)

    // Calcul du pourcentage de complétion de la semaine
    const masteredTopics = progresses.filter((p) => p.masteryScore >= 70).length
    const progressPercent = Math.round((masteredTopics / weekTopicIds.length) * 100)

    currentWeek.progressPercent = progressPercent

    // Tous les topics de la semaine sont maîtrisés
    const weekCompleted = masteredTopics >= weekTopicIds.length
    if (weekCompleted) {
      currentWeek.status = 'completed'
    }
    await currentWeek.save()

    // Activation de la semaine suivante
    let planCompleted = false
    if (weekCompleted) {
      const nextWeek = learningPlan.weeks.find(
        (w) => w.weekNumber === currentWeek.weekNumber + 1
      )
      if (nextWeek) {
        nextWeek.status = 'in_progress'
        await nextWeek.save()
      } else {
        // Plus de semaine → planning terminé
        learningPlan.status = 'completed'
        await learningPlan.save()
        planCompleted = true
      }
    }

    // Détection du besoin d'ajustement
    const needsAdjustment = await this.shouldAdjustPlan(user, learningPlan)

    return { weekCompleted, planCompleted, needsAdjustment }
  }

  // ─── Ajustement adaptatif ─────────────────────────────────────────────────

  /**
   * Détermine si le planning doit être ajusté.
   * Conditions : l'utilisateur est en difficulté sur plusieurs topics
   * ou avance beaucoup plus vite que prévu.
   */
  async shouldAdjustPlan(user: User, learningPlan: LearningPlan): Promise<boolean> {
    await learningPlan.load('weeks')

    const currentWeek = await learningPlan.currentWeek()
    if (!currentWeek) return false

    const progresses = await Progress.query()
      .where('user_id', user.id)
      .whereIn('topic_id', currentWeek.topicIds)
    const strugglingTopics = progresses.filter((p) => p.masteryScore < 40).length
    const excellingOnAll = progresses.every((p) => p.masteryScore >= 90)

    // Ajustement si > 50% des topics posent problème ou si l'étudiant excelle partout
    return strugglingTopics / (progresses.length || 1) > 0.5 || excellingOnAll
  }

  /**
   * Demande à Claude d'ajuster le planning et applique les changements.
   */
  async adjustPlan(params: {
    user: User
    learningPlan: LearningPlan
    reason?: string
  }): Promise<{ messageToStudent: string; updatedWeeks: number }> {
    const { user, learningPlan } = params

    // Construction automatique de la raison si non fournie
    const reason = params.reason ?? (await this.buildAdjustmentReason(user, learningPlan))

    const adjustment = await claudeService.adjustPlan({
      user,
      learningPlan,
      reason,
    }) as ClaudeAdjustmentResponse

    if (!adjustment.weeks_to_update?.length) {
      return { messageToStudent: adjustment.message_to_student, updatedWeeks: 0 }
    }

    // Résolution des slugs pour les semaines ajustées
    const allSlugs = [
      ...new Set(adjustment.weeks_to_update.flatMap((w) => w.topic_slugs)),
    ]
    const topicMap = await this.resolveTopicSlugs(allSlugs)

    // Application des changements en transaction
    await db.transaction(async (trx) => {
      for (const updatedWeek of adjustment.weeks_to_update) {
        const week = learningPlan.weeks.find((w) => w.weekNumber === updatedWeek.week_number)
        if (!week) continue

        const newTopicIds = updatedWeek.topic_slugs
          .map((slug) => topicMap.get(slug))
          .filter((id): id is number => id !== undefined)

        week.theme = updatedWeek.theme
        week.objective = updatedWeek.objective
        week.topicIds = newTopicIds
        await week.useTransaction(trx).save()
      }

      // Enregistrement de l'ajustement
      await learningPlan.useTransaction(trx).flagForAdjustment(reason)
    })

    return {
      messageToStudent: adjustment.message_to_student,
      updatedWeeks: adjustment.weeks_to_update.length,
    }
  }

  // ─── Récupération du planning ─────────────────────────────────────────────

  /**
   * Retourne le planning actif d'un utilisateur avec ses semaines et topics chargés.
   */
  async getActivePlan(userId: number): Promise<LearningPlan | null> {
    const plan = await LearningPlan.query()
      .where('user_id', userId)
      .where('status', 'active')
      .preload('weeks')
      .first()

    return plan
  }

  /**
   * Retourne la leçon du jour : le prochain topic non maîtrisé de la semaine en cours.
   */
  async getTodayLesson(user: User): Promise<Topic | null> {
    const plan = await this.getActivePlan(user.id)
    if (!plan) return null

    const currentWeek = await plan.currentWeek()
    if (!currentWeek) return null

    // On cherche le premier topic de la semaine pas encore maîtrisé
    for (const topicId of currentWeek.topicIds) {
      const progress = await Progress.query()
        .where('user_id', user.id)
        .where('topic_id', topicId)
        .first()

      if (!progress || progress.status !== 'mastered') {
        return Topic.find(topicId)
      }
    }

    return null
  }

  // ─── Helpers privés ───────────────────────────────────────────────────────

  /**
   * Valide la structure du planning retourné par Claude.
   */
  private validateClaudePlan(plan: ClaudePlanResponse): void {
    if (!plan.summary || !Array.isArray(plan.weeks) || plan.weeks.length === 0) {
      throw new Error('Structure du planning Claude invalide.')
    }
    for (const week of plan.weeks) {
      if (!week.week_number || !week.theme || !Array.isArray(week.topic_slugs)) {
        throw new Error(`Semaine malformée dans le planning Claude : ${JSON.stringify(week)}`)
      }
    }
  }

  /**
   * Résout une liste de slugs en map slug → id depuis la BDD.
   * Les slugs non trouvés sont ignorés avec un warning.
   */
  private async resolveTopicSlugs(slugs: string[]): Promise<Map<string, number>> {
    const topics = await Topic.query().whereIn('slug', slugs)
    const map = new Map<string, number>()

    for (const topic of topics) {
      map.set(topic.slug, topic.id)
    }

    // Warning pour les slugs inconnus (Claude a peut-être inventé un slug)
    const missing = slugs.filter((s) => !map.has(s))
    if (missing.length > 0) {
      console.warn(`[PlanningService] Slugs inconnus ignorés : ${missing.join(', ')}`)
    }

    return map
  }

  /**
   * Initialise une entrée Progress pour chaque topic du planning.
   * Évite les doublons avec un upsert.
   */
  private async initializeProgressForTopics(
    userId: number,
    topicIds: number[],
    trx: any
  ): Promise<void> {
    for (const topicId of topicIds) {
      await Progress.updateOrCreate(
        { userId, topicId },
        { status: 'not_started', masteryScore: 0 },
        { client: trx }
      )
    }
  }

  /**
   * Construit automatiquement la raison d'ajustement
   * en analysant la progression réelle de l'utilisateur.
   */
  private async buildAdjustmentReason(
    user: User,
    learningPlan: LearningPlan
  ): Promise<string> {
    const currentWeek = await learningPlan.currentWeek()
    if (!currentWeek) return 'Fin du planning atteinte.'

    const progresses = await Progress.query()
      .where('user_id', user.id)
      .whereIn('topic_id', currentWeek.topicIds)

    const avgMastery =
      progresses.reduce((sum, p) => sum + p.masteryScore, 0) / (progresses.length || 1)

    const struggling = progresses.filter((p) => p.masteryScore < 40)
    const excelling = progresses.filter((p) => p.masteryScore >= 90)

    const parts: string[] = [`Semaine ${currentWeek.weekNumber} — Maîtrise moyenne : ${Math.round(avgMastery)}%.`]

    if (struggling.length > 0) {
      const slugs = await Topic.query()
        .whereIn('id', struggling.map((p) => p.topicId))
        .then((t) => t.map((x) => x.title))
      parts.push(`L'étudiant est en difficulté sur : ${slugs.join(', ')}.`)
    }

    if (excelling.length === progresses.length) {
      parts.push('L\'étudiant maîtrise tous les topics de la semaine — il peut accélérer.')
    }

    return parts.join(' ')
  }
}

// ─── Export singleton ──────────────────────────────────────────────────────

export default new PlanningService()