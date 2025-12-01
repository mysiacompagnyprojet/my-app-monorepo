// backend/src/routes/import-ocr.js

const express = require('express');
const multer = require('multer');
const { createWorker } = require('tesseract.js');
const { parseRawLine } = require('../utils/ingredients');

// Toute l’intelligence OCR est maintenant dans utils/ocrText.js
const {
  smartFilterLinesFromText,
  splitIngredientsAndSteps,
  parseOcrIngredient,
  beautifyIngredients,
} = require('../utils/ocrText');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// ───────────────────── Auth (Supabase déjà branché globalement) ──────────

function needAuth(req, res, next) {
  if (!req.user?.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ───────────────────── OCR worker partagé ─────────────────────

let workerPromise;
async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      // Version simple : on initialise directement avec les langues
      const worker = await createWorker('fra+eng');
      return worker;
    })();
  }
  return workerPromise;
}

// ───────────────────── Route POST /import/ocr ─────────────────────

router.post('/ocr', needAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ ok: false, error: 'Aucun fichier reçu' });
    }

    const worker = await getWorker();
    const { data } = await worker.recognize(req.file.buffer);

    const rawText = String(data.text || '').trim();
    if (!rawText) {
      return res
        .status(400)
        .json({ ok: false, error: 'Texte OCR vide' });
    }

    // 1) Nettoyage / filtrage des lignes
    const filteredLines = smartFilterLinesFromText(rawText);
    if (!filteredLines.length) {
      return res.status(400).json({
        ok: false,
        error: 'Impossible de détecter une recette dans cette image',
      });
    }

    // 2) Découpage en portions / ingrédients / étapes / notes
    const { servings, ingredientLines, stepLines, notesLines } =
      splitIngredientsAndSteps(filteredLines);

    // 3) Parse des lignes d'ingrédients -> { name, quantity, unit }
    const ingredientsRaw = ingredientLines.map((line) => {
      // a) parse spécifique OCR
      const parsedOcr = parseOcrIngredient(line);
      if (parsedOcr) {
        return {
          name: parsedOcr.name,
          quantity: parsedOcr.quantity,
          unit: parsedOcr.unit || 'g',
        };
      }

      // b) fallback sur le parseur générique de ton appli
      const parsed = parseRawLine(line);
      if (parsed) {
        return {
          name: parsed.nameCanon || parsed.name || line,
          quantity: parsed.quantityNum ?? parsed.quantity ?? 0,
          unit: parsed.unit || 'g',
        };
      }

      // c) dernier recours : on garde la ligne telle quelle
      return {
        name: line,
        quantity: 0,
        unit: 'g',
      };
    });

    // 4) Nettoyage + dédoublonnage des ingrédients
    const ingredients = beautifyIngredients(ingredientsRaw);

    // 5) Construction du brouillon pour le frontend
    const draft = {
      title: 'Recette importée',
      servings,
      imageUrl: null,
      notes: notesLines.length ? notesLines.join('\n') : '',
      steps: stepLines,
      ingredients,
    };

    return res.json({ ok: true, draft });
  } catch (e) {
    console.error('POST /import/ocr error:', e);
    return res
      .status(500)
      .json({ ok: false, error: e.message || 'ocr_error' });
  }
});

module.exports = router;

