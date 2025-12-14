// backend/src/utils/ocrText.js

const { tidyName } = require('./ingredients');

/* ─────────────────────────────────────────────────────────────
   0) Helpers texte
───────────────────────────────────────────────────────────── */

function cleanRawTextLine(s) {
  let t = String(s || '').replace(/\r/g, '').trim();
  if (!t) return '';

  t = t.replace(/[•·\u2022]/g, '•');
  t = t.replace(/[—–]/g, '-');
  t = t.replace(/[“”]/g, '"');
  t = t.replace(/[’]/g, "'");

  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

function splitToLines(rawText) {
  const t = String(rawText || '').replace(/\r/g, '\n');
  return t
    .split('\n')
    .map(cleanRawTextLine)
    .filter(Boolean);
}

function hasTooManySymbols(line) {
  const t = String(line || '');
  const letters = (t.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g) || []).length;
  const symbols = (t.match(/[^A-Za-zÀ-ÖØ-öø-ÿ0-9\s]/g) || []).length;
  return letters > 0 ? symbols / letters > 1.2 : symbols >= 6;
}

function looksLikeUrlOrHandle(line) {
  const t = String(line || '').trim();
  if (!t) return false;
  if (/https?:\/\//i.test(t)) return true;
  if (/\bwww\./i.test(t)) return true;
  if (/\b(bit\.ly|t\.co|linktr\.ee)\b/i.test(t)) return true;
  if (/^@\w+/i.test(t)) return true;
  if (/\s@\w+/i.test(t)) return true;
  if (/#[\w-]+/.test(t)) return true;
  return false;
}

function looksLikeUiNoise(line) {
  const t = String(line || '').toLowerCase();
  if (!t) return true;

  if (t.length <= 1) return true;

  if (/^\d{1,3}%$/.test(t)) return true;

  if (
    /\b(partager|envoyer|enregistrer|enregistré|commentaires?|j'aime|like|suivre|s'abonner|abonne|abonne-toi|follow|subscribe|voir plus|lire la suite|plus d'infos|publicit|sponsor|promoted|shop|acheter|buy now|add to cart)\b/i.test(
      t
    )
  ) {
    return true;
  }

  if (/\b(pinterest|instagram|tiktok|facebook|youtube)\b/i.test(t)) return true;

  if (/\b(recette de|par\s+@|by\s+@|créé par|creator|créatrice)\b/i.test(t))
    return true;

  if (hasTooManySymbols(t)) return true;

  if (looksLikeUrlOrHandle(t)) return true;

  return false;
}

/* ─────────────────────────────────────────────────────────────
   1) Filtrage langue (hook Accept-Language)
───────────────────────────────────────────────────────────── */

function looksEnglish(line) {
  const t = String(line || '').toLowerCase();
  const hits = [
    'the ',
    ' and ',
    ' with ',
    ' minutes',
    ' cups',
    ' tbsp',
    ' tsp',
    ' oven',
    ' heat',
    ' stir',
    ' bake',
    ' preheat',
  ].reduce((acc, w) => (t.includes(w) ? acc + 1 : acc), 0);
  return hits >= 2;
}

function looksFrench(line) {
  const t = String(line || '').toLowerCase();
  if (/[àâäçéèêëîïôöùûüœ]/i.test(t)) return true;
  const hits = [
    'préparation',
    'cuisson',
    'ingrédients',
    'minutes',
    'four',
    'mélanger',
    'ajouter',
    'faire',
    'dans',
    'avec',
  ].reduce((acc, w) => (t.includes(w) ? acc + 1 : acc), 0);
  return hits >= 1;
}

function filterByLanguage(line, lang) {
  if (!lang) return true;

  if (lang === 'fr') {
    if (looksEnglish(line) && !looksFrench(line)) return false;
    return true;
  }

  if (lang === 'en') {
    if (looksFrench(line) && !looksEnglish(line)) return false;
    return true;
  }

  return true;
}

/* ─────────────────────────────────────────────────────────────
   2) Filtrage intelligent + corbeille (trash)
───────────────────────────────────────────────────────────── */

function smartFilterWithTrashFromText(rawText, opts = {}) {
  const lang = opts.lang || 'fr';

  const lines = splitToLines(rawText);
  const kept = [];
  const trash = [];

  for (const l of lines) {
    const line = cleanRawTextLine(l);
    if (!line) continue;

    if (!filterByLanguage(line, lang)) {
      trash.push(line);
      continue;
    }

    if (looksLikeUiNoise(line)) {
      trash.push(line);
      continue;
    }

    kept.push(line);
  }

  // Dédup légère
  const seen = new Set();
  const uniq = [];
  for (const l of kept) {
    const k = l.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(l);
  }

  return { lines: uniq, trash };
}

// rétrocompat si utilisé ailleurs
function smartFilterLinesFromText(rawText) {
  return smartFilterWithTrashFromText(rawText, { lang: 'fr' }).lines;
}

/* ─────────────────────────────────────────────────────────────
   3) Détection sections / steps / ingrédients
───────────────────────────────────────────────────────────── */

function isMetaLine(line) {
  const t = String(line || '').toLowerCase();
  if (!t) return true;
  if (/^\s*(\d+\s*(kcal|cal)|kcal)\b/.test(t)) return true;
  if (/\b(difficulté|difficulty|coût|budget)\b/i.test(t)) return true;
  return false;
}

function isSectionHeader(line) {
  const t = String(line || '').trim();
  return /:\s*$/.test(t) && t.length <= 60;
}

function looksLikeStep(line) {
  const t = String(line || '').trim();
  if (!t) return false;

  if (/^\s*[•\-]\s+/.test(t)) return true;
  if (/^\s*\d+\s*[\.\)\-]\s+/.test(t)) return true;

  if (
    /\b(préchauffer|mélanger|ajouter|cuire|faire|verser|remuer|mettre|incorporer|chauffer|laisser)\b/i.test(
      t
    ) &&
    t.length > 18
  ) {
    return true;
  }

  return false;
}

function cleanIngredientLine(line) {
  let t = String(line || '').trim();
  if (!t) return '';
  t = t.replace(/^[\s•\-·\u2022]*\d+[\.\)\-]\s*/g, '');
  t = t.replace(/^[\s•\-·\u2022]+/g, '');
  return t.trim();
}

