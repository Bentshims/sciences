import claudeService from '#services/claude_service'
import Exercise from '#models/exercise'
import Session from '#models/session'
import Progress from '#models/progress'
import type Topic from '#models/topic'
import type User from '#models/user'

// ─── Types ─────────────────────────────────────────────────────────────────

export interface GeneratedExercise {
  question: string
  type: 'calcul' | 'demonstration' | 'qcm' | 'graphique' | 'application'
  correct_answer: string
  solution_steps: { step: number; description: string; formula?: string }[]
  hints: string[]
}

export interface EvaluationResult {
  isCorrect: boolean
  feedback: string
  solutionSteps: { step: number; description: string; formula?: string }[]
  encouragement: string
  nextDifficulty: 'facile' | 'moyen' | 'difficile'
}

export interface SubmitAnswerResult {
  evaluation: EvaluationResult
  exercise: Exercise
  sessionUpdated: boolean
}

// ─── Service ───────────────────────────────────────────────────────────────

export class ExerciseService {

  // ─── Génération ────────────────────────────────────────────────────────────

  /**
   * Génère un nouvel exercice adapté au niveau de l'utilisateur.
   * Analyse les erreurs précédentes pour cibler les points faibles.
   */
  async generate(params: {
    user: User
    topic: Topic
    session: Session
    progress: Progress | null
  }): Promise<Exercise> {
    const { user, topic, session, progress } = params

    // Récupération des erreurs récentes sur ce topic pour les passer à Claude
    const previousErrors = await this.getRecentErrors(user.id, topic.id)

    // Génération par Claude
    const generated = await claudeService.generateExercise({
      user,
      topic,
      session,
      progress,
      previousErrors,
    }) as GeneratedExercise

    this.validateGeneratedExercise(generated)

    // Sauvegarde en base
    const exercise = await Exercise.create({
      sessionId: session.id,
      topicId: topic.id,
      question: generated.question,
      questionData: {
        type: generated.type,
        steps: generated.solution_steps,
      },
      type: generated.type,
      difficulty: this.mapDifficulty(user.level),
      correctAnswer: generated.correct_answer,
      solutionSteps: generated.solution_steps,
      attempts: 0,
    })

    // Mise à jour du compteur de la session
    await this.incrementSessionExercises(session)

    return exercise
  }

  // ─── Soumission ────────────────────────────────────────────────────────────

  /**
   * Soumet la réponse d'un utilisateur et déclenche l'évaluation par Claude.
   * Met à jour la session et retourne le feedback complet.
   */
  async submitAnswer(params: {
    user: User
    exercise: Exercise
    session: Session
    answer: string
  }): Promise<SubmitAnswerResult> {
    const { user, exercise, session, answer } = params

    // Enregistrement de la tentative
    await exercise.submitAnswer(answer)

    // Évaluation par Claude
    const rawEvaluation = await claudeService.evaluateAnswer({
      user,
      session,
      exerciseQuestion: exercise.question,
      correctAnswer: exercise.correctAnswer,
      userAnswer: answer,
      attempts: exercise.attempts,
    }) as EvaluationResult & {
      is_correct: boolean
      feedback: string
      solution_steps: { step: number; description: string; formula?: string }[]
      encouragement: string
      next_difficulty: 'facile' | 'moyen' | 'difficile'
    }

    // Normalisation de la réponse Claude (snake_case → camelCase)
    const evaluation: EvaluationResult = {
      isCorrect: rawEvaluation.is_correct ?? rawEvaluation.isCorrect,
      feedback: rawEvaluation.feedback,
      solutionSteps: rawEvaluation.solution_steps ?? rawEvaluation.solutionSteps ?? [],
      encouragement: rawEvaluation.encouragement,
      nextDifficulty: rawEvaluation.next_difficulty ?? rawEvaluation.nextDifficulty ?? 'moyen',
    }

    // Application de l'évaluation sur l'exercice
    await exercise.applyEvaluation({
      isCorrect: evaluation.isCorrect,
      feedback: evaluation.feedback,
      solutionSteps: evaluation.solutionSteps,
    })

    // Mise à jour des métriques de la session
    const sessionUpdated = await this.updateSessionMetrics(session, evaluation.isCorrect)

    return { evaluation, exercise, sessionUpdated }
  }

