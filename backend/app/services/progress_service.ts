import Progress from '#models/progress'
import Topic from '#models/topic'
import Session from '#models/session'
import planningService from '#services/planning_service'
import type User from '#models/user'
import type LearningPlan from '#models/learning_plan'

// ─── Types ─────────────────────────────────────────────────────────────────

export interface TopicProgressSummary {
  topicId: number
  topicTitle: string
  topicSlug: string
  category: string
  masteryScore: number
  currentLevel: string
  status: string
  sessionsCount: number
  successRate: number
  totalTimeMinutes: number
  isDueForReview: boolean
  nextReviewAt: Date | null
}

export interface GlobalProgressSummary {
  totalTopics: number
  masteredTopics: number
  inProgressTopics: number
  notStartedTopics: number
  needsReviewTopics: number
  overallMasteryPercent: number
  totalTimeMinutes: number
  totalSessions: number
  planProgressPercent: number
  topicsToReviewToday: TopicProgressSummary[]
  weakTopics: TopicProgressSummary[]
  strongTopics: TopicProgressSummary[]
}

export interface SessionCompletionResult {
  progressUpdated: boolean
  topicMastered: boolean
  planAdjusted: boolean
  planAdjustmentMessage?: string
  weekCompleted: boolean
  planCompleted: boolean
}

// ─── Service ───────────────────────────────────────────────────────────────

export class ProgressService {

  // ─── Mise à jour après session ────────────────────────────────────────────

  /**
   * Point d'entrée principal — appelé à la fin de chaque session.
   * Met à jour la progression, vérifie si le topic est maîtrisé,
   * et déclenche l'ajustement du planning si nécessaire.
   */
  async handleSessionCompletion(params: {
    user: User
    session: Session
    learningPlan: LearningPlan | null
  }): Promise<SessionCompletionResult> {
    const { user, session, learningPlan } = params

    // Récupération ou création de la progression sur ce topic
    const progress = await Progress.updateOrCreate(
      { userId: user.id, topicId: session.topicId },
      { status: 'not_started', masteryScore: 0 }
    )

    // Mise à jour des stats avec l'algorithme SM-2
    await progress.updateAfterSession({
      sessionScore: session.performanceScore ?? session.successRate,
      exercisesAttempted: session.exercisesAttempted,
      exercisesCorrect: session.exercisesCorrect,
      durationMinutes: session.durationMinutes,
    })

    const topicMastered = progress.status === 'mastered'

    let weekCompleted = false
    let planCompleted = false
    let planAdjusted = false
    let planAdjustmentMessage: string | undefined

    // Si le topic est maîtrisé et qu'il y a un planning actif
    if (topicMastered && learningPlan) {
      const result = await planningService.markTopicCompleted({
        user,
        learningPlan,
      })

      weekCompleted = result.weekCompleted
      planCompleted = result.planCompleted

      // Ajustement adaptatif si nécessaire
      if (result.needsAdjustment) {
        const adjustment = await planningService.adjustPlan({ user, learningPlan })
        planAdjusted = true
        planAdjustmentMessage = adjustment.messageToStudent
      }
    }

    return {
      progressUpdated: true,
      topicMastered,
      planAdjusted,
      planAdjustmentMessage,
      weekCompleted,
      planCompleted,
    }
  }

  // ─── Récupération de la progression ──────────────────────────────────────

  /**
   * Retourne la progression complète d'un utilisateur sur tous ses topics,
   * enrichie avec les titres et catégories depuis la table topics.
   */
  async getFullProgress(userId: number): Promise<TopicProgressSummary[]> {
    const progresses = await Progress.query()
      .where('user_id', userId)
      .preload('topic')
      .orderBy('mastery_score', 'desc')

    return progresses.map((p) => this.formatTopicSummary(p))
  }

  /**
   * Retourne la progression d'un utilisateur sur un topic spécifique.
   */
  async getTopicProgress(userId: number, topicId: number): Promise<Progress | null> {
    return Progress.query()
      .where('user_id', userId)
      .where('topic_id', topicId)
      .preload('topic')
      .first()
  }

