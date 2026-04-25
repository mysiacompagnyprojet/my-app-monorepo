// backend/src/routes/import-ocr/splitpipeline.js
// LEVEL: ROUTE
// import autorisés : 
// import interdits : 
// importé uniquement par 

'use strict';

const { detectOcrLayoutCase } = require('../../utils/ocrLayoutCases');
const { extractFragmentedIngredientLines, chooseBestIngredientLines, mergeSpatialHints, removeWeakerDuplicates } = require('../../utils/ocrFragmentedIngredients');
const { splitIngredientsAndSteps, miniReflow } = require('../../utils/ocrText');
const { scoreSplitQuality, rescueWrappedIngredientFragmentsOnly, cleanFinalSplit } = require('./splitHelpers');

function buildBestSplitFromOcr({ lines, rawLines, spatialIngredientHints, dlog,}) {
  const layoutCase = detectOcrLayoutCase(lines);
  const useFragmentedStrategy = !!layoutCase.shouldUseSpecializedRecovery;

  let splitPass1 = splitIngredientsAndSteps(lines, {
    disableInlineExtraction: useFragmentedStrategy,
  });

  if (!useFragmentedStrategy) {
    splitPass1 = rescueWrappedIngredientFragmentsOnly(splitPass1);
  }

  let split = splitPass1;

  if (useFragmentedStrategy) {
    dlog('[DEBUG][FRAGMENT_INPUT_LINES', lines);

    const fragmentedIngredientLines = extractFragmentedIngredientLines(rawLines);
    let enrichedFragmented = fragmentedIngredientLines;

    if (
      layoutCase.shouldUseSpecializedRecovery &&
      Array.isArray(spatialIngredientHints) &&
      spatialIngredientHints.length >= 2
    ) {
      enrichedFragmented = removeWeakerDuplicates(
        mergeSpatialHints(
          fragmentedIngredientLines,
          spatialIngredientHints
        )
      );
    }

    const best = chooseBestIngredientLines({
      standardLines: splitPass1.ingredientLines || [],
      fragmentedLines: enrichedFragmented,
    });

    split = {
      ...splitPass1,
      ingredientLines: best.chosen || splitPass1.ingredientLines || [],
    };

    dlog('[OCR LAYOUT CASE]', layoutCase);
    dlog('[OCR FRAGMENTED RESULT]', best);
  } else {
    const reflowedLines = miniReflow(splitPass1);
    const splitPass2 = splitIngredientsAndSteps(reflowedLines);

    const q1 = scoreSplitQuality(splitPass1);
    const q2 = scoreSplitQuality(splitPass2);

    dlog('[SPLIT QUALITY][PASS1]', q1, splitPass1.ingredientLines || []);
    dlog('[SPLIT QUALITY][PASS2]', q2, splitPass2.ingredientLines || []);

    const pass2LosesTooMuch =
      q2.strictCount < q1.strictCount - 2 ||
      q2.totalIngredientLike < q1.totalIngredientLike - 3;

    const pass2ClearlyBetter =
      q2.score > q1.score + 4 &&
      q2.strictCount >= q1.strictCount &&
      q2.totalIngredientLike >= q1.totalIngredientLike - 1;

    if (!pass2LosesTooMuch && pass2ClearlyBetter) {
      split = splitPass2;
    }
  }

  split = cleanFinalSplit(split, rawLines || lines);

  let servings = split.servings || 1;
  if (!Number.isFinite(servings) || servings < 1) servings = 1;

  return {
    split,
    servings,
    layoutCase,
  };
}

module.exports = {
  buildBestSplitFromOcr,
};