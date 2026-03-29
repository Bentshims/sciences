import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import progressService from '#services/progress_service'
import planningService from '#services/planning_service'
import Progress from '#models/progress'
import User from '#models/user'

// ─── Controller ────────────────────────────────────────────────────────────

@inject()
export default class ProgressController {

  /**
   * GET /api/progress
   * Retourne la progression complète de l'utilisateur sur tous ses topics.
   * Triée par score de maîtrise décroissant.
   */
  async index({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail() as User

    const allProgress = await progressService.getFullProgress(user.id)

    return response.ok({
      progress: allProgress,
      total: allProgress.length,
    })
  }

  /**
   * GET /api/progress/summary
   * Retourne le résumé global : stats, topics forts/faibles, révisions dues.
   * C'est la source principale de données du dashboard.
   */
  async summary({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail() as User

    const plan = await planningService.getActivePlan(user.id)

    const [globalSummary, byCategory, nextTopic] = await Promise.all([
      progressService.getGlobalSummary({ user, learningPlan: plan }),
      progressService.getProgressByCategory(user.id),
      progressService.getNextRecommendedTopic({ user, learningPlan: plan }),
    ])

    return response.ok({
      summary: globalSummary,
      progressByCategory: byCategory,
      nextRecommendedTopic: nextTopic
        ? {
            id: nextTopic.id,
            slug: nextTopic.slug,
            title: nextTopic.title,
            category: nextTopic.category,
            difficulty: nextTopic.difficulty,
            isQuantum: nextTopic.isQuantum,
          }
        : null,
    })
  }

  /**
   * GET /api/progress/topics/:topicId
   * Retourne la progression détaillée sur un topic spécifique.
   * Inclut le score, le niveau, l'historique des sessions et la prochaine révision.
   */
  async topic({ params, auth, response }: HttpContext) {
    const user = auth.getUserOrFail() as User

    const progress = await progressService.getTopicProgress(user.id, params.topicId)

    if (!progress) {
      return response.ok({
        status: 'not_started',
        masteryScore: 0,
        message: 'Tu n\'as pas encore étudié ce topic.',
      })
    }

    return response.ok({
      topicId: progress.topicId,
      masteryScore: progress.masteryScore,
      currentLevel: progress.currentLevel,
      status: progress.status,
      sessionsCount: progress.sessionsCount,
      totalExercises: progress.totalExercises,
      correctExercises: progress.correctExercises,
      successRate: progress.overallSuccessRate,
      totalTimeMinutes: progress.totalTimeMinutes,
      lastStudiedAt: progress.lastStudiedAt,
      nextReviewAt: progress.nextReviewAt,
      isDueForReview: progress.isDueForReview,
      reviewIntervalDays: progress.reviewIntervalDays,
    })
  }

  /**
   * GET /api/progress/review-queue
   * Retourne les topics à réviser aujourd'hui selon l'algorithme SM-2.
   * Affiché en priorité sur le dashboard si la queue n'est pas vide.
   */
  async reviewQueue({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail() as User

    const queue = await progressService.getReviewQueue(user.id, 10)

    return response.ok({
      queue: queue.map((t) => ({
        id: t.id,
        slug: t.slug,
        title: t.title,
        category: t.category,
        difficulty: t.difficulty,
        isQuantum: t.isQuantum,
      })),
      count: queue.length,
      hasReviews: queue.length > 0,
    })
  }

  /**
   * GET /api/progress/streak
   * Retourne la série de jours consécutifs d'apprentissage de l'utilisateur.
   * Gamification simple pour encourager la régularité.
   */
  async streak({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail() as User

    // Récupération de toutes les progressions avec dernière date d'étude
    const progresses = await Progress.query()
      .where('user_id', user.id)
      .whereNotNull('last_studied_at')
      .orderBy('last_studied_at', 'desc')

    const streak = this.computeStreak(progresses)
    const lastActiveAt = user.lastActiveAt

    return response.ok({
      currentStreak: streak,
      lastActiveAt,
      isActiveToday: lastActiveAt
        ? new Date(lastActiveAt as any).toDateString() === new Date().toDateString()
        : false,
    })
  }

  // ─── Helpers privés ──────────────────────────────────────────────────────

  /**
   * Calcule la série de jours consécutifs d'activité.
   * Un jour est "actif" si l'utilisateur a étudié au moins un topic.
   */
  private computeStreak(progresses: Progress[]): number {
    if (progresses.length === 0) return 0

    // Collecte des dates uniques d'étude
    const studyDates = new Set(
      progresses
        .filter((p) => p.lastStudiedAt !== null)
        .map((p) => p.lastStudiedAt!.toISODate())
    )

    let streak = 0
    let currentDate = new Date()

    // Remonte jour par jour depuis aujourd'hui
    for (let i = 0; i < 365; i++) {
      const dateStr = currentDate.toISOString().split('T')[0]
      if (studyDates.has(dateStr)) {
        streak++
        currentDate.setDate(currentDate.getDate() - 1)
      } else {
        // On tolère le jour courant si pas encore étudié aujourd'hui
        if (i === 0) {
          currentDate.setDate(currentDate.getDate() - 1)
          continue
        }
        break
      }
    }

    return streak
  }
}