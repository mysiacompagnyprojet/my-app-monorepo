// backend/src/routes/import-ocr.js

const express = require('express');
const multer = require('multer');

const { parseRawLine } = require('../utils/ingredients');
const {
  smartFilterWithTrashFromText,
  smartFilterWithTrashFromLines,
  splitIngredientsAndSteps,
  parseOcrIngredient,
  beautifyIngredients,
  guessTitleFromLines,
  looksLikeStep,
  normalizeStepsFromLines,
  extractNotesFromLines,
  extractLinesFromVisionAnnotation,
} = require('../utils/ocrText');

const { ocrFromBufferDetailed } = require('../services/vision');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const MAX_OCR_IMAGES = 10;

/* ───────────────── AUTH ───────────────── */
function needAuth(req, res, next) {
  if (!req.user?.userId) {
    return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
  }
  next();
}

/* ───────────────── HELPERS ───────────────── */

function isIphoneRequest(req) {
  const ua = String(req.headers['user-agent'] || '');
  return /iPhone|iPad|iPod|iOS/i.test(ua);
}

function cleanIosRawText(raw) {
  let t = String(raw || '');

  // barre iOS (heure + réseau)
  t = t.replace(
    /(^|\n)[^\n]*(4g|5g|lte|wifi)[^\n]*\d{1,2}:\d{2}[^\n]*\n/gi,
    '\n'
  );

  // lignes du type "16 %"
  t = t.replace(/(^|\n)\s*\d{1,3}\s*%\s*(\n|$)/g, '\n');

  return t;
}

function getPreferredLang(req) {
  const h = String(req.headers['accept-language'] || '').toLowerCase();
  if (!h) return 'fr';
  if (h.startsWith('fr')) return 'fr';
  if (h.startsWith('en')) return 'en';
  return 'fr';
}

function extractServingsFallback(text) {
  const t = String(text || '');

  let m = t.match(/(\d+)\s*(personnes|parts|portions)/i);
  if (m) return parseInt(m[1], 10);

  m = t.match(/pour\s*(\d+)\s*(?:à|-)\s*(\d+)/i);
  if (m) return Math.max(parseInt(m[1], 10), parseInt(m[2], 10));

  return null;
}

/* ───────────────── ROUTE OCR ───────────────── */

router.post(
  '/ocr',
  needAuth,
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'files', maxCount: MAX_OCR_IMAGES },
  ]),
  async (req, res) => {
    try {
      const debug = req.query.debug === '1';

      const single = req.files?.file?.[0];
      const multi = Array.isArray(req.files?.files) ? req.files.files : [];
      const files = multi.length ? multi : single ? [single] : [];

      if (!files.length) {
        return res.status(400).json({
          ok: false,
          error: 'IMAGE_MISSING',
          message: 'Aucune image fournie',
        });
      }

      if (files.length > MAX_OCR_IMAGES) {
        return res.status(400).json({
          ok: false,
          error: 'TOO_MANY_IMAGES',
          message: `Maximum ${MAX_OCR_IMAGES} images autorisées`,
        });
      }

      const lang = getPreferredLang(req);

      /* ───── OCR (détaillé) ───── */
      const texts = [];
      const allVisionLines = [];

      for (const f of files) {
        const out = await ocrFromBufferDetailed(f.buffer, { langHint: lang });
        const txt = String(out?.text || '').trim();
        if (txt) texts.push(txt);

        // Géométrie -> lignes propres si dispo
        const geoLines = extractLinesFromVisionAnnotation(out?.fullTextAnnotation);
        if (Array.isArray(geoLines) && geoLines.length) {
          allVisionLines.push(...geoLines);
        }
      }

      let rawText = texts.filter(Boolean).join('\n\n');

      if (isIphoneRequest(req)) {
        rawText = cleanIosRawText(rawText);
      }

      if (!rawText.trim() && !allVisionLines.length) {
        return res.status(400).json({
          ok: false,
          error: 'OCR_EMPTY',
          message: 'OCR vide : image illisible ou trop floue',
        });
      }

      /* ───── FILTRAGE + TRASH ───── */
      // Si on a des lignes géométriques, on les préfère (meilleur split)
      const filtered = allVisionLines.length
        ? smartFilterWithTrashFromLines(allVisionLines, { lang })
        : smartFilterWithTrashFromText(rawText, { lang });

      const lines = filtered.lines || [];
      const trash = filtered.trash || [];

      if (debug) {
        return res.json({
          ok: true,
          debug: {
            filesCount: files.length,
            maxImages: MAX_OCR_IMAGES,
            lang,
            usedGeometryLines: allVisionLines.length > 0,
            geometryLinesCount: allVisionLines.length,
            rawTextLength: rawText.length,
            firstLines: lines.slice(0, 40),
            trashSample: trash.slice(0, 40),
          },
        });
      }

      if (!lines.length) {
        return res.status(400).json({
          ok: false,
          error: 'ONLY_NOISE',
          message: 'Le texte détecté est uniquement du bruit',
        });
      }

      /* ───── SPLIT ───── */
      const split = splitIngredientsAndSteps(lines);

      let ingredientLines = split.ingredientLines || [];
      const stepLines = split.stepLines || [];
      const notesLines = split.notesLines || [];

      ingredientLines = ingredientLines.filter((l) => !looksLikeStep(l));

      let servings = split.servings || extractServingsFallback(rawText) || 1;
      if (!Number.isFinite(servings) || servings < 1) servings = 1;

      /* ───── INGREDIENTS ───── */
      const ingredients = beautifyIngredients(
        ingredientLines.map((line) => {
          const parsed = parseOcrIngredient(line) || parseRawLine(line);
          if (!parsed) {
            return { name: line, quantity: 0, unit: '' };
          }
          return {
            name: parsed.name || line,
            quantity: parsed.quantity || 0,
            unit: parsed.unit || '',
          };
        })
      );

      /* ───── STEPS ───── */
      const steps = normalizeStepsFromLines(stepLines);

      /* ───── TITLE + NOTES ───── */
      const title = guessTitleFromLines(lines) || 'Recette importée';
      const notes = extractNotesFromLines(notesLines, { title });

      /* ───── RESPONSE ───── */
      return res.json({
        ok: true,
        draft: {
          title,
          servings,
          imageUrl: null,
          notes,
          ingredients,
          steps,
          trash,
        },
      });
    } catch (err) {
      console.error('OCR ERROR:', err);
      return res.status(500).json({
        ok: false,
        error: 'INTERNAL_ERROR',
      });
    }
  }
);

module.exports = router;










