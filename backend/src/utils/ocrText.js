// backend/src/utils/ocrText.js

// ─────────────────────────────────────────────────────────────
// 1) Scoring / filtrage de lignes OCR
// ─────────────────────────────────────────────────────────────

const HARD_JUNK_PATTERNS = [
  /we use cookies/i,
  /privacy policy/i,
  /cookies? policy/i,
  /if you continue to use this site/i,
  /app store|google play|android|ios/i,
  /^\d{1,2}:\d{2}\s*$/i,
  /^\s*4g\s*$/i,
  /@[\w.]+/,
  /#\w+/,
  /(instagram|facebook|tiktok|youtube)/i,
  /(abonne[-\s]?toi|abonnez[-\s]?vous|likez?)/i,
  /\b(pub|promotion|réduction|soldes?)\b/i,
];

const META_LINE_PATTERNS = [
  /^r[ée]alis[ée] par/i,
  /^type de plat/i,
  /^niveau de/i,
  /^temps/i,
  /^portions?/i,
  /^erreurs?\s+à\s+éviter/i,
];

const COOKING_VERBS =
  /(faites|ajoutez|versez|mélangez|cuire|cuisez|chauffez|préchauffez|servez|incorporez|laissez|faites|ajoutez|égouttez|dorez|remuez|faites cuire)/i;

const ING_HINT =
  /(\d+\s*(g|kg|ml|cl|l|cuill|cuillère|pincée|tranche|gousse|oeuf|œuf))/i;

function isMetaLine(s) {
  return META_LINE_PATTERNS.some((re) => re.test(s));
}

function scoreLine(line) {
  const txt = String(line || '').trim();
  if (!txt) return -10;

  let score = 0;
  if (HARD_JUNK_PATTERNS.some((re) => re.test(txt))) score -= 8;
  if (isMetaLine(txt)) score -= 5;
  if (COOKING_VERBS.test(txt)) score += 4;
  if (ING_HINT.test(txt)) score += 4;
  if (txt.length > 4) score += 1;

  return score;
}

function smartFilterLinesFromText(rawText) {
  const rawLines = String(rawText || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const scored = rawLines.map((line) => ({
    line,
    score: scoreLine(line),
  }));

  return scored
    .filter((o) => o.score >= 1)
    .map((o) => o.line);
}

// ─────────────────────────────────────────────────────────────
// 2) Helpers
// ─────────────────────────────────────────────────────────────

function cleanRawTextLine(line) {
  let s = String(line || '').trim();
  s = s.replace(/^[•\-–—*\d.\)\s]+/, '');
  s = s.replace(/^[EOI]\s+/, '');
  return s.trim();
}

function cleanIngredientLine(line) {
  let l = cleanRawTextLine(line);

  // Supprimer descriptions après ":"
  if (l.includes(':')) {
    const left = l.split(':')[0];
    if (ING_HINT.test(left)) l = left;
  }

  l = l.replace(/\(facultatif\)/gi, '');
  l = l.replace(/:\s*$/, '');
  return l.trim();
}

// ─────────────────────────────────────────────────────────────
// 3) Parsing ingrédients
// ─────────────────────────────────────────────────────────────

function parseOcrIngredient(line) {
  const txt = cleanIngredientLine(line);
  if (!txt) return null;

  let m;

  m = txt.match(/^(\d+(?:[.,]\d+)?)\s*(g|kg|ml|cl|l)\s*(.+)$/i);
  if (m) {
    return {
      quantity: parseFloat(m[1].replace(',', '.')),
      unit: m[2].toLowerCase(),
      name: m[3].trim(),
    };
  }

  m = txt.match(/^(\d+)\s*(gousses?|œufs?|oeufs?|tranches?)\s*(.+)?$/i);
  if (m) {
    return {
      quantity: parseInt(m[1], 10),
      unit: 'piece',
      name: (m[3] || txt).trim(),
    };
  }

  return {
    quantity: 1,
    unit: 'piece',
    name: txt,
  };
}

function beautifyIngredients(list = []) {
  const map = new Map();

  for (const ing of list) {
    const key = `${ing.name.toLowerCase()}|${ing.unit}`;
    if (!map.has(key) || ing.quantity > map.get(key).quantity) {
      map.set(key, ing);
    }
  }

  return Array.from(map.values()).map((i) => ({
    ...i,
    name: i.name.charAt(0).toUpperCase() + i.name.slice(1),
  }));
}

// ─────────────────────────────────────────────────────────────
// 4) Titre
// ─────────────────────────────────────────────────────────────

function guessTitleFromLines(lines = []) {
  for (const raw of lines) {
    const m = raw.match(/pour pr[ée]parer ce\s+(.+?)(?:,|$)/i);
    if (m) return m[1].trim();
  }
  return '';
}

// ─────────────────────────────────────────────────────────────
// 5) Split ingrédients / étapes / notes
// ─────────────────────────────────────────────────────────────

function splitIngredientsAndSteps(filteredLines) {
  const lines = filteredLines.map(cleanRawTextLine);

  const ingredientLines = [];
  const stepLines = [];
  const notesLines = [];

  let section = null;

  for (const line of lines) {
    const lower = line.toLowerCase();

    if (/^ingr[ée]dients?/.test(lower)) {
      section = 'ingredients';
      continue;
    }
    if (/^pr[ée]paration/.test(lower) || /^instructions?/.test(lower)) {
      section = 'steps';
      continue;
    }
    if (/erreurs?\s+à\s+éviter/.test(lower)) {
      section = 'notes';
      notesLines.push(line);
      continue;
    }

    if (section === 'ingredients') {
      ingredientLines.push(cleanIngredientLine(line));
    } else if (section === 'steps') {
      if (COOKING_VERBS.test(line)) stepLines.push(line);
    } else if (section === 'notes') {
      notesLines.push(line);
    }
  }

  return {
    servings: 1,
    ingredientLines,
    stepLines,
    notesLines,
  };
}

// ─────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────

module.exports = {
  smartFilterLinesFromText,
  splitIngredientsAndSteps,
  parseOcrIngredient,
  beautifyIngredients,
  guessTitleFromLines,
};






