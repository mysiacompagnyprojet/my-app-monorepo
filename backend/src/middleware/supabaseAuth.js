// backend/src/middleware/supabaseAuth.js
const fetch = global.fetch; // Node 18+ possède fetch nativement

async function supabaseAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const [, token] = auth.split(' ');

    if (!token) {
      return res.status(401).json({ error: 'Bearer token missing' });
    }

    const r = await fetch(`${process.env.SUPABASE_PROJECT_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: process.env.SUPABASE_KEY,
      },
    });

    if (!r.ok) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const user = await r.json();
    req.user = { userId: user.id, email: user.email };
    next();
  } catch (e) {
    console.error('Supabase auth error:', e);
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

module.exports = { supabaseAuth };
