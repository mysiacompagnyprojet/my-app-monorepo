// backend/src/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

// 1) CORS
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  process.env.FRONTEND_VERCEL_URL || '', // ton Vercel
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

// --- Stripe webhook AVANT express.json() ---
const { billing, billingWebhookHandler } = require('./routes/billing');
app.use('/billing', billingWebhookHandler); // ce handler utilise express.raw()

// --- Puis seulement maintenant le JSON ---
app.use(express.json());

// --- Auth Supabase sur les routes protégées ---
const { supabaseAuth } = require('./middleware/supabaseAuth');
app.use(['/recipes', '/import', '/shopping-list'], supabaseAuth);
app.use('/billing/checkout', supabaseAuth);

// --- Routers "classiques" ---
const authRouter = require('./routes/auth');
app.use('/auth', authRouter);

const recipesRouter = require('./routes/recipes');
app.use('/recipes', recipesRouter);

const importUrlRouter = require('./routes/import-url');
app.use('/import', importUrlRouter);

const importOcrRouter = require('./routes/import-ocr');
app.use('/import', importOcrRouter);

const shoppingListRouter = require('./routes/shopping-list');
app.use('/shopping-list', shoppingListRouter);

// Le router Stripe "checkout" (qui parse du JSON) se monte APRES express.json()
app.use('/billing', billing);

// --- Healthcheck au format attendu ---
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/', (_req, res) => {
  res.json({ name: 'my-app API', status: 'ok', docs: '/health' });
});

// 4) Listen
const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
  const addr = server.address();
  console.log(`API up on http://${HOST}:${PORT}`, '| bound to:', addr);
});

server.on('error', (err) => console.error('SERVER ERROR:', err));
process.on('uncaughtException', (err) => console.error('UNCAUGHT EXCEPTION:', err));
process.on('unhandledRejection', (reason) => console.error('UNHANDLED REJECTION:', reason));
app.get('/__debug/supabase', (_req, res) => {
  let apiKey = (process.env.SUPABASE_KEY || '').trim();
  apiKey = apiKey.replace(/^"+|"+$/g, '').replace(/^'+|'+$/g, '');
  res.json({
    url: process.env.SUPABASE_PROJECT_URL,
    keyLen: apiKey.length,
    keyHead: apiKey.slice(0, 12),
    keyTail: apiKey.slice(-12),
    files: process.env.DOTENV_SOURCES || 'unknown'
  });
});