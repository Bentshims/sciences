import { DateTime } from 'luxon'
import hash from '@adonisjs/core/services/hash'
import { compose } from '@adonisjs/core/helpers'
import { BaseModel, column, hasMany, hasOne } from '@adonisjs/lucid/orm'
import { withAuthFinder } from '@adonisjs/auth/mixins/lucid'
import type { HasMany, HasOne } from '@adonisjs/lucid/types/relations'
import LearningPlan from './learning_plan.js'
import Session from './session.js'
import Progress from './progress.js'
import Message from './message.js'

const AuthFinder = withAuthFinder(() => hash.use('scrypt'), {
  uids: ['email'],
  passwordColumnName: 'password',
})

export default class User extends compose(BaseModel, AuthFinder) {
  // ─── Colonnes ──────────────────────────────────────────────────────────────

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare fullName: string | null

  @column()
  declare email: string

  @column({ serializeAs: null }) // jamais exposé en JSON
  declare password: string

  // Profil d'apprentissage
  @column()
  declare level: 'debutant' | 'intermediaire' | 'avance'

  @column()
  declare objective: string | null

  @column()
  declare minutesPerDay: number

  @column()
  declare preferredTopics: string[] | null

  // État
  @column()
  declare onboardingCompleted: boolean

  @column()
  declare lastActiveAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // ─── Relations ─────────────────────────────────────────────────────────────

  @hasOne(() => LearningPlan, {
    foreignKey: 'userId',
  })
  declare activePlan: HasOne<typeof LearningPlan>

  @hasMany(() => Session, {
    foreignKey: 'userId',
  })
  declare sessions: HasMany<typeof Session>

  @hasMany(() => Progress, {
    foreignKey: 'userId',
  })
  declare progresses: HasMany<typeof Progress>

  @hasMany(() => Message, {
    foreignKey: 'userId',
  })
  declare messages: HasMany<typeof Message>

  // ─── Méthodes utiles ───────────────────────────────────────────────────────
  // Note : le hashage du mot de passe est géré automatiquement par AuthFinder
  // via passwordColumnName: 'password' — pas besoin de @beforeSave() manuel.

  /**
   * Retourne le profil formaté pour l'envoyer à Claude comme contexte.
   * Claude connaîtra ainsi le niveau, l'objectif et le temps disponible.
   */
  toClaudeContext(): string {
    return [
      `Nom : ${this.fullName ?? 'Utilisateur'}`,
      `Niveau : ${this.level}`,
      `Objectif : ${this.objective ?? 'non précisé'}`,
      `Temps disponible : ${this.minutesPerDay} minutes par jour`,
      `Topics souhaités : ${this.preferredTopics?.join(', ') ?? 'non précisés'}`,
    ].join('\n')
  }

  /**
   * Vérifie si l'utilisateur a terminé l'onboarding.
   */
  get isReady(): boolean {
    return this.onboardingCompleted
  }

  /**
   * Sérialisation publique — on exclut le mot de passe automatiquement
   * grâce à serializeAs: null sur la colonne password.
   */
  serialize() {
    return {
      id: this.id,
      fullName: this.fullName,
      email: this.email,
      level: this.level,
      objective: this.objective,
      minutesPerDay: this.minutesPerDay,
      preferredTopics: this.preferredTopics,
      onboardingCompleted: this.onboardingCompleted,
      lastActiveAt: this.lastActiveAt,
      createdAt: this.createdAt,
    }
  }
}