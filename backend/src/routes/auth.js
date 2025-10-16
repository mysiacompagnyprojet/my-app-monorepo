// backend/src/routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const { prisma } = require('../lib/prisma');
const { signToken } = require('../lib/jwt');
const { supabaseAuth } = require('../middleware/supabaseAuth');

const router = express.Router();

/**
 * POST /auth/register
 * body: { email, password }
 */
router.post('/register', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }
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
 */
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: 'invalid credentials' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'invalid credentials' });

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
 * Protégée par supabaseAuth : on reçoit un Bearer <sb_access_token>
 * -> on upsert l'utilisateur par email et on renvoie des infos minimales.
 */

/**
 * POST /auth/sync
 * Protégée par supabaseAuth : on reçoit un Bearer <sb_access_token>
 * -> on upsert l'utilisateur PAR ID (auth.uid) et on met à jour l'email.
 */
router.post('/sync', supabaseAuth, async (req, res) => {
  try {
    const { userId, email } = req.user || {};
    if (!userId) return res.status(400).json({ error: 'Missing user id from Supabase token' });

    const me = await prisma.user.upsert({
      where: { id: userId },                  // ✅ clé = auth.uid()
      update: { email, updatedAt: new Date() },
      create: { id: userId, email, passwordHash: '' }, // passwordHash vide si NOT NULL
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