/* ─────────────────────────────────────────────────────────────
   4) Split ingrédients / étapes / notes
───────────────────────────────────────────────────────────── */

function extractServingsFromLines(lines) {
  for (const l of lines) {
    const t = String(l || '').toLowerCase();

    let m = t.match(/\b(\d+)\s*(personnes|parts|portions?)\b/i);
    if (m) return parseInt(m[1], 10);

    m = t.match(/\bpour\s*(\d+)\s*(?:a|à|\-)\s*(\d+)\b/i);
    if (m) return Math.max(parseInt(m[1], 10), parseInt(m[2], 10));
  }
  return null;
}

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

    // headers
    if (/^ingr[ée]dients?\b/.test(lower) || /^ingredients\b/.test(lower)) {
      section = 'ingredients';
      continue;
    }
    if (
      /^(pr[ée]paration|preparation)\b/.test(lower) ||
      /^instructions?\b/.test(lower) ||
      /^méthode\b/.test(lower)
    ) {
      section = 'steps';
      continue;
    }

    // notes typiques
    if (
      /\b(temps|cuisson|préparation|preparation|repos|conservation|astuces?|conseils?)\b/i.test(
        lower
      )
    ) {
      section = 'notes';
      notesLines.push(line);
      continue;
    }

    if (isSectionHeader(line)) {
      notesLines.push(line);
      continue;
    }

    if (section === 'ingredients') {
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
      if (looksLikeStep(s) || s.length > 15) stepLines.push(s);
      continue;
    }

    if (section === 'notes') {
      notesLines.push(line);
      continue;
    }

    // hors section : heuristiques
    if (looksLikeStep(line)) {
      stepLines.push(line);
      continue;
    }

    if (
      /(\d|\bg\b|\bkg\b|\bml\b|\bcl\b|\bdl\b|\bl\b|cuill|càs|càc|pincée|tranches?|sachet|poignée|verre)/i.test(
        line
      )
    ) {
      ingredientLines.push(cleanIngredientLine(line));
      continue;
    }

    notesLines.push(line);
  }

  return { servings, ingredientLines, stepLines, notesLines };
}

