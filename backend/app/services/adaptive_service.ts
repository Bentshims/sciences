// import claudeService from '#services/claude_service'
import Session from '#models/session'
import Progress from '#models/progress'
import Exercise from '#models/exercise'
import type User from '#models/user'
import type Topic from '#models/topic'

// ─── Types ─────────────────────────────────────────────────────────────────

/**
 * Profil pédagogique calculé en temps réel pendant une session.
 * Synthèse de tous les signaux observés pour guider Claude.
 */
export interface PedagogicalProfile {
  // Niveau détecté pendant cette session
  detectedLevel: 'debutant' | 'intermediaire' | 'avance'

  // Rythme d'apprentissage
  pace: 'lent' | 'normal' | 'rapide'

  // État émotionnel/cognitif détecté
  cognitiveState: 'struggling' | 'focused' | 'excelling' | 'fatigued'

  // Recommandations d'adaptation
  recommendations: AdaptationRecommendation[]

  // Métriques brutes utilisées pour le calcul
  metrics: SessionMetrics
}

export interface AdaptationRecommendation {
  type:
    | 'simplify_explanation'    // simplifier le niveau d'explication
    | 'increase_difficulty'     // augmenter la difficulté
    | 'add_more_examples'       // donner plus d'exemples avant les exercices
    | 'slow_down'               // ralentir le rythme
    | 'speed_up'                // accélérer
    | 'encourage'               // l'utilisateur a besoin de motivation
    | 'take_break'              // suggérer une pause
    | 'review_prerequisites'    // revoir les prérequis avant de continuer
    | 'switch_approach'         // changer d'approche pédagogique
  priority: 'low' | 'medium' | 'high'
  reason: string
  claudeInstruction: string    // instruction directe à injecter dans le prompt Claude
}

export interface SessionMetrics {
  successRate: number          // taux de réussite actuel
  avgTimePerExercise: number   // temps moyen par exercice (secondes)
  hintsUsedRate: number        // ratio indices / exercices
  consecutiveErrors: number    // erreurs consécutives
  consecutiveSuccesses: number // succès consécutifs
  totalAttempts: number
  sessionDurationMinutes: number
}

export interface AdaptationDecision {
  shouldAdjustDifficulty: boolean
  newDifficulty?: 'facile' | 'moyen' | 'difficile'
  shouldSwitchPhase: boolean
  nextPhase?: 'theory' | 'examples' | 'exercises' | 'review'
  systemPromptAddition: string   // texte à ajouter au system prompt Claude
  messageToUser?: string         // message direct à afficher à l'utilisateur
}

// ─── Service ───────────────────────────────────────────────────────────────

export class AdaptiveService {

  // ─── Analyse en temps réel ────────────────────────────────────────────────

  /**
   * Analyse l'état de la session en cours et retourne le profil pédagogique.
   * Appelé après chaque exercice soumis pour adapter le comportement de Claude.
   */
  async analyzSession(params: {
    user: User
    session: Session
    topic: Topic
    progress: Progress | null
  }): Promise<PedagogicalProfile> {
    const { user, session, topic, progress } = params

    // Calcul des métriques brutes
    const metrics = await this.computeSessionMetrics(session)

    // Détection du niveau actuel
    const detectedLevel = this.detectLevel(metrics, user.level, progress)

    // Détection du rythme
    const pace = this.detectPace(metrics, progress)

    // Détection de l'état cognitif
    const cognitiveState = this.detectCognitiveState(metrics)

    // Génération des recommandations d'adaptation
    const recommendations = this.generateRecommendations(
      metrics,
      cognitiveState,
      detectedLevel,
      user.level,
      progress
    )

    // Mise à jour du niveau détecté dans la session si différent
    if (detectedLevel !== session.detectedLevel) {
      session.detectedLevel = detectedLevel
      await session.save()
    }

    return { detectedLevel, pace, cognitiveState, recommendations, metrics }
  }

