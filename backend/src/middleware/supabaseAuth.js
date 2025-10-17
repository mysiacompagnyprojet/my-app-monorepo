// backend/src/middleware/supabaseAuth.js
const fetch = global.fetch; // Node 18+ possède fetch nativement

async function supabaseAuth(req, res, next) {
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
    // ⚠️ user.id est l’UUID attendu par Prisma (OK)
    req.user = { userId: user.id, email: user.email || null };
    // console.log('supabaseAuth OK → req.user =', req.user); // (debug)

    return next();
  } catch (e) {
    console.error('Supabase auth error:', e);
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

module.exports = { supabaseAuth };

