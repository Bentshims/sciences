import { DateTime } from 'luxon'
import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import vine from '@vinejs/vine'
import User from '#models/user'

// ─── Validators ────────────────────────────────────────────────────────────

const registerValidator = vine.compile(
  vine.object({
    fullName: vine.string().trim().minLength(2).maxLength(100),
    email: vine.string().email().normalizeEmail(),
    password: vine.string().minLength(8).maxLength(100),
  })
)

const loginValidator = vine.compile(
  vine.object({
    email: vine.string().email().normalizeEmail(),
    password: vine.string().minLength(1),
  })
)

// ─── Controller ────────────────────────────────────────────────────────────

@inject()
export default class AuthController {

  /**
   * POST /api/auth/register
   * Crée un nouveau compte utilisateur.
   * Le mot de passe est hashé automatiquement par AuthFinder.
   * L'onboarding n'est pas encore complété à ce stade.
   */
  async register({ request, response }: HttpContext) {
    const data = await request.validateUsing(registerValidator)

    // Vérification unicité email
    const existing = await User.findBy('email', data.email)
    if (existing) {
      return response.conflict({
        message: 'Un compte existe déjà avec cet email.',
      })
    }

    const user = await User.create({
      fullName: data.fullName,
      email: data.email,
      password: data.password,
      level: 'debutant',
      minutesPerDay: 30,
      onboardingCompleted: false,
    })

    return response.created({
      message: 'Compte créé avec succès.',
      user: user.serialize(),
    })
  }

  /**
   * POST /api/auth/login
   * Authentifie l'utilisateur et retourne un token d'accès.
   * Utilise verifyCredentials() fourni par AuthFinder.
   */
  async login({ request, response, auth }: HttpContext) {
    const data = await request.validateUsing(loginValidator)

    // verifyCredentials gère le hash check + lève une exception si invalide
    const user = await User.verifyCredentials(data.email, data.password)

    const token = await auth.use('api').createToken(user)

    // Mise à jour de la dernière activité
    user.lastActiveAt = DateTime.now()
    await user.save()

    return response.ok({
      message: 'Connexion réussie.',
      token: token.toJSON(),
      user: user.serialize(),
      onboardingCompleted: user.onboardingCompleted,
    })
  }

  /**
   * DELETE /api/auth/logout
   * Révoque le token courant.
   */
  async logout({ auth, response }: HttpContext) {
    await auth.use('api').invalidateToken()

    return response.ok({
      message: 'Déconnexion réussie.',
    })
  }

  /**
   * GET /api/auth/me
   * Retourne le profil de l'utilisateur connecté.
   * Utile au démarrage de l'app pour restaurer la session.
   */
  async me({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail() as User

    return response.ok({
      user: user.serialize(),
      onboardingCompleted: user.onboardingCompleted,
    })
  }
}