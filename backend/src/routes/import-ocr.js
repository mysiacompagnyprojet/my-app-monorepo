// backend/src/routes/import-ocr.js
'use strict';

const express = require('express');
const multer = require('multer');

const { ocrFromBuffer } = require('../services/vision');
const {
  smartFilterWithTrashFromText,
  splitIngredientsAndSteps,
  joinWrappedLinesForSteps,
  parseOcrIngredient,
  beautifyIngredients,
  guessTitleFromLines,
  miniReflow,
} = require('../utils/ocrText');

let parseRawLine = null;
try {
  parseRawLine = require('../utils/ingredients')?.parseRawLine || null;
} catch (e) {
  parseRawLine = null;
}

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const MAX_FILES = 10;

router.post('/ocr', upload.array('files', MAX_FILES), async (req, res) => {
  try {
    const isDebug = req.query.debug === '1';

    if (!req.files?.length) {
      return res.status(400).json({ ok: false, error: 'NO_FILES', message: 'Ajoute au moins 1 image.' });
    }

    const texts = [];
    for (const f of req.files) {
      const t = await ocrFromBuffer(f.buffer);
      if (t) texts.push(t);
    }

    const rawText = texts.join('\n\n');

    const filtered = smartFilterWithTrashFromText(rawText);
    let lines = filtered.lines;

    const split = splitIngredientsAndSteps(lines);

    lines = miniReflow(split);

    const title = guessTitleFromLines(lines) || 'Recette importée';

    let servings = split.servings || 1;
    if (!Number.isFinite(servings) || servings < 1) servings = 1;

    const ingredients = beautifyIngredients(
      (split.ingredientLines || [])
        .map((l) => {
          const parsed = parseOcrIngredient(l) || (parseRawLine ? parseRawLine(l) : null);

          if (!parsed) return { name: l, quantity: 0, unit: '' };

          return {
            name: parsed.name || l,
            quantity: Number(parsed.quantity || 0),
            unit: parsed.unit || '',
          };
        })
        .filter((x) => x && x.name && String(x.name).trim().length > 0)
    );

    const rawSteps = joinWrappedLinesForSteps(split.stepLines || []);

    const steps = rawSteps
      .map((s) => String(s || '').trim())
      .filter((s) => s && s !== '•' && s !== '.' && s !== '·');

    const notes = (split.notesLines || []).map((s) => String(s || '').trim()).filter(Boolean).join('\n');

    const draft = {
      title,
      servings,
      imageUrl: null,
      notes,
      ingredients,
      steps,
      trash: filtered.trash,
    };

    if (isDebug) {
      return res.json({
        ok: true,
        debug: {
          imagesCount: req.files.length,
          title,
          servings,
          firstLines: lines.slice(0, 60),
          split: {
            ingredientLinesCount: (split.ingredientLines || []).length,
            stepLinesCount: (split.stepLines || []).length,
            notesLinesCount: (split.notesLines || []).length,
          },
          trashSample: (filtered.trash || []).slice(0, 60),
          draftPreview: {
            ingredientsPreview: draft.ingredients.slice(0, 12),
            stepsPreview: draft.steps.slice(0, 12),
          },
        },
      });
    }

    return res.json({ ok: true, draft });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: 'OCR_FAILED', message: e?.message || 'Erreur OCR' });
  }
});

module.exports = router;