  /**
   * Prend une décision d'adaptation concrète basée sur le profil pédagogique.
   * Retourne les instructions à injecter dans Claude et les actions à effectuer.
   */
  async decide(params: {
    profile: PedagogicalProfile
    session: Session
    progress: Progress | null
  }): Promise<AdaptationDecision> {
    const { profile, session, progress } = params

    const { metrics, cognitiveState, recommendations } = profile

    // Instructions à ajouter au system prompt Claude
    const promptAdditions: string[] = []
    let messageToUser: string | undefined
    let shouldAdjustDifficulty = false
    let newDifficulty: 'facile' | 'moyen' | 'difficile' | undefined
    let shouldSwitchPhase = false
    let nextPhase: 'theory' | 'examples' | 'exercises' | 'review' | undefined

    // ── Traitement de chaque recommandation par priorité ──
    const highPriority = recommendations.filter((r) => r.priority === 'high')
    const medPriority = recommendations.filter((r) => r.priority === 'medium')

    for (const rec of [...highPriority, ...medPriority]) {
      promptAdditions.push(rec.claudeInstruction)

      switch (rec.type) {
        case 'simplify_explanation':
          shouldAdjustDifficulty = true
          newDifficulty = 'facile'
          // Retour à la théorie si trop d'erreurs en exercices
          if (session.phase === 'exercises' && metrics.consecutiveErrors >= 3) {
            shouldSwitchPhase = true
            nextPhase = 'examples'
          }
          break

        case 'increase_difficulty':
          shouldAdjustDifficulty = true
          newDifficulty = 'difficile'
          break

        case 'review_prerequisites':
          shouldSwitchPhase = true
          nextPhase = 'theory'
          messageToUser =
            '📚 On va revoir quelques bases avant de continuer — ça aidera à consolider la suite !'
          break

        case 'take_break':
          messageToUser =
            '☕ Tu travailles depuis un moment ! Une petite pause de 5 minutes serait bénéfique pour mieux mémoriser.'
          break

        case 'encourage':
          // Claude s'en charge via l'instruction dans le prompt
          break
      }
    }

    return {
      shouldAdjustDifficulty,
      newDifficulty,
      shouldSwitchPhase,
      nextPhase,
      systemPromptAddition: promptAdditions.join('\n'),
      messageToUser,
    }
  }

  /**
   * Construit l'addition au system prompt à injecter dans Claude
   * en fonction du profil pédagogique actuel.
   * Appelé avant chaque envoi de message à Claude pendant une session.
   */
  async buildPromptAddition(params: {
    user: User
    session: Session
    topic: Topic
    progress: Progress | null
  }): Promise<string> {
    const profile = await this.analyzSession(params)
    const decision = await this.decide({
      profile,
      session: params.session,
      progress: params.progress,
    })
    return decision.systemPromptAddition
  }

  /**
   * Sauvegarde les notes de Claude sur la session pour adapter la prochaine.
   * Appelé en fin de session.
   */
  async saveSessionNotes(params: {
    user: User
    session: Session
    topic: Topic
    profile: PedagogicalProfile
  }): Promise<void> {
    const { session, profile } = params

    const notes = [
      `Niveau détecté : ${profile.detectedLevel}`,
      `Rythme : ${profile.pace}`,
      `État cognitif : ${profile.cognitiveState}`,
      `Taux de réussite : ${profile.metrics.successRate}%`,
      `Indices utilisés : ${session.hintsUsed}`,
      profile.recommendations.length > 0
        ? `Recommandations : ${profile.recommendations.map((r) => r.type).join(', ')}`
        : '',
    ]
      .filter(Boolean)
      .join(' | ')

    session.claudeSessionNotes = notes
    await session.save()
  }

  // ─── Détection du niveau ──────────────────────────────────────────────────

