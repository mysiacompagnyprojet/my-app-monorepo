// backend/src/routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { signToken } = require('../lib/jwt');
const { authRequired } = require('../middleware/auth');
const { supabaseAuth } = require('../middleware/supabaseAuth');

const prisma = new PrismaClient();
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
 * POST /auth/sync (protégée par Supabase)
 */
router.post('/sync', supabaseAuth, async (req, res) => {
  const { userId, email } = req.user;

  const me = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, passwordHash: '' },
    select: { id: true, email: true, createdAt: true, subscriptionStatus: true },
  });

  return res.json({
    ok: true,
    userId: me.id,
    email: me.email,
    subscriptionStatus: me.subscriptionStatus || 'trialing',
  });
});

module.exports = router;
