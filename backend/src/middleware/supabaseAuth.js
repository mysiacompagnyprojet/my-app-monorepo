// backend/src/middleware/supabaseAuth.js
const fetch = global.fetch;

async function supabaseAuth(req, res, next) {
  if (process.env.DEV_BYPASS_AUTH === 'true') {
    req.user = {
      userId: process.env.DEV_USER_ID || 'dev-user',
      email: process.env.DEV_USER_EMAIL || 'dev@example.com',
    };
    req.userId = req.user.userId;
    return next();
  }

  try {
    const authHeader = req.headers.authorization || '';
    const m = authHeader.match(/^Bearer\s+(.+)$/i);

    if (!m) {
      return res.status(401).json({ error: 'Bearer token missing' });
    }

    const token = m[1];

    const base = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
    const anonKey = process.env.SUPABASE_ANON_KEY || '';

    if (!base || !anonKey) {
      return res.status(500).json({
        error: 'Supabase env missing: SUPABASE_URL / SUPABASE_ANON_KEY',
      });
    }

    const r = await fetch(`${base}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
      },
    });

    if (!r.ok) {
      const details = await r.text().catch(() => '');
      return res.status(401).json({ error: 'Invalid token', details });
    }

    const user = await r.json();
    const userId = user?.id;
    const email = user?.email ?? null;

    if (!userId) {
      return res.status(401).json({ error: 'Supabase user id missing' });
    }

    req.userId = userId;
    req.user = { userId, email };

    return next();
  } catch (e) {
    console.error('Supabase auth error:', e);
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

module.exports = { supabaseAuth };