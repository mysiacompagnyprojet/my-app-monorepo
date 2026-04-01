//backend/src/utils/ingredientParsers
// LEVEL: UTIL
// import autorisés : stringUtils-units-heuristics- constantes neutres
// import interdits : routes-services-middlewares-parsers-utils ocr-supabase-prisma
// importé par ocrTitle, ocrText, vision, ingredients, eventuellement import-ocr

//stringUtils
const { normSpaces } = require('../utils/stringUtils');
const { looksLikeStepVerbLine, looksLikeActionSentence, looksLikeStepLine,} = require('../utils/heuristics');
const { isIngredientsHeader,  isPreparationHeader } = require('../utils/sectionHeaders');
const { QTY_USED, CUILL_RE } = require('../utils/constants');


//ingredientUtils
const { 
  fixCommonOcrQuantityUnitBugs,  
  looksLikeDateNoise, 
  looksLikeCountersNoise, 
  looksLikeSocialNoise,  
  postProcessIngredientName, 
  normalizeQuantityRawForDisplay, 
  parseQuantityToNumber, 
  normalizeUnit,  
} = require('../utils/ingredientUtils');

//ajoute le 29/03/26
function normalizeIngredientParseInput(line) {
  let t = normSpaces(line);
  if (!t) return '';

  // normalise les variantes cuillère à café - remplacé le 31/03/26
  t = t.replace(/\bc\s*\.?\s*[àa]\s*\.?\s*c\s*\.?\b/gi, 'càc');
  t = t.replace(/\bcuill(?:e|è)re?s?\s+[àa]\s+caf(?:é|e)\b/gi, 'càc');

  // normalise les variantes cuillère à soupe - remplacé le 31/03/26
  t = t.replace(/\bc\s*\.?\s*[àa]\s*\.?\s*s\s*\.?\b/gi, 'càs');
  t = t.replace(/\bcuill(?:e|è)re?s?\s+[àa]\s+soupe\b/gi, 'càs');

  return normSpaces(t);
}


