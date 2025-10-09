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
    const url = `${base}/auth/v1/user`;

    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: process.env.SUPABASE_ANON_KEY, // <- clé publishable/anon côté projet
      },
    });

    if (!r.ok) {
      const details = await r.text().catch(() => '');
      return res
        .status(401)
        .json({ error: 'Invalid token', details });
    }

    const user = await r.json();
    // On transmet l’identité au handler suivant
    req.user = { userId: user.id, email: user.email };
    return next();
  } catch (e) {
    console.error('Supabase auth error:', e);
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

module.exports = { supabaseAuth };
