// backend/src/utils/ocrFragmentedIngredients.js
// reconstruire lignes ingredients depuis des fragments
// scorer la qualite de cette reconstruction
// LEVEL: UTIL (OCR text parsing)
// import autorisés : utils (stringUtils, units, heuristics, ingredientParser, ocrTitle)
// import interdits : routes, middleware, services (vision/supabase), prisma/lib, parsers sites
// importé par : routes import-ocr (ou services OCR), et autres utils

'use strict';

const { normSpaces, normalizeLoose } = require('../utils/stringUtils');
const { parseOcrIngredient } = require('../utils/ingredientParser');
const { looksLikeStepLine, looksLikeStepVerbLine, looksLikeActionSentence } = require('../utils/heuristics');

function normalizeLines(lines) {
  return (Array.isArray(lines) ? lines : [])
    .map((x) => normSpaces(String(x || '')))
    .filter(Boolean);
}

function dedupeLines(lines) {
  const seen = new Set();
  const out = [];

  for (const line of lines) {
    const clean = normSpaces(line);
    const key = clean.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }

  return out;
}

function dedupeLinesPreservingCriticalFragments(lines) {
  const seen = new Set();
  const out = [];

  for (const line of lines) {
    const clean = normSpaces(line);
    const key = clean.toLowerCase();
    if (!key) continue;

    // IMPORTANT :
    // on ne déduplique pas les fragments critiques,
    // sinon on perd des vrais "20 g de" ou "1 càc de"
    if (looksLikeMeasureOnlyFragment(clean) || looksLikeConnectorFragmentLocal(clean)) {
      out.push(clean);
      continue;
    }

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }

  return out;
}

// debug
const DEBUG_FRAGMENTED = process.env.OCR_VERBOSE === '1';
const flog = (...args) => {
  if (DEBUG_FRAGMENTED) console.log(...args);
};

function looksLikeUiNoise(line) {
  const t = normSpaces(line);
  const low = t.toLowerCase();
  if (!t) return true;

  if (/^suivre$/i.test(low)) return true;
  if (/^\.\.\.$/.test(t)) return true;
  if (/^\d+[.,]?\d*\s*[kKqQ]?$/.test(t)) return true;
  if (/^[✓☑✔]+$/.test(t)) return true;

  return false;
}

function looksLikeTitleOrBrandNoise(line) {
  const t = normSpaces(line);
  const low = t.toLowerCase();
  if (!t) return false;

  if (/^sauce\s+burger\b/i.test(low)) return true;
  if (/^sauce\s+cheddar\b/i.test(low)) return true;
  if (/sandwichs?/i.test(low)) return true;

  // nom de compte / page / pseudo court
  if (/^[a-z0-9._-]{3,}\s+[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿœ]+/.test(t)) return true;

  if (looksLikeContextOrStandaloneNoise(t)) return true;
  return false;
}

