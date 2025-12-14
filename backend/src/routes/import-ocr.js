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
  looksLikeStep,
} = require('../utils/ocrText');

const { ocrFromBuffer } = require('../services/vision');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Auth : Supabase est branché globalement, ici on vérifie juste la présence de req.user
function needAuth(req, res, next) {
  if (!req.user?.userId) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

function isIphoneRequest(req) {
  const ua = String(req.headers['user-agent'] || '');
  return /iPhone|iPad|iPod|iOS/i.test(ua);
}

// Petit helper : extraction portions si splitIngredientsAndSteps n’a pas trouvé
function extractServingsFallback(text) {
  const t = String(text || '');

  const m1 = t.match(/portions?\s*:\s*(\d+)/i);
  if (m1) return parseInt(m1[1], 10);

  const m1b = t.match(/servings?\s*:\s*(\d+)/i);
  if (m1b) return parseInt(m1b[1], 10);

  const m2 = t.match(/\b(\d+)\s*(personnes|parts)\b/i);
  if (m2) return parseInt(m2[1], 10);

  return null;
}

// Nettoyage “iPhone screenshots” (uniquement iPhone, comme tu veux)
function cleanIosRawText(rawText) {
  let t = String(rawText || '');

  // retire des morceaux très typiques des barres iOS
  // (on reste prudent : seulement si on voit 4G/LTE/WiFi + heure)
  t = t.replace(/(^|\n)[^\n]*(4g|5g|lte|wifi|wi-fi)[^\n]*\b\d{1,2}:\d{2}\b[^\n]*\n/gi, '\n');

  // retire lignes “16 %”
  t = t.replace(/(^|\n)\s*\d{1,3}\s*%\s*(\n|$)/g, '\n');

  return t;
}

// POST /import/ocr
// body: form-data avec champ "file" (1 image) OU "files" (plusieurs images)
router.post(
  '/ocr',
  needAuth,
  upload.fields([
    { name: 'file', maxCount: 1 },  // rétrocompat
    { name: 'files', maxCount: 5 }, // multi-captures
  ]),
  async (req, res) => {
    try {
      const single = req.files?.file?.[0] || null;
      const multi = Array.isArray(req.files?.files) ? req.files.files : [];
      const allFiles = multi.length ? multi : (single ? [single] : []);

      if (!allFiles.length || !allFiles[0]?.buffer) {
        return res.status(400).json({
          error: 'IMAGE_MISSING',
          message: 'Aucun fichier image fourni (attendu: file ou files).',
        });
      }

      const debug = String(req.query.debug || '') === '1';

      // 0) OCR sur chaque image
      const rawTexts = [];
      for (const f of allFiles) {
        const txt = await ocrFromBuffer(f.buffer);
        rawTexts.push(String(txt || '').trim());
      }

      let rawText = rawTexts.filter(Boolean).join('\n\n');

      // nettoyage iPhone uniquement
      if (isIphoneRequest(req)) {
        rawText = cleanIosRawText(rawText);
      }

      if (debug) {
        return res.json({
          ok: true,
          debug: {
            filesCount: allFiles.length,
            isIphone: isIphoneRequest(req),
            rawTextsLengths: rawTexts.map((t) => t.length),
            rawTextLength: rawText.length,
            rawTextFirst2000: rawText.slice(0, 2000),
          },
        });
      }

      if (!rawText || !rawText.trim()) {
        return res.status(400).json({
          error: 'OCR_TEXT_EMPTY',
          message:
            "Impossible de lire du texte dans ces images. Essaie avec des photos plus nettes / zoomées / recadrées.",
        });
      }

      // 1) Filtrage intelligent des lignes
      const filteredLines = smartFilterLinesFromText(rawText);
      if (!filteredLines.length) {
        return res.status(400).json({
          error: 'OCR_TEXT_FILTERED_EMPTY',
          message:
            "Le texte détecté semble être du bruit (pubs, interface…). Essaie avec d’autres captures plus zoomées.",
        });
      }

      // 2) Split
      const split = splitIngredientsAndSteps(filteredLines);
      let ingredientLines = Array.isArray(split.ingredientLines) ? split.ingredientLines : [];
      const stepLines = Array.isArray(split.stepLines) ? split.stepLines : [];
      const notesLines = Array.isArray(split.notesLines) ? split.notesLines : [];

      // Filtre anti “étapes dans ingrédients”
      ingredientLines = ingredientLines.filter((l) => !looksLikeStep(l));

      // servings fallback + garde-fou
      const servingsFromSplit = Number.isFinite(split.servings) ? split.servings : 1;
      const servingsFallback = extractServingsFallback(rawText);
      let servings = servingsFromSplit !== 1 ? servingsFromSplit : (servingsFallback || 1);
      if (!Number.isFinite(servings) || servings < 1 || servings > 20) servings = 1;

      // 3) Ingrédients
      const ingredientsRaw = ingredientLines
        .map((line) => {
          const baseLine = String(line || '').trim();
          if (!baseLine) return null;

          // cas sel/poivre (pas de quantité forcée)
          if (/^\s*(sel|poivre)\b/i.test(baseLine) || /sel\s+et\s+poivre/i.test(baseLine)) {
            return { name: baseLine, quantity: 0, unit: '' };
          }

          // parse OCR dédié
          const parsedOcr = parseOcrIngredient(baseLine);
          if (parsedOcr) {
            return {
              name: parsedOcr.name,
              quantity: parsedOcr.quantity > 0 ? parsedOcr.quantity : 0,
              unit: parsedOcr.unit || '',
            };
          }

          // parse générique
          const parsed = parseRawLine(baseLine);
          if (parsed) {
            const q = parsed.quantityNum ?? parsed.quantity ?? 0;
            return {
              name: parsed.nameCanon || parsed.name || baseLine,
              quantity: q > 0 ? q : 0,
              unit: parsed.unit || '',
            };
          }

          return null;
        })
        .filter(Boolean);

      const ingredients = beautifyIngredients(ingredientsRaw).filter((i) => {
        const name = String(i?.name || '').trim();
        return Boolean(name);
      });

      // 4) Steps propres
      const steps = stepLines
        .map((s) => String(s || '').trim())
        .filter(Boolean);

      // 5) Titre
      const ocrTitle = guessTitleFromLines(filteredLines);

      // 6) Notes
      const baseNotes = notesLines.length ? notesLines.join('\n') : '';
      const noStepsHint =
        steps.length === 0
          ? "\n\n(Aucune étape détectée : si elles sont sur une autre capture, ajoute une image centrée sur “Préparation / Instructions”.)"
          : '';
      const notes = (baseNotes + noStepsHint).trim();

      return res.json({
        ok: true,
        draft: {
          title: ocrTitle || 'Recette importée',
          servings,
          imageUrl: null,
          notes,
          steps,
          ingredients,
        },
      });
    } catch (e) {
      console.error('[import-ocr] error:', e);
      return res.status(500).json({
        error: 'OCR_INTERNAL_ERROR',
        message: "Erreur interne lors de la lecture de l’image.",
      });
    }
  }
);

module.exports = router;





