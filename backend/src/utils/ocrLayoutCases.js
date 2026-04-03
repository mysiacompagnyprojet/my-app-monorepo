//backend/src/utils/ocrLayoutCases.js - 
// analyser les lignes ocr bruts
// detecter le type de mise en page
//dire si le cas ingredient fragmenter merite d'être tenté

'use strict';

const { normSpaces } = require('../utils/stringUtils');
const { parseOcrIngredient } = require('../utils/ingredientParser');
const { looksLikeStepLine, looksLikeStepVerbLine, looksLikeActionSentence } = require('../utils/heuristics');

function normalizeLines(lines) {
  return (Array.isArray(lines) ? lines : [])
    .map((x) => normSpaces(String(x || '')))
    .filter(Boolean);
}

function isShortLine(line) {
  return line.length > 0 && line.length <= 18;
}

function looksLikeMeasureOnlyLine(line) {
  const t = normSpaces(line).toLowerCase();
  if (!t) return false;

  return (
    /^(?:\d+\s+\d+\/\d+|\d+\/\d+|½|⅓|⅔|¼|¾|\d+(?:[.,]\d+)?)\s*(c\.?\s*a\.?\s*c|c\.?\s*a\.?\s*s|càc|càs|cac|cas)\s*(?:de)?$/i.test(t) ||
    /^(?:\d+\s+\d+\/\d+|\d+\/\d+|½|⅓|⅔|¼|¾|\d+(?:[.,]\d+)?)\s*(g|kg|mg|ml|cl|dl|l)\s*(?:de)?$/i.test(t) ||
    /^(?:\d+\s+\d+\/\d+|\d+\/\d+|½|⅓|⅔|¼|¾|\d+(?:[.,]\d+)?)\s+(pincée|pincee|gousse|gousses|sachet|sachets)\s*(?:de)?$/i.test(t)
  );
}

function looksLikeConnectorFragment(line) {
  const t = normSpaces(line).toLowerCase();
  if (!t) return false;

  return (
    /^(jus|zeste|pulpe)\s+de$/i.test(t) ||
    /^(de|du|des|d['’])$/i.test(t)
  );
}

function looksLikeIngredientNameOnly(line) {
  const t = normSpaces(line);
  const low = t.toLowerCase();

  if (!t) return false;
  if (parseOcrIngredient(t)) return false;
  if (looksLikeMeasureOnlyLine(t)) return false;
  if (looksLikeConnectorFragment(t)) return false;
  if (looksLikeStepLine(t) || looksLikeStepVerbLine(t) || looksLikeActionSentence(t)) return false;
  if (/\d/.test(t)) return false;
  if (t.length < 2 || t.length > 32) return false;

  // titres / bruit
  if (/^sauce\s+burger\b/i.test(low)) return false;

  // fragments trop faibles
  if (/^(doux|finement|hach[eé]s?|hach[eé]e|poudre)$/i.test(low)) return false;
  if (/^(de|du|des|et|ou|jus|zeste)$/i.test(low)) return false;

  // adjectif / complément d'action seul
  if (/\b(finement|hach[eé]s?|coup[eé]s?)\b/i.test(low) && low.split(/\s+/).length <= 2) return false;

  return /[A-Za-zÀ-ÖØ-öø-ÿœ]/.test(t);
}

function looksPollutedMultiIngredientLine(line) {
  const t = normSpaces(line).toLowerCase();
  if (!t) return false;

  const metricHits =
    (t.match(/\b\d+(?:[.,]\d+)?\s*(?:g|kg|mg|ml|cl|dl|l)\b/g) || []).length;

  const spoonHits =
    (t.match(/\b(?:\d+\s+\d+\/\d+|\d+\/\d+|½|¼|¾|\d+(?:[.,]\d+)?)\s*(?:càc|càs|cac|cas|c\.?\s*a\.?\s*c|c\.?\s*a\.?\s*s)\b/g) || []).length;

  const humanHits =
    (t.match(/\b(?:\d+\s+\d+\/\d+|\d+\/\d+|½|¼|¾|\d+(?:[.,]\d+)?)\s+(?:pincée|pincee|gousse|gousses|sachet|sachets)\b/g) || []).length;

  const totalMeasureHits = metricHits + spoonHits + humanHits;

  // vrai pollué si plusieurs mesures dans la même ligne
  if (totalMeasureHits >= 2) return true;

  // ou si une mesure + beaucoup trop de tokens
  if (totalMeasureHits >= 1 && t.split(/\s+/).length >= 7) return true;

  return false;
}


function detectOcrLayoutCase(lines) {
  const L = normalizeLines(lines);
  if (!L.length) {
    return {
      caseName: 'unknown',
      confidence: 0,
      signals: {},
    };
  }

  let shortCount = 0;
  let measureOnlyCount = 0;
  let connectorCount = 0;
  let nameOnlyCount = 0;
  let stepCount = 0;
  let pollutedCount = 0;
  let parsedIngredientCount = 0;

  for (const line of L) {
    if (isShortLine(line)) shortCount++;
    if (looksLikeMeasureOnlyLine(line)) measureOnlyCount++;
    if (looksLikeConnectorFragment(line)) connectorCount++;
    if (looksLikeIngredientNameOnly(line)) nameOnlyCount++;
    if (looksLikeStepLine(line) || looksLikeStepVerbLine(line) || looksLikeActionSentence(line)) stepCount++;
    if (looksPollutedMultiIngredientLine(line)) pollutedCount++;
    if (parseOcrIngredient(line)) parsedIngredientCount++;
  }

  const total = L.length;

  const fragmentedScore =
    measureOnlyCount * 5 +
    connectorCount * 4 +
    nameOnlyCount * 3 +
    pollutedCount * 4 +
    Math.min(shortCount, 8) * 1 -
    stepCount * 5 -
    parsedIngredientCount * 1;

  const confidence = Math.max(0, Math.min(1, fragmentedScore / Math.max(12, total * 2)));

  const isFragmented =
    measureOnlyCount >= 2 &&
    (nameOnlyCount >= 2 || connectorCount >= 1) &&
    stepCount <= Math.max(2, Math.floor(total * 0.2));

  const shouldUseSpecializedRecovery =
  isFragmented && confidence >= 0.85;

    return {
        caseName: isFragmented ? 'ingredients_fragmented_measure_name' : 'standard',
        confidence,
        signals: {
            total,
            shortCount,
            measureOnlyCount,
            connectorCount,
            nameOnlyCount,
            stepCount,
            pollutedCount,
            parsedIngredientCount,
            fragmentedScore,
        },
        shouldUseSpecializedRecovery,
        shouldBypassReflow: shouldUseSpecializedRecovery,
        shouldBypassPass2: shouldUseSpecializedRecovery,
        shouldDisableInlineExtraction: shouldUseSpecializedRecovery,
    };
}

module.exports = {
  detectOcrLayoutCase,
  looksLikeMeasureOnlyLine,
  looksLikeConnectorFragment,
  looksLikeIngredientNameOnly,
  looksPollutedMultiIngredientLine,
};