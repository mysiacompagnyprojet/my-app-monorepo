// backend/src/routes/import-ocr/ingredientPipeline.js
// LEVEL: ROUTE HELPER
// rôle : transformer split.ingredientLines en ingredients + extraNotes
// import autorisés : helpers route, utils
// import interdits : express, prisma, services HTTP, autres routes

'use strict';

const { parseOcrIngredient } = require('../../utils/ingredientParser');
const { looksLikeBareIngredientLine, looksLikeNonIngredientGarbage } = require('../../utils/ocrText');
const { normSpaces, stripBulletPrefix, normalizeLoose } = require('../../utils/stringUtils');
const { beautifyIngredients } = require('../../utils/ocrIngredients');

const { isOcrZeroGramNoise, isUnitOnlyLine } = require('./helpers');

const { cleanParsedIngredientName, shouldDropParsedIngredientRow } = require('./ingredientHelpers');

const { splitCommaSeparatedNoQty, splitMergedIngredientLine } = require('./splitHelpers');


function classifyParenthesisContent(content) {
  const t = normSpaces(content);
  const low = normalizeLoose(t);

  if (!t) return 'none';

  // Bruit social / marketing / commentaire perso
  if (
    /\b(bio|abonne|abonnez|like|commentaire|commente|partage|sauvegarde|instagram|lien|profil)\b/i.test(low) ||
    /\b(j adore|j'aime|trop bon|delicieux|recette facile|simple et rapide)\b/i.test(low)
  ) {
    return 'noise';
  }

  // Quantité / unité / précision exploitable
  if (
    /\b\d+\s*(g|kg|mg|ml|cl|l|t[eê]tes?|gousses?|pi[eè]ces?|tomates?)\b/i.test(t) ||
    /\b\d+\s*(?:à|a|-|–)\s*\d+\b/i.test(t) ||
    /\benviron\b/i.test(t)
  ) {
    return 'useful';
  }

  // Alternative / précision cuisine utile
  if (
    /\bou\b/i.test(t) ||
    /\bfacultatif\b/i.test(t) ||
    /\bau choix\b/i.test(t) ||
    /\bsi besoin\b/i.test(t) ||
    /\bpersil\b/i.test(t) ||
    /\bcoriandre\b/i.test(t)
  ) {
    return 'useful';
  }

  return 'noise';
}

function shouldMirrorFullIngredientLineToNotes(line) {
  const t = normSpaces(line);
  if (!t) return false;

  if (/^\s*(?:\d+(?:[.,]\d+)?|\d+\s*\/\s*\d+|½|⅓|⅔|¼|¾)\s+nids?\s+de\b/i.test(t)) {
    return true;
  }
  
  // Alternatives hors parenthèses : utile à garder
  if (/\bou\s+\d+\s*[-–]\s*\d+\b/i.test(t)) return true;

  const matches = [...t.matchAll(/\(([^)]+)\)/g)];
  if (!matches.length) return false;

  return matches.some((m) => classifyParenthesisContent(m[1]) === 'useful');
}


function pushUniqueNote(extraNotes, note) {
  const clean = normSpaces(note);
  if (!clean) return;

  const exists = extraNotes.some((n) => normSpaces(n).toLowerCase() === clean.toLowerCase());
  if (!exists) extraNotes.push(clean);
}



function buildIngredientsFromSplit({ ingredientLines, trash, parseRawLine, dlog }) {
  const extraNotes = [];

  const ingredients = beautifyIngredients(
    (Array.isArray(ingredientLines) ? ingredientLines : [])
      .flatMap((l) => splitMergedIngredientLine(l, trash))
      .flatMap((l) => splitCommaSeparatedNoQty(l))
      .map((obj) => {
        const l0 = String(obj?.text || '').trim();
        let l = stripBulletPrefix(l0).trim();
        if (shouldMirrorFullIngredientLineToNotes(l)) {
          pushUniqueNote(extraNotes, l);
        }
        if (!l) return null;

        l = l.replace(/^[.■]+/g, '').trim();

        if (/^(source|portions?|temps|calories?|remarques?|ingr[eé]dients?\s*:|[eé]tapes?\s+de\s+cuisson\s*:)\b/i.test(l)) {
          return null;
        }

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
        ) {
          return null;
        }

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

        if (/poivre/i.test(l)) {
          dlog?.('[POIVRE RAW LINE]', l);
        }

        const parsed = parseOcrIngredient(l) || (parseRawLine ? parseRawLine(l) : null);

        if (/poivre/i.test(l)) {
          dlog?.('[POIVRE PARSED]', parsed);
        }

        if (!parsed) {
          if (!looksLikeBareIngredientLine(l)) return null;
          return { name: l, quantity: 0, unit: '' };
        }

        const parsedName = normSpaces(parsed.name || '');
        const parsedQty = Number(parsed.quantity || 0);
        const parsedUnit = String(parsed.unit || '').trim();

        if (
          looksLikeNonIngredientGarbage(parsedName) ||
          (!parsedQty && !parsedUnit && !looksLikeBareIngredientLine(parsedName)) ||
          (parsedQty > 0 && /^(piece|pièce)$/i.test(parsedUnit) && !looksLikeBareIngredientLine(parsedName))
        ) {
          return null;
        }

        const row = {
          name: cleanParsedIngredientName(parsedName || l),
          quantity: parsedQty,
          unit: parsedUnit,
        };

        const suspiciousIngredientName = normalizeLoose(row.name || '');

        if (/^(i pincee de|1 pincee de|pincee de|pincée de|a de|de|du|des|jus de)$/i.test(suspiciousIngredientName)) {
          return null;
        }

        row.name = String(row.name || '').replace(/[↑■]+/g, '').trim();

        row.name = row.name.replace(/\s*\([^)]*\)\s*$/g, '').trim();

        if (row.unit && typeof row.name === 'string') {
          row.name = row.name.replace(new RegExp(`\\s+${row.unit}$`, 'i'), '').trim();
        }

        if (typeof parsed.quantityRaw === 'string' && parsed.quantityRaw.trim()) {
          row.quantityRaw = String(parsed.quantityRaw).trim();
        }

        if (isUnitOnlyLine(row.name)) {
          return null;
        }

        row.name = cleanParsedIngredientName(row.name);

        if (shouldDropParsedIngredientRow(row)) {
          return null;
        }

        if (/^sel\s+(et|&)\s+poivre(?:\s+à\s+convenance)?$/i.test(row.name)) {
          extraNotes.push('sel et poivre à convenance');
          return null;
        }

        return row;
      })
      .flat()
      .filter(Boolean)
  );

  return {
    ingredients,
    extraNotes,
  };
}

module.exports = {
  buildIngredientsFromSplit,
};
