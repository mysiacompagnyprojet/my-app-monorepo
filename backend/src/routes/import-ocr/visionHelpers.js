// backend/src/routes/import-ocr/visionHelpers.js
// LEVEL: ROUTE
// import autorisés : 
// import interdits : 
// importé uniquement par 

'use strict';

const { ocrFromBufferWithDebug } = require('../../services/vision');
const { normSpaces, normalizeTitleCandidate } = require('../../utils/stringUtils');
//titleUtils
const { isBlacklistedUiTitle, looksLikeEmotionalHookTitle, looksLikeStepTitle, looksLikeLooseActionStep, looksLikeIngredientOnlyTitle, looksLikeIngredientFragmentTitleForTitle } = require('../../utils/titleUtils');


async function collectOcrDataFromFiles(files, { isDebug = false } = {}) {
  const texts = [];
  const pickedTitles = [];
  const visionDebugByImage = [];
  const allSpatialIngredientHints = [];

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const out = await ocrFromBufferWithDebug(f.buffer, { lang: 'fr' });

    if (out?.text) texts.push(out.text);

    if (Array.isArray(out?.debug?.spatialIngredientHints)) {
      allSpatialIngredientHints.push(...out.debug.spatialIngredientHints);
    }

    let pt = out?.debug?.pickedTitle ? String(out.debug.pickedTitle).trim() : '';

    if (pt) {
      pt = normalizeTitleCandidate(pt);

      if (looksLikeLooseActionStep(pt) || looksLikeStepTitle(pt)) pt = '';
      if (pt && looksLikeIngredientOnlyTitle(pt)) pt = '';
      if (pt && looksLikeIngredientFragmentTitleForTitle(pt)) pt = '';
      if (pt && (isBlacklistedUiTitle(pt) || looksLikeEmotionalHookTitle(pt))) pt = '';
      if (/^pour\s+r[ée]aliser\s+cette\s+recette\s+tu\s+auras\s+besoin\s+de\b/i.test(pt)) pt = '';
      if (/^pour\s+faire\s+cette\s+recette\s+tu\s+auras\s+besoin\s+de\b/i.test(pt)) pt = '';

      if (pt) pickedTitles.push(pt);
    }

    if (isDebug) {
      visionDebugByImage.push({
        index: i,
        pickedTitle: pt || null,
        topTextSample: out?.debug?.topTextSample || null,
        bandTextSample: out?.debug?.bandTextSample || null,
      });
    }
  }

  const spatialIngredientHints = [...new Set(
    allSpatialIngredientHints
      .map((x) => normSpaces(String(x || '')))
      .filter(Boolean)
  )];

  return {
    texts,
    pickedTitles,
    visionDebugByImage,
    spatialIngredientHints,
  };
}

module.exports = {
    collectOcrDataFromFiles,
}