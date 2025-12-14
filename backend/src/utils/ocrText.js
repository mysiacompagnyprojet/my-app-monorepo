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

  // réseaux / tags
  /@[\w.]+/,
  /#\w+/,
  /(instagram|facebook|tiktok|youtube)/i,
  /(abonne[-\s]?toi|abonnez[-\s]?vous|likez?)/i,
  /\b(pub|promotion|réduction|soldes?)\b/i,

  // bruits UI
  /^\d{1,2}:\d{2}\s*$/i,
  /^\s*4g\s*$/i,
];

// lignes “métas” (on ne veut pas les mettre en ingrédients/étapes)
const META_LINE_PATTERNS = [
  /^r[ée]alis[ée] par/i,
  /^type de plat/i,
  /^niveau de/i,
  /^difficult[ée]?\b/i,
  /^prix\b/i,
  /^temps\b/i,
  /^portions?\b/i,
  /^servings?\b/i,
  /^notes?\b/i,
  /^sauvegarder\b/i,

  /^pr[ée]paration\s*:/i,
  /^cuisson\s*:/i,
  /^temps total\s*:/i,
];

// verbes étapes
const COOKING_VERBS =
  /(faites|ajoutez|versez|mélangez|cuire|cuisez|chauffez|préchauffez|enfournez|badigeonnez|pétrissez|servez|incorporez|laissez|égouttez|dorez|remuez|déglacez|émincer|éplucher|laver|râper|couvrir|déposer|couper)/i;

// indicateur “ingrédient”
const ING_HINT =
  /(\d+\s*(g|kg|ml|cl|l)\b|\b(c(?:\.|\s)?à(?:\.|\s)?s|c(?:\.|\s)?à(?:\.|\s)?c|càs|cac)\b|cuill|cuillère|pincée|tranche|gousse|oeuf|œuf)/i;

// ─────────────────────────────────────────────────────────────
// 1.a) Helpers meta / iPhone UI
// ─────────────────────────────────────────────────────────────

function isMetaLine(s) {
  const txt = String(s || '').trim();
  if (!txt) return false;
  return META_LINE_PATTERNS.some((re) => re.test(txt));
}

// lignes typiques d’un screenshot iPhone (status bar)
function isIosUiLine(s) {
  const t = String(s || '').trim();
  if (!t) return false;

  // Ex: "REGLO Mobile 4G 15:06 16 %"
  if (/(^|\s)(4g|5g|lte|wifi|wi-fi)(\s|$)/i.test(t) && /\b\d{1,2}:\d{2}\b/.test(t)) return true;
  if (/\b\d{1,2}:\d{2}\b/.test(t) && /\b\d{1,3}\s*%/.test(t)) return true;
  if (/^(reglo|orange|sfr|bouygues|free)\b/i.test(t)) return true;

  // Ex: juste "16 %" ou "15%"
  if (/^\d{1,3}\s*%$/.test(t)) return true;

  return false;
}

// ─────────────────────────────────────────────────────────────
// 1.b) Normalisation + fusion des lignes “continuation”
// ─────────────────────────────────────────────────────────────

function normalizeBullet(line) {
  return String(line || '')
    .replace(/\u00A0/g, ' ')
    // puces/variants -> "• "
    .replace(/^[•■⚫●\-\*]\s*/g, '• ')
    // emojis type 🔻 🔶 ♦️ etc.
    .replace(/^[🔻🔶🔸🔹♦️♦️◆◇✅❌➡️➤➜▶️]\s*/g, '• ')
    .replace(/^•\s*(\d)/, '• $1')
    .trim();
}

function isIngredientsHeaderLike(s) {
  return /\bingr[ée]dients?\b/i.test(String(s || '').trim());
}
function isStepsHeaderLike(s) {
  const t = String(s || '').trim();
  return /\b(pr[ée]paration|instructions?|method|préparation)\b/i.test(t);
}

