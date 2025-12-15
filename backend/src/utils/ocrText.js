// backend/src/utils/ocrText.js
'use strict';

function normSpaces(s) {
  return String(s || '')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function stripWeird(s) {
  return String(s || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r/g, '');
}

/* =========================
   TRASH / NOISE (iPhone + Social)
========================= */

function looksLikeStatusBarNoise(line) {
  const t = normSpaces(line);

  if (/^\d{1,2}:\d{2}$/.test(t)) return true;
  if (/\b(4g|5g|lte|wifi|wi-fi)\b/i.test(t) && /\b\d{1,3}\b/.test(t)) return true;
  if (/^\d{1,3}%$/.test(t)) return true;

  return false;
}

function looksLikeSocialNoise(line) {
  const t = normSpaces(line).toLowerCase();

  if (/@[a-z0-9._-]{2,}/i.test(t)) return true;
  if (/#\w{2,}/.test(t)) return true;

  if (/https?:\/\//i.test(t) || /\bwww\./i.test(t)) return true;

  if (/\b\d{1,9}\s*(likes?|j’aime|j'aime|comments?|commentaires?)\b/i.test(t)) return true;

  const patterns = [
    'toutes les publications',
    'voir plus',
    'voir la traduction',
    'traduction',
    'répondre',
    'envoyer',
    'partager',
    's’abonner',
    "s'abonner",
    'abonne-toi',
    'abonne toi',
    'abonnez-vous',
    'abonnez vous',
    'publicité',
    'sponsorisé',
    'sponsorisee',
    'collaboration commerciale',
    'publication sponsorisée',
    'contenu sponsorisé',
    'paid partnership',
    'sponsored content',
    'link in bio',
    'swipe up',
    'shop now',
    'save this post',
    'save recipe',
    'comment below',
    'send to a friend',
    'follow for more',
    'original sound',
    'reposted from',
    'open app',
    'ouvrir l’app',
    "ouvrir l'app",
    'sign in',
    'log in',
    'subscribe to unlock',
    'notifications activées',
    'activer les notifications',
    'fermer',
    'retour',
  ];

  if (patterns.some((p) => t.includes(p))) return true;

  const emojiCount = (t.match(/[\u{1F300}-\u{1FAFF}]/gu) || []).length;
  if (emojiCount >= 4 && t.length < 50) return true;

  return false;
}

function isMostlyNoise(line) {
  const t = normSpaces(line);
  if (!t) return true;
  if (t.length <= 1) return true;

  const letters = (t.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g) || []).length;
  const digits = (t.match(/\d/g) || []).length;
  if (letters + digits === 0) return true;

  return false;
}

/* =========================
   DEDUP (cross-captures)
========================= */

function normalizeForDedup(line) {
  return normSpaces(line)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupeLines(lines) {
  const seen = new Set();
  const out = [];

  for (const l of lines) {
    const key = normalizeForDedup(l);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out;
}

/* =========================
   CLEAN + TRASH
========================= */

function smartFilterWithTrashFromText(rawText) {
  const cleaned = stripWeird(rawText);

  const rawLines = cleaned
    .split('\n')
    .map((s) => normSpaces(s))
    .filter(Boolean);

  const lines = [];
  const trash = [];

  for (const l of rawLines) {
    if (isMostlyNoise(l)) {
      trash.push(l);
      continue;
    }
    if (looksLikeStatusBarNoise(l)) {
      trash.push(l);
      continue;
    }
    if (looksLikeSocialNoise(l)) {
      trash.push(l);
      continue;
    }
    lines.push(l);
  }

  return {
    rawText: cleaned,
    lines: dedupeLines(lines),
    trash: dedupeLines(trash),
  };
}

/* =========================
   SERVINGS / TITLE
========================= */

function extractServingsFromLine(line) {
  const t = normSpaces(line).toLowerCase();

  let m = t.match(/ingr[ée]dients?\s+pour\s+(\d+)\s*(personnes|parts|portions)\b/i);
  if (m) return parseInt(m[1], 10);

  m = t.match(/\bpour\s+(\d+)\s*(personnes|parts|portions)\b/i);
  if (m) return parseInt(m[1], 10);

  return null;
}

function isIngredientsHeader(line) {
  const t = normSpaces(line).toLowerCase();
  if (/^ingr[ée]dients?\b/.test(t)) return true;
  if (/^ingr[ée]dients?\s+pour\s+\d+\s*/.test(t)) return true;
  return false;
}

function isPreparationHeader(line) {
  const t = normSpaces(line).toLowerCase();
  return /^préparation\b/.test(t) || /^preparation\b/.test(t) || /^instructions?\b/.test(t);
}

function guessTitleFromLines(lines) {
  for (const l of lines.slice(0, 12)) {
    const t = normSpaces(l);

    if (!t) continue;
    if (looksLikeStatusBarNoise(t)) continue;
    if (looksLikeSocialNoise(t)) continue;
    if (isIngredientsHeader(t)) continue;
    if (isPreparationHeader(t)) continue;
    if (extractServingsFromLine(t)) continue;

    if (/^(temps|notes?)\b/i.test(t)) continue;

    if (t.length >= 6 && t.length <= 80 && !/\d/.test(t)) {
      return t;
    }
  }

  return 'Recette importée';
}

/* =========================
   STEP JOIN WRAPS
========================= */

function joinWrappedLinesForSteps(stepLines) {
  const out = [];
  let buffer = '';

  const flush = () => {
    const s = normSpaces(buffer);
    if (s) out.push(s);
    buffer = '';
  };

  for (const raw of stepLines) {
    const line = normSpaces(raw);
    if (!line) continue;

    if (isPreparationHeader(line)) {
      flush();
      continue;
    }

    if (!buffer) {
      buffer = line;
      continue;
    }

    const endsStrong = /[.!?…:]$/.test(buffer);
    const nextLooksContinuation =
      /^[a-zà-öø-ÿ’'"(]/.test(line) ||
      /^l['’]/i.test(line) ||
      /^(puis|et|ensuite|alors|donc)\b/i.test(line);

    if (!endsStrong && nextLooksContinuation) {
      buffer = `${buffer} ${line}`;
    } else {
      flush();
      buffer = line;
    }
  }

  flush();
  return out;
}

/* =========================
   INGREDIENT PARSER (FR)
========================= */

function parseQuantityFR(q) {
  const t = normSpaces(q).toLowerCase();
  if (!t) return null;

  let s = t.replace(',', '.');

  const uni = {
    '½': '1/2',
    '⅓': '1/3',
    '⅔': '2/3',
    '¼': '1/4',
    '¾': '3/4',
    '⅛': '1/8',
    '⅜': '3/8',
    '⅝': '5/8',
    '⅞': '7/8',
  };
  if (uni[s]) s = uni[s];

  let m = s.match(/(\d+(?:\.\d+)?)\s*(?:-|à|a)\s*(\d+(?:\.\d+)?)/i);
  if (m) return Math.max(parseFloat(m[1]), parseFloat(m[2]));

  m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (m) {
    const a = parseFloat(m[1]);
    const b = parseFloat(m[2]);
    const c = parseFloat(m[3]);
    if (c) return a + b / c;
  }

  m = s.match(/^(\d+)\/(\d+)$/);
  if (m) {
    const a = parseFloat(m[1]);
    const b = parseFloat(m[2]);
    if (b) return a / b;
  }

  m = s.match(/^(\d+(?:\.\d+)?)$/);
  if (m) return parseFloat(m[1]);

  return null;
}

function normalizeUnit(u) {
  const t = normSpaces(u).toLowerCase();

  if (['g', 'gr', 'gramme', 'grammes'].includes(t)) return 'g';
  if (['kg', 'kilo', 'kilos'].includes(t)) return 'kg';
  if (['ml'].includes(t)) return 'ml';
  if (['cl'].includes(t)) return 'cl';
  if (['dl'].includes(t)) return 'dl';
  if (['l', 'litre', 'litres'].includes(t)) return 'l';

  if (t === 'cas' || t === 'càs' || t === 'cs' || (t.includes('cuill') && t.includes('soupe'))) return 'càs';
  if (t === 'cac' || t === 'càc' || t === 'cc' || (t.includes('cuill') && (t.includes('cafe') || t.includes('café')))) return 'càc';

  if (t.includes('pinc')) return 'pincée';
  if (t.includes('gousse')) return 'gousse';
  if (t.includes('tranch')) return 'tranche';
  if (t.includes('sachet')) return 'sachet';
  if (t.includes('paquet')) return 'paquet';
  if (t.includes('boite') || t.includes('boîte')) return 'boîte';
  if (t.includes('verre')) return 'verre';
  if (t.includes('tasse')) return 'tasse';
  if (t.includes('pièce') || t.includes('piece') || t === 'u') return 'pièce';

  return t || '';
}

const QTY_RE =
  '([0-9]+(?:[.,][0-9]+)?|[0-9]+\\s+[0-9]+\\/[0-9]+|[0-9]+\\/[0-9]+|½|⅓|⅔|¼|¾|⅛|⅜|⅝|⅞)';

// ✅ IMPORTANT : cuillere / cuillère / cuilleres / cuillères
const CUILL_RE = 'cuill(?:e|è)re(?:s)?';

function postProcessIngredientName(name) {
  let n = normSpaces(name);

  if (/^huile\s+olive\b/i.test(n)) n = n.replace(/^huile\s+olive\b/i, "huile d'olive");
  n = n.replace(/^de\s+/i, '');

  return n;
}

function parseOcrIngredient(line) {
  const raw = normSpaces(line);
  if (!raw) return null;

  if (isIngredientsHeader(raw)) return null;
  if (isPreparationHeader(raw)) return null;

  let m = raw.match(/^(un peu de|selon goût|au goût)\s+(.+)$/i);
  if (m) {
    return { name: postProcessIngredientName(m[2]), quantity: 0, unit: '' };
  }

  const l = raw.replace(/^[-•*]\s+/, '');

  // "400 g de ..."
  m = l.match(new RegExp(`^${QTY_RE}(\\s?)(kg|g|mg|l|dl|cl|ml)\\b\\s*(?:de\\s+)?(.+)$`, 'i'));
  if (m) {
    const qty = parseQuantityFR(m[1]);
    const unit = normalizeUnit(m[3]);
    const name = postProcessIngredientName(m[4]);
    if (name) return { name, quantity: qty ?? 0, unit };
  }

  // ✅ CUILLÈRE À/A CAFÉ
  // match: "1 cuillère à café de X" / "1 cuillere a cafe X" / "1 cuillères à café d'X"
  m = l.match(
    new RegExp(
      `^${QTY_RE}\\s+(?:${CUILL_RE}\\s*(?:à|a)\\s*caf(?:e|é)|c\\.?\\s*(?:à|a)\\s*c\\.?|càc|cac|cc)\\s*(?:de|d['’])?\\s*(.+)$`,
      'i'
    )
  );
  if (m) {
    const qty = parseQuantityFR(m[1]);
    const name = postProcessIngredientName(m[2]);
    if (name) return { name, quantity: qty ?? 0, unit: 'càc' };
  }

  // ✅ CUILLÈRE À/A SOUPE
  m = l.match(
    new RegExp(
      `^${QTY_RE}\\s+(?:${CUILL_RE}\\s*(?:à|a)\\s*soupe|c\\.?\\s*(?:à|a)\\s*s\\.?|càs|cas|cs)\\s*(?:de|d['’])?\\s*(.+)$`,
      'i'
    )
  );
  if (m) {
    const qty = parseQuantityFR(m[1]);
    const name = postProcessIngredientName(m[2]);
    if (name) return { name, quantity: qty ?? 0, unit: 'càs' };
  }

  // "2 gousses d'ail"
  m = l.match(/^(\d+)\s+(gousses?|tranches?|sachets?|verres?|tasses?|pièces?|pieces?)\s+(?:de\s+|d['’])?(.+)$/i);
  if (m) {
    const qty = parseQuantityFR(m[1]);
    const unit = normalizeUnit(m[2]);
    const name = postProcessIngredientName(m[3]);
    if (name) return { name, quantity: qty ?? 0, unit: unit || '' };
  }

  // "1 oignon" => pièce
  m = l.match(/^(\d+)\s+(.+)$/);
  if (m) {
    const qty = parseQuantityFR(m[1]);
    const name = postProcessIngredientName(m[2]);
    if (name) return { name, quantity: qty ?? 0, unit: 'pièce' };
  }

  return null;
}

function beautifyIngredients(items) {
  const out = [];
  const seen = new Set();

  for (const it of items) {
    const name = normSpaces(it.name || '');
    const quantity = Number.isFinite(it.quantity) ? it.quantity : 0;
    const unit = it.unit == null ? '' : String(it.unit);

    if (!name) continue;

    const key = `${name.toLowerCase()}|${unit.toLowerCase()}|${quantity}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ name, quantity, unit });
  }

  return out;
}

/* =========================
   SPLIT (headers FR)
========================= */

function splitIngredientsAndSteps(lines) {
  const L = lines.map(normSpaces).filter(Boolean);

  let servings = null;
  for (const l of L.slice(0, 30)) {
    const s = extractServingsFromLine(l);
    if (s) {
      servings = s;
      break;
    }
  }

  const idxIng = L.findIndex((l) => /^ingr[ée]dients?\b/i.test(l));
  const idxPrep = L.findIndex((l) => /^préparation\b/i.test(l) || /^preparation\b/i.test(l));

  let ingredientLines = [];
  let stepLines = [];
  let notesLines = [];

  if (idxIng >= 0 && idxPrep >= 0 && idxPrep > idxIng) {
    ingredientLines = L.slice(idxIng + 1, idxPrep);
    stepLines = L.slice(idxPrep, L.length);
  } else if (idxIng >= 0) {
    ingredientLines = L.slice(idxIng + 1);
  } else if (idxPrep >= 0) {
    stepLines = L.slice(idxPrep);
  } else {
    for (const l of L) {
      if (parseOcrIngredient(l)) ingredientLines.push(l);
      else if (isPreparationHeader(l)) stepLines.push(l);
      else notesLines.push(l);
    }
  }

  ingredientLines = ingredientLines.filter((l) => !isIngredientsHeader(l) && !extractServingsFromLine(l));

  if (!notesLines.length) {
    notesLines = L.filter((l) => /^temps\b/i.test(l) || /conservation|astuce|conseil/i.test(l));
  }

  return { ingredientLines, stepLines, notesLines, servings };
}

/* =========================
   MINI REFLOW
========================= */

function miniReflow({ ingredientLines, stepLines, notesLines }) {
  return [...ingredientLines, ...stepLines, ...notesLines];
}

module.exports = {
  smartFilterWithTrashFromText,
  splitIngredientsAndSteps,
  joinWrappedLinesForSteps,
  parseOcrIngredient,
  beautifyIngredients,
  guessTitleFromLines,
  extractServingsFromLine,
  miniReflow,
};
