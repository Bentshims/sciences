import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import vine from '@vinejs/vine'
import claudeService from '#services/claude_service'
import planningService from '#services/planning_service'
import User from '#models/user'

// ─── Validators ────────────────────────────────────────────────────────────

const messageValidator = vine.compile(
  vine.object({
    content: vine.string().trim().minLength(1).maxLength(2000),
  })
)

const completeValidator = vine.compile(
  vine.object({
    level: vine.enum(['debutant', 'intermediaire', 'avance']),
    objective: vine.string().trim().maxLength(500),
    minutesPerDay: vine.number().min(5).max(240),
    preferredTopics: vine.array(vine.string()).minLength(1),
  })
)

// ─── Controller ────────────────────────────────────────────────────────────

@inject()
export default class OnboardingController {

  /**
   * POST /api/onboarding/message
   * Envoie un message à Claude pendant le questionnaire d'onboarding.
   * Claude pose des questions une par une pour comprendre le profil.
   * Quand Claude a assez d'infos, il retourne isComplete: true.
   */
  async message({ request, response, auth }: HttpContext) {
    const user = auth.getUserOrFail() as User

    // Empêcher un utilisateur qui a déjà complété l'onboarding
    if (user.onboardingCompleted) {
      return response.badRequest({
        message: 'L\'onboarding est déjà complété.',
      })
    }

    const { content } = await request.validateUsing(messageValidator)

    const result = await claudeService.sendOnboardingMessage({ user, content })

    return response.ok({
      message: result.content,
      isComplete: result.isComplete,
      meta: {
        inputTokens: result.meta.input_tokens,
        outputTokens: result.meta.output_tokens,
      },
    })
  }

  /**
   * POST /api/onboarding/complete
   * Sauvegarde le profil extrait de l'onboarding et génère le planning.
   * Appelé par le frontend une fois que Claude a signalé isComplete: true.
   * Le frontend extrait les données du profil de la conversation et les envoie ici.
   */
  async complete({ request, response, auth }: HttpContext) {
    const user = auth.getUserOrFail() as User

    if (user.onboardingCompleted) {
      return response.badRequest({
        message: 'L\'onboarding est déjà complété.',
      })
    }

    const data = await request.validateUsing(completeValidator)

    // Mise à jour du profil utilisateur avec les infos de l'onboarding
    user.level = data.level
    user.objective = data.objective
    user.minutesPerDay = data.minutesPerDay
    user.preferredTopics = data.preferredTopics
    await user.save()

    // Génération du planning par Claude + sauvegarde en BDD
    // planningService marque aussi onboardingCompleted = true
    const learningPlan = await planningService.createPlanFromOnboarding(user)

    // Rechargement des semaines pour la réponse
    await learningPlan.ensureWeeksLoaded()

    return response.created({
      message: 'Onboarding complété ! Ton planning personnalisé est prêt.',
      learningPlan: {
        id: learningPlan.id,
        summary: learningPlan.claudeSummary,
        startDate: learningPlan.startDate,
        weeksCount: learningPlan.weeks.length,
        weeks: learningPlan.weeks.map((w) => ({
          weekNumber: w.weekNumber,
          theme: w.theme,
          objective: w.objective,
          intro: w.claudeIntro,
          topicsCount: w.topicIds.length,
        })),
      },
    })
  }

  /**
   * GET /api/onboarding/status
   * Retourne l'état de l'onboarding de l'utilisateur connecté.
   * Utilisé au démarrage de l'app pour savoir où rediriger l'utilisateur.
   */
  async status({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail() as User

    return response.ok({
      onboardingCompleted: user.onboardingCompleted,
      hasProfile: !!user.objective,
      level: user.level,
    })
  }
}