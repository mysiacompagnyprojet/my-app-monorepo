// backend/src/middleware/supabaseAuth.js
const { prisma } = require('../lib/prisma')

const fetch = global.fetch; // Node 18+ possède fetch nativement
const DEBUG_OCR = process.env.OCR_DEBUG !== 'production';
const dlog = (...args) => { if (DEBUG_OCR) console.log(...args); };

async function supabaseAuth(req, res, next) {
  if (process.env.DEV_BYPASS_AUTH === 'true') {
        req.user = {
            userId: process.env.DEV_USER_ID || 'dev-user',
            email: process.env.DEV_USER_EMAIL || 'shirley.valeton88@icloud.com',
        }
        dlog('[auth]', {
            bypass: process.env.DEV_BYPASS_AUTH,
            user: req.user,
        })
        req.userId = req.user.userId
        return next()
    }
  try {
    const authHeader = req.headers.authorization || '';
    const m = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!m) {
      return res.status(401).json({ error: 'Bearer token missing' });
    }
    const token = m[1];

    const base = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
    if (!base || !process.env.SUPABASE_ANON_KEY) {
      return res.status(500).json({ error: 'Supabase env missing: SUPABASE_URL / SUPABASE_ANON_KEY' });
    }

    const url = `${base}/auth/v1/user`;
    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: process.env.SUPABASE_ANON_KEY, // clé anon du projet
      },
    });

    if (!r.ok) {
      const details = await r.text().catch(() => '');
      return res.status(401).json({ error: 'Invalid token', details });
    }

    const user = await r.json();
    //aprés avoir recupere le user Supabase (id + email)
    const supabaseUserId = user.id;
    const email = user.email ?? null;
    await prisma.user.upsert({
      where: { id: supabaseUserId },
      update: { email },
      create: { id: supabaseUserId, email},
    })
    // ⚠️ user.id est l’UUID attendu par Prisma (OK)
    req.userId = supabaseUserId;
    req.user = { userId: supabaseUserId, email }; // avant : userId: user.id, email: user.email || null 
    // console.log('supabaseAuth OK → req.user =', req.user); // (debug)

    return next();
  } catch (e) {
    console.error('Supabase auth error:', e);
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

module.exports = { supabaseAuth };

