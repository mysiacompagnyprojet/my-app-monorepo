// backend/src/routes/import-ocr.js

const express = require('express');
const multer = require('multer');
const { parseRawLine } = require('../utils/ingredients');
const {
  smartFilterLinesFromText,
  splitIngredientsAndSteps,
  parseOcrIngredient,
  beautifyIngredients,
  guessTitleFromLines,
} = require('../utils/ocrText');

// 👉 Google Vision OCR
const { ocrFromBuffer } = require('../services/vision');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Auth : Supabase est branché globalement, ici on vérifie juste la présence de req.user
function needAuth(req, res, next) {
  if (!req.user?.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// POST /import/ocr
// body: form-data avec champ "file" (image)
router.post('/ocr', needAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        error: 'IMAGE_MISSING',
        message: 'Aucun fichier image fourni.',
      });
    }

    // 0) OCR via Google Vision
    const rawText = await ocrFromBuffer(req.file.buffer);

    if (!rawText || !rawText.trim()) {
      return res.status(400).json({
        error: 'OCR_TEXT_EMPTY',
        message:
          'Impossible de lire du texte dans cette image. Essaie avec une photo plus nette ou recadrée.',
      });
    }

    // 1) Filtrage intelligent des lignes
    const filteredLines = smartFilterLinesFromText(rawText);
    if (!filteredLines.length) {
      return res.status(400).json({
        error: 'OCR_TEXT_FILTERED_EMPTY',
        message:
          'Le texte détecté semble être du bruit (pubs, interface…). Essaie avec une autre capture.',
      });
    }

    // 2) Découpage ingrédients / étapes / notes
    const {
      servings,
      ingredientLines,
      stepLines,
      notesLines,
    } = splitIngredientsAndSteps(filteredLines);

    // 3) Mapping ingrédients → { name, quantity, unit }
    const ingredientsRaw = ingredientLines.map((line) => {
      const baseLine = String(line || '').trim();

      // 3.1 Essai parseur OCR dédié
      const parsedOcr = parseOcrIngredient(baseLine);
      if (parsedOcr) {
        return {
          name: parsedOcr.name,
          quantity: parsedOcr.quantity,
          unit: parsedOcr.unit || '',
        };
      }

      // 3.2 Essai parseur générique
      const parsed = parseRawLine(baseLine);
      if (parsed) {
        return {
          name: parsed.nameCanon || parsed.name || baseLine,
          quantity: parsed.quantityNum ?? parsed.quantity ?? 0,
          unit: parsed.unit || '',
        };
      }

      // 3.3 Fallback
      return {
        name: baseLine,
        quantity: 0,
        unit: '',
      };
    });

    // 4) Nettoyage + dédoublonnage
    const ingredients = beautifyIngredients(ingredientsRaw);

    // 5) Deviner le titre
    const ocrTitle = guessTitleFromLines(filteredLines);

    // 6) Draft final
    const draft = {
      title: ocrTitle || 'Recette importée',
      servings,
      imageUrl: null,
      notes: notesLines.length ? notesLines.join('\n') : '',
      steps: stepLines,
      ingredients,
    };

    return res.json({ ok: true, draft });
  } catch (e) {
    console.error('[import-ocr] error:', e);
    return res.status(500).json({
      error: 'OCR_INTERNAL_ERROR',
      message: 'Erreur interne lors de la lecture de l’image.',
    });
  }
});

module.exports = router;
