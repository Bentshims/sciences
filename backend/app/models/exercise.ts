import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Session from './session.js'
import Topic from './topic.js'

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SolutionStep {
  step: number
  description: string
  formula?: string
}

export interface QuestionData {
  type: 'calcul' | 'demonstration' | 'qcm' | 'graphique' | 'application'
  formula?: string
  choices?: string[]       // pour les QCM
  graph_params?: object    // paramètres pour le graphe interactif
  steps?: SolutionStep[]
}

export type ExerciseType = 'calcul' | 'demonstration' | 'qcm' | 'graphique' | 'application'
export type ExerciseDifficulty = 'facile' | 'moyen' | 'difficile'

// ─── Model ─────────────────────────────────────────────────────────────────

export default class Exercise extends BaseModel {
  // ─── Colonnes ──────────────────────────────────────────────────────────────

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare sessionId: number

  @column()
  declare topicId: number

  @column()
  declare question: string

  @column()
  declare questionData: QuestionData | null

  @column()
  declare type: ExerciseType

  @column()
  declare difficulty: ExerciseDifficulty

  @column()
  declare userAnswer: string | null

  @column()
  declare correctAnswer: string

  @column()
  declare claudeFeedback: string | null

  @column()
  declare solutionSteps: SolutionStep[] | null

  @column()
  declare isCorrect: boolean | null

  @column()
  declare attempts: number

  @column()
  declare timeSpentSeconds: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // ─── Relations ─────────────────────────────────────────────────────────────

  @belongsTo(() => Session, { foreignKey: 'sessionId' })
  declare session: BelongsTo<typeof Session>

  @belongsTo(() => Topic, { foreignKey: 'topicId' })
  declare topic: BelongsTo<typeof Topic>

  // ─── Méthodes utiles ───────────────────────────────────────────────────────

  /**
   * Enregistre la tentative de l'utilisateur.
   */
  async submitAnswer(answer: string): Promise<void> {
    this.userAnswer = answer
    this.attempts += 1
    await this.save()
  }

  /**
   * Applique le résultat de l'évaluation par Claude.
   */
  async applyEvaluation(params: {
    isCorrect: boolean
    feedback: string
    solutionSteps?: SolutionStep[]
  }): Promise<void> {
    this.isCorrect = params.isCorrect
    this.claudeFeedback = params.feedback
    if (params.solutionSteps) {
      this.solutionSteps = params.solutionSteps
    }
    await this.save()
  }

  /**
   * Construit le prompt d'évaluation à envoyer à Claude.
   * Claude recevra la question, la réponse attendue et la réponse de l'utilisateur.
   */
  buildEvaluationPrompt(): string {
    return `Tu es un professeur de mathématiques/physique bienveillant.

Voici l'exercice :
Question : ${this.question}
Réponse correcte : ${this.correctAnswer}
Réponse de l'étudiant : ${this.userAnswer}
Nombre de tentatives : ${this.attempts}

Évalue la réponse et réponds UNIQUEMENT en JSON :
{
  "is_correct": true|false,
  "feedback": "explication claire et encourageante",
  "partial_credit": true|false,
  "solution_steps": [
    { "step": 1, "description": "...", "formula": "..." }
  ],
  "encouragement": "message de motivation personnalisé"
}`
  }

  /**
   * Retourne true si l'exercice n'a pas encore été répondu.
   */
  get isPending(): boolean {
    return this.userAnswer === null
  }

  /**
   * Retourne true si l'étudiant a utilisé plusieurs tentatives.
   */
  get hadDifficulty(): boolean {
    return this.attempts > 1
  }
}