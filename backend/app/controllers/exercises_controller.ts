import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import vine from '@vinejs/vine'
import exerciseService from '#services/exercise_service'
import Session from '#models/session'
import Exercise from '#models/exercise'
import Topic from '#models/topic'
import Progress from '#models/progress'
import User from '#models/user'

// ─── Validators ────────────────────────────────────────────────────────────

const submitValidator = vine.create({
  answer: vine.string().trim().minLength(1).maxLength(5000),
})

const feedbackValidator = vine.create({
  feedback: vine.enum(['helpful', 'not_helpful', 'too_complex', 'too_simple']),
})

// ─── Controller ────────────────────────────────────────────────────────────

@inject()
export default class ExercisesController {

  /**
   * POST /api/sessions/:sessionId/exercises/generate
   * Génère un nouvel exercice adapté au niveau de l'utilisateur
   * sur le topic de la session en cours.
   */
  async generate({ params, auth, response }: HttpContext) {
    const user = auth.getUserOrFail() as User

    const session = await Session.findOrFail(params.sessionId)

    if (session.userId !== user.id) {
      return response.forbidden({ message: 'Accès refusé.' })
    }

    if (session.status !== 'active') {
      return response.badRequest({ message: 'La session est terminée.' })
    }

    if (session.phase !== 'exercises') {
      return response.badRequest({
        message: `Tu es en phase "${session.phase}". Passe en phase "exercises" d'abord.`,
      })
    }

    const topic = await Topic.findOrFail(session.topicId)
    const progress = await Progress.query()
      .where('user_id', user.id)
      .where('topic_id', topic.id)
      .first()

    const exercise = await exerciseService.generate({
      user,
      topic,
      session,
      progress: progress ?? null,
    })

    return response.created({
      exercise: {
        id: exercise.id,
        question: exercise.question,
        type: exercise.type,
        difficulty: exercise.difficulty,
        // On n'expose PAS correct_answer ni solution_steps avant soumission
        questionData: exercise.questionData
          ? {
              type: exercise.questionData.type,
              formula: exercise.questionData.formula,
              choices: exercise.questionData.choices, // pour les QCM
            }
          : null,
      },
    })
  }

  /**
   * POST /api/exercises/:id/submit
   * Soumet la réponse de l'utilisateur à un exercice.
   * Claude évalue et retourne feedback + correction détaillée.
   */
  async submit({ params, request, auth, response }: HttpContext) {
    const user = auth.getUserOrFail() as User

    const exercise = await Exercise.query()
      .where('id', params.id)
      .preload('session')
      .firstOrFail()

    if (exercise.session.userId !== user.id) {
      return response.forbidden({ message: 'Accès refusé.' })
    }

    if (exercise.isCorrect !== null) {
      return response.badRequest({
        message: 'Cet exercice a déjà été corrigé.',
        wasCorrect: exercise.isCorrect,
      })
    }

    const { answer } = await request.validateUsing(submitValidator)

    const result = await exerciseService.submitAnswer({
      user,
      exercise,
      session: exercise.session,
      answer,
    })

    return response.ok({
      isCorrect: result.evaluation.isCorrect,
      feedback: result.evaluation.feedback,
      encouragement: result.evaluation.encouragement,
      solutionSteps: result.evaluation.solutionSteps,
      correctAnswer: exercise.correctAnswer,
      attempts: exercise.attempts,
      // Prochaine difficulté suggérée par Claude
      nextDifficulty: result.evaluation.nextDifficulty,
    })
  }

  /**
   * POST /api/exercises/:id/hint
   * Demande un indice à Claude sans révéler la solution.
   * Incrémente le compteur d'indices de la session.
   */
  async hint({ params, auth, response }: HttpContext) {
    const user = auth.getUserOrFail() as User

    const exercise = await Exercise.query()
      .where('id', params.id)
      .preload('session')
      .firstOrFail()

    if (exercise.session.userId !== user.id) {
      return response.forbidden({ message: 'Accès refusé.' })
    }

    if (exercise.isCorrect !== null) {
      return response.badRequest({
        message: 'L\'exercice est déjà corrigé — pas besoin d\'indice.',
      })
    }

    const hint = await exerciseService.requestHint({
      user,
      exercise,
      session: exercise.session,
    })

    return response.ok({
      hint,
      hintsUsed: exercise.session.hintsUsed,
    })
  }

  /**
   * GET /api/sessions/:sessionId/exercises
   * Retourne tous les exercices d'une session avec leurs résultats.
   * Utilisé pour afficher le bilan de fin de session.
   */
  async index({ params, auth, response }: HttpContext) {
    const user = auth.getUserOrFail() as User

    const session = await Session.findOrFail(params.sessionId)

    if (session.userId !== user.id) {
      return response.forbidden({ message: 'Accès refusé.' })
    }

    const exercises = await exerciseService.getSessionExercises(session.id)

    return response.ok({
      exercises: exercises.map((e) => ({
        id: e.id,
        question: e.question,
        type: e.type,
        difficulty: e.difficulty,
        userAnswer: e.userAnswer,
        correctAnswer: e.correctAnswer,
        isCorrect: e.isCorrect,
        attempts: e.attempts,
        claudeFeedback: e.claudeFeedback,
        solutionSteps: e.solutionSteps,
        timeSpentSeconds: e.timeSpentSeconds,
      })),
      summary: {
        total: exercises.length,
        correct: exercises.filter((e) => e.isCorrect === true).length,
        incorrect: exercises.filter((e) => e.isCorrect === false).length,
        pending: exercises.filter((e) => e.isCorrect === null).length,
      },
    })
  }

  /**
   * POST /api/exercises/:id/feedback
   * Enregistre le feedback de l'utilisateur sur la correction de Claude.
   * Utile pour améliorer la qualité des réponses.
   */
  async feedback({ params, request, auth, response }: HttpContext) {
    const user = auth.getUserOrFail() as User

    const exercise = await Exercise.query()
      .where('id', params.id)
      .preload('session')
      .firstOrFail()

    if (exercise.session.userId !== user.id) {
      return response.forbidden({ message: 'Accès refusé.' })
    }

    const { feedback } = await request.validateUsing(feedbackValidator)

    // On stocke le feedback sur le dernier message de correction Claude
    // via le model Message (déjà sauvegardé par claude_service)
    const Message = await import('#models/message').then((m) => m.default)
    const lastMessage = await Message.query()
      .where('session_id', exercise.sessionId)
      .where('context', 'correction')
      .where('role', 'assistant')
      .orderBy('created_at', 'desc')
      .first()

    if (lastMessage) {
      await lastMessage.submitFeedback(feedback)
    }

    return response.ok({ message: 'Feedback enregistré, merci !' })
  }
}