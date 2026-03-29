import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'messages'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()

      table.integer('user_id').unsigned().notNullable()
        .references('id').inTable('users').onDelete('CASCADE')

      // Une conversation peut être liée à une session ou à l'onboarding
      table.integer('session_id').unsigned().nullable()
        .references('id').inTable('sessions').onDelete('CASCADE')

      // Contexte du message
      table.enum('context', [
        'onboarding',   // questionnaire initial
        'planning',     // génération / ajustement du planning
        'theory',       // explication théorique
        'example',      // démonstration d'un exemple
        'exercise',     // pendant un exercice
        'correction',   // feedback sur une réponse
        'hint',         // indice demandé par l'utilisateur
        'freeform',     // question libre hors session
      ]).defaultTo('freeform')

      // Rôle du message (format Claude API)
      table.enum('role', ['user', 'assistant']).notNullable()

      // Contenu du message
      table.text('content').notNullable()

      // Métadonnées Claude (tokens utilisés, modèle, etc.)
      table.jsonb('claude_meta').nullable()
      // ex: { "model": "claude-opus-4-6", "input_tokens": 320, "output_tokens": 840 }

      // Si le message contient des formules LaTeX ou du code
      table.boolean('has_latex').defaultTo(false)
      table.boolean('has_code').defaultTo(false)

      // Feedback utilisateur sur la réponse de Claude
      table.enum('feedback', ['helpful', 'not_helpful', 'too_complex', 'too_simple']).nullable()

      table.timestamp('created_at').notNullable()

      // Index pour récupérer rapidement l'historique d'une session
      table.index(['session_id', 'created_at'])
      table.index(['user_id', 'context'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}