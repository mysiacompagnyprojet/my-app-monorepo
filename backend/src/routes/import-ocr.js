// backend/src/routes/import-ocr.js
'use strict';


const express = require('express');
const multer = require('multer');


const { pickBestTitle, isValidRecipeTitleCandidate, tryMergeSplitTitle } = require('../utils/ocrTitle');


const { ocrFromBuffer, ocrFromBufferWithDebug } = require('../services/vision');
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


// ---------------- Helpers ----------------


function stripBulletPrefix(s) {
  return String(s || '')
    .trim()
    .replace(/^[•·⚫●○◦\-\*]+\s*/g, '')
    .trim();
}


function normalizeTitleCandidate(s) {
  return String(s || '')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}


function isBlacklistedUiTitle(s) {
  const t = normalizeTitleCandidate(s).toLowerCase();
  if (!t) return true;


  // ✅ Instagram / FB / UI générique
  if (t === 'toutes les publications' || t === 'toute les publications') return true;
  if (t === 'enregistré' || t === 'enregistree' || t === 'enregistrée') return true;


  // pages / noms de comptes souvent pris comme titre à tort
  if (t === 'recettes délice' || t === 'recettes delice') return true;
  if (t === 'recettes et délices' || t === 'recettes et delices') return true;


  // Facebook header
  if (t.startsWith('publication de')) return true;


  return false;
}


