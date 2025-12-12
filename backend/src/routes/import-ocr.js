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

const { ocrFromBuffer } = require('../services/vision');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
});

// ─────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────

function needAuth(req, res, next) {
  if (!req.user?.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function extractServingsFallback(text) {
  const t = String(text || '');

  const m1 = t.match(/portions?\s*:\s*(\d+)/i);
  if (m1) return parseInt(m1[1], 10);

  const m2 = t.match(/\b(\d+)\s*(personnes|parts)\b/i);
  if (m2) return parseInt(m2[1], 10);

  return null;
}

function looksLikeStep(line) {
  const s = String(line || '').trim();
  if (!s) return false;

  const verbs =
    /(faites|ajoutez|mélangez|versez|chauffez|préchauffez|enfournez|badigeonnez|pétrissez|laissez|couvrez|déposez|coupez|servez|incorporez|remuez)/i;

  if (/^\d+\s*[\.\)]\s+/.test(s)) return true;
  if (verbs.test(s)) return true;
  if (s.length > 80) return true;

  return false;
}

function cleanStep(line) {
  let s = String(line || '').trim();
  s = s.replace(/^\d+\s*[\.\)]\s*/, '').trim();

  if (/^\d+\s*(min|minutes|h|heures)\b/i.test(s)) return null;
  if (/^(ingredients?|preparation|instructions?)$/i.test(s)) return null;
  if (s.length < 12) return null;

  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function extractNumberedStepsFromRawText(rawText) {
  const t = String(rawText || '').replace(/\r/g, '');
  if (!t) return [];

  let zone = t;
  const prepIdx = zone.toLowerCase().search(/\b(pr[ée]paration|preparation|instructions?)\b/);
  if (prepIdx >= 0) zone = zone.slice(prepIdx);

  const re = /(?:^|\n)\s*(\d{1,2})\s*[\.\)]\s*([^\n]+(?:\n(?!\s*\d{1,2}\s*[\.\)])\s*[^\n]+)*)/g;

  const steps = [];
  let m;
  while ((m = re.exec(zone)) !== null) {
    const txt = String(m[2] || '')
      .replace(/\s*\n\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const cleaned = cleanStep(`${m[1]}. ${txt}`);
    if (cleaned) steps.push(cleaned);
  }
  return steps;
}

/**
 * Découpe une ligne "packagée" en plusieurs ingrédients si elle contient
 * plusieurs motifs quantité+unité.
 */