/* ─────────────────────────────────────────────────────────────
   5) Ingrédients OCR (quantités FR + unités)
───────────────────────────────────────────────────────────── */

function parseQuantity(q) {
  if (q == null) return undefined;
  if (typeof q === 'number') return Number.isFinite(q) ? q : undefined;

  let str = String(q).trim();
  str = str.replace(',', '.');

  // "1 1/2"
  const mix = str.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mix) {
    const [, a, b, c] = mix;
    return parseInt(a, 10) + parseInt(b, 10) / parseInt(c, 10);
  }

  // "1/2"
  const frac = str.match(/^(\d+)\/(\d+)$/);
  if (frac) return parseInt(frac[1], 10) / parseInt(frac[2], 10);

  const num = Number(str);
  return Number.isFinite(num) ? num : undefined;
}

function normalizeUnit(uRaw) {
  const u = String(uRaw || '').toLowerCase().trim();
  if (!u) return '';

  const t = u
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .replace(/à/g, 'a')
    .replace(/é|è|ê/g, 'e')
    .trim();

  if (['g', 'gr', 'gramme', 'grammes'].includes(t)) return 'g';
  if (['kg', 'kilo', 'kilos'].includes(t)) return 'kg';
  if (['ml'].includes(t)) return 'ml';
  if (['cl'].includes(t)) return 'cl';
  if (['dl'].includes(t)) return 'dl';
  if (['l', 'litre', 'litres'].includes(t)) return 'l';

  if (
    [
      'piece',
      'pieces',
      'pièce',
      'pièces',
      'tranche',
      'tranches',
      'sachet',
      'sachets',
      'pincee',
      'pincees',
      'pincée',
      'pincées',
      'poignee',
      'poignees',
      'poignée',
      'poignées',
      'verre',
      'verres',
    ].includes(t)
  ) {
    return t;
  }

  if (
    [
      'cas',
      'cs',
      'c a s',
      'càs',
      'cuillere a soupe',
      'cuillere a soupes',
    ].includes(t)
  )
    return 'càs';

  if (
    [
      'cac',
      'cc',
      'c a c',
      'càc',
      'cuillere a cafe',
      'cuillere a café',
    ].includes(t)
  )
    return 'càc';

  return uRaw;
}