function looksLikeStepTitle(t) {
  const s = String(t || '').trim();
  if (!s) return false;
  return /^[-•*]?\s*(hacher|hachez|eplucher|epluchez|éplucher|épluchez|égoutter|egoutter|ajouter|mixer|mixez|cuire|faire|préchauffer|prechauffer|préparer|preparer|couper|laver|mettre|verser|chauffer|mélanger|melanger)\b/i.test(
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


// ✅ Retire les headers FB qui parasitent les titres
function removeSocialHeaderLines(lines) {
  return (lines || []).filter((l) => !/^publication\s+de\b/i.test(String(l || '').trim()));
}


function isOcrZeroGramNoise(line) {
  const s = stripBulletPrefix(line)
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();


  // "Og", "0g", parfois "O g", ou "0 g"
  if (/^o\s*[gq]$/i.test(s)) return true;
  if (/^0\s*g$/i.test(s)) return true;


  return false;
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
  if (
    /^\s*(\d+([.,]\d+)?|\d+\s+\d+\/\d+|\d+\/\d+|½|⅓|⅔|¼|¾|⅛|⅜|⅝|⅞)\b/.test(raw)
  ) {
    return [{ text: line, noQtyList: false }];
  }


  if (!raw.includes(',')) return [{ text: line, noQtyList: false }];
  if (raw.length > 70) return [{ text: line, noQtyList: false }];


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


  if (parts.length >= 2) return parts.map((p) => ({ text: p, noQtyList: true }));
  return [{ text: line, noQtyList: false }];
}


function fabricateTitleFromIngredientsRows(ingredientsRows) {
const stop = new Set([
'sel', 'poivre', 'eau', "eau d'orange", "eau d’orange",
'huile', "huile d'olive", "huile d’olive",
'beurre'
]);


const rows = Array.isArray(ingredientsRows) ? ingredientsRows : [];


// prend l’ingrédient avec la plus grosse quantité (si dispo), sinon le 1er “utile”
let best = null;


for (const r of rows) {
const name = String(r?.name || '').trim();
if (!name) continue;


const low = name.toLowerCase();
if (stop.has(low)) continue;
if (low.startsWith('huile')) continue;


const qty = Number(r?.quantity || 0);
if (!best) best = { name, qty };
else if (Number.isFinite(qty) && qty > best.qty) best = { name, qty };
}


if (!best) return null;


// mini "style" pour tes cas fréquents
const hasCoco = rows.some((r) => String(r?.name || '').toLowerCase().includes('lait de coco'));
const hasCrevettes = rows.some((r) => String(r?.name || '').toLowerCase().includes('crevette'));


if (hasCrevettes && hasCoco) return 'Crevettes au lait de coco';


// sinon juste capitaliser le principal
const t = best.name.toLowerCase();
return t.charAt(0).toUpperCase() + t.slice(1);
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


    const texts = [];


    // ✅ Titres Vision collectés sur TOUTES les images (en debug et aussi en normal)
    const pickedTitles = [];
    const visionDebugByImage = [];


    for (let i = 0; i < req.files.length; i++) {
      const f = req.files[i];


      // ✅ On utilise la version debug pour récupérer pickedTitle (même en normal)
      // (ça ne change rien au parsing, ça donne juste plus d'infos)
      const out = await ocrFromBufferWithDebug(f.buffer, { lang: 'fr' });


      if (out?.text) texts.push(out.text);


      const pt = out?.debug?.pickedTitle ? String(out.debug.pickedTitle).trim() : '';
      if (pt) pickedTitles.push(pt);


      if (isDebug) {
        visionDebugByImage.push({
          index: i,
          pickedTitle: pt || null,
          topTextSample: out?.debug?.topTextSample || null,
          bandTextSample: out?.debug?.bandTextSample || null,
        });
      }
    }


    // ✅ ICI : boucle finie => pickedTitles est COMPLET
    const mergedFromVision = tryMergeSplitTitle(pickedTitles);
    const bestVisionTitleRaw = mergedFromVision || pickBestTitle(pickedTitles);


    const bestVisionTitle =
      bestVisionTitleRaw &&
      isValidRecipeTitleCandidate(bestVisionTitleRaw) &&
      !isBlacklistedUiTitle(bestVisionTitleRaw)
        ? String(bestVisionTitleRaw).trim()
        : null;


    const rawText = texts.join('\n\n');
    const filtered = smartFilterWithTrashFromText(rawText);


    // ✅ On protège le fallback “guessTitleFromLines”
    const safeLinesForTitle = removeSocialHeaderLines(filtered.lines);


    // ✅ PATCH TITRE (debug=title inclus) : fabrique un titre depuis les lignes d'ingrédients
    function fabricateTitleFromLinesForTitle(linesForTitle) {
    const stop = new Set(['sel', 'poivre', 'eau', 'huile', "huile d'olive", "huile d’olive", 'beurre']);


    const found = [];
    for (const l0 of (linesForTitle || []).slice(0, 60)) {
    const l = String(l0 || '').trim();
    if (!l) continue;
    if (/^préparation\b/i.test(l) || /^preparation\b/i.test(l)) break;


    const parsed = parseOcrIngredient(l);
    if (!parsed?.name) continue;


    const low = String(parsed.name).toLowerCase().trim();
    if (!low || stop.has(low) || low.startsWith('huile')) continue;


    found.push(parsed.name);
    if (found.length >= 4) break;
    }


    const hasCrevettes = found.some((x) => /crevette/i.test(x));
    const hasCoco = (linesForTitle || []).some((x) => /lait\s+de\s+coco/i.test(String(x || '')));


    if (hasCrevettes && hasCoco) return 'Crevettes au lait de coco';
    if (hasCrevettes) return 'Crevettes';


    // fallback : 1er ingrédient utile
    if (found.length >= 1) {
    const t = String(found[0]).toLowerCase();
    return t.charAt(0).toUpperCase() + t.slice(1);
    }
   return null;
   }


    // Split contenu (ingrédients/étapes) — inchangé
    let lines = removeSocialHeaderLines(filtered.lines);


    const split = splitIngredientsAndSteps(lines);
    lines = miniReflow(split);


    let servings = split.servings || 1;
    if (!Number.isFinite(servings) || servings < 1) servings = 1;


    // ---------- INGREDIENTS ----------
    const ingredients = beautifyIngredients(
      (split.ingredientLines || [])
        .flatMap((l) => splitCommaSeparatedNoQty(l))
        .map((obj) => {
          const l = String(obj?.text || '').trim();
          if (!l) return null;


          // ✅ supprime le bruit OCR "Og / 0g"
          if (isOcrZeroGramNoise(l)) return null;


          // ✅ si ça vient d'une liste "sans quantité" (épices, condiments), on force quantity=0
          if (obj.noQtyList) {
            const name = stripBulletPrefix(l);
            if (!name) return null;


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
      .flatMap((s) =>
        String(s || '')
          .split(/\.(?=\s+[A-ZÀ-ÖØ-Þ])/g) // split au "." suivi d'une majuscule
          .map((x) => x.trim())
      )
      .filter((s) => s && s !== '•' && s !== '.' && s !== '·');


    // ---------- NOTES ----------
    const notes = (split.notesLines || []).map((s) => String(s || '').trim()).filter(Boolean).join('\n');


    // ✅ TITRE FINAL : Vision > OCR lines > fallback ingrédients principal
    let title =
      bestVisionTitle ||
      guessTitleFromLines(safeLinesForTitle) ||
      inferTitleFromContent(ingredients, steps) ||
      'Recette importée';


      // ✅ PATCH TITRE: si le “titre” ressemble à une étape (ex: "Épluchez..."), on fabrique via ingrédients
      if (looksLikeStepTitle(title)) {
      const byIng = fabricateTitleFromIngredientsRows(ingredients);
      if (byIng) title = byIng;
      }


     // ✅ Si un “titre” ressemble à une étape => on force un titre basé sur le contenu
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


    // ✅ si le titre final ressemble à une étape => fabriquer via ingrédients
    if (looksLikeStepTitle(title)) {
    const byIng = fabricateTitleFromLinesForTitle(safeLinesForTitle);
    if (byIng) title = byIng;
     }




    // ✅ debug=title : on ne renvoie QUE les infos titres (plus simple pour toi)
    if (debugMode === 'title') {
      return res.json({
        ok: true,
        debug: {
          imagesCount: req.files.length,
          pickedTitles,
          mergedFromVision: mergedFromVision || null,
          bestVisionTitle: bestVisionTitle || null,
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
          vision: {
            pickedTitles,
            mergedFromVision: mergedFromVision || null,
            bestVisionTitle: bestVisionTitle || null,
            byImage: visionDebugByImage,
          },
          firstLines: safeLinesForTitle.slice(0, 60),
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






