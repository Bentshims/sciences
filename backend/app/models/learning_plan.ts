import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import User from './user.js'
import PlanWeek from './plan_week.js'

// Re-export pour compatibilité avec les imports existants du planning_service
export { PlanWeek }

// ─── Types ─────────────────────────────────────────────────────────────────

interface ClaudeSummary {
  total_weeks: number
  goal: string
  pace: 'lent' | 'modere' | 'rapide'
  daily_structure: string
  special_notes?: string
}

// ─── Model LearningPlan ────────────────────────────────────────────────────

export default class LearningPlan extends BaseModel {
  static table = 'learning_plans'

  // ─── Colonnes ────────────────────────────────────────────────────────────

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column()
  declare claudeSummary: ClaudeSummary | null

  @column.date()
  declare startDate: DateTime

  @column.date()
  declare endDate: DateTime | null

  @column()
  declare status: 'active' | 'paused' | 'completed' | 'abandoned'

  @column.dateTime()
  declare lastAdjustedAt: DateTime | null

  @column()
  declare lastAdjustmentReason: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // ─── Relations ───────────────────────────────────────────────────────────

  @belongsTo(() => User, {
    foreignKey: 'userId',
  })
  declare user: BelongsTo<typeof User>

  @hasMany(() => PlanWeek, {
    foreignKey: 'learningPlanId',
  })
  declare weeks: HasMany<typeof PlanWeek>

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /**
   * Charge les semaines depuis la BDD si elles ne sont pas déjà preloadées.
   * On évite this.load('string') qui pose des problèmes de typage TypeScript —
   * on passe directement par PlanWeek.query() et $setRelated().
   *
   * Méthode publique car utilisée à la fois par les services et les controllers.
   */
  async ensureWeeksLoaded(): Promise<void> {
    if (this.$preloaded.weeks) return
    const weeks = await PlanWeek.query()
      .where('learning_plan_id', this.id)
      .orderBy('week_number', 'asc')
    this.$setRelated('weeks', weeks)
  }

  // ─── Méthodes utiles ─────────────────────────────────────────────────────

  /**
   * Retourne la semaine en cours (la première non complétée).
   */
  async currentWeek(): Promise<PlanWeek | null> {
    await this.ensureWeeksLoaded()
    return (
      this.weeks.find((w) => w.status === 'in_progress') ??
      this.weeks.find((w) => w.status === 'pending') ??
      null
    )
  }

  /**
   * Calcule le pourcentage global de complétion du planning.
   */
  async globalProgress(): Promise<number> {
    await this.ensureWeeksLoaded()
    if (this.weeks.length === 0) return 0
    const completed = this.weeks.filter((w) => w.isCompleted).length
    return Math.round((completed / this.weeks.length) * 100)
  }

  /**
   * Retourne le contexte du planning formaté pour Claude,
   * utilisé lors des ajustements adaptatifs.
   */
  async toClaudeContext(): Promise<string> {
    await this.ensureWeeksLoaded()
    const currentWeek = await this.currentWeek()
    const progress = await this.globalProgress()

    return [
      `Planning en cours : ${this.claudeSummary?.goal ?? 'non défini'}`,
      `Rythme : ${this.claudeSummary?.pace ?? 'modéré'}`,
      `Progression globale : ${progress}%`,
      `Semaine actuelle : ${currentWeek?.weekNumber ?? 'N/A'} — ${currentWeek?.theme ?? ''}`,
      `Objectif de la semaine : ${currentWeek?.objective ?? 'non défini'}`,
      `Nombre total de semaines : ${this.claudeSummary?.total_weeks ?? this.weeks.length}`,
    ].join('\n')
  }

  /**
   * Marque le planning comme nécessitant un ajustement par Claude.
   */
  async flagForAdjustment(reason: string): Promise<void> {
    this.lastAdjustmentReason = reason
    this.lastAdjustedAt = DateTime.now()
    await this.save()
  }
}