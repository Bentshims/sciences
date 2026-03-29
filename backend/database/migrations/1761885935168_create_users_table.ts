import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()

      // Identité
      table.string('full_name').nullable()
      table.string('email', 254).notNullable().unique()
      table.string('password').notNullable()

      // Profil d'apprentissage (rempli lors de l'onboarding)
      table.enum('level', ['debutant', 'intermediaire', 'avance']).defaultTo('debutant')
      table.string('objective').nullable()           // ex: "préparer un examen", "curiosité"
      table.integer('minutes_per_day').defaultTo(30) // temps disponible par jour
      table.specificType('preferred_topics', 'text[]').nullable() // notions souhaitées

      // État de l'application
      table.boolean('onboarding_completed').defaultTo(false)
      table.timestamp('last_active_at').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}