// backend/src/utils/ocrFragmentedIngredients.js
// reconstruire lignes ingredients depuis des fragments
// scorer la qualite de cette reconstruction

'use strict';

const { normSpaces } = require('../utils/stringUtils');
const { parseOcrIngredient } = require('../utils/ingredientParser');

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

function normalizeOcrConfusions(line) {
  let t = normSpaces(line);
  if (!t) return '';

  t = t.replace(/^I(?=\s*c\.?\s*a\.?\s*[sc])/i, '1');
  t = t.replace(/^I(?=\s+(pincee|pincée|g|kg|mg|ml|cl|dl|l)\b)/i, '1');

  t = t.replace(/\bpincee\b/gi, 'pincée');
  t = t.replace(/\bc\.a\.c\b/gi, 'càc');
  t = t.replace(/\bc\.a\.s\b/gi, 'càs');

  t = t.replace(/\bhaches\b/gi, 'hachés');
  t = t.replace(/\bhachees\b/gi, 'hachées');

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

function looksLikeConnectorFragmentLocal(line) {
  const t = normalizeOcrConfusions(line).toLowerCase();
  if (!t) return false;

  return (
    /^(jus|zeste|pulpe)\s+de$/i.test(t) ||
    /^(de|du|des|d['’])$/i.test(t)
  );
}

function looksLikeIngredientNameOnlyLocal(line) {
  const t = normalizeOcrConfusions(line);
  if (!t) return false;

  if (parseOcrIngredient(t)) return false;
  if (looksLikeMeasureOnlyFragment(t)) return false;
  if (looksLikeConnectorFragmentLocal(t)) return false;
  if (looksLikeLooseQualifier(t)) return false;

  if (/\d/.test(t)) return false;
  if (t.length < 2 || t.length > 40) return false;

  if (
    /^(sauce|préparation|preparation|ingr[ée]dients?|etapes?|étapes?)$/i.test(t)
  ) {
    return false;
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

function looksLikeStrongParsedIngredient(line) {
  const parsed = parseOcrIngredient(line);
  if (!parsed) return false;

  const name = normSpaces(parsed.name || '');
  const qty = Number(parsed.quantity || 0);
  const unit = String(parsed.unit || '').trim().toLowerCase();

  if (!name) return false;
  if (/^(de|du|des|d['’]|jus de|i pincee de|1 pincee de)$/i.test(name)) return false;
  if (/^[a-z]$/i.test(name)) return false;
  if (/^\d+$/.test(name)) return false;
  if (looksLikeLooseQualifier(name)) return false;

  if (!qty && !unit) return false;

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

function splitPollutedLine(line) {
  let s = normalizeOcrConfusions(line);
  if (!s) return [];

  // coupe avant nouvelle mesure visible
  s = s.replace(/\b(citron)\s+(\d+\s*(?:g|kg|mg|ml|cl|dl|l)\b)/gi, '$1 || $2');

  s = s.replace(/(\s)(\d+(?:[.,]\d+)?\s*(?:g|kg|mg|ml|cl|dl|l)\b)/gi, ' || $2');
  s = s.replace(/(\s)((?:\d+\s+\d+\/\d+|\d+\/\d+|½|¼|¾|\d+(?:[.,]\d+)?)\s*(?:càc|càs|cac|cas))\b/gi, ' || $2');
  s = s.replace(/(\s)(\d+(?:[.,]\d+)?\s+(?:pincée|gousse|gousses|sachet|sachets)\b)/gi, ' || $2');

  // coupes ciblées utiles
  s = s.replace(/\b(mayonnaise)\s+(ketchup)\b/gi, '$1 || $2');
  s = s.replace(/\b(paprika)\s+(poudre d['’]oignon)\b/gi, '$1 || $2');
  s = s.replace(/\b(doux)\s+(et)\s+(poudre d['’]ail)\b/gi, '$1 || $2 $3');

  return s
    .split('||')
    .map((x) => normSpaces(x))
    .filter(Boolean);
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
    const normalized = normalizeOcrConfusions(raw);
    const firstSplit = splitDoubleMeasureLine(normalized);

    for (const chunk of firstSplit) {
      if (looksPollutedMultiIngredientLineLocal(chunk) || countMeasureTokens(chunk) >= 2) {
        out.push(...splitPollutedLine(chunk));
      } else {
        out.push(chunk);
      }
    }
  }

  return dedupeLines(out);
}

function joinMeasureAndNameFragments(lines) {
  const out = [];
  const L = preprocessFragmentedLines(lines);

  let i = 0;

  while (i < L.length) {
    const cur = L[i];
    const next = i + 1 < L.length ? L[i + 1] : '';
    const next2 = i + 2 < L.length ? L[i + 2] : '';

    // mesure + connecteur + nom
    if (
      looksLikeMeasureOnlyFragment(cur) &&
      looksLikeConnectorFragmentLocal(next) &&
      looksLikeIngredientNameOnlyLocal(next2)
    ) {
      out.push(normSpaces(`${cur} ${next} ${next2}`));
      i += 3;
      continue;
    }

    // mesure + "de sucre" / "de moutarde"
    if (looksLikeMeasureOnlyFragment(cur) && next) {
      const nextNorm = normSpaces(next);

      if (/^(de|du|des|d['’])\s+.+$/i.test(nextNorm)) {
        out.push(normSpaces(`${cur} ${nextNorm}`));
        i += 2;
        continue;
      }
    }

    // mesure + nom simple
    if (
      looksLikeMeasureOnlyFragment(cur) &&
      next &&
      looksLikeIngredientNameOnlyLocal(next)
    ) {
      out.push(normSpaces(`${cur} ${next}`));
      i += 2;
      continue;
    }

    // connecteur type "jus de" + nom
    if (
      looksLikeConnectorFragmentLocal(cur) &&
      next &&
      looksLikeIngredientNameOnlyLocal(next)
    ) {
      out.push(normSpaces(`${cur} ${next}`));
      i += 2;
      continue;
    }

    // déjà une bonne ligne
    if (looksLikeStrongParsedIngredient(cur)) {
      out.push(cur);
      i += 1;
      continue;
    }

    // fragment de nom utile, mais pas qualificatif seul
    if (
      looksLikeIngredientNameOnlyLocal(cur) &&
      cur.length >= 4 &&
      !looksLikeLooseQualifier(cur)
    ) {
      out.push(cur);
      i += 1;
      continue;
    }

    // sinon poubelle
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

function scoreIngredientExtraction(lines) {
  const L = dedupeLines(lines);

  let strongParsed = 0;
  let weakParsed = 0;
  let parsedWithQty = 0;
  let suspicious = 0;
  let fragments = 0;
  let polluted = 0;

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

    if (looksLikeBadParsedIngredient(line)) {
      suspicious++;
      continue;
    }

    suspicious++;
  }

  const score =
    strongParsed * 12 +
    parsedWithQty * 5 -
    weakParsed * 8 -
    suspicious * 5 -
    fragments * 7 -
    polluted * 7;

  return {
    total: L.length,
    strongParsed,
    weakParsed,
    parsedWithQty,
    suspicious,
    fragments,
    polluted,
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

  const fragmentedSlightlyBetterAndNotTooDirty =
    fragmentedScore.score > standardScore.score &&
    fragmentedScore.strongParsed >= standardScore.strongParsed &&
    fragmentedScore.suspicious <= standardScore.suspicious + 2;

  const chooseFragmented =
    fragmentedClearlyRecoversMore || fragmentedSlightlyBetterAndNotTooDirty;

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