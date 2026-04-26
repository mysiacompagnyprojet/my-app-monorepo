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

function looksLikeCommentUiLine(line) {
  const t = normSpaces(line).toLowerCase();
  return (
    /^ajouter un commentaire\b/.test(t) ||
    /^notice sur l['’]ia\b/.test(t) ||
    /^suivre$/.test(t)
  );
}

function extractServingsFromLines(lines) {
  for (const raw of lines || []) {
    const t = normSpaces(raw);

    const m =
      t.match(/\b(?:ingr[eé]dients?)\s*\(\s*(\d{1,2})\s*(?:pers|personnes?)\.?\s*\)/i) ||
      t.match(/\b(\d{1,2})\s*(?:pers|personnes?)\.?\b/i);

    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 1 && n <= 20) return n;
    }
  }

  return null;
}

function looksLikeShortIngredientContinuation(line) {
  const t = normSpaces(line).toLowerCase();
  if (!t) return false;
  if (t.length > 28) return false;
  if (/\d/.test(t)) return false;

  if (/^(cocktail|cerise|noir|blanc|fra[iî]che?s?|s[eé]ch[ée]e?s?)$/i.test(t)) return true;

  const GENERIC_CONTINUATIONS = /^(coktail|cerise|cerises|noir|noire|noires|blanc|blanche|blancs|blanches|fra[iî]che?s?|s[eé]ch[ée]e?s?)$/i;
  if (GENERIC_CONTINUATIONS.test(t)) return true;
  return false;
}

function looksLikeQuantifiedIngredientLine(line) {
  const t = normSpaces(line);
  if (!t) return false;

  if (/^\d{1,4}$/.test(t)) return false;  
  return (
    /^\s*(\d+([.,]\d+)?|\d+\s+\d+\/\d+|\d+\/\d+|½|⅓|⅔|¼|¾)/.test(t) ||
    /\b\d+\s*(g|kg|mg|ml|cl|dl|l)\b/i.test(t)
  );
}

function repairSplitIngredientLines(lines) {
  const out = [];

  for (let i = 0; i < (lines || []).length; i++) {
    const current = normSpaces(lines[i]);
    const next = normSpaces(lines[i + 1]);

    if (!current) continue;

    if (
      next &&
      looksLikeQuantifiedIngredientLine(current) &&
      looksLikeShortIngredientContinuation(next)
    ) {
      out.push(`${current} ${next}`);
      i++;
      continue;
    }

    const sojaHerbes = current.match(/^(.*?\bsauce\s+soja\b.*?sal[ée]e?)\s+(herbes?\s+fra[îi]ches?.*)$/i);
    if (sojaHerbes) {
      out.push(normSpaces(sojaHerbes[1]));
      out.push(normSpaces(sojaHerbes[2]));
      continue;
    }

    out.push(current);
  }

  return out;
}

function buildWrappedIngredientLinesFromSource(sourceLines = []) {
  const out = [];

  for (let i = 0; i < sourceLines.length; i++) {
    const current = normSpaces(sourceLines[i]);
    const next = normSpaces(sourceLines[i + 1]);

    if (!current || !next) continue;

    if (
      looksLikeQuantifiedIngredientLine(current) &&
      looksLikeShortIngredientContinuation(next)
    ) {
      out.push(normSpaces(`${current} ${next}`));
      i++;
    }
  }

  return out;
}

function buildWrappedOpenParenthesisIngredientLinesFromSource(sourceLines = []) {
  const out = [];

  for (let i = 0; i < sourceLines.length - 1; i++) {
    const current = normSpaces(sourceLines[i]);
    const next = normSpaces(sourceLines[i + 1]);

    if (!current || !next) continue;

    const cleanCurrent = stripBulletPrefix(current).trim();
    const cleanNext = stripBulletPrefix(next).trim();

    if (!looksLikeQuantifiedIngredientLine(cleanCurrent)) continue;
    if (!cleanCurrent.includes('(')) continue;
    if (cleanCurrent.includes(')')) continue;
    if (!/\)$/.test(cleanNext)) continue;
    if (/[.!?]$/.test(cleanCurrent)) continue;

    out.push(normSpaces(`${cleanCurrent} ${cleanNext}`));
    i++;
  }

  return out;
}