  /**
   * Détecte le niveau réel de l'utilisateur pendant la session.
   * Combine le taux de réussite, le temps passé et l'historique de progression.
   */
  private detectLevel(
    metrics: SessionMetrics,
    declaredLevel: 'debutant' | 'intermediaire' | 'avance',
    progress: Progress | null
  ): 'debutant' | 'intermediaire' | 'avance' {
    const { successRate, hintsUsedRate, avgTimePerExercise } = metrics

    // Si pas assez d'exercices pour juger → on garde le niveau déclaré
    if (metrics.totalAttempts < 3) return declaredLevel

    // Signaux de difficulté → niveau inférieur
    if (successRate < 40 || hintsUsedRate > 0.7) return 'debutant'

    // Signaux de maîtrise → niveau supérieur
    if (successRate > 85 && hintsUsedRate < 0.1 && avgTimePerExercise < 120) return 'avance'

    // Zone intermédiaire
    if (successRate > 60 && hintsUsedRate < 0.4) return 'intermediaire'

    // Par défaut, on reste au niveau de progression historique ou déclaré
    return progress?.currentLevel ?? declaredLevel
  }

  /**
   * Détecte le rythme d'apprentissage selon le temps moyen par exercice.
   */
  private detectPace(
    metrics: SessionMetrics,
    progress: Progress | null
  ): 'lent' | 'normal' | 'rapide' {
    const { avgTimePerExercise, successRate } = metrics

    // Rapide : résout vite ET correctement
    if (avgTimePerExercise < 90 && successRate > 75) return 'rapide'

    // Lent : prend beaucoup de temps ou utilise beaucoup d'indices
    if (avgTimePerExercise > 300 || metrics.hintsUsedRate > 0.6) return 'lent'

    return 'normal'
  }

  /**
   * Détecte l'état cognitif de l'utilisateur.
   */
  private detectCognitiveState(
    metrics: SessionMetrics
  ): 'struggling' | 'focused' | 'excelling' | 'fatigued' {
    const { successRate, consecutiveErrors, consecutiveSuccesses, sessionDurationMinutes } = metrics

    // Fatigué : session longue + dégradation des performances
    if (sessionDurationMinutes > 45 && successRate < 60) return 'fatigued'

    // En difficulté : plusieurs erreurs consécutives
    if (consecutiveErrors >= 3 || successRate < 40) return 'struggling'

    // Excellence : succès consécutifs et bon taux global
    if (consecutiveSuccesses >= 4 && successRate > 85) return 'excelling'

    return 'focused'
  }

  // ─── Génération des recommandations ──────────────────────────────────────

