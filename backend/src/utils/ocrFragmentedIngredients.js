//backend/src/utils/ocrFragmentedIngredients.js
//reconstruire lignes ingredients depuis de sfragmen,ts
//scorer la qualite de cette reconstruction

'use strict';

const { normSpaces } = require('../utils/stringUtils');
const { parseOcrIngredient } = require('../utils/ingredientParser');
const {
  looksLikeMeasureOnlyLine,
  looksLikeConnectorFragment,
  looksLikeIngredientNameOnly,
  looksPollutedMultiIngredientLine,
} = require('../utils/ocrLayoutCases');

function normalizeLines(lines) {
  return (Array.isArray(lines) ? lines : [])
    .map((x) => normSpaces(String(x || '')))
    .filter(Boolean);
}

function dedupeLines(lines) {
  const seen = new Set();
  const out = [];

  for (const line of lines) {
    const key = normSpaces(line).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(normSpaces(line));
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

  return normSpaces(t);
}

function splitPollutedLine(line) {
  let s = normalizeOcrConfusions(line);
  if (!s) return [];

  s = s.replace(/\b(citron)\s+(\d+\s*(?:g|kg|mg|ml|cl|dl|l)\b)/gi, '$1 || $2');
  s = s.replace(/(\s)(\d+(?:[.,]\d+)?\s*(?:g|kg|mg|ml|cl|dl|l)\b)/gi, ' || $2');
  s = s.replace(/(\s)((?:\d+\s+\d+\/\d+|\d+\/\d+|½|¼|¾|\d+(?:[.,]\d+)?)\s*(?:càc|càs|cac|cas))\b/gi, ' || $2');
  s = s.replace(/(\s)(\d+(?:[.,]\d+)?\s+(?:pincée|gousse|gousses|sachet|sachets)\b)/gi, ' || $2');

  return s
    .split('||')
    .map((x) => normSpaces(x))
    .filter(Boolean);
}

function preprocessFragmentedLines(lines) {
  const out = [];

  for (const raw of normalizeLines(lines)) {
    const normalized = normalizeOcrConfusions(raw);

    if (looksPollutedMultiIngredientLine(normalized)) {
      out.push(...splitPollutedLine(normalized));
    } else {
      out.push(normalized);
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

    if (looksLikeMeasureOnlyLine(cur) && next) {
      if (looksLikeConnectorFragment(next) && next2 && looksLikeIngredientNameOnly(next2)) {
        out.push(normSpaces(`${cur} ${next} ${next2}`));
        i += 3;
        continue;
      }

      if (looksLikeIngredientNameOnly(next) || parseOcrIngredient(next)) {
        out.push(normSpaces(`${cur} ${next}`));
        i += 2;
        continue;
      }
    }

    if (looksLikeConnectorFragment(cur) && next && looksLikeIngredientNameOnly(next)) {
      out.push(normSpaces(`${cur} ${next}`));
      i += 2;
      continue;
    }

    if (/^(jus|zeste|pulpe)\s+de$/i.test(cur) && next && looksLikeIngredientNameOnly(next)) {
      out.push(normSpaces(`${cur} ${next}`));
      i += 2;
      continue;
    }

    out.push(cur);
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

  let parsedOk = 0;
  let parsedWithQty = 0;
  let suspicious = 0;
  let fragments = 0;
  let polluted = 0;

  for (const line of L) {
    const parsed = parseOcrIngredient(line);

    if (parsed) {
      parsedOk++;
      if (parsed.quantity || parsed.unit) parsedWithQty++;

      const name = normSpaces(parsed.name || '');
      if (!name || /^(de|du|des|jus de|i pincee de)$/i.test(name)) suspicious++;
      continue;
    }

    if (looksLikeMeasureOnlyLine(line) || looksLikeConnectorFragment(line)) {
      fragments++;
      continue;
    }

    if (looksPollutedMultiIngredientLine(line)) {
      polluted++;
      continue;
    }

    suspicious++;
  }

  const score =
    parsedOk * 6 +
    parsedWithQty * 4 -
    suspicious * 5 -
    fragments * 6 -
    polluted * 6;

  return {
    total: L.length,
    parsedOk,
    parsedWithQty,
    suspicious,
    fragments,
    polluted,
    score,
  };
}

function chooseBestIngredientLines({ standardLines, fragmentedLines }) {
  const standardScore = scoreIngredientExtraction(standardLines || []);
  const fragmentedScore = scoreIngredientExtraction(fragmentedLines || []);

  const chooseFragmented =
    fragmentedScore.score > standardScore.score + 4 &&
    fragmentedScore.parsedWithQty >= standardScore.parsedWithQty &&
    fragmentedScore.fragments <= standardScore.fragments;

  return {
    chosen: chooseFragmented ? dedupeLines(fragmentedLines || []) : dedupeLines(standardLines || []),
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
