// backend/src/routes/import-ocr.js
// LEVEL: ROUTE
// import autorisés : middleware-services-lib-utils,
// import interdits : routes-parsers-frontend
// importé uniquement par src-index

'use strict';

const express = require('express');
const multer = require('multer');
//stringUtils
const { normSpaces, stripDiacritics, stripBulletPrefix, normalizeLoose, normalizeTitleCandidate, sanitizePickedTitle } = require('../utils/stringUtils');
//ocrTitle
const { pickBestTitle, tryMergeSplitTitle} = require('../utils/ocrTitle');
//textUtils
const { normalizeTitleJoinPiece, splitStepsFromLines } = require('../utils/textUtils');
// ✅ Airtable service remplacer par supabase.js
const { getIngredientPriceByName } = require('../services/supabase');
const { ocrFromBufferWithDebug } = require('../services/vision');
const { buildMergedTitleCandidate} = require('../utils/titleMerge');
const { isValidRecipeTitleCandidate } = require('../utils/heuristics');
//titleUtils
const { isBlacklistedUiTitle, looksLikeEmotionalHookTitle, looksLikeStepTitle, looksLikeLooseActionStep, looksLikeIngredientOnlyTitle, looksLikeHookOrLongSentenceTitle, looksLikeMeasureLineTitle, looksTruncatedTitle, isBadTitleCandidate, visionLooksLikeSuffix, stripOcrTitleArtifacts, looksLikeIngredientFragmentTitleForTitle  } = require('../utils/titleUtils');
const { parseOcrIngredient} = require('../utils/ingredientParser');
//ocrText
const { smartFilterWithTrashFromText, splitIngredientsAndSteps, joinWrappedLinesForSteps, beautifyIngredients, guessTitleFromLines, miniReflow } = require('../utils/ocrText');
const { joinWrappedLinesForIngredients } = require('../utils/ingredientUtils');
const { supabaseAdmin } = require('../services/supabaseAdmin');
const { canonUnit, toBaseQty } = require('../utils/units');
const DEBUG_OCR = process.env.OCR_DEBUG === '1';
const dlog = (...args) => { if (DEBUG_OCR) console.log(...args); };

let parseRawLine = null;
try {
  parseRawLine = require('../utils/ingredients')?.parseRawLine || null;
} catch (e) {
  parseRawLine = null;
}


// ---------------- CAT-03.1.2 Helpers (local) ----------------

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

  const hasPates = /\bpates?\b/.test(stepsText) || /\bp[aâ]tes?\b/.test(names);
  const hasTomate = /\btomate\b/.test(names) || /\bconcentre\b/.test(names);
  const hasViande = /\bviande\b/.test(names) || /\bhach[eé]e\b/.test(names);

  if (hasPates && hasTomate && hasViande) return 'Pâtes sauce tomate & viande';
  if (hasPates && hasTomate) return 'Pâtes sauce tomate';

  return null;
}

function removeSocialHeaderLines(lines) {
  return (lines || []).filter((l) => !/^publication\s+de\b/i.test(String(l || '').trim()));
}

function isOcrZeroGramNoise(line) {
  const s = stripBulletPrefix(line)
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (/^o\s*[gq]$/i.test(s)) return true;
  if (/^0\s*g$/i.test(s)) return true;

  return false;
}