  /**
   * Génère la liste des recommandations d'adaptation
   * basées sur toutes les métriques observées.
   */
  private generateRecommendations(
    metrics: SessionMetrics,
    cognitiveState: string,
    detectedLevel: string,
    declaredLevel: string,
    progress: Progress | null
  ): AdaptationRecommendation[] {
    const recommendations: AdaptationRecommendation[] = []

    // ── En difficulté ──
    if (cognitiveState === 'struggling') {
      recommendations.push({
        type: 'encourage',
        priority: 'high',
        reason: `${metrics.consecutiveErrors} erreurs consécutives`,
        claudeInstruction:
          '⚠️ ADAPTATION : L\'étudiant est en difficulté. Sois très encourageant, décompose chaque concept en micro-étapes, utilise des analogies simples et concrètes.',
      })

      if (metrics.successRate < 30) {
        recommendations.push({
          type: 'review_prerequisites',
          priority: 'high',
          reason: `Taux de réussite critique : ${metrics.successRate}%`,
          claudeInstruction:
            '⚠️ ADAPTATION : Reviens aux bases. Vérifie que les prérequis sont maîtrisés avant de continuer.',
        })
      } else {
        recommendations.push({
          type: 'simplify_explanation',
          priority: 'high',
          reason: 'Taux de réussite insuffisant',
          claudeInstruction:
            '⚠️ ADAPTATION : Simplifie tes explications. Utilise des exemples numériques concrets avant les formules abstraites.',
        })
      }

      if (metrics.hintsUsedRate > 0.7) {
        recommendations.push({
          type: 'add_more_examples',
          priority: 'medium',
          reason: 'Utilisation excessive des indices',
          claudeInstruction:
            'ADAPTATION : Donne 1-2 exemples résolus supplémentaires avant de proposer un nouvel exercice.',
        })
      }
    }

    // ── Excellence ──
    if (cognitiveState === 'excelling') {
      recommendations.push({
        type: 'increase_difficulty',
        priority: 'medium',
        reason: `${metrics.consecutiveSuccesses} succès consécutifs`,
        claudeInstruction:
          '🚀 ADAPTATION : L\'étudiant maîtrise parfaitement. Augmente progressivement la difficulté, propose des variantes plus complexes et des cas limites.',
      })

      if (detectedLevel !== declaredLevel) {
        recommendations.push({
          type: 'speed_up',
          priority: 'low',
          reason: 'Niveau détecté supérieur au niveau déclaré',
          claudeInstruction:
            'ADAPTATION : Tu peux avancer plus vite, sauter les explications de base et aller directement aux concepts avancés.',
        })
      }
    }

    // ── Fatigué ──
    if (cognitiveState === 'fatigued') {
      recommendations.push({
        type: 'take_break',
        priority: 'high',
        reason: `Session de ${metrics.sessionDurationMinutes} minutes avec dégradation`,
        claudeInstruction:
          '☕ ADAPTATION : L\'étudiant montre des signes de fatigue. Allège le contenu, propose des exercices plus courts et suggère une pause si les erreurs continuent.',
      })
    }

    // ── Rythme lent ──
    if (metrics.avgTimePerExercise > 300 && cognitiveState !== 'struggling') {
      recommendations.push({
        type: 'slow_down',
        priority: 'low',
        reason: 'Temps moyen par exercice élevé',
        claudeInstruction:
          'ADAPTATION : L\'étudiant prend son temps — c\'est bien. Ne le presse pas, laisse-le réfléchir à son rythme.',
      })
    }

    return recommendations
  }

  // ─── Calcul des métriques ─────────────────────────────────────────────────

  /**
   * Calcule toutes les métriques brutes d'une session.
   */
  private async computeSessionMetrics(session: Session): Promise<SessionMetrics> {
    // Récupération des exercices de la session
    const exercises = await Exercise.query()
      .where('session_id', session.id)
      .orderBy('created_at', 'asc')

    const totalAttempts = exercises.length
    const correctCount = exercises.filter((e) => e.isCorrect === true).length
    const successRate = totalAttempts > 0
      ? Math.round((correctCount / totalAttempts) * 100)
      : 0

    // Temps moyen par exercice
    const totalTime = exercises.reduce((sum, e) => sum + e.timeSpentSeconds, 0)
    const avgTimePerExercise = totalAttempts > 0
      ? Math.round(totalTime / totalAttempts)
      : 0

    // Ratio indices / exercices
    const hintsUsedRate = totalAttempts > 0
      ? session.hintsUsed / totalAttempts
      : 0

    // Erreurs et succès consécutifs (depuis la fin)
    let consecutiveErrors = 0
    let consecutiveSuccesses = 0

    for (let i = exercises.length - 1; i >= 0; i--) {
      const ex = exercises[i]
      if (ex.isCorrect === false) {
        if (consecutiveSuccesses === 0) consecutiveErrors++
        else break
      } else if (ex.isCorrect === true) {
        if (consecutiveErrors === 0) consecutiveSuccesses++
        else break
      } else {
        break // exercice sans résultat → on s'arrête
      }
    }

    // Durée de la session
    const sessionDurationMinutes = session.durationMinutes > 0
      ? session.durationMinutes
      : Math.round(session.startedAt.diffNow('minutes').minutes * -1)

    return {
      successRate,
      avgTimePerExercise,
      hintsUsedRate,
      consecutiveErrors,
      consecutiveSuccesses,
      totalAttempts,
      sessionDurationMinutes,
    }
  }
}

// ─── Export singleton ──────────────────────────────────────────────────────

export default new AdaptiveService()