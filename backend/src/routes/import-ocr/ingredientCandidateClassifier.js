//backend/src/routes/import-ocr/ingredientCandidateClassifier.js


'use strict';

const { parseOcrIngredient } = require('../../utils/ingredientParser');
const { normSpaces, normalizeLoose, stripBulletPrefix } = require('../../utils/stringUtils');

function hasStrongSocialOrUiNoise(line) {
  const t = normSpaces(line);
  const low = normalizeLoose(t);

  if (!t) return true;

  return (
    /[♡❤️♥◆≈~<>σ☑]/.test(t) ||
    /\b(ajouter un commentaire|suivre|suivi|notice sur l['’]ia|instagram|hashtag)\b/i.test(t) ||
    /\b(faktory|jumbo expedition|father joh|fronger|nonofoodies|dr[oó]nar|grammes|750grammes)\b/i.test(low) ||
    /^\d+[,.]?\d*\s*k$/i.test(t) ||
    /^[A-Z]$/.test(t) ||
    /^\d+\s*c\s+\d+\s*grammes?$/i.test(low) ||
    /^\d+\s*\d+\s*grammes?$/i.test(low)
  );
}

function looksLikeMaterialOrInstruction(line) {
  const t = normSpaces(line);
  const low = normalizeLoose(t);

  return (
    /\b(mat[eé]riel|plaque de four|saladier|cuill[eè]re en bois|rouleau|four)\b/i.test(low) ||
    /\b(pr[eé]paration|repos|cuisson|astuce|faites lever|pour r[eé]ussir)\b/i.test(low)
  );
}

function normalizeIngredientDisplayName(name) {
  let s = normSpaces(name);
  if (!s) return '';

  // Descripteurs utiles en notes, mais mauvais pour le matching prix
  s = s.replace(/\b(ti[eè]de|mou|molle|fondu|fondue|r[aâ]p[eé]|finement\s+r[aâ]p[eé])\b/gi, '').trim();

  // Restes OCR fréquents en fin de nom
  s = s.replace(/\b(pour|ca|b|personnes?)$/i, '').trim();

  // Parenthèse cassée
  s = s.replace(/\s*\([^)]*$/g, '').trim();
  s = s.replace(/\s*\([^)]*\)\s*$/g, '').trim();

  return normSpaces(s);
}

function shouldMirrorLineToNotes(line) {
  const t = normSpaces(line);
  if (!t) return false;

  return (
    /\([^)]{2,}\)/.test(t) ||
    /\b(ti[eè]de|mou|molle|fondu|fondue|m[uû]rs?\s+[àa]\s+point|finement\s+r[aâ]p[eé])\b/i.test(t) ||
    /^jus\s+de\s+\d+/i.test(t) ||
    /\bou\s+[a-zà-öø-ÿœ' -]+$/i.test(t)
  );
}

function normalizeAlternativeUnitLine(line) {
  const t = normSpaces(line);
  if (!t) return null;

  const m = t.match(
    /^(\d+(?:[.,]\d+)?|\d+\s*\/\s*\d+|½|⅓|⅔|¼|¾)\s+(feuilles?|tranches?|morceaux?|nids?|bottes?)\s+de\s+(.+?)\s+ou\s+.+$/i
  );

  if (!m) return null;

  return {
    line: `${m[1]} ${m[2]} de ${m[3]}`,
    note: t,
  };
}


function parsedCandidateKey(parsed) {
  if (!parsed) return '';
  return normalizeLoose(`${parsed.name || ''}|${parsed.quantity || 0}|${parsed.unit || ''}`);
}

function looksLikeStandaloneTitleOrSection(line) {
  const t = normSpaces(line);
  const low = normalizeLoose(t);

  if (!t) return true;

  if (/^(ingredients?|les ingredients|ingrédients?|les ingrédients)$/i.test(low)) return true;
  if (/^(decoration|décoration|ganache montee|ganache montée|nids en meringue)$/i.test(low)) return true;
  if (/^(preparation|préparation|instructions?)$/i.test(low)) return true;

  if (/^\d+\s+portions?$/i.test(low)) return true;

  if (
    /^[A-ZÀ-ÖØ-Þ0-9 &'’-]{8,}$/.test(t) &&
    !/^\d/.test(t) &&
    !/\b(g|kg|ml|cl|l|càc|càs|cuill|oeufs?|œufs?)\b/i.test(t)
  ) {
    return true;
  }

  return false;
}

function looksLikeOrphanAlternativeOrNote(line) {
  const t = normSpaces(line);
  const low = normalizeLoose(t);

  if (!t) return true;

  return (
    /^à\s+l['’]ancienne$/i.test(t) ||
    /^a\s+l ancienne$/i.test(low) ||
    /^\(?optionnel\)?$/i.test(low) ||
    /^\(?facultatif\)?$/i.test(low) ||
    /^cremeux\)?$/i.test(low) ||
    /^crémeux\)?$/i.test(t) ||
    /^\)?$/.test(t)
  );
}