function hasUsefulParenthesis(line) {
  const t = normSpaces(line);
  if (!/\([^)]{3,}\)/.test(t)) return false;

  const inside = [...t.matchAll(/\(([^)]+)\)/g)]
    .map((m) => normSpaces(m[1]))
    .join(' ');

  if (!inside) return false;

  if (/\b(bio|abonne|abonnez|like|commentaire|commente|instagram|profil|lien)\b/i.test(inside)) {
    return false;
  }

  return (
    /\d/.test(inside) ||
    /\bou\b/i.test(inside) ||
    /\bsi besoin\b/i.test(inside) ||
    /\benviron\b/i.test(inside) ||
    /\bfacultatif\b/i.test(inside) ||
    /\bpersil\b/i.test(inside) ||
    /\bcoriandre\b/i.test(inside)
  );
}

function stripParenthesisForCompare(line) {
  return normSpaces(line)
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\bd['’]/gi, 'de ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function restoreUsefulParenthesizedIngredientLines({ ingredientLines, notesLines, sourceLines }) {
  let ingredients = [...ingredientLines];
  let notes = [...notesLines];

  const sourceUseful = (sourceLines || [])
    .map(normSpaces)
    .filter(Boolean)
    .filter(hasUsefulParenthesis);

  for (const fullLine of sourceUseful) {
    const comparableFull = stripParenthesisForCompare(fullLine);

    const idx = ingredients.findIndex((line) => {
      const comparableIngredient = stripParenthesisForCompare(line);
      return comparableFull.includes(comparableIngredient);
    });

    if (idx >= 0) {
      ingredients[idx] = fullLine;
    }

    if (!notes.some((n) => normSpaces(n).toLowerCase() === fullLine.toLowerCase())) {
      notes.push(fullLine);
    }

    notes = notes.filter((note) => {
      const n = normSpaces(note);
      if (!n) return false;
      if (fullLine.includes(`(${n})`)) return false;
      return true;
    });
  }

  return {
    ingredientLines: ingredients,
    notesLines: notes,
  };
}

function rescueQuantifiedSeasoningLinesFromNotes(notesLines = []) {
  return (notesLines || [])
    .map(normSpaces)
    .filter(Boolean)
    .filter((line) =>
      /^\d+(?:[.,]\d+)?\s+pinc[ée]es?\s+(?:de\s+)?(?:sel|poivre)(?:\s+ou\s+sel\s+fin)?$/i.test(line)
    )
    .map((line) =>
      normSpaces(
        line
          .replace(/\bpincées\b/i, 'pincée')
          .replace(/\bsel\s+ou\s+sel\s+fin\b/i, 'sel')
      )
    );
}

function rescueExplicitIngredientLinesFromSource(sourceLines = []) {
  const out = [];

  for (let i = 0; i < sourceLines.length; i++) {
    const current = normSpaces(sourceLines[i]);
    const next = normSpaces(sourceLines[i + 1]);

    const clean = stripBulletPrefix(current)
      .replace(/^\.+/, '')
      .trim();

    if (!clean) continue;

    let m = clean.match(/^jus\s+de\s+(\d+(?:[.,]\d+)?)\s+(.+)$/i);
    if (m) {
      out.push(`${m[1]} ${m[2]}`);
      out.push(clean);
      continue;
    }

    m = clean.match(/^(\d+(?:[.,]\d+)?)\s+(.+?)\s*&\s*(\d+(?:[.,]\d+)?)\s*(kg|g|mg|l|dl|cl|ml|a)\s+de\s+(.+?)(?:\s*\([^)]*\))?$/i);
    if (m) {
      out.push(`${m[1]} ${m[2]}`);
      if (m[4].toLowerCase() !== 'a') {
        out.push(`${m[3]} ${m[4]} de ${m[5]}`);
      }
      out.push(clean);
      continue;
    }

    m = clean.match(/^(\d+(?:[.,]\d+)?)\s+c\.?\s*[àa]\s*caf[ée]?\s+de\s+(.+?)(?:\s*\([^)]*\))?\s*,?\s*sel\s*&\s*$/i);
    if (m) {
      out.push(`${m[1]} càc de ${m[2]}`);
      out.push('sel');
      if (/^poivre$/i.test(next)) out.push('poivre');
      out.push(clean);
      continue;
    }

    if (/^\d+(?:[.,]\d+)?\s+cm\s+de\s+/i.test(clean)) {
      out.push(clean);
      continue;
    }

    if (/^\d+(?:[.,]\d+)?\s+avocats?\b/i.test(clean)) {
      out.push(clean);
      continue;
    }
  }

  return out;
}

