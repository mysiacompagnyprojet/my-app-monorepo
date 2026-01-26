//backend/src/utils/ingredientParsers

//stringUtils
const { normSpaces } = require('../utils/stringUtils');
//ingredientUtils
const { fixCommonOcrQuantityUnitBugs, isIngredientsHeader, isPreparationHeader, looksLikeDateNoise, looksLikeCountersNoise, looksLikeSocialNoise, looksLikeStepLine, postProcessIngredientName, normalizeQuantityRawForDisplay, parseQuantityToNumber, normalizeUnit, looksLikeActionSentence, looksLikeStepVerbLine, QTY_USED, CUILL_RE } = require('../utils/ingredientUtils');

function parseOcrIngredient(line) {
  const raw0 = normSpaces(line);
  if (!raw0) return null;

  // ✅ bruit OCR fréquent : "Og" / "0g" isolé
  if (/^o[gq]$/i.test(raw0) || /^0\s*g$/i.test(raw0)) return null;

  const raw = fixCommonOcrQuantityUnitBugs(raw0);

  if (isIngredientsHeader(raw)) return null;
  if (isPreparationHeader(raw)) return null;

  if (looksLikeDateNoise(raw)) return null;
  if (looksLikeCountersNoise(raw)) return null;
  if (looksLikeSocialNoise(raw)) return null;

  if (looksLikeStepLine(raw)) return null;

  let m = raw.match(/^(un peu de|selon goût|au goût)\s+(.+)$/i);
  if (m) {
    return { name: postProcessIngredientName(m[2]), quantity: 0, unit: '' };
  }

  const l = raw.replace(/^[-•*]\s+/, '');

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

  // cuillère à café
  m = l.match(
    new RegExp(
      `^${QTY_USED}\\s+(?:${CUILL_RE}\\s*(?:à|a)\\s*caf(?:e|é)|c\\.?\\s*(?:à|a)\\s*c\\.?|càc|cac|cc)\\s*(?:de|d['’])?\\s*(.+)$`,
      'i'
    )
  );
  if (m) {
    const qtyRaw = normalizeQuantityRawForDisplay(m[1]);
    const qtyNum = parseQuantityToNumber(m[1]);
    const name = postProcessIngredientName(m[2]);
    if (name) return { name, quantity: qtyNum ?? 0, quantityRaw: qtyRaw || undefined, unit: 'càc' };
  }

  // cuillère à soupe
  m = l.match(
    new RegExp(
      `^${QTY_USED}\\s+(?:${CUILL_RE}\\s*(?:à|a)\\s*soupe|c\\.?\\s*(?:à|a)\\s*s\\.?|càs|cas|cs)\\s*(?:de|d['’])?\\s*(.+)$`,
      'i'
    )
  );
  if (m) {
    const qtyRaw = normalizeQuantityRawForDisplay(m[1]);
    const qtyNum = parseQuantityToNumber(m[1]);
    const name = postProcessIngredientName(m[2]);
    if (name) return { name, quantity: qtyNum ?? 0, quantityRaw: qtyRaw || undefined, unit: 'càs' };
  }

  // unités “humaines”
  m = l.match(/^(\d+)\s+(gousses?|tranches?|sachets?|verres?|tasses?|pièces?|pieces?)\s+(?:de\s+|d['’])?(.+)$/i);
  if (m) {
    const qtyRaw = normalizeQuantityRawForDisplay(m[1]);
    const qtyNum = parseQuantityToNumber(m[1]);
    const unit = normalizeUnit(m[2]);
    const name = postProcessIngredientName(m[3]);
    if (name) return { name, quantity: qtyNum ?? 0, quantityRaw: qtyRaw || undefined, unit: unit || '' };
  }

  // Quantité + nom sans unité : "1/2 blanc de poireau"
  m = l.match(new RegExp(`^${QTY_USED}\\s+(.+)$`, 'i'));
  if (m) {
    const qtyRaw = normalizeQuantityRawForDisplay(m[1]);
    const qtyNum = parseQuantityToNumber(m[1]);
    let name = postProcessIngredientName(m[2]);

    if (/^(min|mins|minute|minutes)\b/i.test(name)) return null;

    if (looksLikeActionSentence(name) || looksLikeStepVerbLine(name) || looksLikeStepLine(name)) return null;

    if (name) return { name, quantity: qtyNum ?? 0, quantityRaw: qtyRaw || undefined, unit: 'pièce' };
  }

  // fallback
  m = l.match(/^(\d+)\s+(.+)$/);
  if (m) {
    const qtyRaw = normalizeQuantityRawForDisplay(m[1]);
    const qtyNum = parseQuantityToNumber(m[1]);
    const name = postProcessIngredientName(m[2]);
    if (name) return { name, quantity: qtyNum ?? 0, quantityRaw: qtyRaw || undefined, unit: 'pièce' };
  }

  return null;
}
module.exports = {
    parseOcrIngredient,
}