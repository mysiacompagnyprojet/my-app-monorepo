// backend/src/middleware/supabaseAuth.js
const fetch = global.fetch; // Node 18+ possède fetch nativement

async function supabaseAuth(req, res, next) {
  //a supprimer je pense, pour tester beug
  console.log('[auth] URL =', process.env.SUPABASE_URL);
  console.log('[auth] KEY =', (process.env.SUPABASE_KEY || '').slice(0, 10) + '...');
  console.log('[auth] has Authorization =', !!req.headers.authorization);
  //jusque là
  try {
    const auth = req.headers.authorization || '';
    const [, token] = auth.split(' ');
    
    if (!token) {
      return res.status(401).json({ error: 'Bearer token missing' });
    }

    const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: process.env.SUPABASE_KEY,
      },
    });

    if (!r.ok) {
      //a supprimer je pense pour verifier beug
      const details = await r.text().catch(() => '');
      console.error('[auth] Supabase rejected token:', r.status, details);
      //jusque là
      return res.status(401).json({ error: 'Invalid token', details });
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
