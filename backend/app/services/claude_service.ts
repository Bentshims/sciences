import env from '#start/env'
import Message, { type ClaudeMessage, type ClaudeMeta, type MessageContext } from '#models/message'
import type User from '#models/user'
import type Topic from '#models/topic'
import type Session from '#models/session'
import type Progress from '#models/progress'
import type LearningPlan from '#models/learning_plan'

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ClaudeResponse {
  content: string
  meta: ClaudeMeta
}

export interface SendMessageParams {
  user: User
  content: string
  context: MessageContext
  sessionId?: number
  // Contextes optionnels injectés dans le system prompt
  topic?: Topic
  session?: Session
  progress?: Progress
  learningPlan?: LearningPlan
}

export interface GeneratePlanParams {
  user: User
  onboardingHistory: ClaudeMessage[]
}

export interface GenerateExerciseParams {
  user: User
  topic: Topic
  session: Session
  progress: Progress | null
  previousErrors?: string[]
}

export interface EvaluateAnswerParams {
  user: User
  session: Session
  exerciseQuestion: string
  correctAnswer: string
  userAnswer: string
  attempts: number
}

// ─── Constantes ────────────────────────────────────────────────────────────

const CLAUDE_MODEL = 'claude-opus-4-6'
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'
const MAX_TOKENS = 2048
const MAX_HISTORY_MESSAGES = 20 // fenêtre de contexte glissante

// ─── Prompts système de base ───────────────────────────────────────────────

const BASE_SYSTEM_PROMPT = `Tu es QuantumLearn, un professeur expert en mathématiques et physique.
Tu t'adaptes TOUJOURS au niveau et au rythme de l'étudiant.
Tu es bienveillant, encourageant et pédagogue.
Tu utilises la notation LaTeX pour toutes les formules mathématiques (délimiteurs $...$ pour inline, \\[...\\] pour display).
Tu ne donnes jamais directement la réponse à un exercice — tu guides par des questions et des indices.
Tu détectes les difficultés et adaptes immédiatement ton approche.`

const ONBOARDING_SYSTEM_PROMPT = `${BASE_SYSTEM_PROMPT}

Tu es en train d'accueillir un nouvel étudiant. Ton rôle est de :
1. Le mettre à l'aise avec un accueil chaleureux
2. Comprendre ses objectifs (exam, curiosité, projet, etc.)
3. Évaluer son niveau actuel (quelques questions ciblées)
4. Identifier les notions qu'il veut apprendre
5. Connaître son temps disponible par jour
Pose UNE seule question à la fois. Sois naturel, pas robotique.
Une fois que tu as toutes les infos, dis exactement : "ONBOARDING_COMPLETE"`

const PLANNING_SYSTEM_PROMPT = `${BASE_SYSTEM_PROMPT}

Tu dois générer un planning d'apprentissage personnalisé en JSON.
Basé sur le profil de l'étudiant et ses réponses à l'onboarding, crée un planning structuré et réaliste.
Réponds UNIQUEMENT avec un objet JSON valide, sans markdown, sans backticks, sans texte avant ou après.`

// ─── Service principal ─────────────────────────────────────────────────────

export class ClaudeService {
  private apiKey: string

  constructor() {
    this.apiKey = env.get('ANTHROPIC_API_KEY') ?? '' as string
    if (!this.apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set')
    }
    if (!this.apiKey.startsWith('sk-')) {
      throw new Error('ANTHROPIC_API_KEY is not valid')
    }
    if (this.apiKey.length !== 59) {
      throw new Error('ANTHROPIC_API_KEY is not valid')
    }
    if (this.apiKey.length !== 59) {
      throw new Error('ANTHROPIC_API_KEY is not valid')
    }
    if (this.apiKey.length !== 59) {
      throw new Error('ANTHROPIC_API_KEY is not valid')
    }
  }


  // ─── Méthode centrale d'appel API ────────────────────────────────────────

