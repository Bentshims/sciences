quantum-learn-backend/
│
├── app/
│   ├── controllers/
│   │   ├── auth_controller.ts            # Register, Login, Logout
│   │   ├── onboarding_controller.ts      # Questionnaire + génération planning
│   │   ├── plans_controller.ts           # CRUD planning
│   │   ├── sessions_controller.ts        # Sessions d'apprentissage
│   │   ├── progress_controller.ts        # Mise à jour progression
│   │   ├── topics_controller.ts          # Notions disponibles
│   │   └── claude_controller.ts          # Proxy appels Claude API
│   │
│   ├── models/
│   │   ├── user.ts
│   │   ├── learning_plan.ts              # Planning global de l'utilisateur
│   │   ├── plan_week.ts                  # Semaine du planning
│   │   ├── topic.ts                      # Notion (dérivée, intégrale...)
│   │   ├── session.ts                    # Session d'apprentissage
│   │   ├── exercise.ts                   # Exercice généré
│   │   ├── progress.ts                   # Score par notion
│   │   └── message.ts                    # Historique messages Claude
│   │
│   ├── services/
│   │   ├── claude_service.ts             # Gestion appels API Claude + contexte
│   │   ├── adaptive_service.ts           # Logique adaptation pédagogique
│   │   ├── planning_service.ts           # Génération et mise à jour planning
│   │   ├── exercise_service.ts           # Génération exercices dynamiques
│   │   └── progress_service.ts          # Calcul scores, recommandations
│   │
│   ├── middleware/
│   │   ├── auth_middleware.ts
│   │   └── session_middleware.ts
│   │
│   └── validators/
│       ├── auth_validator.ts
│       ├── onboarding_validator.ts
│       └── session_validator.ts
│
├── database/
│   ├── migrations/
│   │   ├── 001_create_users.ts
│   │   ├── 002_create_topics.ts
│   │   ├── 003_create_learning_plans.ts
│   │   ├── 004_create_plan_weeks.ts
│   │   ├── 005_create_sessions.ts
│   │   ├── 006_create_exercises.ts
│   │   ├── 007_create_progress.ts
│   │   └── 008_create_messages.ts
│   │
│   └── seeders/
│       └── topics_seeder.ts              # Pré-remplir toutes les notions
│
├── config/
│   ├── app.ts
│   ├── auth.ts
│   ├── database.ts
│   └── cors.ts
│
├── start/
│   ├── routes.ts                         # Toutes les routes API
│   └── kernel.ts
│
├── .env
├── adonisrc.ts
├── tsconfig.json
└── package.json



POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/logout

POST   /api/onboarding/start             # Claude pose les questions
POST   /api/onboarding/generate-plan     # Claude génère le planning

GET    /api/plans/:userId                # Récupérer le planning
PATCH  /api/plans/:id/adjust             # Claude ajuste le planning

GET    /api/topics                       # Toutes les notions
GET    /api/topics/:slug                 # Détail d'une notion

POST   /api/sessions/start               # Démarrer une leçon
POST   /api/sessions/:id/message         # Envoyer message à Claude
PATCH  /api/sessions/:id/complete        # Terminer la leçon

GET    /api/progress/:userId             # Progression globale
POST   /api/progress/update              # Mettre à jour après exercice

POST   /api/exercises/generate           # Claude génère un exercice
POST   /api/exercises/:id/evaluate       # Claude évalue la réponse