function looksLikeContextOrStandaloneNoise(line) {
  const t = normSpaces(line);
  const low = normalizeLoose(t);

  if (!t) return true;

  if (/^ingr[eé]dients?\b/i.test(low)) return true;
  if (/^les ingr[eé]dients\b/i.test(low)) return true;

  if (/_/.test(t)) return true;
  if (/[♫♪]/.test(t)) return true;

  if (/\b(anniversaire|recette|ultra gourmand|sans cuisson|gourmand|gourmande)\b/i.test(low)) return true;
  if (/\b(ajouter un commentaire|suivre|notice sur l ia|instagram)\b/i.test(low)) return true;

  // Ligne titre courte, pas une ligne ingrédient fiable
  if (
    !/\d/.test(t) &&
    /^[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿœ' -]+$/.test(t) &&
    t.split(/\s+/).length <= 4
  ) {
    return true;
  }

  return false;
}

function normalizeOcrConfusions(line) {
  let t = normSpaces(line);
  if (!t) return '';

  // I / l / | -> 1 devant une mesure
  t = t.replace(/^[I|l](?=\s*c\.?\s*a\.?\s*[sc])/i, '1');
  t = t.replace(/^[I|l](?=\s+(pincee|pincée|g|kg|mg|ml|cl|dl|l)\b)/i, '1');

  t = t.replace(/\b(\d+)\s+a\s+de\b/gi, '$1 g de');
  t = t.replace(/\b(\d+)\s+q\s+de\b/gi, '$1 g de');

  // formes OCR des cuillères
  t = t.replace(/\bc\.?\s*a\.?\s*c\.?\b/gi, 'càc');
  t = t.replace(/\bc\.?\s*a\.?\s*s\.?\b/gi, 'càs');

  // orthographe OCR fréquente
  t = t.replace(/\bpincee\b/gi, 'pincée');
  t = t.replace(/\bhaches\b/gi, 'hachés');
  t = t.replace(/\bhachees\b/gi, 'hachées');

  // "1/2 càcI pincee de" -> "1/2 càc || 1 pincée de"
  t = t.replace(
    /\b((?:\d+\s+\d+\/\d+|\d+\/\d+|½|⅓|⅔|¼|¾|\d+(?:[.,]\d+)?)\s*càc)\s*[I|l]\s*(pincée|pincee)\s+de\b/gi,
    '$1 || 1 pincée de'
  );

  // "1/2 càcI" -> "1/2 càc || 1"
  t = t.replace(
    /\b((?:\d+\s+\d+\/\d+|\d+\/\d+|½|⅓|⅔|¼|¾|\d+(?:[.,]\d+)?)\s*càc)\s*[I|l]\b/gi,
    '$1 || 1'
  );

  // "200 a de" -> "200 g de"
  t = t.replace(/^(\d+(?:[.,]\d+)?)\s+a\s+de\b/i, '$1 g de');

  // "200 a" -> "200 g"
  t = t.replace(/^(\d+(?:[.,]\d+)?)\s+a\b/i, '$1 g');

  // "I pincee de" -> "1 pincée de"
  t = t.replace(/^[I|l]\s+(pincée|pincee)\s+de\b/i, '1 pincée de');

  // "I càc de" / "I càs de"
  t = t.replace(/^[I|l]\s+càc\b/i, '1 càc');
  t = t.replace(/^[I|l]\s+càs\b/i, '1 càs');

  // espaces manquants après unité
  t = t.replace(/\b(càc|càs)(?=de\b)/gi, '$1 ');
  t = t.replace(/\b(g|kg|mg|ml|cl|dl|l)(?=de\b)/gi, '$1 ');

  return normSpaces(t);
}

function looksLikeGarbageFragment(line) {
  const t = normalizeOcrConfusions(line);
  const low = t.toLowerCase();
  if (!t) return true;

  if (looksLikeUiNoise(t)) return true;
  if (looksLikeTitleOrBrandNoise(t)) return true;

  if (looksLikeStepLine(t) || looksLikeStepVerbLine(t) || looksLikeActionSentence(t)) return true;

  if (/^(de|du|des|d['’])$/i.test(low)) return false;
  if (/^(jus|zeste|pulpe)\s+de$/i.test(low)) return false;

  if (/^[a-z]$/i.test(low)) return true;
  if (/^\d+$/.test(low)) return true;
  if (/^[a-z]\s+[a-z]$/i.test(low) && low.length <= 6) return true;

  return false;
}

function measureSuggestsLiquid(line) {
  const t = normalizeOcrConfusions(line).toLowerCase();
  return /\b(ml|cl|dl|l|càc|càs)\b/.test(t);
}

function measureSuggestsWeight(line) {
  const t = normalizeOcrConfusions(line).toLowerCase();
  return /\b(g|kg|mg)\b/.test(t);
}

function nameLooksLiquidCompatible(line) {
  const t = normalizeOcrConfusions(line).toLowerCase();
  if (!t) return false;

  return /\b(lait|eau|huile|jus|vinaigre|cr[eè]me|creme|sauce|sirop)\b/i.test(t);
}

function nameLooksWeightCompatible(line) {
  const t = normalizeOcrConfusions(line).toLowerCase();
  if (!t) return false;

  return /\b(farine|beurre|cheddar|fromage|sucre|sel|poivre|paprika|oignon|ail|cornichons?)\b/i.test(t);
}

function measureNameCompatibilityScore(measureLine, nameLine) {
  const measure = normalizeOcrConfusions(measureLine);
  const name = normalizeOcrConfusions(nameLine);
  if (!measure || !name) return -100;

  let score = 0;

  if (measureSuggestsLiquid(measure) && nameLooksLiquidCompatible(name)) score += 4;
  if (measureSuggestsWeight(measure) && nameLooksWeightCompatible(name)) score += 4;

  if (measureSuggestsLiquid(measure) && nameLooksWeightCompatible(name)) score -= 3;
  if (measureSuggestsWeight(measure) && nameLooksLiquidCompatible(name)) score -= 1;

  return score;
}

function cleanConnectorLedName(line) {
  const t = normalizeOcrConfusions(line);
  if (!t) return '';

  return normSpaces(t.replace(/^(de|du|des|d['’])\s+/i, ''));
}

function buildIngredientTextFromMeasureAndName(measureLine, nameLine) {
  const measure = normalizeOcrConfusions(measureLine);
  const rawName = normalizeOcrConfusions(nameLine);

  if (!measure || !rawName) return '';

  if (/^(de|du|des|d['’])\s+/i.test(rawName)) {
    return normalizeFragmentedIngredientLine(`${measure} ${rawName}`);
  }

  if (/\b(de|du|des|d['’])\s*$/i.test(measure)) {
    return normalizeFragmentedIngredientLine(`${measure} ${rawName}`);
  }

  return normalizeFragmentedIngredientLine(`${measure} de ${rawName}`);
}

function nextMeaningfulIndex(lines, startIndex, maxLookAhead = 3) {
  const max = Math.min(lines.length, startIndex + maxLookAhead + 1);

  for (let i = startIndex; i < max; i++) {
    const t = normalizeOcrConfusions(lines[i] || '');
    if (!t) continue;

    if (looksLikeUiNoise(t)) continue;
    if (looksLikeTitleOrBrandNoise(t)) continue;
    if (looksLikeGarbageFragment(t) && !looksLikeConnectorFragmentLocal(t)) continue;

    return i;
  }

  return -1;
}

function findNextMeasureIndex(lines, startIndex, maxLookAhead = 5) {
  const max = Math.min(lines.length, startIndex + maxLookAhead + 1);

  for (let i = startIndex; i < max; i++) {
    const t = normalizeOcrConfusions(lines[i] || '');
    if (!t) continue;
    if (looksLikeMeasureOnlyFragment(t)) return i;
  }

  return -1;
}

function looksLikeLooseQualifier(line) {
  const t = normSpaces(line).toLowerCase();
  if (!t) return false;

  return /^(hach[ée]s?|finement|doux|douce|fum[ée]e?|sal[ée]e?|enti[eè]re?s?|moulu[e]s?|et)$/i.test(t);
}

function looksLikeQualifierTail(line) {
  const t = normalizeOcrConfusions(line).toLowerCase();
  if (!t) return false;

  return (
    /^(doux|douce|fumé|fumee|fumée|fumee|fort|forte|moulu|moulue|moulus|moulues|séché|seche|séchée|sechee|frais|fraîche|fraiches|fraîches)$/i.test(t) ||
    /^(haché|hache|hachés|haches|hachée|hachee|hachées|hachees)(?:\s+finement)?$/i.test(t) ||
    /^finement\s+(haché|hache|hachés|haches|hachée|hachee|hachées|hachees)$/i.test(t) ||
    /^(liquide\s+enti[eè]re|enti[eè]re|cr[eè]me\s+liquide\s+enti[eè]re)$/i.test(t) ||
    /^en\s+poudre$/i.test(t)
  );
}

function looksLikeCoordinatedTail(line) {
  const t = normalizeOcrConfusions(line).toLowerCase();
  if (!t) return false;

  return (
    /^et\s+poudre\s+d['’][a-zà-öø-ÿœ' -]+$/i.test(t) ||
    /^et\s+[a-zà-öø-ÿœ' -]{2,30}$/i.test(t)
  );
}

function looksLikeMeasureOnlyFragment(line) {
  const t = normalizeOcrConfusions(line).toLowerCase();
  if (!t) return false;

  return (
    /^(?:\d+\s+\d+\/\d+|\d+\/\d+|½|⅓|⅔|¼|¾|\d+(?:[.,]\d+)?)\s*(?:càc|càs|g|kg|mg|ml|cl|dl|l)\s*(?:de)?$/i.test(t) ||
    /^(?:\d+\s+\d+\/\d+|\d+\/\d+|½|⅓|⅔|¼|¾|\d+(?:[.,]\d+)?)\s+(?:pincée|gousse|gousses|sachet|sachets)\s*(?:de)?$/i.test(t)
  );
}

function looksLikeConnectorFragmentLocal(line) {
  const t = normalizeOcrConfusions(line).toLowerCase();
  if (!t) return false;

  return (
    /^(jus|zeste|pulpe)\s+de$/i.test(t) ||
    /^(de|du|des|d['’])$/i.test(t) ||
    /^(de|du|des|d['’])\s+[a-zà-öø-ÿœ' -]{2,40}$/i.test(t)
  );
}

function looksLikeUsefulNameTail(line) {
  const t = normalizeOcrConfusions(line).toLowerCase();
  if (!t) return false;

  return (
    /^poudre d['’][a-zà-öø-ÿœ' -]+$/i.test(t) ||
    /^et\s+poudre d['’][a-zà-öø-ÿœ' -]+$/i.test(t)
  );
}

function looksLikeStrongStandaloneIngredient(line) {
  const t = normalizeFragmentedIngredientLine(line);
  if (!t) return false;

  if (looksLikeUiNoise(t)) return false;
  if (looksLikeTitleOrBrandNoise(t)) return false;
  if (looksLikeGarbageFragment(t)) return false;
  if (looksLikeMeasureOnlyFragment(t)) return false;
  if (looksLikeConnectorFragmentLocal(t)) return false;
  if (looksLikeLooseQualifier(t)) return false;
  if (looksLikeQualifierTail(t)) return false;
  if (looksLikeCoordinatedTail(t)) return false;

  const parsed = parseOcrIngredient(t);
  if (!parsed || !parsed.name) return false;

  const name = normSpaces(parsed.name || '');
  if (!name) return false;

  if (looksLikeTitleOrBrandNoise(name)) return false;
  if (looksLikeGarbageFragment(name)) return false;
  if (/^(de|du|des|d['’]|jus de)$/i.test(name)) return false;

  const hasQty = parsed.quantity != null && parsed.quantity !== 0;
  const hasUnit = !!String(parsed.unit || '').trim();

  return hasQty && hasUnit;
}

function appendTailToIngredientText(baseText, tail) {
  const base = normalizeFragmentedIngredientLine(baseText);
  const extra = normalizeOcrConfusions(tail);
  if (!base || !extra) return base;

  if (looksLikeQualifierTail(extra)) {
    return normalizeFragmentedIngredientLine(`${base} ${extra}`);
  }

  if (looksLikeCoordinatedTail(extra)) {
    return normalizeFragmentedIngredientLine(`${base} ${extra}`);
  }

  return base;
}

function enrichIngredientWithFollowingTails(lines, indexes, text) {
  let out = normalizeFragmentedIngredientLine(text);
  let consumed = [...indexes];

  if (!out) return { text: '', indexes: consumed, bonus: 0 };

  let last = Math.max(...indexes);
  let bonus = 0;

  for (let j = last + 1; j < Math.min(lines.length, last + 3); j++) {
    const cur = normalizeOcrConfusions(lines[j] || '');
    if (!cur) continue;

    if (looksLikeQualifierTail(cur)) {
      out = appendTailToIngredientText(out, cur);
      consumed.push(j);
      bonus += 4;
      last = j;
      continue;
    }

    if (looksLikeCoordinatedTail(cur)) {
      out = appendTailToIngredientText(out, cur);
      consumed.push(j);
      bonus += 5;
      last = j;
      continue;
    }

    break;
  }

  return {
    text: normalizeFragmentedIngredientLine(out),
    indexes: consumed,
    bonus,
  };
}

function looksLikeIngredientNameOnlyLocal(line) {
  const t = normalizeOcrConfusions(line);
  const low = t.toLowerCase();

  if (!t) return false;

  if (parseOcrIngredient(t)) return false;
  if (looksLikeMeasureOnlyFragment(t)) return false;
  if (looksLikeConnectorFragmentLocal(t)) return false;
  if (looksLikeLooseQualifier(t) && !looksLikeQualifierTail(t)) return false;
  if (looksLikeGarbageFragment(t)) return false;

  if (/\d/.test(t)) return false;
  if (t.length < 2 || t.length > 32) return false;

  if (/^(sauce|préparation|preparation|ingr[ée]dients?|etapes?|étapes?)$/i.test(low)) {
    return false;
  }

  if (/^(de|du|des|d['’])\b/i.test(low)) return false;
  if (/^(et|ou)\b/i.test(low)) return false;

  if (/^(sel|poivre|beurre|farine|cheddar|moutarde|sucre|paprika)$/i.test(low)) {
    return true;
  }

  if (looksLikeUsefulNameTail(t)) return true;
  if (looksLikeQualifierTail(t)) return false;
  if (looksLikeCoordinatedTail(t)) return false;

  return /[A-Za-zÀ-ÖØ-öø-ÿœ]/.test(t);
}

function looksLikeSafeBareIngredientName(line) {
  const t = normalizeOcrConfusions(line).toLowerCase();
  if (!t) return false;

  return /^(sel|poivre|thym|laurier|persil|coriandre|basilic|origan|paprika|curry|cumin|cannelle|huile de tournesol|huile d['’]olive)$/i.test(t);
}

function countMeasureTokens(line) {
  const t = normalizeOcrConfusions(line).toLowerCase();
  if (!t) return 0;

  const matches =
    (t.match(/(?:\d+\s+\d+\/\d+|\d+\/\d+|½|⅓|⅔|¼|¾|\d+(?:[.,]\d+)?)\s*(?:càc|càs|g|kg|mg|ml|cl|dl|l)\b/g) || []).length +
    (t.match(/(?:\d+\s+\d+\/\d+|\d+\/\d+|½|⅓|⅔|¼|¾|\d+(?:[.,]\d+)?)\s+(?:pincée|gousse|gousses|sachet|sachets)\b/g) || []).length;

  return matches;
}

function looksPollutedMultiIngredientLineLocal(line) {
  const t = normalizeOcrConfusions(line).toLowerCase();
  if (!t) return false;

  const measureHits = countMeasureTokens(t);
  const wordCount = t.split(/\s+/).filter(Boolean).length;

  if (measureHits >= 2) return true;

  const hasIngredientSeparator =
    /\b(et|ou)\b/.test(t) ||
    /,/.test(t) ||
    /\//.test(t);

  const hasMultipleIngredientChunks =
    /\bde\s+[a-zà-öø-ÿœ' -]{2,}\s+(?:de|du|des|d['’])\s+[a-zà-öø-ÿœ' -]{2,}/i.test(t);

  if (measureHits === 1 && wordCount >= 7 && (hasIngredientSeparator || hasMultipleIngredientChunks)) {
    return true;
  }

  return false;
}

function looksLikeStrongParsedIngredient(line) {
  const parsed = parseOcrIngredient(line);
  if (!parsed) return false;

  const name = normSpaces(parsed.name || '');
  const qty = Number(parsed.quantity || 0);
  const unit = String(parsed.unit || '').trim().toLowerCase();

  if (!name) return false;
  if (looksLikeGarbageFragment(name)) return false;
  if (/^(de|du|des|d['’]|jus de|i pincee de|1 pincee de|pincee de|pincée de)$/i.test(name)) return false;
  if (/^[a-z]$/i.test(name)) return false;
  if (/^\d+$/.test(name)) return false;
  if (looksLikeLooseQualifier(name)) return false;

  if (!qty && !unit) return false;

  if (/^(sauce burger|sauce cheddar)$/i.test(name.toLowerCase())) return false;

  return true;
}

function looksLikeBadParsedIngredient(line) {
  const parsed = parseOcrIngredient(line);
  if (!parsed) return false;

  const name = normSpaces(parsed.name || '');
  if (!name) return true;

  if (/^(de|du|des|d['’]|jus de|i pincee de|1 pincee de|pincee de|pincée de)$/i.test(name)) return true;
  if (/^[a-z]$/i.test(name)) return true;
  if (/^\d+$/.test(name)) return true;
  if (looksLikeLooseQualifier(name)) return true;

  return false;
}

function explainCandidateRejection(text) {
  const t = normalizeOcrConfusions(text);
  if (!t) return 'empty';

  if (looksLikeUiNoise(t)) return 'ui_noise';
  if (looksLikeTitleOrBrandNoise(t)) return 'title_or_brand_noise';
  if (looksLikeGarbageFragment(t)) return 'garbage_fragment';
  if (looksLikeMeasureOnlyFragment(t)) return 'measure_only_fragment';
  if (looksLikeConnectorFragmentLocal(t)) return 'connector_only_fragment';
  if (looksLikeLooseQualifier(t)) return 'loose_qualifier';
  if (looksPollutedMultiIngredientLineLocal(t)) return 'polluted_multi_ingredient_line';

  const parsed = parseOcrIngredient(t);
  if (!parsed) return 'parse_failed';

  if (!parsed.name) return 'parsed_without_name';
  if (looksLikeBadParsedIngredient(t)) return 'bad_parsed_ingredient';

  return 'accepted';
}

function splitPollutedLine(line) {
  let s = normalizeOcrConfusions(line);
  if (!s) return [];

  s = s.replace(/\b(citron)\s+(\d+(?:[.,]\d+)?\s*(?:g|kg|mg|ml|cl|dl|l)\b)/gi, '$1 || $2');
  s = s.replace(/(\s)(\d+(?:[.,]\d+)?\s*(?:g|kg|mg|ml|cl|dl|l)\b)/gi, ' || $2');
  s = s.replace(/(\s)((?:\d+\s+\d+\/\d+|\d+\/\d+|½|¼|¾|\d+(?:[.,]\d+)?)\s*(?:càc|càs|cac|cas))\b/gi, ' || $2');
  s = s.replace(/(\s)(\d+(?:[.,]\d+)?\s+(?:pincée|gousse|gousses|sachet|sachets)\b)/gi, ' || $2');

  s = s.replace(/\b(mayonnaise)\s+(ketchup)\b/gi, '$1 || $2');
  s = s.replace(/\b(cornichons)\s+(de\s+paprika)\b/gi, '$1 || $2');
  s = s.replace(/\b(paprika)\s+(poudre d['’]oignon)\b/gi, '$1 || $2');
  s = s.replace(/\b(poudre d['’]oignon)\s+(poudre d['’]ail)\b/gi, '$1 || $2');
  s = s.replace(/\b(doux)\s+(et)\s+(poudre d['’]ail)\b/gi, '$1 || $2 $3');

  return s
    .split('||')
    .map((x) => normSpaces(x))
    .filter(Boolean)
    .filter((x) => !/^(sauce burger|sauce cheddar)$/i.test(x));
}

function connectorIngredientCompatibilityScore(connector, name) {
  const c = normalizeOcrConfusions(connector).toLowerCase();
  const n = normalizeOcrConfusions(name).toLowerCase();

  if (!c || !n) return 0;

  if (/^(jus|zeste|pulpe)\s+de$/i.test(c)) {
    if (/\b(citron|citron vert|lime|orange|pamplemousse|mandarine|cl[ée]mentine)\b/i.test(n)) {
      return 10;
    }

    if (/\b(moutarde|sucre|paprika|cornichons?|mayonnaise|ketchup|oignon|ail)\b/i.test(n)) {
      return -12;
    }

    return -4;
  }

  return 0;
}

function resolveStandaloneConnectorIngredient(lines, startIndex, usedIndexes = new Set()) {
  const cur = normalizeOcrConfusions(lines[startIndex] || '');
  if (!cur) return null;
  if (usedIndexes.has(startIndex)) return null;

  if (!/^(jus|zeste|pulpe)\s+de$/i.test(cur)) return null;

  let best = null;

  for (let j = startIndex + 1; j < Math.min(lines.length, startIndex + 6); j++) {
    if (usedIndexes.has(j)) continue;

    const next = normalizeOcrConfusions(lines[j] || '');
    if (!next) continue;
    if (!looksLikeIngredientNameOnlyLocal(next)) continue;

    const candidate = normSpaces(`${cur} ${next}`);

    let score = 18;
    score += connectorIngredientCompatibilityScore(cur, next);

    if (j === startIndex + 1) score += 4;
    if (next.split(/\s+/).length <= 2) score += 2;

    score -= Math.max(0, j - startIndex - 1);

    flog('[FRAG][STANDALONE][CANDIDATE]', {
      startIndex,
      nextIndex: j,
      candidate,
      score,
    });

    if (!best || score > best.score) {
      best = {
        text: candidate,
        indexes: [startIndex, j],
        score,
      };
    }
  }

  flog('[FRAG][STANDALONE][SCAN]', {
    startIndex,
    cur,
    best,
  });

  if (best && best.score >= 20) return best;
  return null;
}

function collectNameOptionsInRange(lines, start, end, excludeIndex = -1) {
  const out = [];

  for (let j = start; j <= end && j < lines.length; j++) {
    if (j < 0 || j === excludeIndex) continue;

    const cur = normalizeOcrConfusions(lines[j] || '');
    if (!cur) continue;
    if (looksLikeUiNoise(cur)) continue;
    if (looksLikeTitleOrBrandNoise(cur)) continue;

    if (/^(de|du|des|d['’])$/i.test(cur)) {
      const next = normalizeOcrConfusions(lines[j + 1] || '');
      if (next && j + 1 <= end && j + 1 !== excludeIndex && looksLikeIngredientNameOnlyLocal(next)) {
        out.push({
          text: `${cur} ${next}`,
          start: j,
          end: j + 1,
        });
      }
      continue;
    }

    if (/^(de|du|des|d['’])\s+.+$/i.test(cur) || looksLikeIngredientNameOnlyLocal(cur)) {
      out.push({
        text: cur,
        start: j,
        end: j,
      });
    }
  }

  const uniq = [];
  const seen = new Set();

  for (const opt of out) {
    const key = normalizeOcrConfusions(opt.text).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    uniq.push(opt);
  }

  return uniq;
}

function hasBlockingContentBetweenMeasures(lines, start, end) {
  for (let i = start; i <= end && i < lines.length; i++) {
    const cur = normalizeOcrConfusions(lines[i] || '');
    if (!cur) continue;

    if (looksLikeUiNoise(cur)) continue;
    if (looksLikeTitleOrBrandNoise(cur)) continue;

    if (looksLikeStrongParsedIngredient(cur)) return true;
    if (/^(jus|zeste|pulpe)\s+de$/i.test(cur)) return true;
  }

  return false;
}

function previousMeaningfulIndex(lines, startIndex, maxLookBack = 3) {
  const min = Math.max(0, startIndex - maxLookBack);

  for (let i = startIndex; i >= min; i--) {
    const t = normalizeOcrConfusions(lines[i] || '');
    if (!t) continue;
    if (looksLikeUiNoise(t)) continue;
    if (looksLikeTitleOrBrandNoise(t)) continue;
    return i;
  }

  return -1;
}

function looksLikeCitrusName(line) {
  const t = normalizeOcrConfusions(line).toLowerCase();
  if (!t) return false;
  return /\b(citron|citron vert|lime|orange|pamplemousse)\b/.test(t);
}

function countMeasuresBetween(lines, start, end) {
  let count = 0;

  for (let i = start; i <= end && i < lines.length; i++) {
    const t = normalizeOcrConfusions(lines[i] || '');
    if (!t) continue;
    if (looksLikeMeasureOnlyFragment(t)) count++;
  }

  return count;
}

function resolveDualMeasureWindow(lines, startIndex) {
  const m1 = normalizeOcrConfusions(lines[startIndex] || '');
  if (!looksLikeMeasureOnlyFragment(m1)) return null;

  const i2 = findNextMeasureIndex(lines, startIndex + 1, 6);
  if (i2 < 0) return null;

  const m2 = normalizeOcrConfusions(lines[i2] || '');
  if (!looksLikeMeasureOnlyFragment(m2)) return null;

  if (hasBlockingContentBetweenMeasures(lines, startIndex + 1, i2 - 1)) {
    flog('[FRAG][DUAL][BEST]', {
      startIndex,
      m1,
      m2,
      best: null,
      reason: 'blocking_content_between_measures',
    });
    return null;
  }

  const leftOptions = collectNameOptionsInRange(lines, startIndex + 1, i2 - 1, i2);
  const rightOptions = collectNameOptionsInRange(lines, i2 + 1, Math.min(lines.length - 1, i2 + 4), -1);

  if (!leftOptions.length || !rightOptions.length) {
    flog('[FRAG][DUAL][BEST]', {
      startIndex,
      m1,
      m2,
      best: null,
      reason: 'missing_left_or_right_options',
      leftOptions,
      rightOptions,
    });
    return null;
  }

  let best = null;

  for (const left of leftOptions) {
    for (const right of rightOptions) {
      const beforeWindowIdx = previousMeaningfulIndex(lines, startIndex - 1, 4);
      const beforeWindowText =
        beforeWindowIdx >= 0 ? normalizeOcrConfusions(lines[beforeWindowIdx] || '') : '';

      if (/^(jus|zeste|pulpe)\s+de$/i.test(beforeWindowText) && looksLikeCitrusName(right.text)) {
        flog('[FRAG][DUAL][SKIP_RIGHT_CITRUS_AFTER_CONNECTOR]', {
          startIndex,
          measure1: m1,
          measure2: m2,
          beforeWindowText,
          right: right.text,
        });
        continue;
      }

      const t1 = buildIngredientTextFromMeasureAndName(m1, left.text);
      const t2 = buildIngredientTextFromMeasureAndName(m2, right.text);

      if (!t1 || !t2) continue;
      if (looksLikeBadParsedIngredient(t1) || looksLikeBadParsedIngredient(t2)) continue;

      const p1 = parseOcrIngredient(t1);
      const p2 = parseOcrIngredient(t2);

      if (!p1 || !p2 || !p1.name || !p2.name) continue;

      let score =
        measureNameCompatibilityScore(m1, left.text) +
        measureNameCompatibilityScore(m2, right.text) +
        12;

      if (left.start === startIndex + 1) score += 3;
      if (right.start === i2 + 1) score += 3;

      flog('[FRAG][DUAL][PAIR]', {
        startIndex,
        measure1: m1,
        measure2: m2,
        left: left.text,
        right: right.text,
        t1,
        t2,
        score,
      });

      if (!best || score > best.score) {
        best = {
          score,
          texts: [t1, t2],
          consume: Math.max(left.end, right.end, i2) - startIndex + 1,
        };
      }
    }
  }

  flog('[FRAG][DUAL][BEST]', {
    startIndex,
    m1,
    m2,
    best,
  });

  return best;
}

function buildBestLocalIngredientCandidate(lines, startIndex) {
  const cur = normalizeOcrConfusions(lines[startIndex] || '');
  if (!cur || !looksLikeMeasureOnlyFragment(cur)) return null;

  const i1 = nextMeaningfulIndex(lines, startIndex + 1, 3);
  const i2 = i1 >= 0 ? nextMeaningfulIndex(lines, i1 + 1, 3) : -1;

  const next = i1 >= 0 ? normalizeOcrConfusions(lines[i1] || '') : '';
  const next2 = i2 >= 0 ? normalizeOcrConfusions(lines[i2] || '') : '';

  const nextIsMeasure = next && looksLikeMeasureOnlyFragment(next);
  const next2IsMeasure = next2 && looksLikeMeasureOnlyFragment(next2);

  const candidates = [];

  // 1) mesure + "de sucre"
  if (next && /^(de|du|des|d['’])\s+.+$/i.test(next)) {
    const text = buildIngredientTextFromMeasureAndName(cur, next);
    if (text) {
      const enriched = enrichIngredientWithFollowingTails(lines, [startIndex, i1], text);
      candidates.push({
        text: enriched.text,
        indexes: enriched.indexes,
        score: 14 + measureNameCompatibilityScore(cur, next) + enriched.bonus,
      });
    }
  }

  // 2) mesure + "de" + nom
  if (
    next &&
    /^(de|du|des|d['’])$/i.test(next) &&
    next2 &&
    looksLikeIngredientNameOnlyLocal(next2)
  ) {
    const mergedName = `${next} ${next2}`;
    const text = buildIngredientTextFromMeasureAndName(cur, mergedName);
    if (text) {
      const enriched = enrichIngredientWithFollowingTails(lines, [startIndex, i1, i2], text);
      candidates.push({
        text: enriched.text,
        indexes: enriched.indexes,
        score: 16 + measureNameCompatibilityScore(cur, next2) + enriched.bonus,
      });
    }
  }

  // 3) mesure + nom simple
  if (next && looksLikeIngredientNameOnlyLocal(next) && !nextIsMeasure) {
    let score = 12 + measureNameCompatibilityScore(cur, next);

    const prevIdx = previousMeaningfulIndex(lines, startIndex - 1, 3);
    const prev = prevIdx >= 0 ? normalizeOcrConfusions(lines[prevIdx] || '') : '';

    if (/^(jus|zeste|pulpe)\s+de$/i.test(prev) && looksLikeCitrusName(next)) {
      score -= 20;
    }

    if (next2 && /^(de|du|des|d['’])\s+.+$/i.test(next2)) {
      score -= 4;
    }

    const text = buildIngredientTextFromMeasureAndName(cur, next);
    if (text) {
      const enriched = enrichIngredientWithFollowingTails(lines, [startIndex, i1], text);
      candidates.push({
        text: enriched.text,
        indexes: enriched.indexes,
        score: score + enriched.bonus,
      });
    }
  }

  // 4) mesure + fragment connector-led suivant nettoyé
  if (next2 && /^(de|du|des|d['’])\s+.+$/i.test(next2)) {
    const cleanedNext2 = cleanConnectorLedName(next2);

    if (cleanedNext2 && looksLikeIngredientNameOnlyLocal(cleanedNext2)) {
      const text = buildIngredientTextFromMeasureAndName(cur, cleanedNext2);
      if (text) {
        const enriched = enrichIngredientWithFollowingTails(lines, [startIndex, i2], text);
        candidates.push({
          text: enriched.text,
          indexes: enriched.indexes,
          score: 13 + measureNameCompatibilityScore(cur, cleanedNext2) + enriched.bonus,
        });
      }
    }
  }

  // 5) chercher un nom simple un peu plus loin si les premiers éléments sont du bruit structurel
  if (!nextIsMeasure && !next2IsMeasure) {
    for (let j = startIndex + 1; j < Math.min(lines.length, startIndex + 5); j++) {
      const cand = normalizeOcrConfusions(lines[j] || '');
      if (!cand) continue;

      if (!looksLikeIngredientNameOnlyLocal(cand)) continue;
      if (looksLikeCitrusName(cand)) continue;

      let score = 9 + measureNameCompatibilityScore(cur, cand);
      score -= (j - (startIndex + 1)) * 2;

      const measuresBetween = countMeasuresBetween(lines, startIndex + 1, j - 1);
      score -= measuresBetween * 8;

      const text = buildIngredientTextFromMeasureAndName(cur, cand);
      if (text) {
        const enriched = enrichIngredientWithFollowingTails(lines, [startIndex, j], text);
        candidates.push({
          text: enriched.text,
          indexes: enriched.indexes,
          score: score + enriched.bonus,
        });
      }
    }
  }

  if (!candidates.length) return null;

  flog('[FRAG][LOCAL][SCAN]', {
    startIndex,
    cur,
    next,
    next2,
    candidates,
  });

  candidates.sort((a, b) => b.score - a.score);

  const best = candidates[0];
  const parsed = parseOcrIngredient(best.text);
  const rejection = !parsed || !parsed.name
    ? 'parse_failed'
    : looksLikeBadParsedIngredient(best.text)
      ? 'bad_parsed_ingredient'
      : null;

  flog('[FRAG][LOCAL][BEST]', {
    startIndex,
    best,
    parsed,
    rejection,
  });

  if (!parsed || !parsed.name) return null;
  if (looksLikeBadParsedIngredient(best.text)) return null;

  return best;
}

function splitDoubleMeasureLine(line) {
  const t = normalizeOcrConfusions(line);
  if (!t) return [];

  if (countMeasureTokens(t) < 2) return [t];

  let s = t;
  s = s.replace(
    /((?:\d+\s+\d+\/\d+|\d+\/\d+|½|¼|¾|\d+(?:[.,]\d+)?)\s*(?:càc|càs|g|kg|mg|ml|cl|dl|l|pincée))\s+(?=(?:1|I|½|¼|¾|\d))/gi,
    '$1 || '
  );

  return s
    .split('||')
    .map((x) => normSpaces(x))
    .filter(Boolean);
}

function preprocessFragmentedLines(lines) {
  const out = [];

  for (const raw of normalizeLines(lines)) {
    let normalized = normalizeOcrConfusions(raw);
    if (!normalized) continue;

    normalized = normalized
      .replace(/\b(citron)\s+(\d+(?:[.,]\d+)?\s*(?:g|kg|mg|ml|cl|dl|l)\b)/gi, '$1 || $2')
      .replace(/\b(ketchup)\s+(1\s*càc\b)/gi, '$1 || $2')
      .replace(/\b(mayonnaise)\s+(ketchup)\b/gi, '$1 || $2')
      .replace(/\b(cornichons)\s+(de\s+paprika)\b/gi, '$1 || $2')
      .replace(/\b(paprika)\s+(poudre d['’]oignon)\b/gi, '$1 || $2')
      .replace(/\b(oignon)\s+(poudre d['’]ail)\b/gi, '$1 || $2')
      .replace(/\b(1\/2\s*càc)\s+(1\s*pincée)\b/gi, '$1 || $2');

    const primaryChunks = normalized
      .split('||')
      .map((x) => normSpaces(x))
      .filter(Boolean);

    for (const primary of primaryChunks) {
      const firstSplit = splitDoubleMeasureLine(primary);

      for (const chunk of firstSplit) {
        if (!chunk) continue;

        if (looksPollutedMultiIngredientLineLocal(chunk) || countMeasureTokens(chunk) >= 2) {
          out.push(...splitPollutedLine(chunk));
        } else {
          out.push(chunk);
        }
      }
    }
  }

  flog('[FRAG][PREPROCESS][IN]', normalizeLines(lines));
  flog('[FRAG][PREPROCESS][OUT]', out);

  const cleaned = dedupeLinesPreservingCriticalFragments(out);
  flog('[FRAG][PREPROCESS][STRONG_STANDALONE]', cleaned.filter(looksLikeStrongStandaloneIngredient));

  return cleaned;
}

function joinMeasureAndNameFragments(lines) {
  const out = [];
  const L = preprocessFragmentedLines(lines);
  const used = new Set();

  // PASS 0 : on protège uniquement les ingrédients déjà complets, parseables, et non bruités
  for (let i = 0; i < L.length; i++) {
    const cur = normalizeOcrConfusions(L[i] || '');
    if (!cur) continue;

    if (looksLikeUiNoise(cur)) continue;
    if (looksLikeTitleOrBrandNoise(cur)) continue;
    if (looksLikeGarbageFragment(cur)) continue;
    if (looksLikeMeasureOnlyFragment(cur)) continue;
    if (looksLikeConnectorFragmentLocal(cur)) continue;

    if (looksLikeStrongStandaloneIngredient(cur)) {
      const enriched = enrichIngredientWithFollowingTails(L, [i], cur);

      out.push(normalizeFragmentedIngredientLine(enriched.text));

      for (const idx of enriched.indexes || [i]) {
        used.add(idx);
      }

      flog('[FRAG][JOIN][PASS0_STRONG_ACCEPT]', {
        index: i,
        text: cur,
        enriched: enriched.text,
      });
    }
  }

  // PASS 1 : fenêtres à double mesure
  for (let i = 0; i < L.length; i++) {
    if (used.has(i)) continue;

    const cur = normalizeOcrConfusions(L[i] || '');
    if (!cur) continue;
    if (!looksLikeMeasureOnlyFragment(cur)) continue;

    const dual = resolveDualMeasureWindow(
      L.map((x, idx) => (used.has(idx) ? '' : x)),
      i
    );

    if (dual) {
      flog('[FRAG][JOIN][PASS1_DUAL_ACCEPT]', {
        texts: dual.texts,
        consume: dual.consume,
        startIndex: i,
      });

      for (const text of dual.texts) {
        if (!looksLikeBadParsedIngredient(text)) {
          out.push(text);
        }
      }

      for (let k = i; k < i + dual.consume; k++) {
        used.add(k);
      }
    }
  }

  // PASS 2 : reconstruction locale simple
  for (let i = 0; i < L.length; i++) {
    if (used.has(i)) continue;

    const cur = normalizeOcrConfusions(L[i] || '');
    if (!cur) continue;

    const masked = L.map((x, idx) => (used.has(idx) ? '' : x));
    const built = buildBestLocalIngredientCandidate(masked, i);

    if (built) {
      flog('[FRAG][JOIN][PASS2_LOCAL_ACCEPT]', {
        text: built.text,
        consume: built.indexes,
        startIndex: i,
      });

      if (!looksLikeBadParsedIngredient(built.text)) {
        out.push(built.text);
      }

      for (const idx of built.indexes || []) {
        used.add(idx);
      }
      continue;
    }

    if (looksLikeStrongParsedIngredient(cur) && !looksLikeBadParsedIngredient(cur)) {
      out.push(cur);
      used.add(i);
    }
  }

  // PASS 3 : ingrédients autonomes sans quantité
  for (let i = 0; i < L.length; i++) {
    if (used.has(i)) continue;

    const standalone = resolveStandaloneConnectorIngredient(L, i, used);
    if (standalone) {
      out.push(standalone.text);

      flog('[FRAG][JOIN][PASS3_STANDALONE_ACCEPT]', {
        text: standalone.text,
        indexes: standalone.indexes,
      });

      for (const idx of standalone.indexes) used.add(idx);
      continue;
    }

    const cur = normalizeOcrConfusions(L[i] || '');
    if (!cur) continue;

    if (looksLikeIngredientNameOnlyLocal(cur)) {

  const canSaveBareNameInFragmented =
    looksLikeSafeBareIngredientName(cur) &&
    !looksLikeContextOrStandaloneNoise(cur);

  if (canSaveBareNameInFragmented) {
    out.push(cur);
    used.add(i);

    flog('[FRAG][JOIN][PASS3_SAFE_BARE_ACCEPT]', {
      index: i,
      text: cur,
    });

    continue;
  }

  flog('[FRAG][JOIN][PASS3_NAME_REJECTED]', {
    index: i,
    text: cur,
    reason: 'bare_name_not_attached_to_measure',
  });

  continue;
}

    if (/^et\s+(poudre d['’]ail)$/i.test(cur)) {
      const fixed = cur.replace(/^et\s+/i, '');
      out.push(fixed);
      used.add(i);

      flog('[FRAG][JOIN][PASS3_TAIL_SALVAGE]', {
        index: i,
        text: fixed,
      });

      continue;
    }

    flog('[FRAG][JOIN][SKIP]', {
      index: i,
      cur,
      reason: explainCandidateRejection(cur),
    });
  }

  const cleanedOut = dedupeLines(
    out.filter((x) => {
      const t = normalizeFragmentedIngredientLine(x);
      if (!t) return false;
      if (looksLikeMeasureOnlyFragment(t)) return false;
      if (looksLikeConnectorFragmentLocal(t)) return false;
      if (looksLikeBadParsedIngredient(t)) return false;
      return true;
    })
  );

  flog('[FRAG][JOIN][FINAL_OUT]', cleanedOut);

  return cleanedOut;
}

function normalizeFragmentedIngredientLine(line) {
  let t = normalizeOcrConfusions(line);
  if (!t) return '';

  t = t.replace(/\bde\s+de\b/gi, 'de');
  t = t.replace(/\bcàc\s+de\s+de\b/gi, 'càc de');
  t = t.replace(/\bcàs\s+de\s+de\b/gi, 'càs de');

  t = t.replace(/\b1\s+pincée\s+de\s*$/i, '1 pincée');
  t = t.replace(/\bI\s+pincee\s+de\s*$/i, '1 pincée');
  t = t.replace(/\bI\s+pincée\s+de\s*$/i, '1 pincée');

  t = t.replace(/\bI\s+càc\b/gi, '1 càc');
  t = t.replace(/\bI\s+càs\b/gi, '1 càs');

  t = t.replace(/\b(1\/2|1|2|3|4|5)\s*càc(?=de\b)/gi, '$1 càc ');
  t = t.replace(/\b(1\/2|1|2|3|4|5)\s*càs(?=de\b)/gi, '$1 càs ');

  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

function extractFragmentedIngredientLines(lines) {
  const joined = joinMeasureAndNameFragments(lines);

  return removeShorterIncludedDuplicateSameMeasure(
    joined
    .map(normalizeFragmentedIngredientLine)
    .filter(Boolean)
  );
}

function scoreIngredientExtraction(lines) {
  const L = dedupeLines(lines);

  let strongParsed = 0;
  let weakParsed = 0;
  let parsedWithQty = 0;
  let suspicious = 0;
  let fragments = 0;
  let polluted = 0;
  let looseNames = 0;

  for (const line of L) {
    if (looksLikeLooseQualifier(line)) {
      suspicious += 2;
      continue;
    }

    if (looksLikeMeasureOnlyFragment(line) || looksLikeConnectorFragmentLocal(line)) {
      fragments++;
      continue;
    }

    if (looksPollutedMultiIngredientLineLocal(line)) {
      polluted++;
      continue;
    }

    const parsed = parseOcrIngredient(line);

    if (parsed) {
      if (looksLikeBadParsedIngredient(line)) {
        suspicious += 2;
        continue;
      }

      if (looksLikeStrongParsedIngredient(line)) {
        strongParsed++;
        if (parsed.quantity || parsed.unit) parsedWithQty++;
      } else {
        weakParsed++;
        suspicious++;
      }
      continue;
    }

    if (looksLikeIngredientNameOnlyLocal(line)) {
      looseNames += 2;
      continue;
    }

    suspicious++;
  }

  const score =
    strongParsed * 18 +
    parsedWithQty * 10 -
    weakParsed * 12 -
    suspicious * 10 -
    fragments * 10 -
    polluted * 12 -
    looseNames * 12;

  return {
    total: L.length,
    strongParsed,
    weakParsed,
    parsedWithQty,
    suspicious,
    fragments,
    polluted,
    looseNames,
    score,
  };
}

function chooseBestIngredientLines({ standardLines, fragmentedLines }) {
  const standard = dedupeLines(standardLines || []);
  const fragmented = dedupeLines(fragmentedLines || []);

  const standardScore = scoreIngredientExtraction(standard);
  const fragmentedScore = scoreIngredientExtraction(fragmented);

  // garde-fou : ne jamais préférer un résultat vide s'il existe un standard non vide
  if (!fragmented.length && standard.length) {
    return {
      chosen: standard,
      chosenSource: 'standard',
      standardScore,
      fragmentedScore,
    };
  }

  const fragmentedClearlyRecoversMore =
    fragmentedScore.strongParsed >= standardScore.strongParsed + 2 ||
    fragmentedScore.parsedWithQty >= standardScore.parsedWithQty + 2;

  const fragmentedCleanerAtEquivalentLevel =
    fragmentedScore.strongParsed >= standardScore.strongParsed &&
    fragmentedScore.parsedWithQty >= standardScore.parsedWithQty &&
    fragmentedScore.suspicious < standardScore.suspicious;

  const fragmentedMuchBetterByScore =
    fragmented.length > 0 &&
    fragmentedScore.score >= standardScore.score + 8;

  const chooseFragmented =
    fragmented.length > 0 &&
    (
      fragmentedClearlyRecoversMore ||
      fragmentedCleanerAtEquivalentLevel ||
      fragmentedMuchBetterByScore
    );

  return {
    chosen: chooseFragmented ? fragmented : standard,
    chosenSource: chooseFragmented ? 'fragmented' : 'standard',
    standardScore,
    fragmentedScore,
  };
}
function normalizeSpatialHintText(hint) {
  if (!hint) return '';

  let t = normSpaces(hint);

  t = t.replace(/\bc\.?\s*a\.?\s*c\.?\b/gi,'càc');
  t = t.replace(/\bc\.?\s*a\.?\s*s\.?\b/gi,'càs');
  t = t.replace(/\bpincee\b/gi,'pincée');

  return normSpaces(t);
}

function isStrongSpatialIngredient(line) {

  if (!line) return false;

  const parsed = parseOcrIngredient(line);

  if (!parsed || !parsed.name)
    return false;

  const hasQty =
    parsed.quantity !== null &&
    parsed.quantity !== undefined &&
    parsed.quantity !== 0;

  const hasUnit =
    !!String(parsed.unit || '').trim();

  return hasQty && hasUnit;
}

function mergeSpatialHints(fragmented, spatialHints) {

  const base =
    Array.isArray(fragmented)
      ? [...fragmented]
      : [];

  const spatial =
    Array.isArray(spatialHints)
      ? spatialHints
      : [];

  const normalizedSpatial =
    spatial
      .map(normalizeSpatialHintText)
      .filter(Boolean);

  for (const hint of normalizedSpatial) {

    if (!isStrongSpatialIngredient(hint))
      continue;

    const alreadyPresent =
      base.some(l =>
        normSpaces(l).toLowerCase() ===
        normSpaces(hint).toLowerCase()
      );

    if (!alreadyPresent) {
      base.push(hint);
    }
  }

  return base;
}

function normalizedIngredientName(line){

  const parsed =
    parseOcrIngredient(line);

  if (!parsed || !parsed.name)
    return '';

  return normSpaces(parsed.name)
    .toLowerCase();
}

function hasStrongQtyUnit(line){

  const parsed =
    parseOcrIngredient(line);

  if (!parsed) return false;

  const hasQty =
    parsed.quantity !== null &&
    parsed.quantity !== undefined &&
    parsed.quantity !== 0;

  const hasUnit =
    !!String(parsed.unit || '').trim();

  return hasQty && hasUnit;
}

function removeShorterIncludedDuplicateSameMeasure(lines) {
  const source = Array.isArray(lines) ? lines : [];
  const out = [];

  for (const line of source) {
    const parsed = parseOcrIngredient(line);

    if (!parsed || !parsed.name) {
      out.push(line);
      continue;
    }

    const name = normSpaces(parsed.name).toLowerCase();
    const qty = Number(parsed.quantity || 0);
    const unit = String(parsed.unit || '').trim().toLowerCase();

    if (!name || !qty || !unit) {
      out.push(line);
      continue;
    }

    const strongerSameMeasure = source.find((other) => {
      if (normSpaces(other).toLowerCase() === normSpaces(line).toLowerCase()) {
        return false;
      }

      const otherParsed = parseOcrIngredient(other);
      if (!otherParsed || !otherParsed.name) return false;

      const otherName = normSpaces(otherParsed.name).toLowerCase();
      const otherQty = Number(otherParsed.quantity || 0);
      const otherUnit = String(otherParsed.unit || '').trim().toLowerCase();

      if (otherQty !== qty) return false;
      if (otherUnit !== unit) return false;
      if (otherName === name) return false;

      return otherName.length > name.length && otherName.includes(name);
    });

    if (strongerSameMeasure) continue;

    out.push(line);
  }

  return dedupeLines(out);
}


function removeWeakerDuplicates(lines){

  const source =
    Array.isArray(lines)
      ? lines
      : [];

  const out = [];

  for (const line of source){

    const parsed =
      parseOcrIngredient(line);

    if (!parsed || !parsed.name){
      out.push(line);
      continue;
    }

    const currentName =
      normalizedIngredientName(line);

    if (!currentName){
      out.push(line);
      continue;
    }

    const sameName =
      source.filter(l =>
        normalizedIngredientName(l)
          === currentName
      );

    if (sameName.length <= 1){
      out.push(line);
      continue;
    }

    const stronger =
      sameName.find(l =>
        hasStrongQtyUnit(l)
      );

    if (
      stronger &&
      normSpaces(stronger).toLowerCase() !==
      normSpaces(line).toLowerCase()
    ){
      continue;
    }

    out.push(line);
  }

  return removeShorterIncludedDuplicateSameMeasure(
    Array.from(
      new Set(
        out.map((x) => normSpaces(x))
      )
    )
  );
}

module.exports = {
  extractFragmentedIngredientLines,
  chooseBestIngredientLines,
  mergeSpatialHints,
  removeWeakerDuplicates
};