function splitCompositeQuantityLine(line) {
  const t = normSpaces(line);
  if (!t) return null;

  const m = t.match(
    /^(\d+(?:[.,]\d+)?|\d+\s*\/\s*\d+|½|⅓|⅔|¼|¾)\s+(.+?)\s*(?:&|et)\s*(\d+(?:[.,]\d+)?)\s*(kg|g|mg|l|dl|cl|ml|a)\s+de\s+(.+?)(?:\s*\([^)]*\))?\)?$/i
  );

  if (!m) return null;

  const leftQty = m[1];
  const leftName = normSpaces(m[2]);
  const rightQty = m[3];
  const rawUnit = m[4];
  const rightUnit = rawUnit.toLowerCase() === 'a' ? 'g' : rawUnit;
  const rightName = normSpaces(m[5]);

  if (!leftName || !rightName) return null;

  return {
    lines: [
      `${leftQty} ${leftName}`,
      `${rightQty} ${rightUnit} de ${rightName}`,
    ],
    note: t,
  };
}

function looksLikeSafeBareIngredientName(line) {
  const t = normSpaces(line);
  const low = normalizeLoose(t);

  if (!t) return false;

  return /^(sel|poivre|thym|laurier|persil|coriandre|basilic|origan|paprika|curry|cumin|cannelle|huile de tournesol|huile d olive|huile d'olive|huile d’olive)$/i.test(low);
}

function classifyIngredientCandidateLine(line) {
  const original = normSpaces(line);
  const clean = stripBulletPrefix(original).replace(/^\.+/, '').trim();

  if (!clean) return { action: 'trash' };

  if (looksLikeStandaloneTitleOrSection(clean)) {
    return { action: 'trash' };
  }

  if (looksLikeOrphanAlternativeOrNote(clean)) {
    return { action: 'trash', note: clean };
  }

  if (hasStrongSocialOrUiNoise(clean)) {
    return { action: 'trash' };
  }

  if (looksLikeMaterialOrInstruction(clean)) {
    return { action: 'trash' };
  }

  const alternativeUnitLine = normalizeAlternativeUnitLine(clean);
  if (alternativeUnitLine) {
        return {
            action: 'keep',
            line: alternativeUnitLine.line,
            note: alternativeUnitLine.note,
        };
  }

  const composite = splitCompositeQuantityLine(clean);
  if (composite) {
    return {
      action: 'expand',
      lines: composite.lines,
      note: composite.note,
    };
  }

  const parsed = parseOcrIngredient(clean);

  if (!parsed) {
    if (!looksLikeSafeBareIngredientName(clean)) {
      return { action: 'trash' };
    }

    return { action: 'keep', line: clean };
  }


  const name = normSpaces(parsed.name || '');

  if (!name) return { action: 'trash' };

  // Rejette les faux ingrédients générés par quantité + phrase/matériel
  if (looksLikeMaterialOrInstruction(name) || hasStrongSocialOrUiNoise(name)) {
    return { action: 'trash' };
  }

  const normalizedName = normalizeIngredientDisplayName(name);

  if (!normalizedName) return { action: 'trash' };

  const normalizedLine = clean.replace(name, normalizedName);

  return {
    action: 'keep',
    line: normSpaces(normalizedLine),
    note: shouldMirrorLineToNotes(clean) ? clean : '',
    parsedKey: parsedCandidateKey({
      ...parsed,
      name: normalizedName,
    }),
  };
}

function cleanIngredientCandidateLines(lines = []) {
  const out = [];
  const notes = [];
  const seen = new Set();

  for (const raw of lines || []) {
    const result = classifyIngredientCandidateLine(raw);

    if (result.note) {
      const noteKey = normalizeLoose(result.note);
      if (!notes.some((n) => normalizeLoose(n) === noteKey)) {
        notes.push(result.note);
      }
    }

    if (result.action === 'trash') continue;

    const expandedLines = result.action === 'expand'
    ? result.lines || []
    : [result.line];

    for (const candidateLine of expandedLines) {
      const line = normSpaces(candidateLine);
      if (!line) continue;

      const parsed = parseOcrIngredient(line);
      const key = parsedCandidateKey(parsed) || normalizeLoose(line);

      if (seen.has(key)) continue;
      seen.add(key);

      out.push(line);
    }
    continue;
  }

  return {
    ingredientLines: out,
    notesLines: notes,
  };
}

module.exports = {
  cleanIngredientCandidateLines,
  classifyIngredientCandidateLine,
};