function parseOcrIngredient(line) {
  const raw = String(line || '').trim();
  if (!raw) return null;

  const t0 = cleanIngredientLine(raw);

  // OCR : "1 kg 9 de cerises" -> 1.9 kg
  let m = t0.match(/^(\d+)\s*(kg|g|l|ml|cl|dl)\s*(\d+)\s+(.+)$/i);
  if (m) {
    const a = m[1];
    const unit = m[2];
    const b = m[3];
    const rest = m[4];
    const q = parseQuantity(`${a}.${b}`);
    return {
      name: tidyName(rest),
      quantity: Number.isFinite(q) ? q : 0,
      unit: normalizeUnit(unit),
    };
  }

  // qty + unit? + name
  m = t0.match(
    /^((?:\d+\s+\d+\/\d+)|(?:\d+\/\d+)|(?:\d+(?:[.,]\d+)?))\s*(?:([a-zA-Zéèêàâîïôöùûüœ.\s]+?)\s+)?(.+)$/
  );

  if (!m) {
    return { name: tidyName(t0), quantity: 0, unit: '' };
  }

  const qtyRaw = m[1];
  let unitRaw = m[2] || '';
  let nameRaw = m[3] || '';

  if (/^(de|d')\b/i.test(unitRaw.trim())) {
    nameRaw = `${unitRaw} ${nameRaw}`.trim();
    unitRaw = '';
  }

  unitRaw = unitRaw
    .replace(/\b(cuillere|cuillère)s?\s*a\s*soupe\b/i, 'càs')
    .replace(/\b(cuillere|cuillère)s?\s*a\s*cafe\b/i, 'càc')
    .replace(/\bcuill?\.?\s*à\s*soupe\b/i, 'càs')
    .replace(/\bcuill?\.?\s*à\s*caf[eé]\b/i, 'càc')
    .trim();

  const q = parseQuantity(qtyRaw);
  const unit = normalizeUnit(unitRaw);
  const name = tidyName(nameRaw);

  return {
    name: name || tidyName(t0.replace(qtyRaw, '').replace(unitRaw, '').trim()),
    quantity: Number.isFinite(q) ? q : 0,
    unit: unit || '',
  };
}

function beautifyIngredients(list = []) {
  const out = [];
  const seen = new Map();

  for (const item of list) {
    if (!item) continue;

    const name = tidyName(item.name || '');
    if (!name) continue;

    const unit = String(item.unit || '').trim();
    const qty = Number(item.quantity || 0);

    const key = `${name.toLowerCase()}|${unit.toLowerCase()}`;

    if (seen.has(key)) {
      const idx = seen.get(key);
      if (qty > 0 && Number.isFinite(qty)) {
        out[idx].quantity = Number(out[idx].quantity || 0) + qty;
      }
      continue;
    }

    out.push({
      name,
      quantity: Number.isFinite(qty) ? qty : 0,
      unit,
    });

    seen.set(key, out.length - 1);
  }

  return out;
}

/* ─────────────────────────────────────────────────────────────
   6) Title / Notes / Steps
───────────────────────────────────────────────────────────── */

function guessTitleFromLines(lines = []) {
  for (const l of lines.slice(0, 25)) {
    const t = String(l || '').trim();
    if (!t) continue;

    const lower = t.toLowerCase();
    if (/^(ingr[ée]dients?|ingredients|pr[ée]paration|preparation|instructions?)\b/.test(lower))
      continue;

    if (looksLikeStep(t)) continue;
    if (/(^\d|(\bg\b|\bkg\b|\bml\b|\bcl\b|cuill|càs|càc))/i.test(t)) continue;
    if (t.length < 5 || t.length > 90) continue;

    return t;
  }
  return '';
}

function extractNotesFromLines(lines = []) {
  const cleaned = lines
    .map(cleanRawTextLine)
    .filter(Boolean)
    .filter((l) => !looksLikeUiNoise(l));

  const seen = new Set();
  const uniq = [];
  for (const l of cleaned) {
    const k = l.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(l);
  }

  return uniq.join('\n').trim();
}

function splitStepLineAggressive(line) {
  let t = String(line || '').trim();
  if (!t) return [];

  // retire puces
  t = t.replace(/^[\s•\-·\u2022]+/g, '');

  // "Faire cuire.Xxxxx" -> "Faire cuire. Xxxxx"
  t = t.replace(/\.(?=[A-ZÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ])/g, '. ');

  const parts = t
    .split(/\s*(?:\n|\r|\t)\s*/g)
    .flatMap((x) => x.split(/\s*•\s*/g))
    .flatMap((x) => x.split(/\s*(?:(?<=\.)\s+|(?<=!)\s+|(?<=\?)\s+|;\s+)/g));

  return parts.map((p) => p.trim()).filter(Boolean);
}

function normalizeStepsFromLines(stepLines = []) {
  const out = [];

  for (const raw of stepLines) {
    const line = cleanRawTextLine(raw);
    if (!line) continue;

    const parts = splitStepLineAggressive(line);

    for (let p of parts) {
      p = p.replace(/^[\s•\-·\u2022]*\d+[\.\)\-]\s*/g, '').trim();
      p = p.replace(/^[\s•\-·\u2022]+/g, '').trim();
      if (!p) continue;
      if (p.length < 3) continue;
      out.push(p);
    }
  }

  const seen = new Set();
  const uniq = [];
  for (const s of out) {
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(s);
  }

  return uniq;
}

/* ─────────────────────────────────────────────────────────────
   Exports
───────────────────────────────────────────────────────────── */

module.exports = {
  smartFilterWithTrashFromText,
  smartFilterLinesFromText,
  splitIngredientsAndSteps,
  parseOcrIngredient,
  beautifyIngredients,
  guessTitleFromLines,
  looksLikeStep,
  normalizeStepsFromLines,
  extractNotesFromLines,
};
