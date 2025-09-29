// backend/src/routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { signToken } = require('../lib/jwt');
// ⬇️ On garde ton authRequired si tu l'utilises ailleurs, mais on n'en a plus besoin pour /sync
const { authRequired } = require('../middleware/auth');
// ⬇️ On ajoute le middleware Supabase
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
      select: { id: true, email: true, createdAt: true }
    });

    // Optionnel: login auto après inscription (JWT "maison")
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
      user: { id: user.id, email: user.email, createdAt: user.createdAt }
    });
  } catch (e) {
    console.error('login error', e);
    return res.status(500).json({ error: 'internal error' });
  }
});

/**
 * POST /auth/sync (protégée par Supabase)
 * - Le middleware supabaseAuth valide le Bearer token auprès de Supabase
 * - Il pose { userId, email } sur req.user
 * - On upsert l'utilisateur côté Prisma (création si absent)
 */
router.post('/sync', supabaseAuth, async (req, res) => {
  const { userId, email } = req.user; // vient de supabaseAuth

  // Upsert par email : si l'utilisateur n'existe pas encore en DB, on le crée
  const me = await prisma.user.upsert({
    where: { email },
    update: {}, // tu peux ajouter des mises à jour ici
    create: { email, passwordHash: '' }, // si tu utilises seulement Supabase, pas besoin de vrai password
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

