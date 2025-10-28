// backend/src/index.js

// 0) Variables d’environnement
require('dotenv').config();

// 1) Core & middlewares
const express = require('express');
const cors = require('cors');
const app = express();

// 2) Middlewares maison / routes
const { supabaseAuth } = require('./middleware/supabaseAuth'); // <- chemin singulier (dossier existant)
const { billing, billingWebhookHandler } = require('./routes/billing');
const devAirtable = require('./routes/dev-airtable');
const importUrlRouter = require('./routes/import-url');
const importOcrRouter = require('./routes/import-ocr');
const recipesRouter = require('./routes/recipes');
const authRouter = require('./routes/auth');
const shoppingListRouter = require('./routes/shopping-list');

// 3) Healthcheck (ultra simple et avant tout)
app.get('/health', (_req, res) => res.json({ ok: true, status: 'ok' }));

// 4) Webhook Stripe en RAW (⚠️ doit être avant express.json())
app.use('/billing/webhook', billingWebhookHandler());

// 5) JSON pour le reste
app.use(express.json());

// 6) Force la réponse en UTF-8 (évite les soucis d’accents côté clients/outils)
app.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});

// 7) CORS — liste blanche (garde tes URLs + variables d’env)
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  process.env.FRONTEND_URL || '',
  process.env.FRONTEND_VERCEL_URL || '',
  process.env.APP_URL || '', // ex: https://ton-app.vercel.app
].filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// 8) Route dev publique AVANT l’auth (pour tes tests Airtable)
app.use(devAirtable);

// 9) Auth globale (remplit req.user pour toutes les routes suivantes)
app.use(supabaseAuth);

// 10) Routes métier (ordre lisible)
app.use('/billing', billing);                // POST /billing/checkout
app.use('/auth', authRouter);                // /auth/*
app.use('/import', importUrlRouter);         // POST /import/url
app.use('/import', importOcrRouter);         // POST /import/ocr
app.use('/recipes', recipesRouter);          // GET/POST /recipes
app.use('/shopping-list', shoppingListRouter); // POST /shopping-list

// 11) Root (petite page d’accueil JSON)
app.get('/', (_req, res) => {
  res.json({ name: 'my-app API', status: 'ok', docs: '/health' });
});

// 12) Démarrage du serveur (HOST/PORT depuis .env si dispo)
const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`API running on http://${HOST}:${PORT}`);
});
