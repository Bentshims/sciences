import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import Topic from '#models/topic'
import Progress from '#models/progress'
import User from '#models/user'

// ─── Controller ────────────────────────────────────────────────────────────

@inject()
export default class TopicsController {

  /**
   * GET /api/topics
   * Retourne tous les topics actifs, groupés par catégorie.
   * Pour chaque topic, on enrichit avec la progression de l'utilisateur si dispo.
   */
  async index({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail() as User

    const topics = await Topic.query()
      .where('is_active', true)
      .orderBy('category', 'asc')
      .orderBy('order_in_category', 'asc')

    // Récupération de toutes les progressions en une seule requête
    const progresses = await Progress.query().where('user_id', user.id)
    const progressMap = new Map(progresses.map((p) => [p.topicId, p]))

    // Groupement par catégorie
    const grouped: Record<string, object[]> = {}

    for (const topic of topics) {
      const progress = progressMap.get(topic.id)

      if (!grouped[topic.category]) {
        grouped[topic.category] = []
      }

      grouped[topic.category].push({
        id: topic.id,
        slug: topic.slug,
        title: topic.title,
        description: topic.description,
        category: topic.category,
        categoryLabel: topic.categoryLabel,
        difficulty: topic.difficulty,
        difficultyStars: topic.difficultyStars,
        estimatedHours: topic.estimatedHours,
        prerequisites: topic.prerequisites,
        isQuantum: topic.isQuantum,
        // Progression de l'utilisateur sur ce topic
        userProgress: progress
          ? {
              masteryScore: progress.masteryScore,
              status: progress.status,
              currentLevel: progress.currentLevel,
              isDueForReview: progress.isDueForReview,
            }
          : {
              masteryScore: 0,
              status: 'not_started',
              currentLevel: 'debutant',
              isDueForReview: false,
            },
      })
    }

    return response.ok({
      topics: grouped,
      total: topics.length,
      categories: Object.keys(grouped),
    })
  }

  /**
   * GET /api/topics/:slug
   * Retourne le détail complet d'un topic avec la progression de l'utilisateur.
   * Inclut les prérequis résolus (avec leurs titres).
   */
  async show({ params, auth, response }: HttpContext) {
    const user = auth.getUserOrFail() as User

    const topic = await Topic.query()
      .where('slug', params.slug)
      .where('is_active', true)
      .firstOrFail()

    // Progression de l'utilisateur sur ce topic
    const progress = await Progress.query()
      .where('user_id', user.id)
      .where('topic_id', topic.id)
      .first()

    // Résolution des prérequis avec leurs titres
    let prerequisites: object[] = []
    if (topic.prerequisites.length > 0) {
      const prereqTopics = await Topic.query().whereIn('slug', topic.prerequisites)
      const prereqProgressMap = new Map(
        (
          await Progress.query()
            .where('user_id', user.id)
            .whereIn(
              'topic_id',
              prereqTopics.map((t) => t.id)
            )
        ).map((p) => [p.topicId, p])
      )

      prerequisites = prereqTopics.map((t) => {
        const prereqProgress = prereqProgressMap.get(t.id)
        return {
          id: t.id,
          slug: t.slug,
          title: t.title,
          isMastered: prereqProgress?.status === 'mastered',
          masteryScore: prereqProgress?.masteryScore ?? 0,
        }
      })
    }

    // Vérification si l'utilisateur peut commencer ce topic
    const prerequisitesMet = prerequisites.every((p: any) => p.isMastered)

    return response.ok({
      topic: {
        id: topic.id,
        slug: topic.slug,
        title: topic.title,
        description: topic.description,
        category: topic.category,
        categoryLabel: topic.categoryLabel,
        difficulty: topic.difficulty,
        difficultyStars: topic.difficultyStars,
        estimatedHours: topic.estimatedHours,
        isQuantum: topic.isQuantum,
        prerequisites,
        prerequisitesMet,
      },
      userProgress: progress
        ? {
            masteryScore: progress.masteryScore,
            status: progress.status,
            currentLevel: progress.currentLevel,
            sessionsCount: progress.sessionsCount,
            successRate: progress.overallSuccessRate,
            totalTimeMinutes: progress.totalTimeMinutes,
            isDueForReview: progress.isDueForReview,
            nextReviewAt: progress.nextReviewAt,
          }
        : null,
    })
  }

  /**
   * GET /api/topics/quantum
   * Retourne uniquement les topics du monde quantique.
   * Affiché dans le hub quantique de l'app.
   */
  async quantum({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail() as User

    const topics = await Topic.query()
      .where('is_quantum', true)
      .where('is_active', true)
      .orderBy('order_in_category', 'asc')

    const progresses = await Progress.query()
      .where('user_id', user.id)
      .whereIn('topic_id', topics.map((t) => t.id))

    const progressMap = new Map(progresses.map((p) => [p.topicId, p]))

    return response.ok({
      topics: topics.map((t) => {
        const progress = progressMap.get(t.id)
        return {
          id: t.id,
          slug: t.slug,
          title: t.title,
          description: t.description,
          difficulty: t.difficulty,
          difficultyStars: t.difficultyStars,
          estimatedHours: t.estimatedHours,
          prerequisites: t.prerequisites,
          userProgress: {
            masteryScore: progress?.masteryScore ?? 0,
            status: progress?.status ?? 'not_started',
          },
        }
      }),
    })
  }

  /**
   * GET /api/topics/search?q=...
   * Recherche de topics par titre ou description.
   */
  async search({ request, response }: HttpContext) {
    const query = request.qs().q as string

    if (!query || query.trim().length < 2) {
      return response.badRequest({
        message: 'La requête de recherche doit contenir au moins 2 caractères.',
      })
    }

    const topics = await Topic.query()
      .where('is_active', true)
      .where((builder) => {
        builder
          .whereILike('title', `%${query}%`)
          .orWhereILike('description', `%${query}%`)
      })
      .orderBy('title', 'asc')
      .limit(20)

    return response.ok({
      topics: topics.map((t) => ({
        id: t.id,
        slug: t.slug,
        title: t.title,
        category: t.category,
        categoryLabel: t.categoryLabel,
        difficulty: t.difficulty,
        isQuantum: t.isQuantum,
      })),
      total: topics.length,
      query,
    })
  }
}