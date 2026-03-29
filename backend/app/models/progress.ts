import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from './user.js'
import Topic from './topic.js'

export type MasteryStatus = 'not_started' | 'in_progress' | 'mastered' | 'needs_review'

export default class Progress extends BaseModel {
  static table = 'progress'

  // ─── Colonnes ──────────────────────────────────────────────────────────────

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column()
  declare topicId: number

  @column()
  declare masteryScore: number // 0-100

  @column()
  declare currentLevel: 'debutant' | 'intermediaire' | 'avance'

  // Statistiques cumulées
  @column()
  declare sessionsCount: number

  @column()
  declare totalExercises: number

  @column()
  declare correctExercises: number

  @column()
  declare totalTimeMinutes: number

  // Répétition espacée (algorithme SM-2 simplifié)
  @column.dateTime()
  declare lastStudiedAt: DateTime | null

  @column.dateTime()
  declare nextReviewAt: DateTime | null

  @column()
  declare reviewIntervalDays: number

  @column()
  declare status: MasteryStatus

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // ─── Relations ─────────────────────────────────────────────────────────────

  @belongsTo(() => User, { foreignKey: 'userId' })
  declare user: BelongsTo<typeof User>

  @belongsTo(() => Topic, { foreignKey: 'topicId' })
  declare topic: BelongsTo<typeof Topic>

  // ─── Méthodes utiles ───────────────────────────────────────────────────────

  /**
   * Taux de réussite global sur ce topic.
   */
  get overallSuccessRate(): number {
    if (this.totalExercises === 0) return 0
    return Math.round((this.correctExercises / this.totalExercises) * 100)
  }

  /**
   * Détermine si ce topic est dû pour une révision.
   */
  get isDueForReview(): boolean {
    if (!this.nextReviewAt) return false
    return DateTime.now() >= this.nextReviewAt
  }

  /**
   * Met à jour la progression après une session terminée.
   * Recalcule le score de maîtrise et planifie la prochaine révision.
   *
   * @param sessionScore - score de performance de la session (0-100)
   * @param exercisesAttempted - nb d'exercices tentés dans la session
   * @param exercisesCorrect - nb d'exercices réussis dans la session
   * @param durationMinutes - durée de la session
   */
  async updateAfterSession(params: {
    sessionScore: number
    exercisesAttempted: number
    exercisesCorrect: number
    durationMinutes: number
  }): Promise<void> {
    const { sessionScore, exercisesAttempted, exercisesCorrect, durationMinutes } = params

    // Mise à jour des statistiques cumulées
    this.sessionsCount += 1
    this.totalExercises += exercisesAttempted
    this.correctExercises += exercisesCorrect
    this.totalTimeMinutes += durationMinutes
    this.lastStudiedAt = DateTime.now()

    // Recalcul du score de maîtrise (moyenne pondérée : 70% historique + 30% session)
    this.masteryScore = Math.round(this.masteryScore * 0.7 + sessionScore * 0.3)

    // Mise à jour du niveau détecté
    this.currentLevel = this.computeLevel()

    // Mise à jour du statut
    this.status = this.computeStatus()

    // Algorithme de répétition espacée (SM-2 simplifié)
    this.reviewIntervalDays = this.computeNextInterval(sessionScore)
    this.nextReviewAt = DateTime.now().plus({ days: this.reviewIntervalDays })

    await this.save()
  }

  /**
   * Calcule le niveau actuel basé sur le score de maîtrise.
   */
  private computeLevel(): 'debutant' | 'intermediaire' | 'avance' {
    if (this.masteryScore >= 75) return 'avance'
    if (this.masteryScore >= 40) return 'intermediaire'
    return 'debutant'
  }

  /**
   * Calcule le statut de maîtrise.
   */
  private computeStatus(): MasteryStatus {
    if (this.sessionsCount === 0) return 'not_started'
    if (this.masteryScore >= 85) return 'mastered'
    if (this.isDueForReview) return 'needs_review'
    return 'in_progress'
  }

  /**
   * Algorithme SM-2 simplifié :
   * - Bonne session (score > 80) → on double l'intervalle
   * - Session correcte (score 50-80) → on augmente légèrement
   * - Mauvaise session (score < 50) → on remet à 1 jour
   */
  private computeNextInterval(sessionScore: number): number {
    if (sessionScore < 50) return 1
    if (sessionScore < 80) return Math.min(this.reviewIntervalDays + 1, 7)
    return Math.min(this.reviewIntervalDays * 2, 30)
  }

  /**
   * Retourne un résumé formaté pour Claude,
   * utilisé dans le contexte adaptatif.
   */
  toClaudeContext(): string {
    return [
      `Maîtrise du topic : ${this.masteryScore}/100`,
      `Niveau actuel : ${this.currentLevel}`,
      `Sessions effectuées : ${this.sessionsCount}`,
      `Taux de réussite global : ${this.overallSuccessRate}%`,
      `Statut : ${this.status}`,
      this.isDueForReview ? '⚠️ Ce topic nécessite une révision.' : '',
    ]
      .filter(Boolean)
      .join('\n')
  }
}