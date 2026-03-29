import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import vine from '@vinejs/vine'
import planningService from '#services/planning_service'
import progressService from '#services/progress_service'
// import LearningPlan from '#models/learning_plan'
import Topic from '#models/topic'
import User from '#models/user'

// ─── Validators ────────────────────────────────────────────────────────────

const adjustValidator = vine.create({
  reason: vine.string().trim().minLength(5).maxLength(500).optional(),
})

// ─── Controller ────────────────────────────────────────────────────────────

@inject()
export default class PlansController {

  /**
   * GET /api/plans/active
   * Retourne le planning actif de l'utilisateur connecté
   * avec ses semaines, topics et progression.
   */
  async active({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail() as User

    const plan = await planningService.getActivePlan(user.id)

    if (!plan) {
      return response.notFound({
        message: 'Aucun planning actif trouvé. Complète l\'onboarding pour en générer un.',
      })
    }

    // Chargement des semaines avec leurs topics
    await plan.ensureWeeksLoaded()

    // Récupération des titres de topics pour chaque semaine
    const allTopicIds = [...new Set(plan.weeks.flatMap((w) => w.topicIds))]
    const topics = await Topic.query().whereIn('id', allTopicIds)
    const topicMap = new Map(topics.map((t) => [t.id, t]))

    const progress = await plan.globalProgress()

    return response.ok({
      plan: {
        id: plan.id,
        status: plan.status,
        startDate: plan.startDate,
        endDate: plan.endDate,
        summary: plan.claudeSummary,
        globalProgressPercent: progress,
        lastAdjustedAt: plan.lastAdjustedAt,
        weeks: plan.weeks.map((w) => ({
          id: w.id,
          weekNumber: w.weekNumber,
          theme: w.theme,
          objective: w.objective,
          intro: w.claudeIntro,
          status: w.status,
          progressPercent: w.progressPercent,
          topics: w.topicIds.map((id) => {
            const topic = topicMap.get(id)
            return topic
              ? {
                  id: topic.id,
                  slug: topic.slug,
                  title: topic.title,
                  category: topic.category,
                  difficulty: topic.difficulty,
                  estimatedHours: topic.estimatedHours,
                }
              : null
          }).filter(Boolean),
        })),
      },
    })
  }

  /**
   * GET /api/plans/today
   * Retourne la leçon du jour : le prochain topic recommandé.
   * C'est la première chose affichée sur le dashboard.
   */
  async today({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail() as User

    const plan = await planningService.getActivePlan(user.id)

    // Prochaine leçon recommandée
    const todayTopic = await planningService.getTodayLesson(user)

    // Prochain topic selon SM-2 (révisions dues)
    const reviewQueue = await progressService.getReviewQueue(user.id, 3)

    return response.ok({
      todayTopic: todayTopic
        ? {
            id: todayTopic.id,
            slug: todayTopic.slug,
            title: todayTopic.title,
            category: todayTopic.category,
            difficulty: todayTopic.difficulty,
            estimatedHours: todayTopic.estimatedHours,
            isQuantum: todayTopic.isQuantum,
          }
        : null,
      reviewQueue: reviewQueue.map((t) => ({
        id: t.id,
        slug: t.slug,
        title: t.title,
        category: t.category,
      })),
      planStatus: plan?.status ?? null,
    })
  }

  /**
   * POST /api/plans/adjust
   * Demande à Claude d'ajuster le planning en fonction de la progression réelle.
   * Peut être déclenché manuellement par l'utilisateur ou automatiquement
   * par le système après détection d'une difficulté ou d'une avance.
   */
  async adjust({ request, auth, response }: HttpContext) {
    const user = auth.getUserOrFail() as User

    const data = await request.validateUsing(adjustValidator)

    const plan = await planningService.getActivePlan(user.id)

    if (!plan) {
      return response.notFound({
        message: 'Aucun planning actif à ajuster.',
      })
    }

    const result = await planningService.adjustPlan({
      user,
      learningPlan: plan,
      reason: data.reason,
    })

    return response.ok({
      message: 'Planning ajusté avec succès.',
      messageToStudent: result.messageToStudent,
      updatedWeeks: result.updatedWeeks,
    })
  }

  /**
   * GET /api/plans/summary
   * Retourne le résumé global de progression pour le dashboard.
   * Inclut les stats par catégorie, les topics forts/faibles, etc.
   */
  async summary({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail() as User

    const plan = await planningService.getActivePlan(user.id)

    const globalSummary = await progressService.getGlobalSummary({
      user,
      learningPlan: plan,
    })

    const byCategory = await progressService.getProgressByCategory(user.id)

    return response.ok({
      summary: globalSummary,
      progressByCategory: byCategory,
    })
  }
}