import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'topics'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      
      // Colonnes principales
      table.string('slug').notNullable().unique()
      table.string('title').notNullable()
      table.text('description').notNullable()
      table.string('category').notNullable()
      table.integer('order_in_category').notNullable()
      
      // Colonnes de configuration
      table.json('prerequisites').nullable()
      table.integer('difficulty').notNullable().defaultTo(1)
      table.integer('estimated_hours').notNullable().defaultTo(1)
      table.boolean('is_quantum').notNullable().defaultTo(false)
      table.boolean('is_active').notNullable().defaultTo(true)
      
      // Colonnes pour Claude
      table.text('theory_prompt').nullable()
      table.text('exercise_prompt').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}