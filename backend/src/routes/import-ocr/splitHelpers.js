// backend/src/routes/import-ocr/splitHelpers.js
// LEVEL: ROUTE
// import autorisés : 
// import interdits : 
// importé uniquement par

'use strict';
const { isUnitOnlyLine } = require('./helpers');

const { parseOcrIngredient } = require('../../utils/ingredientParser');
const { joinWrappedLinesForIngredients, looksLikeListBullet } = require('../../utils/ingredientUtils');
const { looksLikeBareIngredientLine, looksLikeNonIngredientGarbage } = require('../../utils/ocrText');
const { normSpaces, stripBulletPrefix } = require('../../utils/stringUtils');







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

//ajouter le 31/03/26 - remplacer le 01/06/26
function scoreSplitQuality(split) {
  const lines = Array.isArray(split?.ingredientLines) ? split.ingredientLines : [];

  let strictCount = 0;
  let bareCount = 0;
  let bulletIngredientCount = 0;
  let spoonCount = 0;
  let fractionCount = 0;
  let garbageCount = 0;
  let phraseCount = 0;

  for (const raw of lines) {
    const l = normSpaces(raw);
    if (!l) continue;

    const unbulleted = stripBulletPrefix(l).trim();
    const parsed = parseOcrIngredient(l);

    const isBullet = looksLikeListBullet(l);
    const hasFraction = /\b\d+\s*\/\s*\d+\b/.test(l) || /[¼½¾⅓⅔⅛⅜⅝⅞]/.test(l);
    const looksSpoon = /(?:c\s*\.?\s*à\s*caf(?:é)?|c\s*\.?\s*à\s*soupe|càc|càs|cac|cas)\b/i.test(l);

    if (parsed) {
      const name = normSpaces(parsed.name || '');
      const qty = Number(parsed.quantity || 0);
      const unit = String(parsed.unit || '').trim();

      if (
        !name ||
        looksLikeNonIngredientGarbage(name) ||
        /^[a-z]$/i.test(name) ||
        /^\d+$/.test(name) ||
        /^[a-z]\d+$|^\d+[a-z]$/i.test(name)
      ) {
        garbageCount++;
        continue;
      }

      if (qty > 0 || unit) strictCount++;
      else if (looksLikeBareIngredientLine(name)) bareCount++;
      else garbageCount++;

      if (isBullet) bulletIngredientCount++;
      if (hasFraction) fractionCount++;
      if (looksSpoon) spoonCount++;

      continue;
    }

    //remplacer le 02/04/26
    if (looksLikeBareIngredientLine(unbulleted)) {
      if (
        /[.!?]/.test(unbulleted) ||
        /^(commencez|prenez|versez|ajoutez|mélangez|melangez|frottez|beurrez|battez|badigeonnez|placez|laissez|coupez|étalez|etalez|tracez|croisez|préchauffez|prechauffez)\b/i.test(unbulleted)
      ) {
        phraseCount++;
        continue;
      }

      bareCount++;
      if (isBullet) bulletIngredientCount++;
      continue;
    }

    if (
      /[.!?]/.test(l) ||
      /\b(frottez|mélangez|melangez|ajoutez|versez|beurrez|placez|laissez|badigeonnez|tracez|croisez)\b/i.test(l)
    ) {
      phraseCount++;
      continue;
    }

    garbageCount++;
  }

  const totalIngredientLike =
    strictCount + bareCount + bulletIngredientCount + spoonCount + fractionCount;

  return {
    strictCount,
    bareCount,
    bulletIngredientCount,
    spoonCount,
    fractionCount,
    garbageCount,
    phraseCount,
    totalIngredientLike,
    score:
      strictCount * 8 +
      bareCount * 3 +
      bulletIngredientCount * 4 +
      spoonCount * 4 +
      fractionCount * 3 -
      garbageCount * 4 -
      phraseCount * 2,
  };
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


module.exports = {
    splitCommaSeparatedNoQty,
    scoreSplitQuality,
    rescueWrappedIngredientFragmentsOnly,
    splitMergedIngredientLine,
};