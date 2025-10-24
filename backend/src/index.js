// backend/src/index.js 
require('dotenv').config(); 
const express = require('express'); 
const cors = require('cors'); 
 
const app = express(); 
const { supabaseAuth } = require('./middleware/supabaseAuth'); 
const devAirtable = require('./routes/dev-airtable'); // 0) Health (simple & avant tout) app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// 1) CORS
const allowedOrigins = [ 
  'http://localhost:3000', 
  'http://127.0.0.1:3000', 
  'http://localhost:5173', 
  process.env.FRONTEND_URL || '', process.env.FRONTEND_VERCEL_URL || '', 
  process.env.APP_URL || '', // ex: https://ton-app.vercel.app 
  ].filter(Boolean);
 
app.use( cors({ 
    origin: (origin, cb) => { 
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true); 
      return cb(new Error('Not allowed by CORS')); 
    }, 
    credentials: true, 
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], 
    allowedHeaders: ['Content-Type', 'Authorization'], 
  }) 
); 
 
// 2) Stripe webhook DOIT être avant express.json() 
const { billing, billingWebhookHandler } = require('./routes/billing'); app.use('/billing/webhook', billingWebhookHandler());

// 2) JSON 
app.use(express.json()); 
 
// ⚠️ Route dev publique AVANT l’auth 
app.use(devAirtable);

//Auth globale pour le reste 
app.use(supabaseAuth);

// 3) Routes 
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
 
const recipeDraftsRouter = require('./routes/recipeDrafts'); 
app.use('/recipe-drafts', recipeDraftsRouter);

// 👈 assure le montage de /billing/checkout 
app.use('/billing', billing);

// 6) Root 
app.get('/', (_req, res) => { 
  res.json({ name: 'my-app API', status: 'ok', docs: '/health' }); });

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`API running on http://${HOST}:${PORT}`);
});