  /**
   * Retourne un résumé global de la progression,
   * incluant les stats du planning et les recommandations.
   */
  async getGlobalSummary(params: {
    user: User
    learningPlan: LearningPlan | null
  }): Promise<GlobalProgressSummary> {
    const { user, learningPlan } = params

    const allProgress = await this.getFullProgress(user.id)

    // Comptages par statut
    const mastered = allProgress.filter((p) => p.status === 'mastered')
    const inProgress = allProgress.filter((p) => p.status === 'in_progress')
    const notStarted = allProgress.filter((p) => p.status === 'not_started')
    const needsReview = allProgress.filter((p) => p.isDueForReview)

    // Score global de maîtrise (moyenne pondérée)
    const overallMastery =
      allProgress.length > 0
        ? Math.round(
            allProgress.reduce((sum, p) => sum + p.masteryScore, 0) / allProgress.length
          )
        : 0

    // Stats cumulées
    const totalTime = allProgress.reduce((sum, p) => sum + p.totalTimeMinutes, 0)
    const totalSessions = allProgress.reduce((sum, p) => sum + p.sessionsCount, 0)

    // Progression du planning
    const planProgress = learningPlan ? await learningPlan.globalProgress() : 0

    // Topics à réviser aujourd'hui (dus selon SM-2)
    const toReviewToday = allProgress.filter((p) => p.isDueForReview)

    // Topics faibles (score < 40, au moins 1 session)
    const weakTopics = allProgress
      .filter((p) => p.masteryScore < 40 && p.sessionsCount > 0)
      .slice(0, 5)

    // Topics forts (score >= 80)
    const strongTopics = allProgress
      .filter((p) => p.masteryScore >= 80)
      .slice(0, 5)

    return {
      totalTopics: allProgress.length,
      masteredTopics: mastered.length,
      inProgressTopics: inProgress.length,
      notStartedTopics: notStarted.length,
      needsReviewTopics: needsReview.length,
      overallMasteryPercent: overallMastery,
      totalTimeMinutes: totalTime,
      totalSessions,
      planProgressPercent: planProgress,
      topicsToReviewToday: toReviewToday,
      weakTopics,
      strongTopics,
    }
  }

  // ─── Recommandations ──────────────────────────────────────────────────────

  /**
   * Retourne le prochain topic recommandé à étudier.
   * Priorité : révisions dues > topics en cours > prochaine leçon du planning.
   */
  async getNextRecommendedTopic(params: {
    user: User
    learningPlan: LearningPlan | null
  }): Promise<Topic | null> {
    const { user, learningPlan } = params

    // 1. Y a-t-il des révisions dues aujourd'hui ?
    const dueReview = await Progress.query()
      .where('user_id', user.id)
      .where('next_review_at', '<=', new Date())
      .whereNot('status', 'not_started')
      .orderBy('next_review_at', 'asc')
      .preload('topic')
      .first()

    if (dueReview) return dueReview.topic

    // 2. Y a-t-il un topic en cours non terminé ?
    const inProgress = await Progress.query()
      .where('user_id', user.id)
      .where('status', 'in_progress')
      .orderBy('last_studied_at', 'desc')
      .preload('topic')
      .first()

    if (inProgress) return inProgress.topic

    // 3. Prochaine leçon du planning
    if (learningPlan) {
      return planningService.getTodayLesson(user)
    }

    return null
  }

  /**
   * Retourne les topics que l'utilisateur devrait réviser
   * en priorité selon l'algorithme SM-2.
   */
  async getReviewQueue(userId: number, limit: number = 5): Promise<Topic[]> {
    const progresses = await Progress.query()
      .where('user_id', userId)
      .where('next_review_at', '<=', new Date())
      .orderBy('next_review_at', 'asc')
      .preload('topic')
      .limit(limit)

    return progresses.map((p) => p.topic)
  }

  // ─── Stats par catégorie ──────────────────────────────────────────────────

  /**
   * Retourne la progression groupée par catégorie de topics.
   * Utile pour afficher un radar chart sur le dashboard.
   */
  async getProgressByCategory(userId: number): Promise<Record<string, number>> {
    const progresses = await Progress.query()
      .where('user_id', userId)
      .preload('topic')

    const byCategory: Record<string, { total: number; count: number }> = {}

    for (const progress of progresses) {
      const category = progress.topic.category
      if (!byCategory[category]) {
        byCategory[category] = { total: 0, count: 0 }
      }
      byCategory[category].total += progress.masteryScore
      byCategory[category].count += 1
    }

    // Calcul de la moyenne par catégorie
    const result: Record<string, number> = {}
    for (const [category, data] of Object.entries(byCategory)) {
      result[category] = Math.round(data.total / data.count)
    }

    return result
  }

  // ─── Helpers privés ───────────────────────────────────────────────────────

  /**
   * Formate un objet Progress en TopicProgressSummary pour le frontend.
   */
  private formatTopicSummary(progress: Progress): TopicProgressSummary {
    return {
      topicId: progress.topicId,
      topicTitle: progress.topic.title,
      topicSlug: progress.topic.slug,
      category: progress.topic.category,
      masteryScore: progress.masteryScore,
      currentLevel: progress.currentLevel,
      status: progress.status,
      sessionsCount: progress.sessionsCount,
      successRate: progress.overallSuccessRate,
      totalTimeMinutes: progress.totalTimeMinutes,
      isDueForReview: progress.isDueForReview,
      nextReviewAt: progress.nextReviewAt?.toJSDate() ?? null,
    }
  }
}

// ─── Export singleton ──────────────────────────────────────────────────────

export default new ProgressService()