import { DateTime } from 'luxon'
import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import Session from './session.js'
import Progress from './progress.js'

export type TopicCategory =
  | 'algebre'
  | 'analyse'
  | 'geometrie'
  | 'probabilites'
  | 'physique_classique'
  | 'physique_quantique'
  | 'relativite'

export default class Topic extends BaseModel {
  // ─── Colonnes ──────────────────────────────────────────────────────────────

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare slug: string

  @column()
  declare title: string

  @column()
  declare description: string

  @column()
  declare category: TopicCategory

  @column()
  declare orderInCategory: number

  @column()
  declare prerequisites: string[]

  @column()
  declare difficulty: number // 1-5

  @column()
  declare estimatedHours: number

  @column({ serializeAs: null }) // prompts internes, non exposés au frontend
  declare theoryPrompt: string | null

  @column({ serializeAs: null })
  declare exercisePrompt: string | null

  @column()
  declare isQuantum: boolean

  @column()
  declare isActive: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // ─── Relations ─────────────────────────────────────────────────────────────

  @hasMany(() => Session, {
    foreignKey: 'topicId',
  })
  declare sessions: HasMany<typeof Session>

  @hasMany(() => Progress, {
    foreignKey: 'topicId',
  })
  declare progresses: HasMany<typeof Progress>

  // ─── Méthodes utiles ───────────────────────────────────────────────────────

  /**
   * Construit le prompt système que Claude utilisera pour expliquer ce topic.
   * On fusionne le prompt de base avec le niveau de l'utilisateur.
   */
  buildTheoryPrompt(userLevel: 'debutant' | 'intermediaire' | 'avance'): string {
    const base = this.theoryPrompt ?? `Tu es un professeur expert en ${this.title}.`

    const levelInstructions: Record<string, string> = {
      debutant: 'Utilise un langage simple, beaucoup d\'analogies et d\'exemples concrets. Évite le jargon technique sans l\'expliquer.',
      intermediaire: 'Équilibre entre intuition et rigueur mathématique. Tu peux utiliser les notations standard.',
      avance: 'Sois rigoureux et précis. Tu peux utiliser les démonstrations formelles et les notations avancées.',
    }

    return `${base}\n\nNiveau de l'utilisateur : ${levelInstructions[userLevel]}`
  }

  /**
   * Construit le prompt pour générer un exercice adapté au niveau.
   */
  buildExercisePrompt(
    userLevel: 'debutant' | 'intermediaire' | 'avance',
    previousErrors?: string[]
  ): string {
    const base = this.exercisePrompt ?? `Génère un exercice sur le topic : ${this.title}.`

    const difficultyMap = { debutant: 'facile', intermediaire: 'moyen', avance: 'difficile' }

    let prompt = `${base}\n\nDifficulté : ${difficultyMap[userLevel]}.`

    if (previousErrors && previousErrors.length > 0) {
      prompt += `\n\nL'utilisateur a eu des difficultés avec : ${previousErrors.join(', ')}. Insiste sur ces points dans l'exercice.`
    }

    prompt += `\n\nRéponds UNIQUEMENT en JSON avec ce format :
{
  "question": "...",
  "type": "calcul|demonstration|qcm|graphique|application",
  "correct_answer": "...",
  "solution_steps": [
    { "step": 1, "description": "...", "formula": "..." }
  ],
  "hints": ["indice 1", "indice 2"]
}`

    return prompt
  }

  /**
   * Retourne le label lisible de la catégorie.
   */
  get categoryLabel(): string {
    const labels: Record<TopicCategory, string> = {
      algebre: 'Algèbre',
      analyse: 'Analyse',
      geometrie: 'Géométrie',
      probabilites: 'Probabilités',
      physique_classique: 'Physique Classique',
      physique_quantique: 'Physique Quantique',
      relativite: 'Relativité',
    }
    return labels[this.category]
  }

  /**
   * Retourne les étoiles de difficulté (pour l'UI).
   * ex: difficulty 3 → "★★★☆☆"
   */
  get difficultyStars(): string {
    return '★'.repeat(this.difficulty) + '☆'.repeat(5 - this.difficulty)
  }
}