import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

// Import normal — AdonisJS gère la référence circulaire nativement
// grâce à la fonction fléchée () => LearningPlan dans le décorateur.
// La fonction n'est résolue qu'à l'exécution, quand les deux modules
// sont déjà chargés → pas de problème de dépendance circulaire.
import LearningPlan from './learning_plan.js'

export type PlanWeekStatus = 'pending' | 'in_progress' | 'completed' | 'skipped'

export default class PlanWeek extends BaseModel {
  static table = 'plan_weeks'

  // ─── Colonnes ──────────────────────────────────────────────────────────────

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare learningPlanId: number

  @column()
  declare weekNumber: number

  @column()
  declare theme: string | null

  @column()
  declare claudeIntro: string | null

  @column()
  declare topicIds: number[]

  @column()
  declare objective: string | null

  @column()
  declare status: PlanWeekStatus

  @column()
  declare progressPercent: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // ─── Relations ─────────────────────────────────────────────────────────────

  // La fonction fléchée () => LearningPlan est la clé :
  // elle n'est appelée qu'au moment où la relation est utilisée,
  // pas au moment de l'import du fichier → pas de circular dependency.
  @belongsTo(() => LearningPlan, {
    foreignKey: 'learningPlanId',
  })
  declare learningPlan: BelongsTo<typeof LearningPlan>

  // ─── Méthodes utiles ───────────────────────────────────────────────────────

  get isCompleted(): boolean {
    return this.status === 'completed'
  }

  get isActive(): boolean {
    return this.status === 'in_progress'
  }

  get isPending(): boolean {
    return this.status === 'pending'
  }

  get hasTopics(): boolean {
    return this.topicIds.length > 0
  }

  toString(): string {
    return `Semaine ${this.weekNumber} — ${this.theme ?? 'Sans titre'} [${this.status}] ${this.progressPercent}%`
  }
}