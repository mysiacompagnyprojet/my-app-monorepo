// backend/src/routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const { prisma } = require('../lib/prisma');
const { signToken } = require('../lib/jwt');
const { supabaseAuth } = require('../middleware/supabaseAuth');

const router = express.Router();

/** Utils */
function badRequest(res, msg) {
  return res.status(400).json({ error: msg || 'bad request' });
}
function unauthorized(res, msg) {
  return res.status(401).json({ error: msg || 'unauthorized' });
}

/**
 * POST /auth/register
 * body: { email, password }
 * -> crée un utilisateur "classique" (non Supabase) avec hash de mot de passe
 */
router.post('/register', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return badRequest(res, 'email and password are required');

  try {
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return res.status(409).json({ error: 'email already in use' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, passwordHash },
      select: { id: true, email: true, createdAt: true },
    });

    const token = signToken({ userId: user.id, email: user.email });
    return res.status(201).json({ ok: true, user, token });
  } catch (e) {
    console.error('register error', e);
    return res.status(500).json({ error: 'internal error' });
  }
});

/**
 * POST /auth/login
 * body: { email, password }
 * -> login "classique" (non Supabase) avec JWT maison
 */
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return badRequest(res, 'email and password are required');

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return unauthorized(res, 'invalid credentials');

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return unauthorized(res, 'invalid credentials');

    const token = signToken({ userId: user.id, email: user.email });
    return res.json({
      ok: true,
      token,
      user: { id: user.id, email: user.email, createdAt: user.createdAt },
    });
  } catch (e) {
    console.error('login error', e);
    return res.status(500).json({ error: 'internal error' });
  }
});

/**
 * POST /auth/sync
 * Protégée par supabaseAuth : reçoit un Bearer <sb_access_token>
 * Objectif : upsert l'utilisateur DB via l'ID Supabase (auth.uid) et mettre à jour l'email.
 * Renvoie { ok, userId, email, subscriptionStatus }
 *
 * ⚠️ Hypothèses:
 * - prisma User.id est un String UUID (compatible Supabase auth.uid()).
 * - passwordHash peut être vide si champ NOT NULL (on stocke '').
 * - champ subscriptionStatus existe (string) — sinon adapter le select/retour.
 */
router.post('/sync', supabaseAuth, async (req, res) => {
  try {
    const { userId, email } = req.user || {};
    if (!userId) return badRequest(res, 'Missing user id from Supabase token');
    // email peut être null si l’utilisateur supabase n’a pas d’email (rare), on tolère.

    const me = await prisma.user.upsert({
      where: { id: userId },
      update: {
        email: email || undefined,
        updatedAt: new Date(),
      },
      create: {
        id: userId,
        email: email || '',
        passwordHash: '', // si colonne NOT NULL
      },
      select: { id: true, email: true, createdAt: true, subscriptionStatus: true },
    });

    return res.json({
      ok: true,
      userId: me.id,
      email: me.email,
      subscriptionStatus: me.subscriptionStatus || 'trialing',
    });
  } catch (e) {
    console.error('sync error', e);
    return res.status(500).json({
      error: 'internal error',
      message: e?.message,
      code: e?.code,
      meta: e?.meta,
    });
  }
});

module.exports = router;

