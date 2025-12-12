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
  /^pr[ée]paration\s*:/i,
  /^cuisson\s*:/i,
  /^temps total\s*:/i,
];

const COOKING_VERBS =
  /(faites|ajoutez|versez|mélangez|cuire|cuisez|chauffez|préchauffez|servez|incorporez|laissez|égouttez|dorez|remuez|faites cuire|enfournez|badigeonnez|pétrissez|couvrez|déposez|coupez)/i;

const ING_HINT =
  /(\d+\s*(g|kg|ml|cl|l|cuill|cuillère|pincée|tranche|gousse|oeuf|œuf))/i;

function isMetaLine(s) {
  const txt = String(s || '').trim();
  return META_LINE_PATTERNS.some((re) => re.test(txt));
}

// ─────────────────────────────────────────────────────────────
// 1.b) Normalisation + fusion des lignes “continuation”
// ─────────────────────────────────────────────────────────────

function normalizeBullet(line) {
  return String(line || '')
    .replace(/\u00A0/g, ' ')
    .replace(/[\r\n]+/g, ' ')
    .replace(/^[•■⚫●\-\*]\s*/g, '• ')
    .replace(/^•\s*(\d)/, '• $1')
    .replace(/\s+/g, ' ')
    .trim();
}

function isIngredientsHeaderLike(s) {
  return /\bingr[ée]dients?\b/i.test(String(s || '').trim());
}

function shouldJoinWithPrevious(prev, curr) {
  if (!prev || !curr) return false;

  if (isIngredientsHeaderLike(prev) || isIngredientsHeaderLike(curr)) return false;

  const startsNewItem = /^•\s+/.test(curr) || /^\d+\s*[\.\)]\s+/.test(curr);
  if (startsNewItem) return false;

  const startsParen = /^\(/.test(curr);
  const isShort = curr.length <= 18;

  const startsLower =
    curr.length > 0 &&
    curr[0] === curr[0].toLowerCase() &&
    /[a-zàâäéèêëïîôöùûüç]/i.test(curr[0]);

  const prevEndsColon = /:\s*$/.test(prev);

  if (prevEndsColon) return true;
  if (startsLower || startsParen || isShort) return true;

  return false;
}

function joinContinuationLines(lines) {
  const out = [];
  for (const raw of lines) {
    const line = normalizeBullet(raw);
    if (!line) continue;

    const prev = out[out.length - 1];
    if (prev && shouldJoinWithPrevious(prev, line)) {
      out[out.length - 1] = `${prev} ${line}`.replace(/\s+/g, ' ').trim();
    } else {
      out.push(line);
    }
  }
  return out;
}

