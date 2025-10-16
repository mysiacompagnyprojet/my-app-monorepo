// backend/src/routes/import-ocr.js
const express = require('express');
const multer = require('multer');
const Tesseract = require('tesseract.js');
const { parseRawLine } = require('../utils/ingredients');
const { prisma } = require('../lib/prisma');
const { checkAndIncrementLimit } = require('../utils/limits');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
});

const router = express.Router();

function needAuth(req, res, next) {
  if (!req.user?.userId) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// POST /import/ocr
router.post('/ocr', needAuth, upload.single('file'), async (req, res) => {
  try {
    // 1) Fichier requis
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'Image manquante' });
    }

    // 2) Vérifie la limite AVANT de lancer l’OCR (économise du CPU si limite atteinte)
    const chk = await checkAndIncrementLimit(req.user.userId, 'lunch'); // adapte le type si besoin
    if (!chk.allowed) {
      return res.status(402).json({ ok: false, error: 'limit_reached' });
    }

    // 3) OCR
    const buffer = req.file.buffer;
    const { data } = await Tesseract.recognize(buffer, 'fra+eng');
    const text = (data.text || '').replace(/\r/g, '');

    // 4) Parsing lignes
    const lines = text
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    const title = lines[0] || 'Recette';
    const rawIngredients = lines
      .slice(1, 30)
      .filter((l) => /(\d|g|kg|ml|l|cuill|oeuf|farine|sucre|sel)/i.test(l));
    const steps = lines
      .slice(1)
      .filter((l) => l.length > 20)
      .slice(0, 10);

    const ingredients = rawIngredients.map(parseRawLine).filter(Boolean);

    // 5) Retourne un brouillon (draft) côté front
    return res.json({
      ok: true,
      draft: { title, servings: 1, steps, imageUrl: null, ingredients },
    });
  } catch (e) {
    console.error('POST /import/ocr error:', e);
    return res
      .status(500)
      .json({ ok: false, error: 'internal error', message: e?.message });
  }
});

module.exports = router;