  // ─── Indice ────────────────────────────────────────────────────────────────

  /**
   * Demande un indice à Claude pour débloquer l'utilisateur
   * sans révéler la solution complète.
   */
  async requestHint(params: {
    user: User
    exercise: Exercise
    session: Session
  }): Promise<string> {
    const { user, exercise, session } = params

    const hintPrompt = `
L'étudiant est bloqué sur cet exercice (tentative ${exercise.attempts}) :
Question : ${exercise.question}
Donne un indice progressif qui oriente sans révéler la réponse.
L'indice doit débloquer le raisonnement, pas court-circuiter l'apprentissage.
Réponds uniquement avec le texte de l'indice.`

    const response = await claudeService.sendMessage({
      user,
      content: hintPrompt,
      context: 'hint',
      sessionId: session.id,
      session,
    })

    // Incrémentation du compteur d'indices
    session.hintsUsed += 1
    await session.save()

    return response.content
  }

  // ─── Récupération ──────────────────────────────────────────────────────────

  /**
   * Retourne tous les exercices d'une session avec leurs résultats.
   */
  async getSessionExercises(sessionId: number): Promise<Exercise[]> {
    return Exercise.query()
      .where('session_id', sessionId)
      .orderBy('created_at', 'asc')
  }

  /**
   * Retourne les exercices ratés d'un utilisateur sur un topic.
   * Utilisé pour cibler les révisions.
   */
  async getFailedExercises(userId: number, topicId: number): Promise<Exercise[]> {
    return Exercise.query()
      .where('topic_id', topicId)
      .where('is_correct', false)
      .whereHas('session', (query) => {
        query.where('user_id', userId)
      })
      .orderBy('created_at', 'desc')
      .limit(10)
  }

  // ─── Helpers privés ────────────────────────────────────────────────────────

  /**
   * Récupère les descriptions des erreurs récentes sur un topic
   * pour les passer à Claude et cibler la génération d'exercices.
   */
  private async getRecentErrors(userId: number, topicId: number): Promise<string[]> {
    const failedExercises = await Exercise.query()
      .where('topic_id', topicId)
      .where('is_correct', false)
      .whereHas('session', (query) => {
        query.where('user_id', userId)
      })
      .orderBy('created_at', 'desc')
      .limit(5)

    return failedExercises
      .map((e) => e.claudeFeedback)
      .filter((f): f is string => f !== null)
  }

  /**
   * Traduit le niveau utilisateur en difficulté d'exercice.
   */
  private mapDifficulty(
    level: 'debutant' | 'intermediaire' | 'avance'
  ): 'facile' | 'moyen' | 'difficile' {
    const map = {
      debutant: 'facile',
      intermediaire: 'moyen',
      avance: 'difficile',
    } as const
    return map[level]
  }

  /**
   * Incrémente le compteur d'exercices tentés dans la session.
   */
  private async incrementSessionExercises(session: Session): Promise<void> {
    session.exercisesAttempted += 1
    await session.save()
  }

  /**
   * Met à jour les métriques de la session après évaluation.
   * Retourne true si la session a été modifiée.
   */
  private async updateSessionMetrics(
    session: Session,
    isCorrect: boolean
  ): Promise<boolean> {
    if (isCorrect) {
      session.exercisesCorrect += 1
    }
    await session.save()
    return true
  }

  /**
   * Valide la structure de l'exercice retourné par Claude.
   */
  private validateGeneratedExercise(exercise: GeneratedExercise): void {
    if (!exercise.question || !exercise.correct_answer) {
      throw new Error('Exercice Claude invalide — champs question ou correct_answer manquants.')
    }
    if (!Array.isArray(exercise.solution_steps)) {
      exercise.solution_steps = []
    }
    if (!Array.isArray(exercise.hints)) {
      exercise.hints = []
    }
  }
}

// ─── Export singleton ──────────────────────────────────────────────────────

export default new ExerciseService()