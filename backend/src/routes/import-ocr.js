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

function stripBulletPrefix(s) {
  return String(s || '')
    .trim()
    .replace(/^[•·⚫●○◦\-\*]+\s*/g, '')
    .trim();
}

/**
 * Split ligne "épices" si:
 * - pas de quantité au début
 * - contient des virgules
 * - et ressemble à une liste
 *
 * ✅ Retourne des objets { text, noQtyList } pour savoir si on doit FORCER quantity=0
 */
function splitCommaSeparatedNoQty(line) {
  const raw = stripBulletPrefix(line);
  if (!raw) return [{ text: line, noQtyList: false }];

  // si ça commence par une quantité => on ne split pas
  if (/^\s*(\d+([.,]\d+)?|\d+\s+\d+\/\d+|\d+\/\d+|½|⅓|⅔|¼|¾|⅛|⅜|⅝|⅞)\b/.test(raw)) {
    return [{ text: line, noQtyList: false }];
  }

  // doit contenir une virgule
  if (!raw.includes(',')) return [{ text: line, noQtyList: false }];

  // évite de splitter des phrases longues (trop risqué)
  if (raw.length > 70) return [{ text: line, noQtyList: false }];

  // Split par virgule + " et " + "&"
  const parts = raw
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .flatMap((x) =>
      x
        .split(/\s+(?:et|&)\s+/i)
        .map((y) => y.trim())
        .filter(Boolean)
    )
    .map((x) => x.replace(/^\.+/, '').trim())
    .filter(Boolean);

  // si on obtient au moins 2 items, on split
  if (parts.length >= 2) return parts.map((p) => ({ text: p, noQtyList: true }));

  return [{ text: line, noQtyList: false }];
}

function looksLikeStepTitle(t) {
  const s = String(t || '').trim();
  if (!s) return false;
  return /^[-•*]?\s*(égoutter|egoutter|ajouter|mixer|mixez|cuire|faire|préchauffer|prechauffer|préparer|preparer|couper|laver|mettre|verser|chauffer|mélanger|melanger)\b/i.test(
    s
  );
}

function inferTitleFromContent(ingredientsRows, stepsArr) {
  const names = (ingredientsRows || [])
    .map((x) => String(x?.name || '').toLowerCase())
    .filter(Boolean)
    .join(' | ');

  const stepsText = (stepsArr || []).join(' ').toLowerCase();

  const hasNuggets = /\bnuggets?\b/.test(stepsText);
  const hasPoisChiches = /\bpois\s*chiches?\b/.test(names);

  if (hasNuggets && hasPoisChiches) return 'Nuggets de pois chiches';
  if (hasNuggets) return 'Nuggets maison';

  return null;
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

    let title = guessTitleFromLines(lines) || 'Recette importée';

    let servings = split.servings || 1;
    if (!Number.isFinite(servings) || servings < 1) servings = 1;

    // ---------- INGREDIENTS ----------
    const ingredients = beautifyIngredients(
      (split.ingredientLines || [])
        .flatMap((l) => splitCommaSeparatedNoQty(l))
        .map((obj) => {
          const l = String(obj?.text || '').trim();
          if (!l) return null;

          // ✅ si ça vient d'une liste "sans quantité" (épices, condiments), on force quantity=0
          if (obj.noQtyList) {
            const name = stripBulletPrefix(l);
            if (!name) return null;

            // sel/poivre => 0
            if (/^sel$/i.test(name)) return { name: 'sel', quantity: 0, unit: '' };
            if (/^poivre$/i.test(name)) return { name: 'poivre', quantity: 0, unit: '' };

            return { name, quantity: 0, unit: '' };
          }

          const parsed = parseOcrIngredient(l) || (parseRawLine ? parseRawLine(l) : null);

          if (!parsed) return { name: l, quantity: 0, unit: '' };

          const row = {
            name: parsed.name || l,
            quantity: Number(parsed.quantity || 0),
            unit: parsed.unit || '',
          };

          // ✅ IMPORTANT: on passe le raw (fraction / virgule) au front
          if (typeof parsed.quantityRaw === 'string' && parsed.quantityRaw.trim()) {
            row.quantityRaw = String(parsed.quantityRaw).trim();
          }

          return row;
        })
        .filter(Boolean)
    );

    // ---------- STEPS ----------
    const rawSteps = joinWrappedLinesForSteps(split.stepLines || []);
    const steps = rawSteps
      .map((s) => String(s || '').trim())
      .filter((s) => s && s !== '•' && s !== '.' && s !== '·');

    // ---------- NOTES ----------
    const notes = (split.notesLines || []).map((s) => String(s || '').trim()).filter(Boolean).join('\n');

    // ✅ Override titre si c'est clairement une étape (à faire AVANT draft)
    if (looksLikeStepTitle(title)) {
      const inferred = inferTitleFromContent(ingredients, steps);
      if (inferred) title = inferred;
    }

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
