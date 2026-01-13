// backend/src/routes/import-ocr.js
'use strict';

const express = require('express');
const multer = require('multer');

const { pickBestTitle, isValidRecipeTitleCandidate, tryMergeSplitTitle } = require('../utils/ocrTitle');

// ✅ Airtable service
const { getIngredientPriceByName, canonUnit, toBaseQty } = require('../services/airtable');

const { ocrFromBufferWithDebug } = require('../services/vision');
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

// ---------------- CAT-03.1.2 Helpers (local) ----------------

function normSpaces(s) {
  return String(s || '')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function looksTruncatedTitle(t) {
  // ✅ rend robuste aux accents "combinés" (ex: "a\u0300" au lieu de "à")
  const s = normSpaces(String(t || ''))
    .normalize('NFD') // sépare lettre + accent
    .replace(/[\u0300-\u036f]/g, '') // enlève les accents
    .trim()
    .toLowerCase();

  if (!s) return false;

  // finissant par un connecteur => souvent titre coupé
  return /\b(et|de|d['’]|du|des|a)\s*$/.test(s);
}

function normalizeTitleJoinPiece(s) {
  let t = normSpaces(s);
  t = t.replace(/\s*\+\s*/g, ' ');
  t = t.replace(/[⭑★☆✦✧✨]+$/g, '');
  t = t.replace(/[.!?…]+$/g, '').trim();
  return normSpaces(t);
}

function isBadTitleCandidateLocal(s) {
  const t = normSpaces(s).toLowerCase();
  if (!t) return true;
  if (t.includes('.com') || t.includes('.fr')) return true;
  if (/^\d/.test(t)) return true;
  if (/\b(g|gr|kg|ml|cl|dl|l)\b/.test(t)) return true;

  if (isBlacklistedUiTitle(t)) return true;
  if (looksLikeEmotionalHookTitle(t)) return true;
  if (looksLikeStepTitle(t)) return true;

  return false;
}

function canJoinTitleLines(prev, next) {
  const a = normSpaces(prev);
  const b = normSpaces(next);
  if (!a || !b) return false;

  if (/^ingr[ée]dients?\b/i.test(b)) return false;
  if (/^(préparation|preparation|instructions?)\b/i.test(b)) return false;
  if (/\b(temps|cuisson|portions?|calories?)\b/i.test(b)) return false;

  if (parseOcrIngredient(b)) return false;
  if (looksLikeStepTitle(b)) return false;

  const aEndsOpen = /[,/&+–—-]\s*$/.test(a) || /\b(et|de|d['’]|du|des|à|a)\s*$/i.test(a);
  const bLooksContinuation = /^[A-ZÀ-ÖØ-Þa-zà-öø-ÿ]/.test(b) && !/^\d/.test(b) && b.length <= 60;

  if (aEndsOpen) return true;
  if (a.length <= 40 && bLooksContinuation) return true;

  return false;
}

function isTitleNoiseLabel(line) {
  const t = normSpaces(line);
  if (!t) return false;

  // Un seul "mot" tout en majuscules, court => souvent un label déco (FARINE, SUCRE, LEVURE...)
  if (/^[A-ZÀ-ÖØ-Þ]{3,12}$/.test(t)) return true;

  return false;
}

function buildMergedTitleCandidate(scan, startIdx, maxLines = 3) {
  let out = normalizeTitleJoinPiece(scan[startIdx]);
  if (!out) return null;

  let used = 1;

  for (let k = startIdx + 1; k < scan.length && used < maxLines; k++) {
    if (isTitleNoiseLabel(scan[k])) continue;

    const next = normalizeTitleJoinPiece(scan[k]);
    if (!next) break;

    // ✅ NEW: si la ligne est déjà contenue dans le titre (doublon), on la saute
    const outLow = out.toLowerCase();
    const nextLow = next.toLowerCase();
    if (outLow.includes(nextLow)) continue;

    if (!canJoinTitleLines(out, next)) break;

    out = normSpaces(`${out} ${next}`);
    used++;
  }

  if (out.length < 6 || out.length > 90) return null;
  if (/\d/.test(out)) return null;
  if (isBadTitleCandidateLocal(out)) return null;

  return out;
}

function isBlacklistedUiTitle(s) {
  const t = normalizeTitleCandidate(s).toLowerCase();
  if (!t) return true;

  if (/→\s*suivre$/i.test(t)) return true;
  if (/\bsuivre$/i.test(t) && t.includes('→')) return true;

  if (t === 'toutes les publications' || t === 'toute les publications') return true;
  if (t === 'enregistré' || t === 'enregistree' || t === 'enregistrée') return true;

  if (t === 'recettes délice' || t === 'recettes delice') return true;
  if (t === 'recettes et délices' || t === 'recettes et delices') return true;

  if (t.startsWith('publication de')) return true;

  return false;
}

function stripDiacritics(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function looksLikeEmotionalHookTitle(raw) {
  const s0 = String(raw || '').trim();
  if (!s0) return false;

  const s = stripDiacritics(s0).toLowerCase();

  if (
    s.length > 60 &&
    !/\b(recette|gateau|gâteau|soupe|salade|pates?|pâtes?|riz|poulet|boeuf|bœuf|porc|poisson)\b/.test(s)
  ) {
    return true;
  }

  if (/[!?]{2,}/.test(s)) return true;
  if (/\bahah\b/.test(s)) return true;
  if (/\bpersonne\b/.test(s)) return true;

  if (/\b(j['’]ai|j[’']?|je|m['’]a|mon|ma|mes|moi)\b/.test(s)) return true;

  const hooks = [
    'comment vous dire',
    'vous allez adorer',
    'incroyable recette',
    'trop bonne',
    'trop bon',
    'un delice',
    'c est une tuerie',
    'vous devez absolument',
    'on raffole',
    'ca m a remonte le moral',
    'remonte le moral',
    'je signale toute copie',
    'protege par des droits d auteur',
  ];

  if (hooks.some((h) => s.includes(h))) return true;

  if (s.length > 45 && /\b(dit|mangeait|voici|ajoute|ajoutee|comment|dire|remonte)\b/.test(s)) return true;

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

function joinWrappedLinesForIngredients(lines) {
  const src = (lines || [])
    .map((x) => String(x || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const out = [];
  let i = 0;

  while (i < src.length) {
    const cur = src[i];

    if (/^\d+$/.test(cur) && i + 1 < src.length && isUnitOnlyLine(src[i + 1])) {
      const qty = cur;
      const unit = src[i + 1].trim();
      i += 2;

      const nameParts = [];
      while (i < src.length) {
        const x = src[i];
        if (!x) {
          i++;
          continue;
        }
        if (/^\d+$/.test(x)) break;
        if (isUnitOnlyLine(x)) break;
        nameParts.push(x);
        i++;

        if (i < src.length && /^\d+/.test(src[i])) break;
      }

      const merged = `${qty} ${unit} ${nameParts.join(' ')}`.replace(/\s+/g, ' ').trim();
      if (merged && merged !== `${qty} ${unit}`) out.push(merged);
      continue;
    }

    if (isUnitOnlyLine(cur)) {
      if (out.length > 0 && /\b\d+$/.test(out[out.length - 1])) {
        out[out.length - 1] = `${out[out.length - 1]} ${cur}`.replace(/\s+/g, ' ').trim();
      }
      i++;
      continue;
    }

    out.push(cur);
    i++;
  }

  return out;
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
    const hasQtyInTrash = Array.isArray(trash) && trash.some((x) => String(x || '').trim() === qty);
    const qty2 = hasQtyInTrash ? qty : qty;
    return [`${qty} g de ${m[2].trim()}`, `${qty2} g de beurre de cacahuète`];
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
            airtableId: null,
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
          airtableId: priceRow?.airtableId || null,
        };
      } catch (e) {
        // si Airtable plante, on ne bloque pas l’OCR
        return {
          ...ing,
          price: null,
          costEur: 0,
          priceMatched: false,
          airtableId: null,
        };
      }
    })
  );

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

    const texts = [];

    const pickedTitles = [];
    const visionDebugByImage = [];

    for (let i = 0; i < req.files.length; i++) {
      const f = req.files[i];

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
      !looksLikeStepTitle(bestVisionTitleRaw)
        ? String(bestVisionTitleRaw).trim()
        : null;

    const rawText = texts.join('\n\n');
    const filtered = smartFilterWithTrashFromText(rawText);

    const safeLinesForTitle = removeSocialHeaderLines(filtered.lines);

    if (bestVisionTitle) {
  // ✅ on normalise AVANT tout (enlève +, ponctuation, espaces)
  bestVisionTitle = normalizeTitleJoinPiece(bestVisionTitle);

  const trunc = looksTruncatedTitle(bestVisionTitle);

  if (trunc) {
    const scan = (safeLinesForTitle || []).map(normSpaces).filter(Boolean);

    // on cherche l'index de la ligne la plus proche du titre
    const target = normalizeTitleJoinPiece(bestVisionTitle);
    let idx = scan.findIndex((l) => normalizeTitleJoinPiece(l) === target);
    if (idx < 0) idx = 0;

    const merged = buildMergedTitleCandidate(scan, idx, 4);

    if (merged && merged.length > bestVisionTitle.length && !isBadTitleCandidateLocal(merged)) {
      bestVisionTitle = merged;
    }
    bestVisionTitle = normalizeTitleJoinPiece(bestVisionTitle);
  }
}

    let lines = removeSocialHeaderLines(filtered.lines);
    let split = splitIngredientsAndSteps(lines);

    split = rescueWrappedIngredientFragmentsOnly(split);

    lines = miniReflow(split);

    let servings = split.servings || 1;
    if (!Number.isFinite(servings) || servings < 1) servings = 1;

    // ---------- INGREDIENTS ----------
    const ingredients = beautifyIngredients(
      joinWrappedLinesForIngredients(split.ingredientLines || [])
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

          const parsed = parseOcrIngredient(l) || (parseRawLine ? parseRawLine(l) : null);
          if (!parsed) return { name: l, quantity: 0, unit: '' };

          const row = {
            name: parsed.name || l,
            quantity: Number(parsed.quantity || 0),
            unit: parsed.unit || '',
          };

          row.name = String(row.name || '').replace(/[↑■]+/g, '').trim();

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

    function cleanStepPrefix(s) {
      return String(s || '')
        .replace(/^[\s•·\u2022\-*]+/g, '')
        .replace(/^\d{1,3}\s*$/g, '')
        .replace(/^\d{1,3}\s+(?=[A-ZÀ-ÖØ-Þ])/g, '')
        .replace(/^\d{1,3}\s*[.)\-:]\s*/g, '')
        .trim();
    }

    function splitStepsSmart(arr) {
      const out = [];
      for (const s0 of arr || []) {
        let s = String(s0 || '').replace(/\s+/g, ' ').trim();
        if (!s) continue;
        if (/^\d{1,3}$/.test(s)) continue;

        s = cleanStepPrefix(s);
        if (!s) continue;

        const parts = s
          .split(/(?<=\.)\s+/g)
          .map((x) => cleanStepPrefix(x))
          .filter(Boolean);

        if (parts.length >= 2 && (s.length >= 90 || parts.length >= 3)) out.push(...parts);
        else out.push(s);
      }
      return out;
    }

    const steps = splitStepsSmart(rawSteps)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => s !== '•' && s !== '.' && s !== '·')
      .filter((s) => !/^\d{1,3}$/.test(s));

    // ---------- NOTES ----------
    const baseNotes = (split.notesLines || []).map((s) => String(s || '').trim()).filter(Boolean);
    const notes = baseNotes.join('\n');

    // ---------- TITRE FINAL ----------
    let title =
      bestVisionTitle ||
      guessTitleFromLines(safeLinesForTitle) ||
      inferTitleFromContent(ingredients, steps) ||
      'Recette importée';

      title = normalizeTitleCandidate(title);

    if (looksLikeEmotionalHookTitle(title)) {
      title = inferTitleFromContent(ingredients, steps) || fabricateTitleFromIngredientsRows(ingredients) || 'Recette importée';
    }

    if (looksLikeStepTitle(title)) {
      title = inferTitleFromContent(ingredients, steps) || fabricateTitleFromIngredientsRows(ingredients) || 'Recette importée';
    }

    // ✅ IMPORTANT : draft est déclaré AVANT d’être utilisé (sinon: cannot access draft before initialization)
    const draft = {
      title,
      servings,
      imageUrl: null,
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

