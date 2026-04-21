// backend/src/routes/demo-import-ocr.js
// LEVEL: ROUTE
// Route publique OCR de démonstration (sans compte)

'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

const { supabaseAdmin } = require('../services/supabaseAdmin');
const { checkAndIncrementGuestDemoLimit } = require('../services/guestDemoLimits');

const { removeSocialHeaderLines } = require('./import-ocr/helpers');
const { buildIngredientsFromSplit } = require('./import-ocr/ingredientPipeline');
const { priceIngredients, annotateDuplicateCourses } = require('./import-ocr/pricingHelpers');
const { buildBestSplitFromOcr } = require('./import-ocr/splitPipeline');
const { buildFinalOcrTitle } = require('./import-ocr/titlePipeline');
const { collectOcrDataFromFiles } = require('./import-ocr/visionHelpers');
const { buildDemoOcrSuccessResponse } = require('./import-ocr/demoResponseHelpers');

const { smartFilterWithTrashFromText, joinWrappedLinesForSteps } = require('../utils/ocrText');
const { splitStepsFromLines } = require('../utils/textUtils');

const DEBUG_OCR = process.env.OCR_DEBUG !== 'production';
const dlog = (...args) => {
  if (DEBUG_OCR) console.log(...args);
};

let parseRawLine = null;
try {
  parseRawLine = require('../utils/ingredients')?.parseRawLine || null;
} catch (_e) {
  parseRawLine = null;
}

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const MAX_FILES = 2;

router.post('/ocr', upload.array('files', MAX_FILES), async (req, res) => {
  try {
    if (!req.files?.length) {
      return res.status(400).json({
        ok: false,
        error: 'NO_FILES',
        message: 'Ajoute au moins 1 image.',
      });
    }

    if (req.files.length > MAX_FILES) {
      return res.status(400).json({
        ok: false,
        error: 'TOO_MANY_FILES',
        message: `Maximum ${MAX_FILES} images pour le test gratuit.`,
      });
    }

    const gate = await checkAndIncrementGuestDemoLimit(req);

    if (!gate.allowed) {
      return res.status(429).json({
        ok: false,
        error: 'DEMO_LIMIT_REACHED',
        message: 'Tu as atteint la limite du test gratuit pour aujourd’hui.',
      });
    }

    const imageFile = req.files[0];
    const extFromName = path.extname(imageFile.originalname || '').toLowerCase();
    const extFromMime =
      imageFile.mimetype === 'image/png' ? '.png' :
      imageFile.mimetype === 'image/webp' ? '.webp' :
      imageFile.mimetype === 'image/heic' ? '.heic' :
      imageFile.mimetype === 'image/heif' ? '.heif' :
      '.jpg';

    const ext = extFromName || extFromMime;
    const safeName = `${Date.now()}-${crypto.randomUUID()}${ext}`;
    const imagePath = `ocr-demo/${safeName}`;

    const { error: uploadError } = await supabaseAdmin
      .storage
      .from('recipe-images')
      .upload(imagePath, imageFile.buffer, {
        contentType: imageFile.mimetype,
        upsert: false,
      });

    let imageUrl = null;

    if (!uploadError) {
      const { data } = supabaseAdmin
        .storage
        .from('recipe-images')
        .getPublicUrl(imagePath);

      imageUrl = data.publicUrl;
    }

    const {
      texts,
      pickedTitles,
      spatialIngredientHints,
    } = await collectOcrDataFromFiles(req.files, { isDebug: false });

    const rawText = texts.join('\n\n');
    const filtered = smartFilterWithTrashFromText(rawText);

    const safeLinesForTitle = removeSocialHeaderLines(filtered.lines);
    const rawLines = removeSocialHeaderLines(filtered.lines);
    const lines = [...rawLines];

    const { split, servings } = buildBestSplitFromOcr({
      lines,
      rawLines,
      spatialIngredientHints,
      dlog,
    });

    const { ingredients, extraNotes } = buildIngredientsFromSplit({
      ingredientLines: split.ingredientLines || [],
      trash: filtered.trash,
      parseRawLine,
      dlog,
    });

    const rawSteps = joinWrappedLinesForSteps(split.stepLines || []);
    const steps = splitStepsFromLines(rawSteps)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => s !== '•' && s !== '.' && s !== '·')
      .filter((s) => !/^\d{1,3}$/.test(s));

    const baseNotes = (split.notesLines || [])
      .map((s) => String(s || '').trim())
      .filter(Boolean);

    const allNotes = [...baseNotes, ...extraNotes];
    const notes = allNotes.join('\n');

    const { title } = buildFinalOcrTitle({
      pickedTitles,
      safeLinesForTitle,
      ingredients,
      steps,
      dlog,
    });

    const draft = {
      title,
      servings,
      imageUrl,
      notes,
      ingredients,
      steps,
      trash: filtered.trash,
      totalCostEur: null,
    };

    const priced = await priceIngredients(draft.ingredients, { dlog });
    draft.ingredients = annotateDuplicateCourses(priced.ingredients);
    draft.totalCostEur = priced.totalCostEur;

    const responsePayload = buildDemoOcrSuccessResponse({
      draft,
      trial: gate,
    });

    return res.json(responsePayload);
  } catch (e) {
    console.error(e);
    return res.status(500).json({
      ok: false,
      error: 'OCR_FAILED',
      message: e?.message || 'Erreur OCR',
    });
  }
});

module.exports = router;