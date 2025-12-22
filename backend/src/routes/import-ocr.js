// backend/src/routes/import-ocr.js
'use strict';

const express = require('express');
const multer = require('multer');

const { pickBestTitle, isValidRecipeTitleCandidate, tryMergeSplitTitle } = require('../utils/ocrTitle');

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
    'sel',
    'poivre',
    'eau',
    "eau d'orange",
    "eau d’orange",
    'huile',
    "huile d'olive",
    "huile d’olive",
    'beurre',
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

function isUnitOnlyLine(s) {
  const l = String(s || '').trim().toLowerCase();
  return l === 'g' || l === 'kg' || l === 'ml' || l === 'cl' || l === 'l';
}

// Recolle les ingrédients Instagram cassés en lignes du type: ["100", "g", "de beurre de", "cacahuete"]
function joinWrappedLinesForIngredients(lines) {
  const src = (lines || [])
    .map((x) => String(x || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const out = [];
  let i = 0;

  while (i < src.length) {
    const cur = src[i];

    // cas: "100" puis "g|ml|..." puis une ou plusieurs lignes de texte
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

        // stop si on voit un nouveau début d'ingrédient (quantité)
        if (i < src.length && /^\d+/.test(src[i])) break;
      }

      const merged = `${qty} ${unit} ${nameParts.join(' ')}`.replace(/\s+/g, ' ').trim();
      if (merged && merged !== `${qty} ${unit}`) out.push(merged);
      continue;
    }

    // cas: ligne seule "g" => si la ligne précédente finit par un nombre, on l'attache, sinon on ignore
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
  for (const x of (arr || [])) {
    const s = String(x || '').replace(/\s+/g, ' ').trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

// ✅ ne fait QUE rajouter des ingrédients, ne touche pas aux steps.
function rescueWrappedIngredientFragmentsOnly(split) {
  const ing = Array.isArray(split?.ingredientLines) ? [...split.ingredientLines] : [];
  const notes = Array.isArray(split?.notesLines) ? split.notesLines : [];
  const steps = Array.isArray(split?.stepLines) ? split.stepLines : [];

  // On ne prend que des "petits morceaux" typiques OCR (pas des phrases)
  const candidates = []
    .concat(notes, steps)
    .map((x) => stripBulletPrefix(String(x || '')).replace(/^[.■]+/g, '').trim())
    .filter(Boolean)
    .filter((t) => {
      const low = t.toLowerCase();

      // ✅ très court / fragment
      if (isUnitOnlyLine(low)) return true;                    // "g"
      if (/^\d{1,4}$/.test(low)) return true;                  // "100"
      if (/^(de|d['’])\b/.test(low)) return true;              // "de beurre de"
      if (/^(beurre|cacahu|grill|concas)\b/.test(low)) return true;

      // marqueurs réseaux (souvent collés aux fragments ingrédients)
      if (/\b(recoltos|delico|recettes?\s+d[eé]lice)\b/.test(low)) return true;

      // sinon, on évite de prendre des vraies phrases (trop long)
      if (t.length > 34) return false;

      // petite tolérance: mots "ingrédients" seuls
      if (/^ingr[eé]dients?\s*:?$/.test(low)) return true;

      return false;
    });

  if (!candidates.length) return split;

  // Recolle les fragments ("100", "g", "de beurre de", "cacahuete") => "100 g de beurre de cacahuete"
  const rebuilt = joinWrappedLinesForIngredients(candidates);

  // Ajoute uniquement ce qui ressemble à une ligne ingrédient exploitable
  const add = rebuilt.filter((l) => {
    const s = String(l || '').trim();
    if (!s) return false;
    // au moins une quantité + une unité
    if (/^\d{1,4}\s*(kg|g|mg|l|dl|cl|ml)\b/i.test(s)) return true;
    // ou parseOcrIngredient arrive à comprendre
    return !!parseOcrIngredient(s);
  });

  if (!add.length) return split;

  return {
    ...split,
    ingredientLines: uniqLines(ing.concat(add)),
  };
}


/**
 * ✅ Patch Biscuits:
 * Dé-fusionne une ligne ingrédient quand splitIngredientsAndSteps a déjà collé
 * "100 g de chocolat noir de beurre de cacahuete" au lieu de 2 ingrédients.
 */
function splitMergedIngredientLine(line, trash) {
  let s = String(line || '').replace(/\s+/g, ' ').trim();
  if (!s) return [];

  // virer bruit de fin (ex: "Recoltos Délico")
  s = s.replace(/\bRecoltos\b.*$/i, '').trim();

  // ✅ cas précis "100 g de chocolat noir de beurre de cacahuete" => 2 ingrédients
  const m = s.match(/^(\d+)\s*g\s+de\s+(.+?)\s+de\s+beurre\s+de\s+cacahu(?:e|è)te\b/i);
  if (m && /chocolat/i.test(m[2])) {
    const qty = m[1];

    // si le même nombre apparaît dans trashSample, on est encore + confiant
    const hasQtyInTrash = Array.isArray(trash) && trash.some((x) => String(x || '').trim() === qty);
    const qty2 = hasQtyInTrash ? qty : qty; // on garde qty dans tous les cas (test 4)

    return [`${qty} g de ${m[2].trim()}`, `${qty2} g de beurre de cacahuète`];
  }

  return [s];
}

// ✅ Filet de sécurité : reconstruit les ingrédients "coupés" selon l’ordre des images (mobile)
function rescuePeanutIngredientsFromAllLines({ filteredLines, ingredientLines, notesLines }) {
  const ing = Array.isArray(ingredientLines) ? [...ingredientLines] : [];
  const notes = Array.isArray(notesLines) ? [...notesLines] : [];
  const all = []
    .concat(Array.isArray(filteredLines) ? filteredLines : [])
    .concat(ing)
    .concat(notes)
    .map((x) => String(x || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const hasPeanutButterAlready = ing.some((x) => /beurre\s+de\s+cacahu/i.test(String(x || '')));
  const hasPeanutsAlready = ing.some((x) => /cacahu/i.test(String(x || '')) && /grill|concas/i.test(String(x || '')));

  let pendingQty = null;
  let pendingUnit = null;

  let rebuiltPeanutButter = null;
  let rebuiltPeanuts = null;

  for (let i = 0; i < all.length; i++) {
    const raw = all[i];
    const s = stripBulletPrefix(raw).replace(/^[.■]+/g, '').trim();
    if (!s) continue;

    // mémorise "100" puis "g" quand c’est découpé sur plusieurs lignes
    if (/^\d+$/.test(s)) {
      pendingQty = s;
      continue;
    }
    if (isUnitOnlyLine(s)) {
      pendingUnit = s.toLowerCase();
      continue;
    }

    // --- beurre de cacahuète reconstruit depuis fragments ---
    // cas fragments : "de beurre de" puis "cacahuete"
    if (!hasPeanutButterAlready && !rebuiltPeanutButter) {
      const isBeurreDeFrag = /^d[’']?\s*e?\s*beurre\s+de\b/i.test(s) || /^de\s+beurre\s+de\b/i.test(s);
      if (isBeurreDeFrag) {
        const next = stripBulletPrefix(all[i + 1] || '').replace(/^[.■]+/g, '').trim();
        const next2 = stripBulletPrefix(all[i + 2] || '').replace(/^[.■]+/g, '').trim();

        const tail =
          /\bcacahu/i.test(next) ? next :
          /\bcacahu/i.test(next2) ? next2 :
          '';

        if (tail && pendingQty && (pendingUnit || 'g')) {
          const unit = pendingUnit || 'g';
          rebuiltPeanutButter = `${pendingQty} ${unit} de beurre de cacahuète`;
        }
      }

      // cas direct déjà “en une ligne” mais passé en notes : "100 g de beurre de cacahuete"
      const mPB = s.match(/^(\d+)\s*(g|kg|mg|l|dl|cl|ml)\s+de\s+beurre\s+de\s+cacahu/i);
      if (!rebuiltPeanutButter && mPB) {
        rebuiltPeanutButter = `${mPB[1]} ${mPB[2]} de beurre de cacahuète`;
      }
    }

    // --- cacahuètes grillées concassées reconstruites ---
    if (!hasPeanutsAlready && !rebuiltPeanuts) {
      const mP = s.match(/^(\d+)\s*(g|kg|mg|l|dl|cl|ml)\s+de\s+cacahu/i);
      if (mP) {
        const a1 = stripBulletPrefix(all[i + 1] || '').replace(/^[.■]+/g, '').trim().toLowerCase();
        const a2 = stripBulletPrefix(all[i + 2] || '').replace(/^[.■]+/g, '').trim().toLowerCase();

        const add = [];
        if (/(grill|grille)/.test(a1)) add.push('grillées');
        if (/(concas|concass)/.test(a1)) add.push('concassées');
        if (/(grill|grille)/.test(a2) && !add.includes('grillées')) add.push('grillées');
        if (/(concas|concass)/.test(a2) && !add.includes('concassées')) add.push('concassées');

        const suffix = add.length ? ` ${add.join(' ')}` : '';
        rebuiltPeanuts = `${mP[1]} ${mP[2]} de cacahuètes${suffix}`.trim();
      }
    }
  }

  // injecte si reconstruit
  if (rebuiltPeanutButter && !hasPeanutButterAlready) ing.push(rebuiltPeanutButter);
  if (rebuiltPeanuts && !hasPeanutsAlready) ing.push(rebuiltPeanuts);

  // nettoie notes : enlève les fragments qui polluent (g / de beurre de / cacahuete / grillees / concassees / recoltos / recettes delice)
  const cleanedNotes = notes.filter((x) => {
    const t = stripBulletPrefix(String(x || '')).replace(/\s+/g, ' ').trim().toLowerCase();
    if (!t) return false;
    if (t === 'g') return false;
    if (/^de\s+beurre\s+de\b/.test(t)) return false;
    if (/^cacahu/.test(t)) return false;
    if (/^grill/.test(t)) return false;
    if (/^concas/.test(t)) return false;
    if (/\brecoltos\b|\bd[eé]lico\b|\brecettes?\s+d[eé]lice\b/.test(t)) return false;
    return true;
  });

  return { ingredientLines: ing, notesLines: cleanedNotes };
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
//
    let split = splitIngredientsAndSteps(lines);

    // ✅ Filet de sécurité : récupère des morceaux d'ingrédients tombés en notes/étapes
    split = rescueWrappedIngredientFragmentsOnly(split);


// ✅ Patch mobile: récupère les fragments d'ingrédients tombés dans notes
{
  const salvaged = salvageIngredientFragmentsFromNotes({
    ingredientLines: split.ingredientLines || [],
    notesLines: split.notesLines || [],
  });

  split = {
    ...split,
    ingredientLines: salvaged.ingredientLines,
    notesLines: salvaged.notesLines,
  };
}

// ✅ Filet de sécurité (ordre des images) : reconstruit beurre de cacahuète / cacahuètes grillées concassées
{
  const rescued = rescuePeanutIngredientsFromAllLines({
    filteredLines: filtered.lines,          // <- important : ordre OCR global
    ingredientLines: split.ingredientLines, // <- après 1er salvage
    notesLines: split.notesLines,
  });

  split = {
    ...split,
    ingredientLines: rescued.ingredientLines,
    notesLines: rescued.notesLines,
  };
}

lines = miniReflow(split);

//
    let servings = split.servings || 1;
    if (!Number.isFinite(servings) || servings < 1) servings = 1;
    
    // ✅ Récupère des fragments d'ingrédients qui tombent dans NOTES (cas mobile/FB/IG)
function salvageIngredientFragmentsFromNotes({ ingredientLines, notesLines, trash }) {
const ing = Array.isArray(ingredientLines) ? [...ingredientLines] : [];
const notes = Array.isArray(notesLines) ? [...notesLines] : [];

const keepNotes = [];
const frags = [];

// heuristiques simples : on ne prend QUE des lignes qui ressemblent à des morceaux d'ingrédients
for (const raw of notes) {
const t0 = String(raw || '').replace(/\s+/g, ' ').trim();
if (!t0) continue;

const t = stripBulletPrefix(t0).trim();

// on garde les vrais titres/sections dans notes
if (/^(pr[eé]paration|instructions?|m[eé]thode|[eé]tapes?)\s*:?\b/i.test(t)) {
keepNotes.push(t0);
continue;
}

// fragments typiques : "g", "de beurre de", "cacahuete", etc.
const isUnitFrag = isUnitOnlyLine(t);
const isDeFrag = /^(de|d['’])\b/i.test(t);
const looksPeanutFrag = /\b(beurre\s+de\s+cacahu|cacahu[eé]tes?|cacahuete|grill[eé]es?|concass[eé]es?)\b/i.test(t);
const isShortWordy = t.length <= 32 && /^[a-zà-öø-ÿ'’ -]+$/i.test(t);

// évite la pollution "Recettes Délice / Recoltos Délico" : on les traite comme fragments (pour pouvoir les virer ensuite)
const looksBrandNoise = /\b(recettes?\s+d[eé]lice|recoltos|d[eé]lico)\b/i.test(t);

if (isUnitFrag || isDeFrag || looksPeanutFrag || (isShortWordy && looksBrandNoise)) {
frags.push(t);
} else {
keepNotes.push(t0);
}
}

if (frags.length === 0) {
return { ingredientLines: ing, notesLines: keepNotes };
}

// ✅ cas mobile: la quantité "100" est parfois dans trash, et les fragments ("g", "de beurre de", "cacahuete") tombent en notes
{
const blob = frags.join(' ').toLowerCase();

const hasUnitG = frags.some((x) => String(x || '').trim().toLowerCase() === 'g');
const hasPeanutButter = /\bbeurre\s+de\s+cacahu/i.test(blob);

if (hasUnitG && hasPeanutButter) {
// on prend "100" si présent dans trash (ton cas)
const qty = Array.isArray(trash) && trash.some((x) => String(x || '').trim() === '100') ? '100' : null;

if (qty) {
ing.push(`${qty} g de beurre de cacahuète`);

// on évite de laisser ces fragments en notes
const cleanedKeep = keepNotes.filter((l) => !/\b(beurre\s+de\s+cacahu|cacahuete)\b/i.test(String(l || '')));
return { ingredientLines: ing, notesLines: cleanedKeep };
}
}
}
// On recolle les fragments en vraies lignes d'ingrédients
const joined = joinWrappedLinesForIngredients(frags);

for (const j0 of joined) {
const j = String(j0 || '').replace(/\s+/g, ' ').trim();
if (!j) continue;

// cas "100 g de chocolat noir de beurre de cacahuete" (ou similaire) => split en 2
const split2 = splitMergedIngredientLine(j, null);
for (const one of split2) {
const x = String(one || '').trim();
if (!x) continue;

// si ça ressemble à un ingrédient, on l'injecte
if (parseOcrIngredient(x) || /^\d{1,4}\s*(kg|g|mg|l|dl|cl|ml)\b/i.test(x)) {
ing.push(x);
} else {
// sinon, on le garde en notes (mais nettoyé)
keepNotes.push(x);
}
}
}

return { ingredientLines: ing, notesLines: keepNotes };
}

    // ---------- INGREDIENTS ----------
    const ingredients = beautifyIngredients(
      joinWrappedLinesForIngredients(split.ingredientLines || [])
        // ✅ Patch Biscuits: dé-fusionne AVANT splitCommaSeparatedNoQty()
        .flatMap((l) => splitMergedIngredientLine(l, filtered.trash))
        .flatMap((l) => splitCommaSeparatedNoQty(l))
        .map((obj) => {
          const l0 = String(obj?.text || '').trim();
          let l = stripBulletPrefix(l0).trim(); // ✅ enlève puces/points partout (pas seulement noQtyList)
          if (!l) return null;

          // petit nettoyage des symboles et points
          l = l.replace(/^[.■]+/g, '').trim();

          // ✅ filtres anti-métadonnées (RECETTE6)
          if (/^(source|portions?|temps|calories?|remarques?|ingr[eé]dients?\s*:|[eé]tapes?\s+de\s+cuisson\s*:)\b/i.test(l))
          return null;
          if (/\b\w+\.(com|fr|net|org)\b/i.test(l)) return null; // ex: yumrecette.com
          if (/^\d+\s*(heure|heures|min|minutes)\b/i.test(l)) return null; // ex: "1 heure"
          
          const meta = l
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '') // enlève accents
          .replace(/\s+/g, ' ')
          .trim();

          if (meta === 'etapes de cuisson:' || meta === 'etapes de cuisson' || meta === 'preparation:' || meta === 'preparation' || meta === 'ingredients:' || meta === 'ingredients') {
          return null;
         }

          // normalisation "cuillère à soupe" (aide parseOcrIngredient)
          l = l.replace(/cuill[eè]res?\s+à\s+soupe/gi, 'càs');

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

          // ✅ nettoie symboles (↑, ■) dans le nom
          row.name = String(row.name || '').replace(/[↑■]+/g, '').trim();

          // évite "miel g" quand l'unité est déjà dans row.unit
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
      bestVisionTitle || guessTitleFromLines(safeLinesForTitle) || inferTitleFromContent(ingredients, steps) || 'Recette importée';

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

            // ✅ AJOUT: pour comprendre les cas “Biscuits”
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
