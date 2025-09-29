// backend/src/middleware/supabaseAuth.js
const fetch = global.fetch; // Node 18+ possède fetch nativement

/**
 * Middleware qui valide le token Supabase
 * et ajoute les infos utilisateur dans req.user
 */
async function supabaseAuth(req, res, next) {
  try {
    // Récupère le header Authorization (ex: "Bearer xxxxx")
    const auth = req.headers.authorization || '';
    const [, token] = auth.split(' '); // découpe après "Bearer"

    if (!token) {
      return res.status(401).json({ error: 'Bearer token missing' });
    }

    // Vérifie le token auprès de Supabase
    const r = await fetch(`${process.env.SUPABASE_PROJECT_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: process.env.SUPABASE_KEY, // ta anon/public key
      },
    });

    if (!r.ok) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const user = await r.json(); // { id, email, ... }

    // Attache l'utilisateur à req pour les handlers suivants
    req.user = { userId: user.id, email: user.email };

    // Passe au middleware/route suivant
    next();
  } catch (e) {
    console.error('Supabase auth error:', e);
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

module.exports = { supabaseAuth };