function splitCommaSeparatedNoQty(line) {
  const raw = stripBulletPrefix(line);
  if (!raw) return [{ text: line, noQtyList: false }];

  if (/^\s*(\d+([.,]\d+)?|\d+\s+\d+\/\d+|\d+\/\d+|½|⅓|⅔|¼|¾|⅛|⅜|⅝|⅞)\b/.test(raw)) {
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
  const stop = new Set(['sel', 'poivre', 'eau', "eau d'orange", "eau d’orange", 'huile', "huile d'olive", "huile d’olive", 'beurre']);

  const rows = Array.isArray(ingredientsRows) ? ingredientsRows : [];

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

  const hasCoco = rows.some((r) => String(r?.name || '').toLowerCase().includes('lait de coco'));
  const hasCrevettes = rows.some((r) => String(r?.name || '').toLowerCase().includes('crevette'));

  if (hasCrevettes && hasCoco) return 'Crevettes au lait de coco';

  const t = best.name.toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function isUnitOnlyLine(s) {
  const l = String(s || '').trim().toLowerCase();
  return l === 'g' || l === 'kg' || l === 'ml' || l === 'cl' || l === 'l';
}

function uniqLines(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr || []) {
    const s = String(x || '').replace(/\s+/g, ' ').trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function rescueWrappedIngredientFragmentsOnly(split) {
  const ing = Array.isArray(split?.ingredientLines) ? [...split.ingredientLines] : [];
  const notes = Array.isArray(split?.notesLines) ? split.notesLines : [];
  const steps = Array.isArray(split?.stepLines) ? split.stepLines : [];

  const candidates = []
    .concat(notes, steps)
    .map((x) => stripBulletPrefix(String(x || '')).replace(/^[.■]+/g, '').trim())
    .filter(Boolean)
    .filter((t) => {
      const low = t.toLowerCase();

      if (isUnitOnlyLine(low)) return true;
      if (/^\d{1,4}$/.test(low)) return true;
      if (/^(de|d['’])\b/.test(low)) return true;
      if (/^(beurre|cacahu|grill|concas)\b/.test(low)) return true;

      if (/\b(recoltos|delico|recettes?\s+d[eé]lice)\b/.test(low)) return true;

      if (t.length > 34) return false;

      if (/^ingr[eé]dients?\s*:?$/.test(low)) return true;

      return false;
    });

  if (!candidates.length) return split;

  const rebuilt = joinWrappedLinesForIngredients(candidates);

  const add = rebuilt.filter((l) => {
    const s = String(l || '').trim();
    if (!s) return false;
    if (/^\d{1,4}\s*(kg|g|mg|l|dl|cl|ml)\b/i.test(s)) return true;
    return !!parseOcrIngredient(s);
  });

  if (!add.length) return split;

  return {
    ...split,
    ingredientLines: uniqLines(ing.concat(add)),
  };
}

function splitMergedIngredientLine(line, trash) {
  let s = String(line || '').replace(/\s+/g, ' ').trim();
  if (!s) return [];

  s = s.replace(/\bRecoltos\b.*$/i, '').trim();

  const m = s.match(/^(\d+)\s*g\s+de\s+(.+?)\s+de\s+beurre\s+de\s+cacahu(?:e|è)te\b/i);
  if (m && /chocolat/i.test(m[2])) {
    const qty = m[1];
    //const hasQtyInTrash = Array.isArray(trash) && trash.some((x) => String(x || '').trim() === qty);
    //const qty2 = hasQtyInTrash ? qty : qty; enlever le 24/02 ne sert a rien
    return [`${qty} g de ${m[2].trim()}`, `${qty} g de beurre de cacahuète`];
  }

  return [s];
}

//Airtable pricing (v1)
function roundMoney(n) {
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function spoonToMl(unit) {
  const u = String(unit || '').toLowerCase().trim();
  if (u === 'càc' || u === 'cac' || u === 'cc') return 5;  // 1 càc ≈ 5 ml
  if (u === 'càs' || u === 'cas' || u === 'cs') return 15; // 1 càs ≈ 15 ml
  return null;
}

/**
 * Calcul le cout à partir :
 * ing: { name, quantity, unit }
 * priceRow: { unit: 'g'|'ml'|'piece', pricePerUnit: number, airtableId, ... }
 */
function computeIngredientCostEur(ing, priceRow) {
  if (!priceRow || !Number.isFinite(priceRow.pricePerUnit)) {
    return { price: null, costEur: 0, matched: false };
  }
  //si pas de quantité exploitable => on ne calcule pas le coût, mais on affiche le prix unitaire
  const qty = Number(ing?.quantity || 0);
  if (!Number.isFinite(qty) || qty <= 0) {
    return {
      price: { eurPer: priceRow.pricePerUnit, perUnit: priceRow.unit },
      costEur: 0,
      matched: true,
    };
  }

  // unit OCR
  const unitRaw = String(ing?.unit || '').trim();

  // ✅ cuillères -> ml (uniquement si Airtable est en "ml")
  const mlPerSpoon = spoonToMl(unitRaw);
  if (mlPerSpoon) {
    if (priceRow.unit !== 'ml') {
      return {
        price: { eurPer: priceRow.pricePerUnit, perUnit: priceRow.unit },
        costEur: null,
        matched: true,
      };
    }
    const totalMl = qty * mlPerSpoon;
    const cost = totalMl * Number(priceRow.pricePerUnit || 0);
    return {
      price: { eurPer: priceRow.pricePerUnit, perUnit: priceRow.unit },
      costEur: Number.isFinite(cost) ? roundMoney(cost) : null,
      matched: true,
    };
  }

  // ✅ unités standard -> base (g/ml/piece)
  const ingUnitCanon = canonUnit(unitRaw); // 'g','kg','ml','l','piece',...
  const { qty: baseQty, unit: baseUnit } = toBaseQty(qty, ingUnitCanon);

  // On ne calcule que si la base correspond à l’unité du prix unitaire Airtable
  if (baseUnit !== priceRow.unit) {
    return {
      price: { eurPer: priceRow.pricePerUnit, perUnit: priceRow.unit },
      costEur: null,
      matched: true,
    };
  }

  const cost = baseQty * Number(priceRow.pricePerUnit || 0);
  return {
    price: { eurPer: priceRow.pricePerUnit, perUnit: priceRow.unit },
    costEur: Number.isFinite(cost) ? roundMoney(cost) : null,
    matched: true,
  };
}

async function priceIngredients(ingredients) {
  let totalCostEur = 0;

  const pricedIngredients = await Promise.all(
    (ingredients || []).map(async (ing) => {
      try {
        // cas "sel" / "poivre" => on ne cherche pas de prix
        const n = String(ing?.name || '').trim().toLowerCase();
        if (n === 'sel' || n === 'poivre') {
          return {
            ...ing,
            price: null,
            costEur: 0,
            priceMatched: true, // on marque comme "ok" (pas d'alerte)
            pricingStatus: 'SKIPPED',
            id: null,
          };
        }
        const priceRow = await getIngredientPriceByName(ing.name, ing.unit);
        const { price, costEur, matched } = computeIngredientCostEur(ing, priceRow);

        if (typeof costEur === 'number' && Number.isFinite(costEur)) {
          totalCostEur += costEur;
        }

        return {
          ...ing,
          price,                          // { eurPer, perUnit } | null
          costEur,                        // number | null
          priceMatched: matched,          // boolean
          id: priceRow?.id|| null,
        };
      } catch (e) {
        // si Airtable plante, on ne bloque pas l’OCR
        return {
          ...ing,
          price: null,
          costEur: 0,
          priceMatched: false,
          pricingStatus: 'ERROR',
          id: null,
        };
      }
    })
  );
  dlog('[debug][parsed ingredients]', ingredients);
  return { ingredients: pricedIngredients, totalCostEur: roundMoney(totalCostEur) };
}
// jusqu'ici Airtable pricing (v1)

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
    const imagePath = `ocr/${Date.now()}-${imageFile.originalname}`;
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
    const texts = [];

    const pickedTitles = [];
    const visionDebugByImage = [];

    for (let i = 0; i < req.files.length; i++) {
      const f = req.files[i];

      const out = await ocrFromBufferWithDebug(f.buffer, { lang: 'fr' });

      if (out?.text) texts.push(out.text);

      let pt = out?.debug?.pickedTitle ? String(out.debug.pickedTitle).trim() : ''; // pt = picked title (titre choisi)

      if (pt) {
        pt = normalizeTitleCandidate(pt); // normalise espaces/ponctuation

        // ❌ Ne jamais garder une ligne d'étape comme titre Vision
        if (looksLikeLooseActionStep(pt) || looksLikeStepTitle(pt)) {
          pt = '';
        }

        // ❌ Ne jamais garder un mini-ingrédient comme titre ("Du thym", etc.)
        if (pt && looksLikeIngredientOnlyTitle(pt)) {
          pt = '';
        }

        if (pt && looksLikeIngredientFragmentTitleForTitle(pt)) {
          pt = '';
        }

        // ❌ Blacklist UI / émotionnel (comme tu fais déjà après, mais ici on nettoie dès la source)
        if (pt && (isBlacklistedUiTitle(pt) || looksLikeEmotionalHookTitle(pt))) {
          pt = '';
        }

        // ✅ Push seulement si vraiment utile
        if (pt) pickedTitles.push(pt);
      }

      if (isDebug) {
        visionDebugByImage.push({
          index: i,
          pickedTitle: pt || null,
          topTextSample: out?.debug?.topTextSample || null,
          bandTextSample: out?.debug?.bandTextSample || null,
        });
      }
    }

    const cleanedPickedTitles = (pickedTitles || [])
      .map((t) => String(t || '').trim())
      .filter(Boolean)
      .filter((t) => isValidRecipeTitleCandidate(t))
      .filter((t) => !isBlacklistedUiTitle(t))
      .filter((t) => !looksLikeEmotionalHookTitle(t))
      .filter((t) => !looksLikeStepTitle(t));

    const mergedFromVision = tryMergeSplitTitle(cleanedPickedTitles);
    const bestVisionTitleRaw = mergedFromVision || pickBestTitle(cleanedPickedTitles);

    let bestVisionTitle =
      bestVisionTitleRaw &&
      isValidRecipeTitleCandidate(bestVisionTitleRaw) &&
      !isBlacklistedUiTitle(bestVisionTitleRaw) &&
      !looksLikeEmotionalHookTitle(bestVisionTitleRaw) &&
      !looksLikeStepTitle(bestVisionTitleRaw) &&
      !looksLikeIngredientFragmentTitleForTitle(bestVisionTitleRaw)
        ? String(bestVisionTitleRaw).trim()
        : null;

    const rawText = texts.join('\n\n');
    const filtered = smartFilterWithTrashFromText(rawText);

    const safeLinesForTitle = removeSocialHeaderLines(filtered.lines);

    if (bestVisionTitle) {
      // ✅ on normalise AVANT tout (enlève +, ponctuation, espaces)
      bestVisionTitle = normalizeTitleJoinPiece(bestVisionTitle);

      const truncEnd = looksTruncatedTitle(bestVisionTitle);
      const truncStart = /^(à|a|de|d['’]|du|des)\b/i.test(bestVisionTitle);
      const firstLines = safeLinesForTitle.slice(0, 60);
      if (bestVisionTitle && truncStart) {
        const idx = firstLines.findIndex(l =>
        normalizeTitleJoinPiece(l).toLowerCase() === normalizeTitleJoinPiece(bestVisionTitle).toLowerCase()
        );

        if (idx > 0) {
          const prev = sanitizePickedTitle(firstLines[idx - 1]);
          const merged = [prev, bestVisionTitle].join(' ').trim();

          if (
            isValidRecipeTitleCandidate(merged) &&
            !looksLikeIngredientFragmentTitleForTitle(merged)
          ) {
          bestVisionTitle = merged;
          }
        }
      }

      if (truncEnd || truncStart) {
        const scan = (safeLinesForTitle || []).map(normSpaces).filter(Boolean);

        // on cherche l'index de la ligne la plus proche du titre
        const target = normalizeTitleJoinPiece(bestVisionTitle);
        let idx = scan.findIndex((l) => normalizeTitleJoinPiece(l) === target);
        if (idx < 0) {
          const targetLow = target.toLowerCase ()
          idx = scan.findIndex((l) => normalizeTitleJoinPiece(l).toLowerCase().includes(targetLow));
        }
        if (idx < 0) idx = 0;  

        const idxStart = truncStart ? Math.max(0, idx - 1) : idx;

        const merged = buildMergedTitleCandidate(scan, idxStart, 4,{
          isIngredientLine: (s) => !!parseOcrIngredient(s),
        });

        if (merged && merged.length > bestVisionTitle.length && !isBadTitleCandidate(merged)) {
        bestVisionTitle = merged;
        }
        bestVisionTitle = normalizeTitleJoinPiece(bestVisionTitle);
      }
    }

    let lines = removeSocialHeaderLines(filtered.lines);
    let split = splitIngredientsAndSteps(lines);

    split = rescueWrappedIngredientFragmentsOnly(split);

    lines = miniReflow(split);
    split = splitIngredientsAndSteps(lines);

    let servings = split.servings || 1;
    if (!Number.isFinite(servings) || servings < 1) servings = 1;

    // ---------- INGREDIENTS ----------
    const extraNotes = [];
    const ingredients = beautifyIngredients(
      (split.ingredientLines || []) // joinWrappedLinesForIngredients (split.ingredientLines || [], parseOcrIngredient) modifier le 23/02 car fais double emploi av cette fonction dans ocrText splitIngredientsAndSteps
        .flatMap((l) => splitMergedIngredientLine(l, filtered.trash))
        .flatMap((l) => splitCommaSeparatedNoQty(l))
        .map((obj) => {
          const l0 = String(obj?.text || '').trim();
          let l = stripBulletPrefix(l0).trim();
          if (!l) return null;

          l = l.replace(/^[.■]+/g, '').trim();

          if (/^(source|portions?|temps|calories?|remarques?|ingr[eé]dients?\s*:|[eé]tapes?\s+de\s+cuisson\s*:)\b/i.test(l))
            return null;
          if (/\b\w+\.(com|fr|net|org)\b/i.test(l)) return null;
          if (/^\d+\s*(heure|heures|min|minutes)\b/i.test(l)) return null;

          const meta = l
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, ' ')
            .trim();

          if (
            meta === 'etapes de cuisson:' ||
            meta === 'etapes de cuisson' ||
            meta === 'preparation:' ||
            meta === 'preparation' ||
            meta === 'ingredients:' ||
            meta === 'ingredients'
          )
            return null;

          l = l.replace(/cuill[eè]res?\s+à\s+soupe/gi, 'càs');
          l = l.replace(/\b(c\s*\.?\s*a\s*\.?\s*s\s*\.?|c\s*\.?\s*à\s*\.?\s*s\s*\.?|cas)\b/gi, 'càs');

          if (isOcrZeroGramNoise(l)) return null;

          if (obj.noQtyList) {
            const name = stripBulletPrefix(l);
            if (!name) return null;
            if (/^sel$/i.test(name)) return { name: 'sel', quantity: 0, unit: '' };
            if (/^poivre$/i.test(name)) return { name: 'poivre', quantity: 0, unit: '' };
            return { name, quantity: 0, unit: '' };
          }

          if (/^\s*ou\b/i.test(l)) {
            extraNotes.push(l.trim());
            return null;
          }

          const parsed = parseOcrIngredient(l) || (parseRawLine ? parseRawLine(l) : null);
          if (!parsed) return { name: l, quantity: 0, unit: '' };

          const row = {
            name: parsed.name || l,
            quantity: Number(parsed.quantity || 0),
            unit: parsed.unit || '',
          };

          row.name = String(row.name || '').replace(/[↑■]+/g, '').trim();

          const paren = row.name.match(/\(([^)]+)\s*$/);
          if (paren?.[1]) {
            const noteFromParen = paren[1].trim();
            //on enléve la parenthése du nom
            row.name = row.name.replace(/\s*\([^)]+\)\s*$/, '').trim();
            //on stock la note
            extraNotes.push(noteFromParen);
            //aussi pour la garder sur l;ingredient
            row.note = noteFromParen;
          }

          if (row.unit && typeof row.name === 'string') {
            row.name = row.name.replace(new RegExp(`\\s+${row.unit}$`, 'i'), '').trim();
          }

          if (typeof parsed.quantityRaw === 'string' && parsed.quantityRaw.trim()) {
            row.quantityRaw = String(parsed.quantityRaw).trim();
          }

          return row;
        })
        .filter(Boolean)
    );

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

    // ---------- TITRE FINAL ----------
    const guessedFromLines = guessTitleFromLines(safeLinesForTitle);
    dlog('[BUTTER_DEBUG] guessedFromLines=', guessedFromLines);

    //const head = safeLinesForTitle.slice(0, 16);
     let title =
      bestVisionTitle ||
      guessedFromLines ||
      inferTitleFromContent(ingredients, steps) ||
      'Recette importée';

      title = normalizeTitleCandidate(title);
      
      //ajoute du 30/01 - sepecialement pour recette 12 zauce->sauce
      title = title.replace(/^zauce\b/i, 'sauce');
      //console log a supprimer
      dlog('[TITLE][AFTER PICK]', { bestVisionTitle, guessedFromLines, title });

      //                                                                           bestVisionTiltle à la place de guessedFromLines
      if (bestVisionTitle && guessedFromLines) {//&& title === normalizeTitleCandidate(bestVisionTitle)) {

        //ajout du 19/01/26 14:29
         const v = normalizeLoose(bestVisionTitle);
         const g = normalizeLoose(guessedFromLines);
        //ajout du 19/01/26 14:30 Si Vision n'est qu'un suffixe court contenu dans guessed, on préfère guessed
        if (visionLooksLikeSuffix(v) && g.length >= v.length + 6 && g.includes(v)) {
         title = normalizeTitleCandidate(guessedFromLines);
        }
        //ajouter d'ici le 29/01 pour recette 1
        const vWords = v.split(' ').filter(Boolean).length;
        const gWords = g.split(' ').filter(Boolean).length;

        const visionIncludedInGuessed = g.includes(v);
        const guessedClearlyRicher = g.length >= v.length + 10 && gWords >= vWords + 1;
        //a ici
        if (visionIncludedInGuessed && guessedClearlyRicher) {
          title = normalizeTitleCandidate(guessedFromLines);
        }
      }
      //console log a supprimer
      dlog('[TITLE][CHECK HOOK/MEASURE]', {
        title,
        hook: looksLikeHookOrLongSentenceTitle(title),
        measure: looksLikeMeasureLineTitle(title),
      });

      //ajout le 30/01 pour recette 12 - d'ici
      // ✅ NEW (very targeted): un "titre de sauce" peut contenir "pour accompagner" sans être un hook à remplacer
      const titleLow = stripDiacritics(normalizeTitleCandidate(title)).toLowerCase();
      const looksLikeSauceTitle =
      /^(z?auce|vinaigrette|dressing|marinade)\b/.test(titleLow) &&
      titleLow.split(/\s+/).filter(Boolean).length >= 3 &&
      titleLow.split(/\s+/).filter(Boolean).length <= 10 &&
      !/\b(tu\s+peux|pas\s+de|m[eé]lange|ajoute|astuce)\b/.test(titleLow);

      if (looksLikeSauceTitle) {
        dlog('[TITLE][ALT BYPASS: sauce-title]', { title });
      } else if (looksLikeHookOrLongSentenceTitle(title) || looksLikeMeasureLineTitle(title)) {
        //console log a supprimer 
        dlog('[TITLE][AFTER ALT]', { title });

        const alt =
         inferTitleFromContent(ingredients, steps) ||
         fabricateTitleFromIngredientsRows(ingredients) ||
         '';
        
        const altNorm = normalizeTitleCandidate(alt);
       
        // Ne jamais remplacer par unité seule / ingrédient
        const altLow = stripDiacritics(altNorm).toLowerCase().trim();
        
        if (
          altNorm &&
          !/^(ml|cl|dl|l|g|gr|kg)$/.test(altLow) &&
          !looksLikeIngredientOnlyTitle(altNorm) &&
          !looksLikeIngredientFragmentTitleForTitle(altNorm) &&
          !parseOcrIngredient(altNorm)
        ) 
        { 
          //ajout d'ici pour recette 1
          const cur = normalizeTitleCandidate(title);
          const curWords = cur.split(' ').filter(Boolean).length;

          const altWords = altNorm.split(' ').filter(Boolean).length;
          const altTooWeak = altWords <= 1 || altNorm.length < 10; // ex: "Potimarron"
          const curRich = curWords >= 3 && cur.length >= 18;       // ex: "TARTE RUSTIQUE ... NOIX"

          //console log a supprimer
          dlog('[TITLE][ALT CHECK]', {
          previousTitle: title,
          cur,
          altNorm,
          curWords,
          altWords,
          curRich,
          altTooWeak,
          });


          //ajoute le 30/01 pour recette 12 d'ici
          // ✅ NEW (safe): empêcher qu'un ingrédient court remplace un vrai titre
          // Exemple recette 12: altNorm = "Yaourt nature" (ingrédient), alors que le titre "sauce..." est correct.
          const altIsLikelyIngredientName =
          altWords <= 2 &&
          ingredients.some((row) => {
            const name = normalizeLoose(row?.name || '');
            const altL = normalizeLoose(altNorm);
            if (!name || !altL) return false;
            // match inclusif (yaourt nature ↔ yaourt nature)
            return name.includes(altL) || altL.includes(name);
          });

          if (altIsLikelyIngredientName) {
            dlog('[TITLE][ALT SKIP: ingredient-like]', { kept: cur, rejectedAlt: altNorm });
          } else if (curRich && altTooWeak) {
            dlog('[TITLE][ALT SKIP]', { kept: cur, rejectedAlt: altNorm });
          } else {
            dlog('[TITLE][ALT APPLY]', { previousTitle: cur, altNorm });
            title = altNorm;
            
          }
          // a ici

          // ✅ garde-fou : ne remplace pas un bon titre par un alt trop faible remplacé par let shouldApllyAlt le 24/02
          //if (curRich && altTooWeak) { } else {// a ici pour recette 1 le 29/01 title = altNorm; }
        
          const shouldApllyAlt =
            !altIsLikelyIngredientName && 
            !(curRich && altTooWeak);
            dlog('[TITLE][ALT SKIP]', { kept: cur, rejectedAlt: altNorm });
          
          if (shouldApllyAlt) {
            dlog('[TITLE][ALT APPLY]', { previousTitle: cur, altNorm });
            title = altNorm;
          } 
        }
      }
    
      if (looksLikeEmotionalHookTitle(title)) {
       title =
       inferTitleFromContent(ingredients, steps) ||
       fabricateTitleFromIngredientsRows(ingredients) ||
       title;
      }

      if (looksLikeStepTitle(title)) {
       title =
       inferTitleFromContent(ingredients, steps) ||
       fabricateTitleFromIngredientsRows(ingredients) ||
       title;
      }

      title = normalizeTitleCandidate(title);
      title = stripOcrTitleArtifacts(title);
      
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

    // ✅ Airtable pricing (V1) : UNE SEULE fois (ne pas dupliquer) 
    const priced = await priceIngredients(draft.ingredients); 
    draft.ingredients = priced.ingredients; 
    draft.totalCostEur = priced.totalCostEur; 

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
    
    return res.json({ ok: true, draft });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: 'OCR_FAILED', message: e?.message || 'Erreur OCR' });
  }
});

module.exports = router;
