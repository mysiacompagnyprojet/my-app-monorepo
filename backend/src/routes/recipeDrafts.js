// backend/src/routes/recipeDrafts.js
const express = require('express');
const { prisma } = require('../lib/prisma');

const router = express.Router();

// même auth que le reste (tu as supabaseAuth en global dans index.js)
function needAuth(req, res, next) {
  if (!req.user?.userId) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

/** (Optionnel) ping local à ce routeur */
router.get('/ping', needAuth, (req, res) => {
  res.json({ ok: true, where: 'recipeDrafts.js', userId: req.user.userId });
});

/** POST /recipe-drafts  -> créer un draft */
router.post('/', needAuth, async (req, res) => {
  try {
    const { sourceUrl, title, imageUrl } = req.body || {};
    const draft = await prisma.recipeDraft.create({
      data: {
        userId: req.user.userId,
        sourceUrl: sourceUrl || null,
        title: title || null,
        imageUrl: imageUrl || null,
        status: 'new',
      },
    });
    res.json({ ok: true, draft });
  } catch (e) {
    console.error('POST /recipe-drafts error:', e);
    res.status(500).json({ ok: false, error: 'internal error', message: e?.message });
  }
});

/** GET /recipe-drafts -> lister drafts de l’utilisateur */
router.get('/', needAuth, async (req, res) => {
  try {
    const drafts = await prisma.recipeDraft.findMany({
      where: { userId: req.user.userId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ ok: true, drafts });
  } catch (e) {
    console.error('GET /recipe-drafts error:', e);
    res.status(500).json({ ok: false, error: 'internal error', message: e?.message });
  }
});

/** ✅ PATCH /recipe-drafts/:id/parsed -> enregistre parsed + status=parsed */
router.patch('/:id/parsed', needAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { parsed } = req.body || {};

    if (!parsed || typeof parsed !== 'object') {
      return res.status(400).json({ ok: false, error: "Body doit contenir un objet 'parsed'" });
    }
    if (!parsed.title || typeof parsed.title !== 'string') {
      return res.status(400).json({ ok: false, error: "parsed.title manquant" });
    }
    if (parsed.steps && !Array.isArray(parsed.steps)) {
      return res.status(400).json({ ok: false, error: "parsed.steps doit être un tableau" });
    }
    if (parsed.ingredients && !Array.isArray(parsed.ingredients)) {
      return res.status(400).json({ ok: false, error: "parsed.ingredients doit être un tableau" });
    }

    const draft = await prisma.recipeDraft.update({
      where: { id },
      data: { parsed, status: 'parsed', updatedAt: new Date() },
    });

    res.json({ ok: true, draft });
  } catch (e) {
    console.error('PATCH /recipe-drafts/:id/parsed error:', e);
    res.status(500).json({ ok: false, error: 'internal error', message: e?.message });
  }
});

/** (Facultatif) Fallback si PATCH pose souci : POST /recipe-drafts/:id/parsed */
router.post('/:id/parsed', needAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { parsed } = req.body || {};
    if (!parsed || typeof parsed !== 'object' || !parsed.title) {
      return res.status(400).json({ ok: false, error: "parsed invalide" });
    }
    const draft = await prisma.recipeDraft.update({
      where: { id },
      data: { parsed, status: 'parsed', updatedAt: new Date() },
    });
    res.json({ ok: true, draft, via: 'POST fallback' });
  } catch (e) {
    console.error('POST /recipe-drafts/:id/parsed error:', e);
    res.status(500).json({ ok: false, error: 'internal error', message: e?.message });
  }
});

module.exports = router;


