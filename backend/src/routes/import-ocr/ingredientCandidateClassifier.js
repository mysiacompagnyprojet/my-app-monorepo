//backend/src/routes/import-ocr/ingredientCandidateClassifier.js


'use strict';

const { parseOcrIngredient } = require('../../utils/ingredientParser');
const { normSpaces, normalizeLoose, stripBulletPrefix } = require('../../utils/stringUtils');

function hasStrongSocialOrUiNoise(line) {
  const t = normSpaces(line);
  const low = normalizeLoose(t);

  if (!t) return true;

  return (
    /[♡❤️♥◆≈~<>σ]/.test(t) ||
    /\b(ajouter un commentaire|suivre|suivi|notice sur l['’]ia|instagram|hashtag)\b/i.test(t) ||
    /\b(faktory|jumbo expedition|father joh|fronger|nonofoodies|dr[oó]nar)\b/i.test(low) ||
    /^\d+[,.]?\d*\s*k$/i.test(t) ||
    /^[A-Z]$/.test(t)
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
    /^jus\s+de\s+\d+/i.test(t)
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

function classifyIngredientCandidateLine(line) {
  const original = normSpaces(line);
  const clean = stripBulletPrefix(original).replace(/^\.+/, '').trim();

  if (!clean) return { action: 'trash' };

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

  const parsed = parseOcrIngredient(clean);

  if (!parsed) {
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

    if (result.action !== 'keep') continue;

    const line = normSpaces(result.line);
    if (!line) continue;

    const parsed = parseOcrIngredient(line);
    const key = parsedCandidateKey(parsed) || normalizeLoose(line);

    if (seen.has(key)) continue;
    seen.add(key);

    out.push(line);

    if (result.note) {
      const noteKey = normalizeLoose(result.note);
      if (!notes.some((n) => normalizeLoose(n) === noteKey)) {
        notes.push(result.note);
      }
    }
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
