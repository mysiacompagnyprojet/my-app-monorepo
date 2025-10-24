// backend/src/routes/recipeDrafts.js
const express = require('express');
const { prisma } = require('../lib/prisma');

const router = express.Router();

// simple middleware d’auth déjà chez toi: req.user.userId
function needAuth(req, res, next) {
  if (!req.user?.userId) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// Créer un draft
router.post('/', needAuth, async (req, res) => {
  try {
    const { sourceUrl, title, imageUrl, rawText, parsed, status } = req.body || {};
    const draft = await prisma.recipeDraft.create({
      data: {
        userId: req.user.userId, // 👈 très important pour RLS
        sourceUrl,
        title,
        imageUrl,
        rawText,
        parsed,
        status, // optionnel (par défaut "new")
      },
    });
    res.json({ ok: true, draft });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'create_failed' });
  }
});

// Lister mes drafts
router.get('/', needAuth, async (req, res) => {
  try {
    const drafts = await prisma.recipeDraft.findMany({
      where: { userId: req.user.userId }, // filtre côté appli + RLS côté DB
      orderBy: { createdAt: 'desc' },
    });
    res.json({ ok: true, drafts });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'list_failed' });
  }
});

module.exports = router;