function addMissingIngredientLinesFromSource({ ingredientLines, notesLines, sourceLines }) {
  let ingredients = [...ingredientLines];
  let notes = [...notesLines];

  for (const line of rescueExplicitIngredientLinesFromSource(sourceLines)) {
    const clean = normSpaces(line);
    if (!clean) continue;

    if (!ingredients.some((x) => normSpaces(x).toLowerCase() === clean.toLowerCase())) {
      ingredients.push(clean);
    }

    if (
      /^jus\s+de\b/i.test(clean) ||
      /\([^)]*\)/.test(clean) ||
      /\bavocats?\s+m[uû]rs?\s+[àa]\s+point\b/i.test(clean) ||
      /\bgingembre\s+frais\s*\(/i.test(clean)
    ) {
      if (!notes.some((x) => normSpaces(x).toLowerCase() === clean.toLowerCase())) {
        notes.push(clean);
      }
    }
  }

  return { ingredientLines: ingredients, notesLines: notes };
}


function cleanFinalSplit(split, sourceLines = []) {
  let ingredientLines = repairSplitIngredientLines(split.ingredientLines || [])
    .filter((l) => !looksLikeCommentUiLine(l));

  let stepLines = (split.stepLines || [])
    .map(normSpaces)
    .filter(Boolean)
    .filter((l) => !looksLikeCommentUiLine(l));

  let notesLines = (split.notesLines || [])
    .map(normSpaces)
    .filter(Boolean)
    .filter((l) => !looksLikeCommentUiLine(l));


  const wrappedFromSource = buildWrappedIngredientLinesFromSource(sourceLines);

  for (const wrapped of wrappedFromSource) {
    const shortPart = wrapped.split(/\s+/).slice(-1)[0];

    ingredientLines = ingredientLines.filter((line) => {
      const t = normSpaces(line).toLowerCase();
      return t !== normSpaces(shortPart).toLowerCase();
    });

    if (!ingredientLines.some((line) => normSpaces(line).toLowerCase() === wrapped.toLowerCase())) {
      ingredientLines.push(wrapped);
    }

    if (!notesLines.some((line) => normSpaces(line).toLowerCase() === wrapped.toLowerCase())) {
      notesLines.push(wrapped);
    }
  }

  const wrappedParenFromSource = buildWrappedOpenParenthesisIngredientLinesFromSource(sourceLines);

  for (const wrapped of wrappedParenFromSource) {
    const wrappedNorm = normSpaces(wrapped).toLowerCase();

    ingredientLines = ingredientLines.filter((line) => {
      const t = normSpaces(stripBulletPrefix(line)).toLowerCase();
      if (!t) return false;
      if (wrappedNorm.includes(t) && t.length < wrappedNorm.length) return false;
      return true;
    });

    notesLines = notesLines.filter((line) => {
      const t = normSpaces(stripBulletPrefix(line)).toLowerCase();
      if (!t) return false;
      if (wrappedNorm.includes(t) && t.length < wrappedNorm.length) return false;
      return true;
    });

    if (!ingredientLines.some((line) => normSpaces(line).toLowerCase() === wrappedNorm)) {
      ingredientLines.push(wrapped);
    }

    if (!notesLines.some((line) => normSpaces(line).toLowerCase() === wrappedNorm)) {
      notesLines.push(wrapped);
    }
  }

  const restoredParentheses = restoreUsefulParenthesizedIngredientLines({
    ingredientLines,
    notesLines,
    sourceLines,
  });

  ingredientLines = restoredParentheses.ingredientLines;
  notesLines = restoredParentheses.notesLines;

  const seasoningFromNotes = rescueQuantifiedSeasoningLinesFromNotes(notesLines);

  for (const line of seasoningFromNotes) {
    if (!ingredientLines.some((x) => normSpaces(x).toLowerCase() === line.toLowerCase())) {
      ingredientLines.push(line);
    }
  }

  const rescuedFromSource = addMissingIngredientLinesFromSource({
    ingredientLines,
    notesLines,
    sourceLines,
  });

  ingredientLines = rescuedFromSource.ingredientLines;
  notesLines = rescuedFromSource.notesLines;
  
  const servingsFromLines = extractServingsFromLines(sourceLines);

  return {
    ...split,
    servings: servingsFromLines || split.servings || 1,
    ingredientLines,
    stepLines,
    notesLines,
  };
}

module.exports = {
    splitCommaSeparatedNoQty,
    scoreSplitQuality,
    rescueWrappedIngredientFragmentsOnly,
    splitMergedIngredientLine,
    extractServingsFromLines,
    cleanFinalSplit,
};