function splitJoinedHeaders(lines) {
  const out = [];
  for (const l of lines) {
    const s = String(l || '').trim();
    if (!s) continue;

    const idx = s.toLowerCase().indexOf('ingrédients');
    if (idx > 0) {
      const left = s.slice(0, idx).trim();
      const right = s.slice(idx).trim();

      if (left) out.push(left);
      if (right) out.push(right);
      continue;
    }

    out.push(s);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// 1.c) Scoring
// ─────────────────────────────────────────────────────────────

function scoreLine(line) {
  const txt = String(line || '').trim();
  if (!txt) return -10;

  let score = 0;
  if (HARD_JUNK_PATTERNS.some((re) => re.test(txt))) score -= 8;
  if (isMetaLine(txt)) score -= 2;

  if (COOKING_VERBS.test(txt)) score += 4;
  if (ING_HINT.test(txt)) score += 4;
  if (txt.length > 4) score += 1;

  return score;
}

function smartFilterLinesFromText(rawText) {
  const rawLines = String(rawText || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((s) => normalizeBullet(s))
    .filter(Boolean);

  const joined = joinContinuationLines(rawLines);
  const expanded = splitJoinedHeaders(joined);

  const scored = expanded.map((line) => ({
    line,
    score: scoreLine(line),
  }));

  return scored.filter((o) => o.score >= 1).map((o) => o.line);
}

// ─────────────────────────────────────────────────────────────
// 2) Helpers
// ─────────────────────────────────────────────────────────────

function cleanRawTextLine(line) {
  let s = String(line || '').trim();
  s = s.replace(/[\r\n]+/g, ' ');
  s = s.replace(/^[•\-–—*\s]+/, '');
  s = s.replace(/^\d+\s*[\.\)]\s+/, '');
  s = s.replace(/^[EOI]\s+/, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function cleanIngredientLine(line) {
  let l = cleanRawTextLine(line);

  if (l.includes(':')) {
    const left = l.split(':')[0];
    if (ING_HINT.test(left)) l = left;
  }

  l = l.replace(/\(facultatif\)/gi, '');
  l = l.replace(/:\s*$/, '');
  l = l.replace(/\s+/g, ' ').trim();
  return l;
}

function extractServingsFromLines(lines) {
  for (const raw of lines) {
    const l = String(raw || '').trim();

    const m1 = l.match(/portions?\s*:\s*(\d+)/i);
    if (m1) return parseInt(m1[1], 10);

    const m2 = l.match(/\b(\d+)\s*(personnes|parts)\b/i);
    if (m2) return parseInt(m2[1], 10);
  }
  return null;
}

function isSectionHeader(line) {
  const l = String(line || '').trim();
  if (!l) return false;

  if (/^ingr[ée]dients?$/i.test(l)) return true;
  if (/^pour\b/i.test(l)) return true;
  if (/:$/.test(l) && !/\d/.test(l)) return true;

  return false;
}

function stripLeadingDe(name) {
  let n = String(name || '').trim();
  n = n.replace(/^d['’]\s*/i, '');
  n = n.replace(/^de\s+/i, '');
  n = n.replace(/\s+/g, ' ').trim();
  return n;
}

function normalizeSpoonUnit(u) {
  const s = String(u || '').toLowerCase().replace(/\./g, '').trim();
  if (
    s === 'c a soupe' ||
    s === 'c à soupe' ||
    s === 'ca soupe' ||
    s === 'c soupe' ||
    s.includes('cuill') && s.includes('soupe')
  ) return 'tbsp';

  if (
    s === 'c a cafe' ||
    s === 'c à cafe' ||
    s === 'c a café' ||
    s === 'c à café' ||
    s === 'ca cafe' ||
    s.includes('cuill') && (s.includes('cafe') || s.includes('café'))
  ) return 'tsp';

  return null;
}

// ─────────────────────────────────────────────────────────────
// 3) Parsing ingrédients
// ─────────────────────────────────────────────────────────────

function parseOcrIngredient(line) {
  const txt = cleanIngredientLine(line);
  if (!txt) return null;

  let m;

  // "500g de ..."
  m = txt.match(/^(\d+(?:[.,]\d+)?)\s*(g|kg|ml|cl|l)\b\s*(.+)$/i);
  if (m) {
    return {
      quantity: parseFloat(m[1].replace(',', '.')),
      unit: m[2].toLowerCase(),
      name: stripLeadingDe(m[3]),
    };
  }

  // "1 c. à soupe de ..." / "1 cuillère(s) à soupe de ..."
  m = txt.match(
    /^(\d+(?:[.,]\d+)?)\s*(c\.?|cuill(?:ère|eres|ères)?s?(?:\(\s*s?\s*\))?)\s*(?:à|a)\s*(soupe)\s*(?:de|d['’])?\s*(.+)$/i
  );
  if (m) {
    return {
      quantity: parseFloat(m[1].replace(',', '.')),
      unit: 'tbsp',
      name: stripLeadingDe(m[4]),
    };
  }

  // "1 c. à café de ..." / "1 cuillère(s) à café de ..."
  m = txt.match(
    /^(\d+(?:[.,]\d+)?)\s*(c\.?|cuill(?:ère|eres|ères)?s?(?:\(\s*s?\s*\))?)\s*(?:à|a)\s*(caf[eé])\s*(?:de|d['’])?\s*(.+)$/i
  );
  if (m) {
    return {
      quantity: parseFloat(m[1].replace(',', '.')),
      unit: 'tsp',
      name: stripLeadingDe(m[4]),
    };
  }

  // "1 pincée de ..."
  m = txt.match(/^(\d+(?:[.,]\d+)?)\s*pinc[ée]es?\s*(?:de|d['’])?\s*(.+)$/i);
  if (m) {
    return {
      quantity: parseFloat(m[1].replace(',', '.')),
      unit: 'pinch',
      name: stripLeadingDe(m[2]),
    };
  }

  // "3 gousses d'ail ..."
  m = txt.match(/^(\d+)\s*(gousses?|œufs?|oeufs?|tranches?)\s*(.+)?$/i);
  if (m) {
    const unitWord = String(m[2] || '').toLowerCase();
    const unit = unitWord.startsWith('gousse') ? 'gousse' : 'piece';
    return {
      quantity: parseInt(m[1], 10),
      unit,
      name: stripLeadingDe(m[3] || txt),
    };
  }

  // Sel/poivre : sans quantité => on ne force pas
  if (/^(sel|poivre)\b/i.test(txt) || /sel\s+et\s+poivre/i.test(txt)) return null;

  return null;
}

function beautifyIngredients(list = []) {
  const map = new Map();

  for (const ing of list) {
    if (!ing) continue;
    const name = String(ing.name || '').replace(/\s+/g, ' ').trim();
    if (!name) continue;

    const unit = String(ing.unit || '').trim();
    const quantity = Number.isFinite(ing.quantity) ? ing.quantity : 0;

    const key = `${name.toLowerCase()}|${unit}`;
    if (!map.has(key) || quantity > (map.get(key).quantity || 0)) {
      map.set(key, { ...ing, name, unit, quantity });
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
  // si on a un titre en tout début, on le prend
  if (lines.length) {
    const first = String(lines[0] || '').trim();
    if (first.length > 6 && first.length < 90 && !isMetaLine(first)) {
      return first;
    }
  }
  for (const raw of lines) {
    const m = String(raw || '').match(/pour pr[ée]parer ce\s+(.+?)(?:,|$)/i);
    if (m) return m[1].trim();
  }
  return '';
}

// ─────────────────────────────────────────────────────────────
// 5) Split ingrédients / étapes / notes
// ─────────────────────────────────────────────────────────────

function splitIngredientsAndSteps(filteredLines) {
  const cleanedLines = filteredLines.map(cleanRawTextLine).filter(Boolean);

  const servings =
    extractServingsFromLines(filteredLines) ||
    extractServingsFromLines(cleanedLines) ||
    1;

  const ingredientLines = [];
  const stepLines = [];
  const notesLines = [];

  let section = null;

  for (const line of cleanedLines) {
    const lower = line.toLowerCase();

    if (isMetaLine(line)) continue;

    if (/^ingr[ée]dients?\b/i.test(lower) || /^ingredients?\b/i.test(lower)) {
      section = 'ingredients';
      continue;
    }
    if (/^pr[ée]paration\b/i.test(lower) || /^preparation\b/i.test(lower) || /^instructions?\b/i.test(lower)) {
      section = 'steps';
      continue;
    }
    if (/erreurs?\s+à\s+éviter/i.test(lower)) {
      section = 'notes';
      notesLines.push(line);
      continue;
    }

    if (isSectionHeader(line)) {
      notesLines.push(line);
      continue;
    }

    if (section === 'ingredients') {
      const ing = cleanIngredientLine(line);
      if (ing) ingredientLines.push(ing);
    } else if (section === 'steps') {
      // on garde numérotation ou verbes cuisine
      if (/^\d+\s*[\.\)]\s+/.test(line) || COOKING_VERBS.test(line) || line.length > 18) {
        stepLines.push(line);
      }
    } else if (section === 'notes') {
      notesLines.push(line);
    }
  }

  return {
    servings,
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


