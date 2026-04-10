// backend/src/routes/import-ocr.js
// LEVEL: ROUTE
// import autorisés : middleware-services-lib-utils,
// import interdits : routes-parsers-frontend
// importé uniquement par src-index

'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

const { supabaseAdmin } = require('../services/supabaseAdmin');

const { removeSocialHeaderLines } = require('./import-ocr/helpers');
const { buildIngredientsFromSplit } = require('./import-ocr/ingredientPipeline');

const { priceIngredients, annotateDuplicateCourses } = require('./import-ocr/pricingHelpers');
const { buildOcrSuccessResponse } = require('./import-ocr/responseHelpers');
const { buildBestSplitFromOcr } = require('./import-ocr/splitPipeline');
const { buildFinalOcrTitle } = require('./import-ocr/titlePipeline');
const { collectOcrDataFromFiles } = require('./import-ocr/visionHelpers');


//ocrText
const { smartFilterWithTrashFromText, joinWrappedLinesForSteps } = require('../utils/ocrText');

const { splitStepsFromLines } = require('../utils/textUtils');

const DEBUG_OCR = process.env.OCR_DEBUG !== 'production';
const dlog = (...args) => { if (DEBUG_OCR) console.log(...args); };


let parseRawLine = null;
try {
  parseRawLine = require('../utils/ingredients')?.parseRawLine || null;
} catch (e) {
  parseRawLine = null;
}

// ---------------- Router ----------------

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const MAX_FILES = 10;

router.post('/ocr', upload.array('files', MAX_FILES), async (req, res) => {
  try {
    const debugMode = String(req.query.debug || '').toLowerCase(); // "1" | "title" | ""
    const isDebug = debugMode === '1' || debugMode === 'title';

    if (!req.files?.length) {
      return res.status(400).json({ ok: false, error: 'NO_FILES', message: 'Ajoute au moins 1 image.' });
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
    const imagePath = `ocr/${safeName}`;
    const { error: uploadError } = await supabaseAdmin
      .storage
      .from('recipe-images')
      .upload(imagePath, imageFile.buffer, {
        contentType: imageFile.mimetype,
        upsert: false,
      });

      let imageUrl = null;

      if(!uploadError) {
        const { data } = supabaseAdmin
          .storage
          .from('recipe-images')
          .getPublicUrl(imagePath);

        imageUrl = data.publicUrl;
      }

      
const {
  texts,
  pickedTitles,
  visionDebugByImage,
  spatialIngredientHints,
} = await collectOcrDataFromFiles(req.files, { isDebug });

const rawText = texts.join('\n\n');
const filtered = smartFilterWithTrashFromText(rawText);

    

    const safeLinesForTitle = removeSocialHeaderLines(filtered.lines);
    const rawLines = removeSocialHeaderLines(filtered.lines);
    const lines = [...rawLines];

    const { split, servings, layoutCase } = buildBestSplitFromOcr({
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

    // ---------- STEPS ----------
    const rawSteps = joinWrappedLinesForSteps(split.stepLines || []);
    const steps = splitStepsFromLines(rawSteps)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => s !== '•' && s !== '.' && s !== '·')
      .filter((s) => !/^\d{1,3}$/.test(s));

    // ---------- NOTES ----------
    const baseNotes = (split.notesLines || [])//.map((s) => String(s || '').trim()).filter(Boolean);
    .map(s => String(s || '').trim())
    .filter(Boolean);
    const allNotes = [...baseNotes,...extraNotes];
    const notes = allNotes.join('\n');

    const {
      title,
      guessedFromLines,
      cleanedPickedTitles,
      mergedFromVision,
      bestVisionTitle,
    } = buildFinalOcrTitle({
      pickedTitles,
      safeLinesForTitle,
      ingredients,
      steps,
      dlog,
    });
      
    // ✅ IMPORTANT : draft est déclaré AVANT d’être utilisé (sinon: cannot access draft before initialization)
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

    // ✅ Airtable pricing (V1) : UNE SEULE fois (ne pas dupliquer) - remplacer le 02/04/26
    const priced = await priceIngredients(draft.ingredients, { dlog });
    draft.ingredients = annotateDuplicateCourses(priced.ingredients);
    dlog('[debug][annotated ingredients]', draft.ingredients);
    draft.totalCostEur = priced.totalCostEur;

 // ─────────────────────────────────────────────
   // ✅ Bêta: limite pricing (10 recettes) dès l’aperçu OCR
   // ─────────────────────────────────────────────

    //console log a supprimer
   dlog('[TITLE][PIPELINE]', {
      guessedFromLines,
      bestVisionTitle,
      mergedFromVision,
      titleBeforeResponse: title,
    });

    // ✅ debug=title : renvoie seulement infos titres
    if (debugMode === 'title') {
      return res.json({
        ok: true,
        debug: {
          imagesCount: req.files.length,
          pickedTitles,
          cleanedPickedTitles,
          mergedFromVision: mergedFromVision || null,
          bestVisionTitle: bestVisionTitle || null,
          guessedFromLines,
          //headForTitle: head,
          finalTitle: title,
          firstLines: safeLinesForTitle.slice(0, 40),
          byImage: visionDebugByImage,
        },
      });
    }

    if (isDebug) {
      return res.json({
        ok: true,
        debug: {
          imagesCount: req.files.length,
          title,
          servings,
          totalCostEur: draft.totalCostEur,
          vision: {
            pickedTitles,
            mergedFromVision: mergedFromVision || null,
            bestVisionTitle: bestVisionTitle || null,
            guessedFromLines,
            byImage: visionDebugByImage,
          },
          firstLines: safeLinesForTitle.slice(0, 60),
          split: {
            ingredientLinesCount: (split.ingredientLines || []).length,
            stepLinesCount: (split.stepLines || []).length,
            notesLinesCount: (split.notesLines || []).length,
            ingredientLines: split.ingredientLines || [],
          },
          trashSample: (filtered.trash || []).slice(0, 60),
          draftPreview: {
            ingredientsPreview: draft.ingredients.slice(0, 12),
            stepsPreview: draft.steps.slice(0, 12),
          },
        },
      });
    }
    
    // --- PAYWALL PRICING (Free: 10 recettes visibles) ---

// 1) déterminer le plan
// IMPORTANT: selon ton auth middleware, adapte la façon de lire l'userId.
// Le plus probable chez toi : req.user.id
// Important: flou à partir de la 11e => on calcule blur AVANT incrément.

const responsePayload = await buildOcrSuccessResponse({ req, draft });
return res.json(responsePayload);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: 'OCR_FAILED', message: e?.message || 'Erreur OCR' });
  }
});


module.exports = router;
