import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import User from './user.js'
import Topic from './topic.js'
import LearningPlan from './learning_plan.js'
import Exercise from './exercise.js'
import Message from './message.js'

export type SessionPhase = 'theory' | 'examples' | 'exercises' | 'review'
export type SessionStatus = 'active' | 'completed' | 'abandoned'

export default class Session extends BaseModel {
  // ─── Colonnes ──────────────────────────────────────────────────────────────

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column()
  declare topicId: number

  @column()
  declare learningPlanId: number | null

  @column()
  declare phase: SessionPhase

  @column()
  declare status: SessionStatus

  // Métriques
  @column()
  declare durationMinutes: number

  @column()
  declare exercisesAttempted: number

  @column()
  declare exercisesCorrect: number

  @column()
  declare hintsUsed: number

  @column()
  declare performanceScore: number | null

  @column()
  declare detectedLevel: 'debutant' | 'intermediaire' | 'avance' | null

  @column()
  declare claudeSessionNotes: string | null

  @column.dateTime()
  declare startedAt: DateTime

  @column.dateTime()
  declare completedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // ─── Relations ─────────────────────────────────────────────────────────────

  @belongsTo(() => User, { foreignKey: 'userId' })
  declare user: BelongsTo<typeof User>

  @belongsTo(() => Topic, { foreignKey: 'topicId' })
  declare topic: BelongsTo<typeof Topic>

  @belongsTo(() => LearningPlan, { foreignKey: 'learningPlanId' })
  declare learningPlan: BelongsTo<typeof LearningPlan>

  @hasMany(() => Exercise, { foreignKey: 'sessionId' })
  declare exercises: HasMany<typeof Exercise>

  @hasMany(() => Message, { foreignKey: 'sessionId' })
  declare messages: HasMany<typeof Message>

  // ─── Méthodes utiles ───────────────────────────────────────────────────────

  /**
   * Taux de réussite de la session (0-100).
   */
  get successRate(): number {
    if (this.exercisesAttempted === 0) return 0
    return Math.round((this.exercisesCorrect / this.exercisesAttempted) * 100)
  }

  /**
   * Détermine si l'utilisateur est en difficulté (< 50% de réussite).
   */
  get isStruggling(): boolean {
    return this.exercisesAttempted >= 3 && this.successRate < 50
  }

  /**
   * Détermine si l'utilisateur maîtrise bien (> 80% de réussite).
   */
  get isExcelling(): boolean {
    return this.exercisesAttempted >= 3 && this.successRate > 80
  }

  /**
   * Passe à la phase suivante de la session.
   */
  async nextPhase(): Promise<void> {
    const phases: SessionPhase[] = ['theory', 'examples', 'exercises', 'review']
    const currentIndex = phases.indexOf(this.phase)

    if (currentIndex < phases.length - 1) {
      this.phase = phases[currentIndex + 1]
    } else {
      await this.complete()
      return
    }
    await this.save()
  }

  /**
   * Termine la session et calcule le score final.
   */
  async complete(): Promise<void> {
    this.status = 'completed'
    this.completedAt = DateTime.now()
    this.durationMinutes = Math.round(
      DateTime.now().diff(this.startedAt, 'minutes').minutes
    )
    this.performanceScore = this.successRate
    await this.save()
  }

  /**
   * Retourne le contexte de la session pour Claude,
   * afin qu'il adapte son comportement en temps réel.
   */
  toClaudeContext(): string {
    return [
      `Phase actuelle : ${this.phase}`,
      `Exercices tentés : ${this.exercisesAttempted}`,
      `Taux de réussite : ${this.successRate}%`,
      `Indices utilisés : ${this.hintsUsed}`,
      this.isStruggling ? '⚠️ L\'utilisateur est en difficulté — simplifie et encourage.' : '',
      this.isExcelling ? '🚀 L\'utilisateur maîtrise bien — tu peux augmenter la difficulté.' : '',
    ]
      .filter(Boolean)
      .join('\n')
  }
}