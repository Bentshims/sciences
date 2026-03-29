import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'learning_plans'

  async up() {
    // ─── Table principale du planning ───────────────────────────────────────
    this.schema.createTable('learning_plans', (table) => {
      table.increments('id').notNullable()

      table.integer('user_id').unsigned().notNullable()
        .references('id').inTable('users').onDelete('CASCADE')

      // Résumé du planning généré par Claude (JSON brut retourné par Claude)
      table.jsonb('claude_summary').nullable()
      // ex: { "total_weeks": 6, "goal": "Maîtriser l'analyse", "pace": "modéré" }

      // Dates
      table.date('start_date').notNullable()
      table.date('end_date').nullable() // calculée automatiquement

      // État
      table.enum('status', ['active', 'paused', 'completed', 'abandoned']).defaultTo('active')

      // Dernier ajustement par Claude (date + raison)
      table.timestamp('last_adjusted_at').nullable()
      table.text('last_adjustment_reason').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })

    // ─── Semaines du planning ────────────────────────────────────────────────
    // Chaque semaine contient une liste ordonnée de topics à étudier
    this.schema.createTable('plan_weeks', (table) => {
      table.increments('id').notNullable()

      table.integer('learning_plan_id').unsigned().notNullable()
        .references('id').inTable('learning_plans').onDelete('CASCADE')

      table.integer('week_number').notNullable()          // 1, 2, 3...
      table.string('theme').nullable()                    // ex: "Fondamentaux de l'analyse"
      table.text('claude_intro').nullable()               // texte d'intro généré par Claude

      // Topics de la semaine (tableau ordonné d'IDs)
      table.specificType('topic_ids', 'integer[]').defaultTo('{}')

      // Objectif de la semaine (généré par Claude)
      table.text('objective').nullable()

      // Suivi
      table.enum('status', ['pending', 'in_progress', 'completed', 'skipped']).defaultTo('pending')
      table.integer('progress_percent').defaultTo(0).checkBetween([0, 100])

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // Une semaine est unique dans un planning
      table.unique(['learning_plan_id', 'week_number'])
    })
  }

  async down() {
    this.schema.dropTable('plan_weeks')
    this.schema.dropTable('learning_plans')
  }
}