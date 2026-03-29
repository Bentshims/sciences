import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import vine from '@vinejs/vine'
import { DateTime } from 'luxon'
import claudeService from '#services/claude_service'
import adaptiveService from '#services/adaptive_service'
import progressService from '#services/progress_service'
import planningService from '#services/planning_service'
import Session from '#models/session'
import Topic from '#models/topic'
import Progress from '#models/progress'
import User from '#models/user'

// ─── Validators ────────────────────────────────────────────────────────────

const startValidator = vine.create({
    topicSlug: vine.string().trim(),
    phase: vine.enum(['theory', 'examples', 'exercises', 'review']).optional(),
  })

const messageValidator = vine.create({
    content: vine.string().trim().minLength(1).maxLength(4000),
    context: vine
      .enum(['theory', 'example', 'exercise', 'correction', 'hint', 'freeform'])
      .optional(),
  })

// ─── Controller ────────────────────────────────────────────────────────────

@inject()
export default class SessionsController {

  /**
   * POST /api/sessions/start
   * Démarre une nouvelle session d'apprentissage sur un topic.
   * Claude génère un message de bienvenue adapté au niveau et à l'historique.
   */
  async start({ request, auth, response }: HttpContext) {
    const user = auth.getUserOrFail() as User
    const data = await request.validateUsing(startValidator)

    // Récupération du topic
    const topic = await Topic.findByOrFail('slug', data.topicSlug)

    // Récupération du planning actif
    const plan = await planningService.getActivePlan(user.id)

    // Récupération de la progression existante sur ce topic
    const progress = await Progress.query()
      .where('user_id', user.id)
      .where('topic_id', topic.id)
      .first()

    // Création de la session
    const session = await Session.create({
      userId: user.id,
      topicId: topic.id,
      learningPlanId: plan?.id ?? null,
      phase: data.phase ?? 'theory',
      status: 'active',
      startedAt: DateTime.now(),
    })

    // Message d'accueil de Claude adapté au contexte
    const welcomePrompt = this.buildWelcomePrompt(topic, progress, session.phase)

    const claudeResponse = await claudeService.sendMessage({
      user,
      content: welcomePrompt,
      context: session.phase === 'exercises' ? 'exercise' : 'theory',
      sessionId: session.id,
      topic,
      session,
      progress: progress ?? undefined,
      learningPlan: plan ?? undefined,
    })

    return response.created({
      session: {
        id: session.id,
        topicId: session.topicId,
        phase: session.phase,
        status: session.status,
        startedAt: session.startedAt,
      },
      topic: {
        id: topic.id,
        slug: topic.slug,
        title: topic.title,
        category: topic.category,
        difficulty: topic.difficulty,
        isQuantum: topic.isQuantum,
      },
      welcomeMessage: claudeResponse.content,
      isFirstSession: !progress || progress.sessionsCount === 0,
    })
  }

  /**
   * POST /api/sessions/:id/message
   * Envoie un message à Claude dans le contexte d'une session active.
   * L'adaptive service enrichit le system prompt avant chaque envoi.
   */
  async message({ params, request, auth, response }: HttpContext) {
    const user = auth.getUserOrFail() as User
    const data = await request.validateUsing(messageValidator)

    const session = await Session.findOrFail(params.id)

    // Vérification que la session appartient à l'utilisateur
    if (session.userId !== user.id) {
      return response.forbidden({ message: 'Accès refusé.' })
    }

    if (session.status !== 'active') {
      return response.badRequest({ message: 'Cette session est terminée.' })
    }

    // Chargement du topic et de la progression
    const topic = await Topic.findOrFail(session.topicId)
    const progress = await Progress.query()
      .where('user_id', user.id)
      .where('topic_id', topic.id)
      .first()

    const plan = session.learningPlanId
      ? await planningService.getActivePlan(user.id)
      : null

    // Analyse adaptive — génère les instructions à injecter dans Claude
    const promptAddition = await adaptiveService.buildPromptAddition({
      user,
      session,
      topic,
      progress: progress ?? null,
    })

    // Envoi du message à Claude avec tout le contexte
    const claudeResponse = await claudeService.sendMessage({
      user,
      content: promptAddition
        ? `[CONTEXTE ADAPTATIF]\n${promptAddition}\n\n[MESSAGE ÉTUDIANT]\n${data.content}`
        : data.content,
      context: data.context ?? this.inferContext(session.phase),
      sessionId: session.id,
      topic,
      session,
      progress: progress ?? undefined,
      learningPlan: plan ?? undefined,
    })

    // Analyse du profil pour retourner des infos utiles au frontend
    const profile = await adaptiveService.analyzSession({
        user,
        session,
        progress: progress ?? null,
        topic: topic,
    })

    return response.ok({
      message: claudeResponse.content,
      adaptiveState: {
        cognitiveState: profile.cognitiveState,
        detectedLevel: profile.detectedLevel,
        pace: profile.pace,
        // On expose uniquement les recommandations hautes priorité
        alerts: profile.recommendations
          .filter((r) => r.priority === 'high')
          .map((r) => ({ type: r.type, reason: r.reason })),
      },
      meta: {
        inputTokens: claudeResponse.meta.input_tokens,
        outputTokens: claudeResponse.meta.output_tokens,
      },
    })
  }

