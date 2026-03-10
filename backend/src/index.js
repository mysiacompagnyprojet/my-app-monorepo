// backend/src/index.js

// 0) Variables d’environnement
require('dotenv').config()

// 1) Core & middlewares
const express = require('express')
const cors = require('cors')

const app = express()

// 2) Middlewares maison / routes
const { supabaseAuth } = require('./middleware/supabaseAuth') // <- chemin singulier (dossier existant)
const { billing, billingWebhookHandler } = require('./routes/billing')
// const devAirtable = require('./routes/dev-airtable'); // base sur supabase
const importUrlRouter = require('./routes/import-url')
const importOcrRouter = require('./routes/import-ocr')
const recipesRouter = require('./routes/recipes')
const authRouter = require('./routes/auth')
const shoppingListRouter = require('./routes/shopping-list')
const ingredientsBase = require('./routes/ingredients-base')
const recipeDraftsRouter = require('./routes/recipeDrafts')
const imagesRouter = require('./routes/images')
const recipeCategoriesRouter = require('./routes/recipe-categories')


// 3) Healthcheck (ultra simple et avant tout)
app.get('/health', (_req, res) => res.json({ ok: true, status: 'ok' }))

// 4) Webhook Stripe en RAW (⚠️ doit être avant express.json())
app.use('/billing/webhook', billingWebhookHandler())

// 5) CORS — DOIT ÊTRE AVANT TES ROUTES (/upload, etc.)
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'https://mysia-app.fr',
  'https://www.mysia-app.fr',
  'https://my-app-monorepo.vercel.app',
  process.env.FRONTEND_URL || '',
  process.env.FRONTEND_VERCEL_URL || '',
  process.env.APP_URL || '', // ex: https://ton-app.vercel.app
].filter(Boolean)

const corsOptions = {
    origin: (origin, cb) => {
      // Requêtes sans Origin (curl, Postman…) → OK
      if (!origin) return cb(null, true)

      const isAllowedExplicit = allowedOrigins.includes(origin)
      const isVercel = origin.endsWith('.vercel.app')
      const isNgrok = origin.includes('ngrok-free.app')

      if (isAllowedExplicit || isVercel || isNgrok) return cb(null, true)

      console.error('CORS bloqué pour origin =', origin)
      return cb(new Error('Not allowed by CORS'))
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}
 app.use(cors(corsOptions))
 app;options('*', cors(corsOptions))

// 6) JSON pour le reste
app.use(express.json())

// 7) Force la réponse en UTF-8 (évite les soucis d’accents côté clients/outils)
app.use((req, res, next) => {
  if (req.method === 'OPTIONS'){
    return res.sendStatus(204)
  }
  next()
})

// 6b) Route bêta
app.use('/beta', require('./routes/beta'))

// 8) Route dev publique AVANT l’auth (pour tes tests Airtable)
// app.use('/dev', devAirtable); // base sur supabase

// 9) ✅ Route upload (doit être APRÈS CORS)
app.use('/upload', imagesRouter)

// 10) Auth globale (remplit req.user pour toutes les routes suivantes)
app.use(supabaseAuth)

// 11) Nouvelle base supabase remplace Airtable
app.use('/ingredients-base', ingredientsBase)
app.use('/recipe-drafts', recipeDraftsRouter)

// 12) Routes métier (ordre lisible)
app.use('/billing', billing) // POST /billing/checkout
app.use('/auth', authRouter) // /auth/*
app.use('/import', importUrlRouter) // POST /import/url
app.use('/import', importOcrRouter) // POST /import/ocr
app.use('/recipes', recipesRouter) // GET/POST /recipes
app.use('/recipe-categories', recipeCategoriesRouter)
app.use('/shopping-list', shoppingListRouter) // POST /shopping-list

// 13) Root (petite page d’accueil JSON)
app.get('/', (_req, res) => {
  res.json({ name: 'my-app API', status: 'ok', docs: '/health' })
})

// 14) Démarrage du serveur (HOST/PORT depuis .env si dispo)
const PORT = process.env.PORT || 4000
const HOST = process.env.HOST || '0.0.0.0'
app.listen(PORT, HOST, () => {
  console.log(`API running on http://${HOST}:${PORT}`)
})