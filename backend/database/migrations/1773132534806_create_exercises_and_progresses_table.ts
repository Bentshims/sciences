import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'exercises'

  async up() {
    // ─── Exercices générés par Claude ────────────────────────────────────────
    this.schema.createTable('exercises', (table) => {
      table.increments('id').notNullable()

      table.integer('session_id').unsigned().notNullable()
        .references('id').inTable('sessions').onDelete('CASCADE')

      table.integer('topic_id').unsigned().notNullable()
        .references('id').inTable('topics').onDelete('CASCADE')

      // Contenu généré par Claude
      table.text('question').notNullable()
      table.jsonb('question_data').nullable()
      // ex: { "type": "calcul", "formula": "f(x) = x²", "steps": [...] }

      // Type d'exercice
      table.enum('type', [
        'calcul',          // calcul numérique
        'demonstration',   // démontrer une propriété
        'qcm',             // choix multiple
        'graphique',       // tracer / interpréter un graphe
        'application',     // problème appliqué (physique)
      ]).defaultTo('calcul')

      // Difficulté adaptée au niveau détecté de l'utilisateur
      table.enum('difficulty', ['facile', 'moyen', 'difficile']).defaultTo('moyen')

      // Réponse et correction
      table.text('user_answer').nullable()
      table.text('correct_answer').notNullable()
      table.text('claude_feedback').nullable()       // explication détaillée de la correction
      table.jsonb('solution_steps').nullable()       // étapes de résolution
      // ex: [{ "step": 1, "description": "On dérive...", "formula": "f'(x) = 2x" }]

      // Résultat
      table.boolean('is_correct').nullable()
      table.integer('attempts').defaultTo(0)
      table.integer('time_spent_seconds').defaultTo(0)

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })

    // ─── Progression par notion ───────────────────────────────────────────────
    // Une ligne par utilisateur/topic — mise à jour après chaque session
    this.schema.createTable('progress', (table) => {
      table.increments('id').notNullable()

      table.integer('user_id').unsigned().notNullable()
        .references('id').inTable('users').onDelete('CASCADE')

      table.integer('topic_id').unsigned().notNullable()
        .references('id').inTable('topics').onDelete('CASCADE')

      // Maîtrise globale du topic (0-100)
      table.integer('mastery_score').defaultTo(0).checkBetween([0, 100])

      // Niveau actuel sur ce topic spécifique
      table.enum('current_level', ['debutant', 'intermediaire', 'avance']).defaultTo('debutant')

      // Statistiques cumulées
      table.integer('sessions_count').defaultTo(0)
      table.integer('total_exercises').defaultTo(0)
      table.integer('correct_exercises').defaultTo(0)
      table.integer('total_time_minutes').defaultTo(0)

      // Suivi des révisions (algorithme de répétition espacée)
      table.timestamp('last_studied_at').nullable()
      table.timestamp('next_review_at').nullable()
      table.integer('review_interval_days').defaultTo(1)

      // État
      table.enum('status', [
        'not_started',
        'in_progress',
        'mastered',
        'needs_review',
      ]).defaultTo('not_started')

      // Une progression est unique par utilisateur/topic
      table.unique(['user_id', 'topic_id'])

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable('progress')
    this.schema.dropTable('exercises')
  }
}