function shouldJoinWithPrevious(prev, curr) {
  if (!prev || !curr) return false;

  if (isIngredientsHeaderLike(prev) || isIngredientsHeaderLike(curr)) return false;
  if (isStepsHeaderLike(prev) || isStepsHeaderLike(curr)) return false;

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

    // si OCR colle "Portions: 4 personnes Ingrédients"
    const idxIng = s.toLowerCase().indexOf('ingrédients');
    if (idxIng > 0) {
      const left = s.slice(0, idxIng).trim();
      const right = s.slice(idxIng).trim();
      if (left) out.push(left);
      if (right) out.push(right);
      continue;
    }

    // si OCR colle "Sel fin PREPARATION"
    const idxPrep = s.toLowerCase().indexOf('preparation');
    if (idxPrep > 0 && /\bpreparation\b/i.test(s)) {
      const left = s.slice(0, idxPrep).trim();
      const right = s.slice(idxPrep).trim();
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
    .filter(Boolean)
    // gros gain iPhone : drop lignes UI
    .filter((s) => !isIosUiLine(s));

  const joined = joinContinuationLines(rawLines);
  const expanded = splitJoinedHeaders(joined);

  const scored = expanded.map((line) => ({
    line,
    score: scoreLine(line),
  }));

  return scored.filter((o) => o.score >= 1).map((o) => o.line);
}

// ─────────────────────────────────────────────────────────────
// 2) Helpers nettoyage
// ─────────────────────────────────────────────────────────────

function cleanRawTextLine(line) {
  let s = String(line || '').trim();

  // enlever puces/tirets + emojis en tête
  s = s.replace(/^[•\-–—*\s]+/, '');
  s = s.replace(/^[🔻🔶🔸🔹♦️◆◇✅❌➡️➤➜▶️]+\s*/, '');

  // enlever numérotation d’étapes ("1." / "1)")
  s = s.replace(/^\d+\s*[\.\)]\s+/, '');

  // petits artefacts OCR
  s = s.replace(/^[EOI]\s+/, '');

  return s.trim();
}

function cleanIngredientLine(line) {
  let l = cleanRawTextLine(line);

  // Supprimer descriptions après ":" si la partie gauche contient une quantité/unité
  if (l.includes(':')) {
    const left = l.split(':')[0];
    if (ING_HINT.test(left)) l = left;
  }

  l = l.replace(/\(facultatif\)/gi, '');
  l = l.replace(/:\s*$/, '');
  l = l.trim();

  // enlever “INGREDIENTS / PREPARATION” qui s’incrustent
  l = l.replace(/\bINGREDIENTS?\b/gi, '').trim();
  l = l.replace(/\bPREPARATION\b/gi, '').trim();

  return l;
}

function extractServingsFromLines(lines) {
  for (const raw of lines) {
    const l = String(raw || '').trim();

    const m1 = l.match(/portions?\s*:\s*(\d+)/i);
    if (m1) return parseInt(m1[1], 10);

    const m1b = l.match(/servings?\s*:\s*(\d+)/i);
    if (m1b) return parseInt(m1b[1], 10);

    const m2 = l.match(/\b(\d+)\s*(personnes|parts)\b/i);
    if (m2) return parseInt(m2[1], 10);
  }
  return null;
}

function isSectionHeader(line) {
  const l = String(line || '').trim();
  if (!l) return false;

  if (/^ingr[ée]dients?$/i.test(l)) return true;
  if (/^(pr[ée]paration|instructions?)$/i.test(l)) return true;
  if (/^pour\b/i.test(l)) return true;
  if (/:\s*$/.test(l) && !/\d/.test(l)) return true;

  return false;
}

