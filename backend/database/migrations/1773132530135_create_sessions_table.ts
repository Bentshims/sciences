import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'sessions'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()

      table.integer('user_id').unsigned().notNullable()
        .references('id').inTable('users').onDelete('CASCADE')

      table.integer('topic_id').unsigned().notNullable()
        .references('id').inTable('topics').onDelete('CASCADE')

      table.integer('learning_plan_id').unsigned().nullable()
        .references('id').inTable('learning_plans').onDelete('SET NULL')

      // Phase de la session
      table.enum('phase', [
        'theory',     // lecture de la théorie
        'examples',   // exemples guidés
        'exercises',  // exercices
        'review',     // révision
      ]).defaultTo('theory')

      // État
      table.enum('status', ['active', 'completed', 'abandoned']).defaultTo('active')

      // Métriques de la session
      table.integer('duration_minutes').defaultTo(0)         // durée réelle
      table.integer('exercises_attempted').defaultTo(0)
      table.integer('exercises_correct').defaultTo(0)
      table.integer('hints_used').defaultTo(0)

      // Score de performance (0-100) calculé à la fin
      table.integer('performance_score').nullable().checkBetween([0, 100])

      // Niveau détecté par Claude pendant cette session
      table.enum('detected_level', ['debutant', 'intermediaire', 'avance']).nullable()

      // Notes de Claude sur cette session (pour adapter la prochaine)
      table.text('claude_session_notes').nullable()

      table.timestamp('started_at').notNullable()
      table.timestamp('completed_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}