//le 29/03/26, remplacé par :
function parseOcrIngredient(line) {
  const raw0 = normSpaces(line);
  if (!raw0) return null;

  // ✅ bruit OCR fréquent : "Og" / "0g" isolé
  if (/^o[gq]$/i.test(raw0) || /^0\s*g$/i.test(raw0)) return null;

  //a remettre une fois le test fait, enlever const afterFix jusqu'à    afterNormalize: raw});} - const raw = normalizeIngredientParseInput(fixCommonOcrQuantityUnitBugs(raw0));
  //a enlever d'ici à
  const afterFix = fixCommonOcrQuantityUnitBugs(raw0);
  const raw = normalizeIngredientParseInput(afterFix);

  // TRACE FRACTIONS
  if (/^\s*(\d+\s+\d+\/\d+|\d+\/\d+|½|⅓|⅔|¼|¾|⅛|⅜|⅝|⅞)/.test(raw0)) {
    console.log('[FRACTION TRACE]', {
      original: raw0,
      afterFix,
      afterNormalize: raw
    });
  }
  //ici


  if (isIngredientsHeader(raw)) return null;
  if (isPreparationHeader(raw)) return null;

  if (looksLikeDateNoise(raw)) return null;
  if (looksLikeCountersNoise(raw)) return null;
  if (looksLikeSocialNoise(raw)) return null;

  let m = raw.match(/^(un peu de|selon goût|au goût)\s+(.+)$/i);
  if (m) {
    return { name: postProcessIngredientName(m[2]), quantity: 0, unit: '' };
  }

  const l = raw.replace(/^[-•*]\s+/, '');

  // plage de quantité : "900 g à 1 kg de paleron de boeuf" - ajoute le 01/04/26
  m = l.match(
    new RegExp(
      `^${QTY_USED}\\s*(kg|g|mg|l|dl|cl|ml)\\s*(?:à|a|-)\\s*${QTY_USED}\\s*(kg|g|mg|l|dl|cl|ml)\\s*(?:de\\s+|d['’]\\s*)?(.+)$`,
      'i'
    )
  );

  if (m) {
    const qtyNum = parseQuantityToNumber(m[3]);
    const qtyRaw = normalizeQuantityRawForDisplay(m[3]);
    const unit = normalizeUnit(m[4]);
    const name = postProcessIngredientName(m[5]);

    if (
      name &&
      !looksLikeActionSentence(name) &&
      !looksLikeStepVerbLine(name) &&
      !looksLikeStepLine(name)
    ) {
      return {
        name,
        quantity: qtyNum ?? 0,
        quantityRaw: qtyRaw || undefined,
        unit
      };
    }
  }


  //ajoute le 01/04/26
  if (/(\d+\s+\d+\/\d+|\d+\/\d+|½|⅓|⅔|¼|¾|⅛|⅜|⅝|⅞)/.test(l)) {
    console.log('[PARSE FRACTION]', l);
  }

  //ajoute le 01/04/26
  if (/^(assaisonnement|assaisonement|cuisson|marinade|sauce)\b.*:$/i.test(l)) return null;
  if (/^ingr[ée]dients?$/i.test(l)) return null;


  if (/^sel\s*&\s*poivre$/i.test(l)) {
    return { name: 'sel', quantity: 0, unit: '' };
  }
  if (/^poivre$/i.test(l)) {
    return { name: 'poivre', quantity: 0, unit: '' };
  }

  // "X g/ml/... de ..."
  m = l.match(new RegExp(`^${QTY_USED}\\s*(kg|g|mg|l|dl|cl|ml)\\b\\s*(?:de\\s+|d['’]\\s*)?(.+)$`, 'i'));
  if (m) {
    const qtyRaw = normalizeQuantityRawForDisplay(m[1]);
    const qtyNum = parseQuantityToNumber(m[1]);
    const unit = normalizeUnit(m[2]);
    const name = postProcessIngredientName(m[3]);
    if (name) return { name, quantity: qtyNum ?? 0, quantityRaw: qtyRaw || undefined, unit };
  }

  // le 29/03/26, remplacé par :
  // cuillère à café
  m = l.match(
    new RegExp(
      `^${QTY_USED}\\s+(?:càc|cac|cc|${CUILL_RE}\\s*(?:à|a)\\s*caf(?:e|é)|c\\.?\\s*(?:à|a)\\s*c\\.?)\\s*(?:de\\s+|d['’]\\s*)?(.+)$`,
      'i'
    )
  );
  if (m) {
    const qtyRaw = normalizeQuantityRawForDisplay(m[1]);
    const qtyNum = parseQuantityToNumber(m[1]);
    const name = postProcessIngredientName(m[m.length - 1]);
    if (
      name &&
      !looksLikeActionSentence(name) &&
      !looksLikeStepVerbLine(name) &&
      !looksLikeStepLine(name)
    ) {
      return { name, quantity: qtyNum ?? 0, quantityRaw: qtyRaw || undefined, unit: 'càc' };
    }
  }


   // le 28/03/26, remplacé par :
  // cuillère à soupe
  m = l.match(
    new RegExp(
      `^${QTY_USED}\\s+(?:càs|cas|cs|${CUILL_RE}\\s*(?:à|a)\\s*soupe|c\\.?\\s*(?:à|a)\\s*s\\.?)\\s*(?:de\\s+|d['’]\\s*)?(.+)$`,
      'i'
    )
  );
  if (m) {
    const qtyRaw = normalizeQuantityRawForDisplay(m[1]);
    const qtyNum = parseQuantityToNumber(m[1]);
    const name = postProcessIngredientName(m[m.length - 1]);
    if (
      name &&
      !looksLikeActionSentence(name) &&
      !looksLikeStepVerbLine(name) &&
      !looksLikeStepLine(name)
    ) {
      return { name, quantity: qtyNum ?? 0, quantityRaw: qtyRaw || undefined, unit: 'càs' };
    }
  }


  // le 29/03/26, remplacé par :
  // unités “humaines”
  m = l.match(
    //remplacé le 01/04/26
    new RegExp(
      `^${QTY_USED}\\s+(gousses?|tranches?|sachets?|verres?|tasses?|pi[nñ]c[ée]es?|pinc[ée]es?|pièces?|pieces?)\\s+(?:de\\s+|d['’]\\s*)?(.+)$`, 'i'
    )
  );

  if (m) {
    const qtyRaw = normalizeQuantityRawForDisplay(m[1]);
    const qtyNum = parseQuantityToNumber(m[1]);
    const unit = normalizeUnit(m[2]);
    const name = postProcessIngredientName(m[3]);
    if (
      name &&
      !looksLikeActionSentence(name) &&
      !looksLikeStepVerbLine(name) &&
      !looksLikeStepLine(name)
    ) {
      return { name, quantity: qtyNum ?? 0, quantityRaw: qtyRaw || undefined, unit: unit || '' };
    }
  }

   // le 29/03/26, remplacé par :
  // Quantité + nom sans unité : "2 œufs", "3 tomates", "1/2 poireau"
  m = l.match(new RegExp(`^${QTY_USED}\\s+(.+)$`, 'i'));
  if (m) {
    const qtyRaw = normalizeQuantityRawForDisplay(m[1]);
    const qtyNum = parseQuantityToNumber(m[1]);
    let name = postProcessIngredientName(m[2]);

    if (!name) return null;

    if (/^(min|mins|minute|minutes|seconde|secondes)\b/i.test(name)) return null;
    if (/^(°c|degr[ée]s?\b)/i.test(name)) return null;
    if (/^(préchauffez|prechauffez|m[ée]langez|melangez|ajoutez|versez|faites|laissez|incorporez|enfournez)\b/i.test(name)) return null;

    if (looksLikeActionSentence(name) || looksLikeStepVerbLine(name) || looksLikeStepLine(name)) return null;

    return { name, quantity: qtyNum ?? 0, quantityRaw: qtyRaw || undefined, unit: 'pièce' };
  }

  // le 29/03/26, remplacé par :
  // fallback prudent
  // supprimer d'ici à - le 01/04/26 car il fait doublon avec celui du dessus
  //m = l.match(new RegExp(`^${QTY_USED}\\s+(.+)$`, 'i'));//remplacé le 01/04/26
  //if (m) {
    //const qtyRaw = normalizeQuantityRawForDisplay(m[1]);
    //const qtyNum = parseQuantityToNumber(m[1]);
    //const name = postProcessIngredientName(m[2]);

   // if (
    //  name &&
     // !looksLikeActionSentence(name) &&
     // !looksLikeStepVerbLine(name) &&
     // !looksLikeStepLine(name)
   // ) {
     // return { name, quantity: qtyNum ?? 0, quantityRaw: qtyRaw || undefined, unit: 'pièce' };
    //}
  //} - ici

  return null;
}
module.exports = {
    parseOcrIngredient,
}