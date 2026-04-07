// backend/src/utils/ocrFragmentedIngredients.js
// reconstruire lignes ingredients depuis des fragments
// scorer la qualite de cette reconstruction
// LEVEL: UTIL (OCR text parsing)
// import autorisés : utils (stringUtils, units, heuristics, ingredientParser, ocrTitle)
// import interdits : routes, middleware, services (vision/supabase), prisma/lib, parsers sites
// importé par : routes import-ocr (ou services OCR), et autres utils

'use strict';

const { normSpaces } = require('../utils/stringUtils');
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
const DEBUG_FRAGMENTED = process.env.OCR_DEBUG !== 'production';
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

function looksLikeIngredientNameOnlyLocal(line) {
  const t = normalizeOcrConfusions(line);
  const low = t.toLowerCase();

  if (!t) return false;

  if (parseOcrIngredient(t)) return false;
  if (looksLikeMeasureOnlyFragment(t)) return false;
  if (looksLikeConnectorFragmentLocal(t)) return false;
  if (looksLikeLooseQualifier(t)) return false;
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

  return /[A-Za-zÀ-ÖØ-öø-ÿœ]/.test(t);
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

function resolveStandaloneConnectorIngredient(lines, startIndex, usedIndexes = new Set()) {
  const cur = normalizeOcrConfusions(lines[startIndex] || '');
  if (!cur) return null;
  if (usedIndexes.has(startIndex)) return null;

  if (!/^(jus|zeste|pulpe)\s+de$/i.test(cur)) return null;

  // Si une mesure arrive immédiatement après, on ne traite PAS ce connecteur
  // comme un ingrédient autonome.
  // Exemple: "Jus de" puis "1 càc de" puis "moutarde" => ne pas fabriquer "Jus de moutarde".
  if (findNextMeasureIndex(lines, startIndex + 1, 2) >= 0) return null;

  let best = null;

  for (let j = startIndex + 1; j < Math.min(lines.length, startIndex + 4); j++) {
    if (usedIndexes.has(j)) continue;

    const next = normalizeOcrConfusions(lines[j] || '');
    if (!next) continue;
    if (!looksLikeIngredientNameOnlyLocal(next)) continue;

    const candidate = normSpaces(`${cur} ${next}`);
    const score =
      20 +
      (j === startIndex + 1 ? 4 : 0) +
      (next.split(/\s+/).length <= 2 ? 2 : 0);

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

  return best;
}

function resolveDualMeasureWindow(lines, startIndex) {
  const m1 = normalizeOcrConfusions(lines[startIndex] || '');
  if (!looksLikeMeasureOnlyFragment(m1)) return null;

  const i2 = findNextMeasureIndex(lines, startIndex + 1, 6);
  if (i2 < 0) return null;

  const m2 = normalizeOcrConfusions(lines[i2] || '');
  if (!looksLikeMeasureOnlyFragment(m2)) return null;

  const nameOptions = [];
  const endScan = Math.min(lines.length, i2 + 4);

  for (let j = startIndex + 1; j < endScan; j++) {
    if (j === i2) continue;

    const cur = normalizeOcrConfusions(lines[j] || '');
    if (!cur) continue;
    if (looksLikeUiNoise(cur)) continue;
    if (looksLikeTitleOrBrandNoise(cur)) continue;

    if (/^(de|du|des|d['’])$/i.test(cur)) {
      const next = normalizeOcrConfusions(lines[j + 1] || '');
      if (next && j + 1 !== i2 && looksLikeIngredientNameOnlyLocal(next)) {
        nameOptions.push({
          text: `${cur} ${next}`,
          start: j,
          end: j + 1,
        });
      }
      continue;
    }

    if (/^(de|du|des|d['’])\s+.+$/i.test(cur) || looksLikeIngredientNameOnlyLocal(cur)) {
      nameOptions.push({
        text: cur,
        start: j,
        end: j,
      });
    }
  }

  const uniq = [];
  const seen = new Set();

  for (const opt of nameOptions) {
    const key = normalizeOcrConfusions(opt.text).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    uniq.push(opt);
  }

  if (uniq.length < 2) return null;

  let best = null;

  for (let a = 0; a < uniq.length; a++) {
    for (let b = 0; b < uniq.length; b++) {
      if (a === b) continue;

      const left = uniq[a];
      const right = uniq[b];

      const t1 = buildIngredientTextFromMeasureAndName(m1, left.text);
      const t2 = buildIngredientTextFromMeasureAndName(m2, right.text);

      if (!t1 || !t2) continue;
      if (looksLikeBadParsedIngredient(t1) || looksLikeBadParsedIngredient(t2)) continue;

      const p1 = parseOcrIngredient(t1);
      const p2 = parseOcrIngredient(t2);

      if (!p1 || !p2 || !p1.name || !p2.name) continue;

      const score =
        measureNameCompatibilityScore(m1, left.text) +
        measureNameCompatibilityScore(m2, right.text) +
        10;

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

  const candidates = [];

  // 1) mesure + "de sucre"
  if (next && /^(de|du|des|d['’])\s+.+$/i.test(next)) {
    const text = buildIngredientTextFromMeasureAndName(cur, next);
    if (text) {
      candidates.push({
        text,
        consume: i1 - startIndex + 1,
        score: 14 + measureNameCompatibilityScore(cur, next),
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
      candidates.push({
        text,
        consume: i2 - startIndex + 1,
        score: 16 + measureNameCompatibilityScore(cur, next2),
      });
    }
  }

  // 3) mesure + nom simple
  if (next && looksLikeIngredientNameOnlyLocal(next)) {
    let score = 12 + measureNameCompatibilityScore(cur, next);

    // Si derrière ce nom il y a un fragment "de lait", "de paprika", etc.,
    // on baisse la confiance: souvent le vrai nom est ce fragment suivant.
    if (next2 && /^(de|du|des|d['’])\s+.+$/i.test(next2)) {
      score -= 4;
    }

    const text = buildIngredientTextFromMeasureAndName(cur, next);
    if (text) {
      candidates.push({
        text,
        consume: i1 - startIndex + 1,
        score,
      });
    }
  }

  // 4) mesure + fragment connector-led suivant nettoyé
  // ex: "250 ml" + "cheddar" + "de lait" => préférer "250 ml de lait"
  // ex: "1 pincée de" + "cornichons" + "de paprika" => préférer "1 pincée de paprika"
  if (next2 && /^(de|du|des|d['’])\s+.+$/i.test(next2)) {
    const cleanedNext2 = cleanConnectorLedName(next2);

    if (cleanedNext2 && looksLikeIngredientNameOnlyLocal(cleanedNext2)) {
      const text = buildIngredientTextFromMeasureAndName(cur, cleanedNext2);
      if (text) {
        candidates.push({
          text,
          consume: i2 - startIndex + 1,
          score: 13 + measureNameCompatibilityScore(cur, cleanedNext2),
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

  return dedupeLinesPreservingCriticalFragments(out);
}

function joinMeasureAndNameFragments(lines) {
  const out = [];
  const L = preprocessFragmentedLines(lines);
  const used = new Set();

  // -------------------------------------------------
  // PASS 1 : fenêtres à double mesure
  // -------------------------------------------------
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

  // -------------------------------------------------
  // PASS 2 : reconstruction locale simple
  // -------------------------------------------------
  for (let i = 0; i < L.length; i++) {
    if (used.has(i)) continue;

    const cur = normalizeOcrConfusions(L[i] || '');
    if (!cur) continue;

    const masked = L.map((x, idx) => (used.has(idx) ? '' : x));
    const built = buildBestLocalIngredientCandidate(masked, i);

    if (built) {
      flog('[FRAG][JOIN][PASS2_LOCAL_ACCEPT]', {
        text: built.text,
        consume: built.consume,
        startIndex: i,
      });

      if (!looksLikeBadParsedIngredient(built.text)) {
        out.push(built.text);
      }

      for (let k = i; k < i + built.consume; k++) {
        used.add(k);
      }
      continue;
    }

    if (looksLikeStrongParsedIngredient(cur) && !looksLikeBadParsedIngredient(cur)) {
      out.push(cur);
      used.add(i);
    }
  }

  // -------------------------------------------------
  // PASS 3 : ingrédients autonomes sans quantité
  // -------------------------------------------------
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

    flog('[FRAG][JOIN][SKIP]', {
      index: i,
      cur,
      reason: explainCandidateRejection(cur),
    });
  }

  flog('[FRAG][JOIN][FINAL_OUT]', out);

  return dedupeLines(out);
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

  return dedupeLines(
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
      looseNames++;
      suspicious += 2;
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
    looseNames * 10;

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

  const fragmentedClearlyRecoversMore =
    fragmentedScore.strongParsed >= standardScore.strongParsed + 2 ||
    fragmentedScore.parsedWithQty >= standardScore.parsedWithQty + 2;

  const fragmentedCleanerAtEquivalentLevel =
    fragmentedScore.strongParsed >= standardScore.strongParsed &&
    fragmentedScore.parsedWithQty >= standardScore.parsedWithQty &&
    fragmentedScore.suspicious < standardScore.suspicious;

  const fragmentedMuchBetterByScore =
    fragmentedScore.score >= standardScore.score + 8;

  const chooseFragmented =
    fragmentedClearlyRecoversMore ||
    fragmentedCleanerAtEquivalentLevel ||
    fragmentedMuchBetterByScore;

  return {
    chosen: chooseFragmented ? fragmented : standard,
    chosenSource: chooseFragmented ? 'fragmented' : 'standard',
    standardScore,
    fragmentedScore,
  };
}

module.exports = {
  extractFragmentedIngredientLines,
  scoreIngredientExtraction,
  chooseBestIngredientLines,
  looksLikeBadParsedIngredient,
};