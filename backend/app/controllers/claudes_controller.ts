import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import vine from '@vinejs/vine'
import claudeService from '#services/claude_service'
import planningService from '#services/planning_service'
import Progress from '#models/progress'
import Message from '#models/message'
import User from '#models/user'

// ─── Validators ────────────────────────────────────────────────────────────

const askValidator = vine.create({
  content: vine.string().trim().minLength(1).maxLength(4000),
  topicSlug: vine.string().trim().optional(),
})

const feedbackValidator = vine.create({
    messageId: vine.number().positive(),
  feedback: vine.enum(['helpful', 'not_helpful', 'too_complex', 'too_simple']),
})

// ─── Controller ────────────────────────────────────────────────────────────

@inject()
export default class ClaudeController {

  /**
   * POST /api/claude/ask
   * Permet à l'utilisateur de poser une question libre à Claude
   * en dehors d'une session structurée.
   * Claude a accès au profil utilisateur et au planning pour contextualiser.
   * Optionnellement lié à un topic si topicSlug est fourni.
   */
  async ask({ request, auth, response }: HttpContext) {
    const user = auth.getUserOrFail() as User
    const data = await request.validateUsing(askValidator)

    // Chargement du contexte disponible
    const plan = await planningService.getActivePlan(user.id)

    // Si un topic est mentionné, on charge sa progression
    let progress: Progress | undefined
    let topic: any | undefined

    if (data.topicSlug) {
      const Topic = await import('#models/topic').then((m) => m.default)
      topic = await Topic.findBy('slug', data.topicSlug)
      if (topic) {
        progress = (await Progress.query()
          .where('user_id', user.id)
          .where('topic_id', topic.id)
          .first()) ?? undefined
      }
    }

    const claudeResponse = await claudeService.sendMessage({
      user,
      content: data.content,
      context: 'freeform',
      topic,
      progress,
      learningPlan: plan ?? undefined,
    })

    return response.ok({
      message: claudeResponse.content,
      meta: {
        inputTokens: claudeResponse.meta.input_tokens,
        outputTokens: claudeResponse.meta.output_tokens,
      },
    })
  }

  /**
   * GET /api/claude/history
   * Retourne l'historique des conversations libres de l'utilisateur.
   * Paginated — 20 messages par page.
   */
  async history({ request, auth, response }: HttpContext) {
    const user = auth.getUserOrFail() as User
    const page = Number(request.qs().page ?? 1)
    const perPage = 20

    const messages = await Message.query()
      .where('user_id', user.id)
      .where('context', 'freeform')
      .orderBy('created_at', 'desc')
      .paginate(page, perPage)

    return response.ok({
      messages: messages.all().map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        hasLatex: m.hasLatex,
        hasCode: m.hasCode,
        feedback: m.feedback,
        createdAt: m.createdAt,
      })),
      meta: messages.getMeta(),
    })
  }

  /**
   * GET /api/claude/session-history/:sessionId
   * Retourne l'historique complet d'une session spécifique.
   * Utilisé pour afficher le transcript d'une session passée.
   */
  async sessionHistory({ params, auth, response }: HttpContext) {
    const user = auth.getUserOrFail() as User

    // Vérification que la session appartient à l'utilisateur
    const Session = await import('#models/session').then((m) => m.default)
    const session = await Session.query()
      .where('id', params.sessionId)
      .where('user_id', user.id)
      .firstOrFail()

    const messages = await Message.query()
      .where('session_id', session.id)
      .orderBy('created_at', 'asc')

    return response.ok({
      sessionId: session.id,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        context: m.context,
        hasLatex: m.hasLatex,
        hasCode: m.hasCode,
        feedback: m.feedback,
        tokenCost: m.tokenCost,
        createdAt: m.createdAt,
      })),
      total: messages.length,
    })
  }

  /**
   * POST /api/claude/feedback
   * Enregistre le feedback de l'utilisateur sur un message Claude.
   * Permet d'améliorer la qualité des réponses au fil du temps.
   */
  async feedback({ request, auth, response }: HttpContext) {
    const user = auth.getUserOrFail() as User
    const data = await request.validateUsing(feedbackValidator)

    const message = await Message.query()
      .where('id', data.messageId)
      .where('user_id', user.id)
      .where('role', 'assistant')
      .firstOrFail()

    await message.submitFeedback(data.feedback)

    return response.ok({
      message: 'Feedback enregistré, merci !',
    })
  }

  /**
   * DELETE /api/claude/history
   * Supprime l'historique des conversations libres de l'utilisateur.
   * Ne supprime PAS les messages liés à des sessions (historique d'apprentissage).
   */
  async clearHistory({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail() as User

    await Message.query()
      .where('user_id', user.id)
      .where('context', 'freeform')
      .whereNull('session_id')
      .delete()

    return response.ok({
      message: 'Historique de conversations libres supprimé.',
    })
  }
}