  /**
   * PATCH /api/sessions/:id/phase
   * Passe à la phase suivante de la session (theory → examples → exercises → review).
   */
  async nextPhase({ params, auth, response }: HttpContext) {
    const user = auth.getUserOrFail() as User

    const session = await Session.findOrFail(params.id)

    if (session.userId !== user.id) {
      return response.forbidden({ message: 'Accès refusé.' })
    }

    const previousPhase = session.phase
    await session.nextPhase()

    return response.ok({
      previousPhase,
      currentPhase: session.phase,
      status: session.status,
    })
  }

  /**
   * PATCH /api/sessions/:id/complete
   * Termine la session, met à jour la progression et ajuste le planning si besoin.
   */
  async complete({ params, auth, response }: HttpContext) {
    const user = auth.getUserOrFail() as User

    const session = await Session.findOrFail(params.id)

    if (session.userId !== user.id) {
      return response.forbidden({ message: 'Accès refusé.' })
    }

    if (session.status === 'completed') {
      return response.badRequest({ message: 'Session déjà terminée.' })
    }

    // Complétion de la session
    await session.complete()

    // Chargement du topic et du planning
    const topic = await Topic.findOrFail(session.topicId)
    const plan = session.learningPlanId
      ? await planningService.getActivePlan(user.id)
      : null

    // Analyse finale et sauvegarde des notes de session
    const profile = await adaptiveService.analyzSession({
        user,
        session,
        progress: null,
        topic: topic,
    })

    await adaptiveService.saveSessionNotes({ user, session, topic, profile })

    // Mise à jour de la progression + ajustement planning si nécessaire
    const completionResult = await progressService.handleSessionCompletion({
      user,
      session,
      learningPlan: plan,
    })

    return response.ok({
      message: 'Session terminée avec succès.',
      session: {
        id: session.id,
        performanceScore: session.performanceScore,
        durationMinutes: session.durationMinutes,
        exercisesAttempted: session.exercisesAttempted,
        exercisesCorrect: session.exercisesCorrect,
        successRate: session.successRate,
      },
      progress: completionResult,
      adaptiveSummary: {
        detectedLevel: profile.detectedLevel,
        cognitiveState: profile.cognitiveState,
        recommendations: profile.recommendations.map((r) => ({
          type: r.type,
          priority: r.priority,
        })),
      },
    })
  }

  /**
   * GET /api/sessions/:id
   * Retourne le détail d'une session avec son historique de messages.
   */
  async show({ params, auth, response }: HttpContext) {
    const user = auth.getUserOrFail() as User

    const session = await Session.query()
      .where('id', params.id)
      .where('user_id', user.id)
      .preload('topic')
      .firstOrFail()

    return response.ok({
      session: {
        id: session.id,
        phase: session.phase,
        status: session.status,
        successRate: session.successRate,
        exercisesAttempted: session.exercisesAttempted,
        exercisesCorrect: session.exercisesCorrect,
        hintsUsed: session.hintsUsed,
        durationMinutes: session.durationMinutes,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
        topic: {
          id: session.topic.id,
          slug: session.topic.slug,
          title: session.topic.title,
        },
      },
    })
  }

  // ─── Helpers privés ──────────────────────────────────────────────────────

  /**
   * Construit le prompt de bienvenue selon la phase et l'historique.
   */
  private buildWelcomePrompt(
    topic: Topic,
    progress: Progress | null,
    phase: string
  ): string {
    const isFirstTime = !progress || progress.sessionsCount === 0
    const isReview = progress && progress.status === 'needs_review'

    if (isFirstTime) {
      return `L'étudiant commence ${topic.title} pour la première fois. Accueille-le chaleureusement, présente brièvement le sujet et ce qu'il va apprendre. Commence par la phase : ${phase}.`
    }

    if (isReview) {
      return `L'étudiant revient réviser ${topic.title} (score de maîtrise : ${progress.masteryScore}/100). Fais un bref rappel des points clés et concentre-toi sur les notions à consolider.`
    }

    return `L'étudiant continue son apprentissage de ${topic.title} (score actuel : ${progress?.masteryScore ?? 0}/100). Reprends là où il en était et enchaîne avec la phase : ${phase}.`
  }

  /**
   * Infère le contexte Claude depuis la phase courante.
   */
  private inferContext(
    phase: string
  ): 'theory' | 'example' | 'exercise' | 'correction' | 'hint' | 'freeform' {
    const map: Record<string, 'theory' | 'example' | 'exercise'> = {
      theory: 'theory',
      examples: 'example',
      exercises: 'exercise',
      review: 'theory',
    }
    return map[phase] ?? 'freeform'
  }
}