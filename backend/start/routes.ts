/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'

// ─── Import des controllers ────────────────────────────────────────────────
// Imports dynamiques recommandés par AdonisJS pour éviter les problèmes
// de chargement circulaire et optimiser le temps de démarrage.

const AuthController = () => import('#controllers/auth_controller')
const OnboardingsController = () => import('#controllers/onboardings_controller')
const PlansController = () => import('#controllers/plans_controller')
const SessionsController = () => import('#controllers/sessions_controller')
const ExercisesController = () => import('#controllers/exercises_controller')
const ProgressesController = () => import('#controllers/progresses_controller')
const TopicsController = () => import('#controllers/topics_controller')
const ClaudesController = () => import('#controllers/claudes_controller')

// ─── Routes publiques ─────────────────────────────────────────────────────
// Accessibles sans authentification

router.group(() => {

  // Auth
  router.post('/auth/register', [AuthController, 'register'])
  router.post('/auth/login', [AuthController, 'login'])

}).prefix('/api')

// ─── Routes protégées ─────────────────────────────────────────────────────
// Toutes ces routes nécessitent un token valide (middleware auth)

router.group(() => {

  // ── Auth ──────────────────────────────────────────────────────────────
  router.delete('/auth/logout', [AuthController, 'logout'])
  router.get('/auth/me', [AuthController, 'me'])

  // ── Onboarding ────────────────────────────────────────────────────────
  router.group(() => {
    router.get('/status', [OnboardingsController, 'status'])
    router.post('/message', [OnboardingsController, 'message'])
    router.post('/complete', [OnboardingsController, 'complete'])
  }).prefix('/onboarding')

  // ── Topics ────────────────────────────────────────────────────────────
  // /quantum et /search AVANT /:slug pour éviter les conflits de routing
  router.group(() => {
    router.get('/', [TopicsController, 'index'])
    router.get('/quantum', [TopicsController, 'quantum'])
    router.get('/search', [TopicsController, 'search'])
    router.get('/:slug', [TopicsController, 'show'])
  }).prefix('/topics')

  // ── Planning ──────────────────────────────────────────────────────────
  router.group(() => {
    router.get('/active', [PlansController, 'active'])
    router.get('/today', [PlansController, 'today'])
    router.get('/summary', [PlansController, 'summary'])
    router.post('/adjust', [PlansController, 'adjust'])
  }).prefix('/plans')

  // ── Sessions ──────────────────────────────────────────────────────────
  router.group(() => {
    router.post('/start', [SessionsController, 'start'])
    router.get('/:id', [SessionsController, 'show'])
    router.post('/:id/message', [SessionsController, 'message'])
    router.patch('/:id/phase', [SessionsController, 'nextPhase'])
    router.patch('/:id/complete', [SessionsController, 'complete'])

    // Exercices imbriqués dans les sessions
    router.post('/:sessionId/exercises/generate', [ExercisesController, 'generate'])
    router.get('/:sessionId/exercises', [ExercisesController, 'index'])
  }).prefix('/sessions')

  // ── Exercices ─────────────────────────────────────────────────────────
  router.group(() => {
    router.post('/:id/submit', [ExercisesController, 'submit'])
    router.post('/:id/hint', [ExercisesController, 'hint'])
    router.post('/:id/feedback', [ExercisesController, 'feedback'])
  }).prefix('/exercises')

  // ── Progression ───────────────────────────────────────────────────────
  router.group(() => {
    router.get('/', [ProgressesController, 'index'])
    router.get('/summary', [ProgressesController, 'summary'])
    router.get('/review-queue', [ProgressesController, 'reviewQueue'])
    router.get('/streak', [ProgressesController, 'streak'])
    router.get('/topics/:topicId', [ProgressesController, 'topic'])
  }).prefix('/progress')

  // ── Claude (questions libres) ─────────────────────────────────────────
  router.group(() => {
    router.post('/ask', [ClaudesController, 'ask'])
    router.get('/history', [ClaudesController, 'history'])
    router.get('/session-history/:sessionId', [ClaudesController, 'sessionHistory'])
    router.post('/feedback', [ClaudesController, 'feedback'])
    router.delete('/history', [ClaudesController, 'clearHistory'])
  }).prefix('/claude')

})
  .prefix('/api')
  .use(middleware.auth({ guards: ['api'] }))