function stripLeadingDe(name) {
  let n = String(name || '').trim();
  n = n.replace(/^d['’]\s*/i, '');
  n = n.replace(/^de\s+/i, '');
  return n.trim();
}

function looksLikeStep(line) {
  const s = String(line || '').trim();
  if (!s) return false;

  if (/^\d+\s*[\.\)]\s+/.test(s)) return true;
  if (COOKING_VERBS.test(s)) return true;
  if (s.length > 80) return true;

  return false;
}

// ─────────────────────────────────────────────────────────────
// 3) Parsing ingrédients (OCR-friendly)
// ─────────────────────────────────────────────────────────────

function parseOcrIngredient(line) {
  const txt = cleanIngredientLine(line);
  if (!txt) return null;

  // lignes "sel/poivre" -> pas de quantité forcée
  if (/^(sel|poivre)\b/i.test(txt) || /sel\s+et\s+poivre/i.test(txt)) {
    return { quantity: 0, unit: '', name: txt };
  }

  let m;

  // "500 ml d'eau" / "200 g de champignons"
  m = txt.match(/^(\d+(?:[.,]\d+)?)\s*(g|kg|ml|cl|l)\b\s*(.+)$/i);
  if (m) {
    return {
      quantity: parseFloat(m[1].replace(',', '.')),
      unit: m[2].toLowerCase(),
      name: stripLeadingDe(m[3]),
    };
  }

  // "2 cm de gingembre"
  m = txt.match(/^(\d+(?:[.,]\d+)?)\s*(cm)\b\s*(?:de|d['’])?\s*(.+)$/i);
  if (m) {
    return {
      quantity: parseFloat(m[1].replace(',', '.')),
      unit: 'cm',
      name: stripLeadingDe(m[3]),
    };
  }

  // Formats càs / c.à.s / c a s / c à s
  m = txt.match(/^(\d+(?:[.,]\d+)?)\s*(c(?:\.|\s)?à(?:\.|\s)?s|càs)\b\s*(?:de|d['’])?\s*(.+)$/i);
  if (m) {
    return {
      quantity: parseFloat(m[1].replace(',', '.')),
      unit: 'tbsp',
      name: stripLeadingDe(m[3]),
    };
  }

  // Formats càc / c.à.c / c a c / c à c
  m = txt.match(/^(\d+(?:[.,]\d+)?)\s*(c(?:\.|\s)?à(?:\.|\s)?c|cac)\b\s*(?:de|d['’])?\s*(.+)$/i);
  if (m) {
    return {
      quantity: parseFloat(m[1].replace(',', '.')),
      unit: 'tsp',
      name: stripLeadingDe(m[3]),
    };
  }

  // "3 cuillères à soupe de beurre"
  m = txt.match(
    /^(\d+(?:[.,]\d+)?)\s*(cuill(?:ère|eres|ères)?s?)\s*(?:à|a)\s*(soupe)\s*(?:de|d['’])?\s*(.+)$/i
  );
  if (m) {
    return {
      quantity: parseFloat(m[1].replace(',', '.')),
      unit: 'tbsp',
      name: stripLeadingDe(m[4]),
    };
  }

  // "1 cuillère à café de curry"
  m = txt.match(
    /^(\d+(?:[.,]\d+)?)\s*(cuill(?:ère|eres|ères)?s?)\s*(?:à|a)\s*(caf[eé])\s*(?:de|d['’])?\s*(.+)$/i
  );
  if (m) {
    return {
      quantity: parseFloat(m[1].replace(',', '.')),
      unit: 'tsp',
      name: stripLeadingDe(m[4]),
    };
  }

  // "1 pincée de noix de muscade"
  m = txt.match(/^(\d+(?:[.,]\d+)?)\s*pinc[ée]es?\s*(?:de|d['’])?\s*(.+)$/i);
  if (m) {
    return {
      quantity: parseFloat(m[1].replace(',', '.')),
      unit: 'pinch',
      name: stripLeadingDe(m[2]),
    };
  }

  // "1 gousse d'ail" / "2 carottes"
  m = txt.match(/^(\d+)\s*(gousses?|carottes?|oignons?|œufs?|oeufs?|tranches?|portions?)\b\s*(.*)$/i);
  if (m) {
    const qty = parseInt(m[1], 10);
    const rest = String(m[3] || '').trim();
    const baseName = rest ? `${m[2]} ${rest}` : m[2];
    return {
      quantity: qty,
      unit: 'piece',
      name: stripLeadingDe(baseName),
    };
  }

  // "une dizaine de crevettes..."
  m = txt.match(/^(une\s+douzaine|une\s+dizaine)\s+(de\s+)?(.+)$/i);
  if (m) {
    return {
      quantity: 1,
      unit: 'lot',
      name: stripLeadingDe(m[3]),
    };
  }

  // si ça ressemble à une étape, on ne le garde pas comme ingrédient
  if (looksLikeStep(txt)) return null;

  // IMPORTANT : pas de "1 piece" par défaut
  return null;
}

function beautifyIngredients(list = []) {
  const map = new Map();

  for (const ing of list) {
    if (!ing) continue;
    const name = String(ing.name || '').trim();
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
// 4) Titre (meilleur pour réseaux sociaux)
// ─────────────────────────────────────────────────────────────

function cleanTitleCandidate(s) {
  let t = String(s || '').trim();
  if (!t) return '';

  // retire emoji UI résiduels
  t = t.replace(/[🔻🔶🔸🔹♦️◆◇✅❌➡️➤➜▶️]/g, '').trim();

  // retire hashtags
  t = t.replace(/#\w+/g, '').trim();

  // "username TITRE..." => garder TITRE
  const m = t.match(/^([a-z0-9_.]{3,})\s+(.+)$/i);
  if (m && m[2] && m[2].length >= 8) {
    t = m[2].trim();
  }

  // retire doubles espaces
  t = t.replace(/\s+/g, ' ').trim();

  return t;
}

function guessTitleFromLines(lines = []) {
  for (const raw of lines) {
    const s = String(raw || '').trim();
    if (!s) continue;

    const low = s.toLowerCase();

    if (isMetaLine(s)) continue;
    if (isIosUiLine(s)) continue;
    if (/\bingr[ée]dients?\b/i.test(s)) continue;
    if (/\bpreparation\b/i.test(low) || /\binstructions?\b/i.test(low)) continue;

    // éviter les lignes temps "30 MIN"
    if (/^\d+\s*(min|minutes)$/i.test(s)) continue;

    const cand = cleanTitleCandidate(s);
    if (cand && cand.length >= 8) return cand;
  }
  return '';
}

// ─────────────────────────────────────────────────────────────
// 5) Split ingrédients / étapes / notes
// ─────────────────────────────────────────────────────────────

function splitIngredientsAndSteps(filteredLines) {
  const cleanedLines = filteredLines.map(cleanRawTextLine).filter(Boolean);

  const servings = extractServingsFromLines(filteredLines) || extractServingsFromLines(cleanedLines) || 1;

  const ingredientLines = [];
  const stepLines = [];
  const notesLines = [];

  let section = null;

  for (const line of cleanedLines) {
    const lower = line.toLowerCase();

    if (isMetaLine(line)) continue;

    // headers
    if (/^ingr[ée]dients?\b/.test(lower) || /^ingredients\b/.test(lower)) {
      section = 'ingredients';
      continue;
    }
    if (/^(pr[ée]paration|preparation)\b/.test(lower) || /^instructions?\b/.test(lower)) {
      section = 'steps';
      continue;
    }
    if (/erreurs?\s+à\s+éviter/i.test(lower)) {
      section = 'notes';
      notesLines.push(line);
      continue;
    }

    if (isSectionHeader(line)) {
      // ex: "Pour la sauce :" -> note
      notesLines.push(line);
      continue;
    }

    if (section === 'ingredients') {
      // sécurité : si une ligne ressemble à une étape -> on bascule en steps
      if (looksLikeStep(line) || /^(pr[ée]paration|preparation)\b/i.test(line)) {
        section = 'steps';
      } else {
        const ing = cleanIngredientLine(line);
        if (ing) ingredientLines.push(ing);
        continue;
      }
    }

    if (section === 'steps') {
      const s = String(line || '').trim();
      if (!s) continue;

      if (looksLikeStep(s) || s.length > 15) {
        stepLines.push(s);
      }
      continue;
    }

    if (section === 'notes') {
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
  // (optionnel, mais utile ailleurs)
  looksLikeStep,
};