function explodePackedIngredientLine(line) {
  let s = String(line || '').trim();
  if (!s) return [];

  s = s.replace(/^[•■⚫●\-\*]+\s*/g, '').trim();

  const tokenRe =
    /(\d+(?:[.,]\d+)?)\s*(kg|g|mg|l|cl|ml|c\.?\s*à\s*soupe|c\.?\s*à\s*café|cuill(?:ère|eres|ères)?s?\s*à\s*soupe|cuill(?:ère|eres|ères)?s?\s*à\s*caf[eé]|pinc[ée]e|pinc[ée]es|gousses?|tranches?|œufs?|oeufs?)/gi;

  const matches = [];
  let m;
  while ((m = tokenRe.exec(s)) !== null) {
    matches.push({ index: m.index });
  }
  if (matches.length <= 1) return [s];

  const cuts = matches.map((x) => x.index).slice(1);

  const parts = [];
  let start = 0;
  for (const cut of cuts) {
    const part = s.slice(start, cut).trim();
    if (part) parts.push(part);
    start = cut;
  }
  const last = s.slice(start).trim();
  if (last) parts.push(last);

  return parts.map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/**
 * Nettoyage final d’une ligne ingrédient :
 * - retire retours à la ligne
 * - retire headers collés (PREPARATION / INGREDIENTS)
 * - retire symboles parasites
 */
function sanitizeIngredientText(line) {
  let s = String(line || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // retirer symboles parasites
  s = s.replace(/[■⚫●]/g, '').trim();

  // retirer headers collés à la fin
  s = s.replace(/\b(preparation|préparation|ingredients|ingrédients|instructions?)\b\s*$/i, '').trim();

  return s;
}

// ─────────────────────────────────────────────────────────────
// POST /import/ocr
// ─────────────────────────────────────────────────────────────

router.post(
  '/ocr',
  needAuth,
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'files', maxCount: 5 },
  ]),
  async (req, res) => {
    try {
      const single = req.files?.file?.[0] || null;
      const multi = Array.isArray(req.files?.files) ? req.files.files : [];
      const allFiles = multi.length ? multi : (single ? [single] : []);

      if (!allFiles.length) {
        return res.status(400).json({
          error: 'IMAGE_MISSING',
          message: 'Aucune image fournie.',
        });
      }

      const debug = String(req.query.debug || '') === '1';

      // OCR multi images
      const rawTexts = [];
      for (const f of allFiles) {
        const txt = await ocrFromBuffer(f.buffer);
        rawTexts.push(String(txt || '').trim());
      }

      const rawText = rawTexts.filter(Boolean).join('\n\n');

      if (debug) {
        return res.json({
          ok: true,
          debug: {
            filesCount: allFiles.length,
            rawTextsLengths: rawTexts.map((t) => t.length),
            rawTextLength: rawText.length,
            rawTextFirst2000: rawText.slice(0, 2000),
          },
        });
      }

      if (!rawText) {
        return res.status(400).json({
          error: 'OCR_TEXT_EMPTY',
          message: 'Impossible de lire du texte dans ces images.',
        });
      }

      // Filtrage & split
      const filteredLines = smartFilterLinesFromText(rawText);
      const split = splitIngredientsAndSteps(filteredLines);

      // Servings (garde-fou)
      let servings =
        Number.isFinite(split.servings) && split.servings !== 1
          ? split.servings
          : extractServingsFallback(rawText) || 1;

      if (!Number.isFinite(servings) || servings < 1 || servings > 20) servings = 1;

      // ─────────────────────
      // Ingredients
      // ─────────────────────
      const ingredientLines = Array.isArray(split.ingredientLines) ? split.ingredientLines : [];

      const explodedLines = ingredientLines
        .flatMap((l) => explodePackedIngredientLine(l))
        .map((l) => sanitizeIngredientText(l))
        .filter(Boolean);

      const ingredientsRaw = explodedLines
        .map((line) => {
          const baseLine = String(line || '').trim();
          if (!baseLine) return null;

          if (looksLikeStep(baseLine)) return null;
          if (baseLine.length > 160) return null;

          if (/^\s*(sel|poivre)\b/i.test(baseLine) || /sel\s+et\s+poivre/i.test(baseLine)) {
            return { name: baseLine, quantity: 0, unit: '' };
          }

          const parsedOcr = parseOcrIngredient(baseLine);
          if (parsedOcr) return parsedOcr;

          const parsed = parseRawLine(baseLine);
          if (parsed) {
            const q = parsed.quantityNum ?? parsed.quantity ?? 0;
            return {
              name: parsed.nameCanon || parsed.name || baseLine,
              quantity: q > 0 ? q : 0,
              unit: parsed.unit || '',
            };
          }

          return { name: baseLine, quantity: 0, unit: '' };
        })
        .filter(Boolean);

      const ingredients = beautifyIngredients(ingredientsRaw);

      // ─────────────────────
      // Steps
      // ─────────────────────
      let steps = (split.stepLines || [])
        .map(cleanStep)
        .filter(Boolean);

      if (steps.length < 3) {
        const fallbackSteps = extractNumberedStepsFromRawText(rawText);
        if (fallbackSteps.length) steps = fallbackSteps;
      }

      const notes =
        steps.length === 0
          ? '(Aucune étape détectée. Ajoute une capture centrée sur la préparation.)'
          : '';

      const draft = {
        title: guessTitleFromLines(filteredLines) || 'Recette importée',
        servings,
        imageUrl: null,
        notes,
        steps,
        ingredients,
      };

      return res.json({ ok: true, draft });
    } catch (e) {
      console.error('[import-ocr] error:', e);
      return res.status(500).json({
        error: 'OCR_INTERNAL_ERROR',
        message: 'Erreur interne OCR.',
      });
    }
  }
);

module.exports = router;