  /**
   * Envoie une requête à l'API Claude et retourne la réponse.
   * C'est la seule méthode qui communique directement avec l'API.
   */
  private async call(params: {
    systemPrompt: string
    messages: ClaudeMessage[]
    maxTokens?: number
  }): Promise<ClaudeResponse> {
    const { systemPrompt, messages, maxTokens = MAX_TOKENS } = params

    const response = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages,
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(`Claude API error ${response.status}: ${JSON.stringify(error)}`)
    }

    const data = await response.json() as { content: { type: string; text: string }[]; model: string; usage: { input_tokens: number; output_tokens: number }; stop_reason: string }

    const content = data.content
      .filter((block: { type: string }) => block.type === 'text')
      .map((block: { text: string }) => block.text)
      .join('') as string

    const meta: ClaudeMeta = {
      model: data.model,
      input_tokens: data.usage.input_tokens,
      output_tokens: data.usage.output_tokens,
      stop_reason: data.stop_reason,
    }

    return { content, meta }
  }

  // ─── Construction du system prompt adaptatif ─────────────────────────────

  /**
   * Construit le system prompt complet en injectant tous les contextes disponibles.
   * Plus Claude a de contexte, mieux il adapte ses réponses.
   */
  private buildAdaptiveSystemPrompt(params: {
    context: MessageContext
    user: User
    topic?: Topic
    session?: Session
    progress?: Progress
    learningPlan?: LearningPlan
  }): string {
    const { context, user, topic, session, progress, learningPlan } = params

    const parts: string[] = [BASE_SYSTEM_PROMPT]

    // ── Profil utilisateur ──
    parts.push(`\n## Profil de l'étudiant\n${user.toClaudeContext()}`)

    // ── Contexte du topic ──
    if (topic) {
      const topicPrompt = topic.buildTheoryPrompt(user.level)
      parts.push(`\n## Topic en cours : ${topic.title}\n${topicPrompt}`)
    }

    // ── Progression sur ce topic ──
    if (progress) {
      parts.push(`\n## Progression sur ce topic\n${progress.toClaudeContext()}`)
    }

    // ── État de la session en cours ──
    if (session) {
      parts.push(`\n## Session en cours\n${session.toClaudeContext()}`)
    }

    // ── Planning global ──
    if (learningPlan) {
      // Note: toClaudeContext est async, on passe le résumé pré-chargé
      if (learningPlan.claudeSummary) {
        parts.push(
          `\n## Planning de l'étudiant\nObjectif : ${learningPlan.claudeSummary.goal}\nRythme : ${learningPlan.claudeSummary.pace}`
        )
      }
    }

    // ── Instructions spécifiques au contexte ──
    const contextInstructions: Partial<Record<MessageContext, string>> = {
      theory:
        '\n## Instruction\nTu expliques la théorie de façon claire et progressive. Utilise des analogies adaptées au niveau. Propose des exemples concrets.',
      example:
        '\n## Instruction\nTu montres un exemple résolu étape par étape. Explique chaque étape. Vérifie la compréhension à la fin.',
      exercise:
        '\n## Instruction\nNe donne JAMAIS la réponse directement. Guide l\'étudiant avec des questions de Socrate. Si il bloque après 2 tentatives, donne un indice progressif.',
      correction:
        '\n## Instruction\nCorrige avec bienveillance. Explique l\'erreur clairement. Montre la démarche correcte étape par étape. Encourage toujours.',
      hint:
        '\n## Instruction\nDonne un indice qui oriente sans révéler la solution. L\'indice doit débloquer l\'étudiant sans court-circuiter son raisonnement.',
      freeform:
        '\n## Instruction\nRéponds à la question de l\'étudiant en restant dans le domaine des maths et de la physique. Si hors sujet, redirige gentiment.',
    }

    if (contextInstructions[context]) {
      parts.push(contextInstructions[context]!)
    }

    return parts.join('\n')
  }

  // ─── Méthodes publiques ───────────────────────────────────────────────────

  /**
   * Envoie un message dans une session d'apprentissage.
   * Récupère l'historique, construit le contexte, appelle Claude et sauvegarde l'échange.
   */
  async sendMessage(params: SendMessageParams): Promise<ClaudeResponse> {
    const { user, content, context, sessionId, topic, session, progress, learningPlan } = params

    // Récupération de l'historique de la session
    const history: ClaudeMessage[] = sessionId
      ? await Message.getClaudeHistory(sessionId, MAX_HISTORY_MESSAGES)
      : []

    // Ajout du message courant
    const messages: ClaudeMessage[] = [...history, { role: 'user', content }]

    // Construction du system prompt adaptatif
    const systemPrompt = this.buildAdaptiveSystemPrompt({
      context,
      user,
      topic,
      session,
      progress,
      learningPlan,
    })

    // Appel API
    const response = await this.call({ systemPrompt, messages })

    // Sauvegarde de l'échange en base
    await Message.saveExchange({
      userId: user.id,
      sessionId,
      context,
      userContent: content,
      assistantContent: response.content,
      claudeMeta: response.meta,
    })

    return response
  }

  /**
   * Gère un message d'onboarding.
   * Retourne aussi un flag `isComplete` quand Claude a fini le questionnaire.
   */
  async sendOnboardingMessage(params: {
    user: User
    content: string
  }): Promise<ClaudeResponse & { isComplete: boolean }> {
    const { user, content } = params

    // Historique de l'onboarding
    const history = await Message.getOnboardingHistory(user.id)
    const messages: ClaudeMessage[] = [...history, { role: 'user', content }]

    const response = await this.call({
      systemPrompt: ONBOARDING_SYSTEM_PROMPT,
      messages,
      maxTokens: 1024,
    })

    // Sauvegarde
    await Message.saveExchange({
      userId: user.id,
      context: 'onboarding',
      userContent: content,
      assistantContent: response.content,
      claudeMeta: response.meta,
    })

    // Détection de fin d'onboarding
    const isComplete = response.content.includes('ONBOARDING_COMPLETE')

    // On nettoie le flag du message retourné au frontend
    if (isComplete) {
      response.content = response.content.replace('ONBOARDING_COMPLETE', '').trim()
    }

    return { ...response, isComplete }
  }

  /**
   * Génère un planning d'apprentissage complet en JSON.
   * Appelé une fois l'onboarding terminé.
   */
  async generateLearningPlan(params: GeneratePlanParams): Promise<object> {
    const { user, onboardingHistory } = params

    const planningPrompt = `
Génère un planning d'apprentissage personnalisé pour cet étudiant.

${user.toClaudeContext()}

Historique de l'onboarding :
${onboardingHistory.map((m) => `${m.role === 'user' ? 'Étudiant' : 'Professeur'}: ${m.content}`).join('\n')}

Génère un planning en JSON avec ce format exact :
{
  "summary": {
    "goal": "description de l'objectif",
    "total_weeks": <nombre>,
    "pace": "lent|modere|rapide",
    "daily_structure": "ex: 15min théorie + 15min exercices",
    "special_notes": "conseils particuliers"
  },
  "weeks": [
    {
      "week_number": 1,
      "theme": "titre de la semaine",
      "objective": "ce que l'étudiant saura faire à la fin",
      "intro": "message d'introduction motivant de Claude",
      "topic_slugs": ["slug1", "slug2"]
    }
  ]
}`

    const response = await this.call({
      systemPrompt: PLANNING_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: planningPrompt }],
      maxTokens: 3000,
    })

    // Sauvegarde du message de génération
    await Message.saveExchange({
      userId: user.id,
      context: 'planning',
      userContent: 'Génère mon planning personnalisé',
      assistantContent: response.content,
      claudeMeta: response.meta,
    })

    // Parse du JSON retourné par Claude
    try {
      const clean = response.content.replace(/```json|```/g, '').trim()
      return JSON.parse(clean)
    } catch {
      throw new Error(`Claude a retourné un JSON invalide : ${response.content.slice(0, 200)}`)
    }
  }

  /**
   * Génère un exercice adapté au niveau de l'utilisateur sur un topic donné.
   */
  async generateExercise(params: GenerateExerciseParams): Promise<object> {
    const { user, topic, session, progress, previousErrors } = params

    const exercisePrompt = topic.buildExercisePrompt(user.level, previousErrors)

    const systemPrompt = this.buildAdaptiveSystemPrompt({
      context: 'exercise',
      user,
      topic,
      session,
      progress: progress ?? undefined,
    })

    const response = await this.call({
      systemPrompt,
      messages: [{ role: 'user', content: exercisePrompt }],
      maxTokens: 1500,
    })

    try {
      const clean = response.content.replace(/```json|```/g, '').trim()
      return JSON.parse(clean)
    } catch {
      throw new Error(`Erreur parsing exercice : ${response.content.slice(0, 200)}`)
    }
  }

  /**
   * Évalue la réponse d'un utilisateur à un exercice.
   */
  async evaluateAnswer(params: EvaluateAnswerParams): Promise<object> {
    const { user, session, exerciseQuestion, correctAnswer, userAnswer, attempts } = params

    const evaluationPrompt = `
Question : ${exerciseQuestion}
Réponse attendue : ${correctAnswer}
Réponse de l'étudiant : ${userAnswer}
Tentatives : ${attempts}
${session.isStruggling ? 'L\'étudiant est en difficulté — sois particulièrement encourageant et détaillé.' : ''}

Réponds UNIQUEMENT en JSON :
{
  "is_correct": true|false,
  "feedback": "correction claire et bienveillante avec explication",
  "solution_steps": [{ "step": 1, "description": "...", "formula": "..." }],
  "encouragement": "message de motivation personnalisé",
  "next_difficulty": "facile|moyen|difficile"
}`

    const systemPrompt = this.buildAdaptiveSystemPrompt({
      context: 'correction',
      user,
      session,
    })

    const response = await this.call({
      systemPrompt,
      messages: [{ role: 'user', content: evaluationPrompt }],
      maxTokens: 1500,
    })

    await Message.saveExchange({
      userId: user.id,
      sessionId: session.id,
      context: 'correction',
      userContent: `Réponse soumise : ${userAnswer}`,
      assistantContent: response.content,
      claudeMeta: response.meta,
    })

    try {
      const clean = response.content.replace(/```json|```/g, '').trim()
      return JSON.parse(clean)
    } catch {
      throw new Error(`Erreur parsing évaluation : ${response.content.slice(0, 200)}`)
    }
  }

  /**
   * Demande à Claude d'ajuster le planning en fonction de la progression réelle.
   */
  async adjustPlan(params: {
    user: User
    learningPlan: LearningPlan
    reason: string
  }): Promise<object> {
    const { user, learningPlan, reason } = params

    const planContext = await learningPlan.toClaudeContext()

    const adjustPrompt = `
${planContext}

Raison de l'ajustement : ${reason}

Propose un ajustement du planning en JSON :
{
  "adjustment_summary": "description de l'ajustement",
  "weeks_to_update": [
    {
      "week_number": <n>,
      "theme": "nouveau thème",
      "objective": "nouvel objectif",
      "topic_slugs": ["slug1"],
      "reason": "pourquoi ce changement"
    }
  ],
  "message_to_student": "message encourageant expliquant l'ajustement"
}`

    const response = await this.call({
      systemPrompt: `${BASE_SYSTEM_PROMPT}\nTu ajustes le planning d'apprentissage de façon bienveillante. Réponds UNIQUEMENT en JSON.`,
      messages: [{ role: 'user', content: adjustPrompt }],
      maxTokens: 2000,
    })

    await Message.saveExchange({
      userId: user.id,
      context: 'planning',
      userContent: `Ajustement demandé : ${reason}`,
      assistantContent: response.content,
      claudeMeta: response.meta,
    })

    try {
      const clean = response.content.replace(/```json|```/g, '').trim()
      return JSON.parse(clean)
    } catch {
      throw new Error(`Erreur parsing ajustement planning : ${response.content.slice(0, 200)}`)
    }
  }
}

// ─── Export singleton ──────────────────────────────────────────────────────
// On exporte une instance unique utilisée dans tous les controllers

export default new ClaudeService()