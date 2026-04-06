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

//ajouter le 06/04/26 - d'ici à
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
// ici

//ajouter le 06/04/26 - d'ici à
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

  return (
    /\b(lait|eau|huile|jus|vinaigre|cr[eè]me|creme|sauce|sirop)\b/i.test(t)
  );
}

function nameLooksWeightCompatible(line) {
  const t = normalizeOcrConfusions(line).toLowerCase();
  if (!t) return false;

  return (
    /\b(farine|beurre|cheddar|fromage|sucre|sel|poivre|paprika|oignon|ail|cornichons?)\b/i.test(t)
  );
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
//ici



//modifier le 06/04/26
function normalizeOcrConfusions(line) {
  let t = normSpaces(line);
  if (!t) return '';

  // I / l / | -> 1 devant une mesure
  t = t.replace(/^[I|l](?=\s*c\.?\s*a\.?\s*[sc])/i, '1');
  t = t.replace(/^[I|l](?=\s+(pincee|pincée|g|kg|mg|ml|cl|dl|l)\b)/i, '1');

  //ajoute le 06/04/26
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

  // "200 a de" -> "200 g de" (OCR classique g -> a)
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

//modifier le 06/04/26
function looksLikeConnectorFragmentLocal(line) {
  const t = normalizeOcrConfusions(line).toLowerCase();
  if (!t) return false;

  return (
    /^(jus|zeste|pulpe)\s+de$/i.test(t) ||
    /^(de|du|des|d['’])$/i.test(t) ||
    /^(de|du|des|d['’])\s+[a-zà-öø-ÿœ' -]{2,40}$/i.test(t)
  );
}

//modifier le 06/04/26
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

  if (
    /^(sauce|préparation|preparation|ingr[ée]dients?|etapes?|étapes?)$/i.test(low)
  ) {
    return false;
  }

  if (/^(de|du|des|d['’])\b/i.test(low)) return false;
  if (/^(et|ou)\b/i.test(low)) return false;

  // trop faible seul
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
  return measureHits >= 1 && t.split(/\s+/).length >= 4;
}


//modifie le 06/04/26
function looksLikeStrongParsedIngredient(line) {
  const parsed = parseOcrIngredient(line);
  if (!parsed) return false;

  const name = normSpaces(parsed.name || '');
  const qty = Number(parsed.quantity || 0);
  const unit = String(parsed.unit || '').trim().toLowerCase();

  if (!name) return false;
  if (looksLikeGarbageFragment(name)) return false;
  if (/^(de|du|des|d['’]|jus de|i pincee de|1 pincee de)$/i.test(name)) return false;
  if (/^[a-z]$/i.test(name)) return false;
  if (/^\d+$/.test(name)) return false;
  if (looksLikeLooseQualifier(name)) return false;

  if (!qty && !unit) return false;

  // si on a une unité mais un nom toxique, ce n'est pas "fort"
  if (/^(sauce burger|sauce cheddar)$/i.test(name.toLowerCase())) return false;

  return true;
}


function looksLikeBadParsedIngredient(line) {
  const parsed = parseOcrIngredient(line);
  if (!parsed) return false;

  const name = normSpaces(parsed.name || '');
  if (!name) return true;

  if (/^(de|du|des|d['’]|jus de|i pincee de|1 pincee de)$/i.test(name)) return true;
  if (/^[a-z]$/i.test(name)) return true;
  if (/^\d+$/.test(name)) return true;
  if (looksLikeLooseQualifier(name)) return true;

  return false;
}

//modifier le 06/04/26
function splitPollutedLine(line) {
  let s = normalizeOcrConfusions(line);
  if (!s) return [];

  // coupe avant nouvelle mesure visible
  s = s.replace(/\b(citron)\s+(\d+\s*(?:g|kg|mg|ml|cl|dl|l)\b)/gi, '$1 || $2');

  s = s.replace(/(\s)(\d+(?:[.,]\d+)?\s*(?:g|kg|mg|ml|cl|dl|l)\b)/gi, ' || $2');
  s = s.replace(/(\s)((?:\d+\s+\d+\/\d+|\d+\/\d+|½|¼|¾|\d+(?:[.,]\d+)?)\s*(?:càc|càs|cac|cas))\b/gi, ' || $2');
  s = s.replace(/(\s)(\d+(?:[.,]\d+)?\s+(?:pincée|gousse|gousses|sachet|sachets)\b)/gi, ' || $2');

  // séparations utiles
  s = s.replace(/\b(mayonnaise)\s+(ketchup)\b/gi, '$1 || $2');
  s = s.replace(/\b(paprika)\s+(poudre d['’]oignon)\b/gi, '$1 || $2');
  s = s.replace(/\b(doux)\s+(et)\s+(poudre d['’]ail)\b/gi, '$1 || $2 $3');

  // cheddar + lait : ne jamais garder ensemble après une mesure liquide
  s = s.replace(/\b([a-zà-öø-ÿœ' -]+)\s+(de lait)\b/gi, '$1 || $2');

  return s
    .split('||')
    .map((x) => normSpaces(x))
    .filter(Boolean);
}

//ajoute le 06/04/26 - d'ici à
function buildBestLocalIngredientCandidate(lines, startIndex) {
  const cur = normalizeOcrConfusions(lines[startIndex] || '');
  const next = normalizeOcrConfusions(lines[startIndex + 1] || '');
  const next2 = normalizeOcrConfusions(lines[startIndex + 2] || '');

  const candidates = [];

  if (!cur) return null;

  // mesure + "de nom"
  if (
    looksLikeMeasureOnlyFragment(cur) &&
    next &&
    /^(de|du|des|d['’])\s+.+$/i.test(next)
  ) {
    candidates.push({
      text: normSpaces(`${cur} ${next}`),
      consume: 2,
      score: 10 + measureNameCompatibilityScore(cur, next),
    });
  }

  // mesure + connecteur + nom
  if (
    looksLikeMeasureOnlyFragment(cur) &&
    next &&
    /^(de|du|des|d['’])$/i.test(next) &&
    next2 &&
    looksLikeIngredientNameOnlyLocal(next2)
  ) {
    candidates.push({
      text: normSpaces(`${cur} ${next} ${next2}`),
      consume: 3,
      score: 14 + measureNameCompatibilityScore(cur, next2),
    });
  }

  // mesure + nom
  if (
    looksLikeMeasureOnlyFragment(cur) &&
    next &&
    looksLikeIngredientNameOnlyLocal(next)
  ) {
    candidates.push({
      text: normSpaces(`${cur} ${next}`),
      consume: 2,
      score: 9 + measureNameCompatibilityScore(cur, next),
    });
  }

  // connecteur type "jus de" + nom
  if (
    looksLikeConnectorFragmentLocal(cur) &&
    next &&
    looksLikeIngredientNameOnlyLocal(next)
  ) {
    candidates.push({
      text: normSpaces(`${cur} ${next}`),
      consume: 2,
      score: 8,
    });
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0];
}
//ici

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

//modifier le 06/04/26
function preprocessFragmentedLines(lines) {
  const out = [];

  for (const raw of normalizeLines(lines)) {
    const normalized = normalizeOcrConfusions(raw);
    if (!normalized) continue;

    if (looksLikeGarbageFragment(normalized)) continue;

    const firstSplit = splitDoubleMeasureLine(normalized);

    for (const chunk of firstSplit) {
      const cleanChunk = normalizeOcrConfusions(chunk);
      if (!cleanChunk) continue;
      if (looksLikeGarbageFragment(cleanChunk)) continue;

      if (looksPollutedMultiIngredientLineLocal(cleanChunk) || countMeasureTokens(cleanChunk) >= 2) {
        const pieces = splitPollutedLine(cleanChunk);
        for (const piece of pieces) {
          const cleanPiece = normalizeOcrConfusions(piece);
          if (!cleanPiece) continue;
          if (looksLikeGarbageFragment(cleanPiece)) continue;
          out.push(cleanPiece);
        }
      } else {
        out.push(cleanChunk);
      }
    }
  }

  return dedupeLines(out);
}



//modifier le 06/04/26
function joinMeasureAndNameFragments(lines) {
  const out = [];
  const L = preprocessFragmentedLines(lines);

  let i = 0;

  while (i < L.length) {
    const cur = normalizeOcrConfusions(L[i] || '');
    if (!cur) {
      i += 1;
      continue;
    }

    const built = buildBestLocalIngredientCandidate(L, i);
    if (built) {
      out.push(built.text);
      i += built.consume;
      continue;
    }

    if (looksLikeStrongParsedIngredient(cur)) {
      out.push(cur);
      i += 1;
      continue;
    }

    i += 1;
  }

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

  // évite "càcde"
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

//modifie le 06/04/26
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
};