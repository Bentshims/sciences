import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from './user.js'
import Session from './session.js'

// ─── Types ─────────────────────────────────────────────────────────────────

export type MessageRole = 'user' | 'assistant'

export type MessageContext =
  | 'onboarding'
  | 'planning'
  | 'theory'
  | 'example'
  | 'exercise'
  | 'correction'
  | 'hint'
  | 'freeform'

export type MessageFeedback = 'helpful' | 'not_helpful' | 'too_complex' | 'too_simple'

export interface ClaudeMeta {
  model: string
  input_tokens: number
  output_tokens: number
  stop_reason?: string
}

// Format attendu par l'API Claude
export interface ClaudeMessage {
  role: MessageRole
  content: string
}

// ─── Model ─────────────────────────────────────────────────────────────────

export default class Message extends BaseModel {
  // ─── Colonnes ──────────────────────────────────────────────────────────────

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column()
  declare sessionId: number | null

  @column()
  declare context: MessageContext

  @column()
  declare role: MessageRole

  @column()
  declare content: string

  @column()
  declare claudeMeta: ClaudeMeta | null

  @column()
  declare hasLatex: boolean

  @column()
  declare hasCode: boolean

  @column()
  declare feedback: MessageFeedback | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  // ─── Relations ─────────────────────────────────────────────────────────────

  @belongsTo(() => User, { foreignKey: 'userId' })
  declare user: BelongsTo<typeof User>

  @belongsTo(() => Session, { foreignKey: 'sessionId' })
  declare session: BelongsTo<typeof Session>

  // ─── Méthodes statiques ────────────────────────────────────────────────────

  /**
   * Récupère l'historique d'une session sous le format attendu par l'API Claude.
   * On limite à `maxMessages` pour ne pas dépasser la fenêtre de contexte.
   *
   * @param sessionId - ID de la session
   * @param maxMessages - nb max de messages à retourner (défaut: 20)
   */
  static async getClaudeHistory(
    sessionId: number,
    maxMessages: number = 20
  ): Promise<ClaudeMessage[]> {
    const messages = await Message.query()
      .where('session_id', sessionId)
      .orderBy('created_at', 'desc')
      .limit(maxMessages)

    // On remet dans l'ordre chronologique pour Claude
    return messages.reverse().map((m) => ({
      role: m.role,
      content: m.content,
    }))
  }

  /**
   * Récupère l'historique d'onboarding d'un utilisateur.
   * Utilisé pour reconstruire le contexte lors de la génération du planning.
   */
  static async getOnboardingHistory(userId: number): Promise<ClaudeMessage[]> {
    const messages = await Message.query()
      .where('user_id', userId)
      .where('context', 'onboarding')
      .orderBy('created_at', 'asc')

    return messages.map((m) => ({
      role: m.role,
      content: m.content,
    }))
  }

  /**
   * Sauvegarde un échange complet (message user + réponse Claude) en une transaction.
   */
  static async saveExchange(params: {
    userId: number
    sessionId?: number
    context: MessageContext
    userContent: string
    assistantContent: string
    claudeMeta?: ClaudeMeta
  }): Promise<{ userMessage: Message; assistantMessage: Message }> {
    const { userId, sessionId, context, userContent, assistantContent, claudeMeta } = params

    const userMessage = await Message.create({
      userId,
      sessionId: sessionId ?? null,
      context,
      role: 'user',
      content: userContent,
      hasLatex: containsLatex(userContent),
      hasCode: containsCode(userContent),
    })

    const assistantMessage = await Message.create({
      userId,
      sessionId: sessionId ?? null,
      context,
      role: 'assistant',
      content: assistantContent,
      claudeMeta: claudeMeta ?? null,
      hasLatex: containsLatex(assistantContent),
      hasCode: containsCode(assistantContent),
    })

    return { userMessage, assistantMessage }
  }

  // ─── Méthodes d'instance ───────────────────────────────────────────────────

  /**
   * Enregistre le feedback de l'utilisateur sur ce message.
   */
  async submitFeedback(feedback: MessageFeedback): Promise<void> {
    this.feedback = feedback
    await this.save()
  }

  /**
   * Retourne le coût estimé en tokens de ce message.
   */
  get tokenCost(): number {
    if (!this.claudeMeta) return 0
    return this.claudeMeta.input_tokens + this.claudeMeta.output_tokens
  }
}

// ─── Helpers privés ────────────────────────────────────────────────────────

/**
 * Détecte la présence de formules LaTeX dans un texte.
 * Cherche les délimiteurs $...$ ou \(...\) ou \[...\]
 */
function containsLatex(text: string): boolean {
  return /(\$[^$]+\$|\\\(.*?\\\)|\\\[.*?\\\])/s.test(text)
}

/**
 * Détecte la présence de blocs de code dans un texte.
 */
function containsCode(text: string): boolean {
  return /```[\s\S]*?```|`[^`]+`/.test(text)
}