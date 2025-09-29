const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require ('bcryptjs');
const { signToken } = require('../lib/jwt');
const { authRequired } = require('../middleware/auth');

// 👇 AJOUTS pour Supabase
const { createRemoteJWKSet, jwtVerify } = require('jose');
const { PrismaClient } = require('../generated/prisma');
const prisma = new PrismaClient();
const projectUrl = process.env.SUPABASE_PROJECT_URL;
const jwksUrl = `${projectUrl}/auth/v1/jwks`;
const JWKS = createRemoteJWKSet(new URL(jwksUrl));

const router = express.Router();

// ---------- 1) Route existante : /auth/login ----------
router.post('/login', (req, res) => {
const { email, password } = req.body || {};
if (!email || !password) {
return res.status(400).json({ error: 'email and password are required' });
}

const payload = { sub: email };
const token = jwt.sign(payload, process.env.JWT_SECRET, {
expiresIn: process.env.JWT_EXPIRES_IN || '7d',
});

return res.json({ token });
});

// ---------- 2) NOUVELLE route : /auth/sync ----------
router.post('/sync', async (req, res) => {
try {
// a) Récupérer le token Supabase envoyé par le front
const authHeader = req.headers.authorization;
if (!authHeader?.startsWith('Bearer ')) {
return res.status(401).json({ error: 'Bearer token missing' });
}
const supabaseToken = authHeader.slice(7);

// b) Vérifier le token auprès de Supabase
const { payload } = await jwtVerify(supabaseToken, JWKS);
const userId = payload.sub; // UUID Supabase
const email = payload.email || '';

if (!userId) {
return res.status(400).json({ error: 'Invalid Supabase token' });
}

// c) Créer ou mettre à jour l'utilisateur dans la base Prisma
const user = await prisma.user.upsert({
where: { id: userId },
update: { email },
create: { id: userId, email, password: '' }, // password vide pour Supabase
});

// d) Déterminer le statut d'abonnement (existant ou valeur par défaut)
const subscriptionStatus = user.subscriptionStatus || 'trialing';

// e) Répondre au front
res.json({ userId, subscriptionStatus });
} catch (err) {
console.error('Erreur /auth/sync :', err);
res.status(401).json({ error: 'Invalid token or sync failed' });
}
});
module.exports = router;
