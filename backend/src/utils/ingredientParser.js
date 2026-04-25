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

  //ajoute le 07/04/26 - securite anti-collage àcr/normalisation 
  t = t.replace(/\b(càc|càs)(?=de\b)/gi, '$1 ');

  return normSpaces(t);
}

function firstDefinedGroup(groups, keys) {
  for (const key of keys) {
    const value = groups?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function normalizeNameBeforeQuantityParen(name) {
  let s = normSpaces(name);
  if (!s) return '';

  s = s.replace(/^(un|une|des|du|de la|de l'|de l’)\s+/i, '');
  s = s.replace(/^épaule\s+d['’]agneau\b/i, 'agneau');
  s = s.replace(/^beaucoup\s+de\s+gousses\s+d['’]ail\b/i, 'ail');
  s = s.replace(/\bgousses?\s+d['’]ail\b/i, 'ail');

  return postProcessIngredientName(s);
}

function parseQuantityFromParenthesisIngredient(line) {
  const t = normSpaces(line);

  const m = t.match(/^(.+?)\s*\(\s*(\d+(?:[.,]\d+)?)\s*(?:à|a|-|–)?\s*\d*(?:\s*)?(kg|kilos?|g|grammes?|ml|cl|l|litres?|t[eê]tes?|gousses?|pi[eè]ces?)\s*(?:environ)?\s*\)$/i);
  if (!m) return null;

  const rawName = m[1];
  const qtyRawToken = m[2];
  const unitRaw = m[3];

  const name = normalizeNameBeforeQuantityParen(rawName);
  const quantity = parseQuantityToNumber(qtyRawToken);
  let unit = normalizeUnit(unitRaw);

  if (/^kilos?$/i.test(unitRaw)) unit = 'kg';
  if (/^grammes?$/i.test(unitRaw)) unit = 'g';
  if (/^litres?$/i.test(unitRaw)) unit = 'l';
  if (/^t[eê]tes?$/i.test(unitRaw)) unit = 'tête';

  if (!name || !quantity || !unit) return null;

  return {
    name,
    quantity,
    quantityRaw: normalizeQuantityRawForDisplay(qtyRawToken) || undefined,
    unit,
  };
}

function cleanParsedNameLocal(name) {
  let s = postProcessIngredientName(name);
  s = s.replace(/^[.\s]+de\s+/i, '');
  s = s.replace(/^[.\s]+/g, '');
  return normSpaces(s);
}

function parseOcrIngredient(line) {
  const raw0 = normSpaces(line);
  if (!raw0) return null;

  if (/^o[gq]$/i.test(raw0) || /^0\s*g$/i.test(raw0)) return null;

  const afterFix = fixCommonOcrQuantityUnitBugs(raw0);
  const raw = normalizeIngredientParseInput(afterFix);

  if (/^\s*(\d+\s+\d+\/\d+|\d+\/\d+|½|⅓|⅔|¼|¾|⅛|⅜|⅝|⅞)/.test(raw0));

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

  m = parseQuantityFromParenthesisIngredient(l);
  if (m) return m;

  if (/(\d+\s+\d+\/\d+|\d+\/\d+|½|⅓|⅔|¼|¾|⅛|⅜|⅝|⅞)/.test(l));

  if (/^(assaisonnement|assaisonement|cuisson|marinade|sauce)\b.*:$/i.test(l)) return null;
  if (/^ingr[ée]dients?$/i.test(l)) return null;

  if (/^sel\s*&\s*poivre$/i.test(l)) {
    return { name: 'sel', quantity: 0, unit: '' };
  }
  if (/^poivre$/i.test(l)) {
    return { name: 'poivre', quantity: 0, unit: '' };
  }

   // mesure naturelle : "1 belle poignée d'épinards frais"
  m = l.match(
    new RegExp(
      `^(?:(?<qtyNat>${QTY_USED})|un|une)\\s+(?:(?:tr[eè]s\\s+)?(?:belle?|petite?|petit|grande?|grand|grosse?|gros)\\s+)?poign(?:ée|ee?)s?\\s+(?:de\\s+|d['’]\\s*)?(?<nameNat>.+)$`,
      'i'
    )
  );
  if (m) {
    const name = postProcessIngredientName(firstDefinedGroup(m.groups, ['nameNat']));
    if (
      name &&
      !looksLikeActionSentence(name) &&
      !looksLikeStepVerbLine(name) &&
      !looksLikeStepLine(name)
    ) {
      return { name, quantity: 0, unit: '' };
    }
  }

  // plage + unité cuillère à soupe : "3 à 4 càs de cottage cheese"
  m = l.match(
    new RegExp(
      `^(?<qtyMinSoup>${QTY_USED})\\s*(?:à|a|-)\\s*(?<qtyMaxSoup>${QTY_USED})\\s+(?:càs|cas|cs|${CUILL_RE}\\s*(?:à|a)\\s*soupe|c\\.?\\s*(?:à|a)\\s*s\\.?)\\s*(?:de\\s+|d['’]\\s*)?(?<nameSoup>.+)$`,
      'i'
    )
  );
  if (m) {
    const qtyToken = firstDefinedGroup(m.groups, ['qtyMinSoup']);
    const qtyRaw = normalizeQuantityRawForDisplay(qtyToken);
    const qtyNum = parseQuantityToNumber(qtyToken);
    const name = postProcessIngredientName(firstDefinedGroup(m.groups, ['nameSoup']));

    if (
      name &&
      !looksLikeActionSentence(name) &&
      !looksLikeStepVerbLine(name) &&
      !looksLikeStepLine(name)
    ) {
      return { name, quantity: qtyNum ?? 0, quantityRaw: qtyRaw || undefined, unit: 'càs' };
    }
  }


  // plage + unité cuillère à café
  m = l.match(
    new RegExp(
      `^(?<qtyMinTea>${QTY_USED})\\s*(?:à|a|-)\\s*(?<qtyMaxTea>${QTY_USED})\\s+(?:càc|cac|cc|${CUILL_RE}\\s*(?:à|a)\\s*caf(?:e|é)|c\\.?\\s*(?:à|a)\\s*c\\.?)\\s*(?:de\\s+|d['’]\\s*)?(?<nameTea>.+)$`,
      'i'
    )
  );
  if (m) {
    const qtyToken = firstDefinedGroup(m.groups, ['qtyMinTea']);
    const qtyRaw = normalizeQuantityRawForDisplay(qtyToken);
    const qtyNum = parseQuantityToNumber(qtyToken);
    const name = postProcessIngredientName(firstDefinedGroup(m.groups, ['nameTea']));

    if (
      name &&
      !looksLikeActionSentence(name) &&
      !looksLikeStepVerbLine(name) &&
      !looksLikeStepLine(name)
    ) {
      return { name, quantity: qtyNum ?? 0, quantityRaw: qtyRaw || undefined, unit: 'càc' };
    }
  }

   // plage sans unité explicite : "10 à 12 tomates cerises"
  m = l.match(
    new RegExp(
      `^(?<qtyMinPlain>${QTY_USED})\\s*(?:à|a|-)\\s*(?<qtyMaxPlain>${QTY_USED})\\s+(?<namePlain>.+)$`,
      'i'
    )
  );
  if (m) {
    const qtyToken = firstDefinedGroup(m.groups, ['qtyMinPlain']);
    const qtyRaw = normalizeQuantityRawForDisplay(qtyToken);
    const qtyNum = parseQuantityToNumber(qtyToken);
    const name = postProcessIngredientName(firstDefinedGroup(m.groups, ['namePlain']));

    if (
      name &&
      !/^(min|mins|minute|minutes|seconde|secondes)\b/i.test(name) &&
      !/^(°c|degr[ée]s?\b)/i.test(name) &&
      !looksLikeActionSentence(name) &&
      !looksLikeStepVerbLine(name) &&
      !looksLikeStepLine(name)
    ) {
      return { name, quantity: qtyNum ?? 0, quantityRaw: qtyRaw || undefined, unit: 'pièce' };
    }
  }

  // plage de quantité avec unité : "900 g à 1 kg de paleron"
  m = l.match(
    new RegExp(
      `^(${QTY_USED})\\s*(kg|g|mg|l|dl|cl|ml)\\s*(?:à|a|-)\\s*(${QTY_USED})\\s*(kg|g|mg|l|dl|cl|ml)\\s*(?:de\\s+|d['’]\\s*)?(.+)$`,
      'i'
    )
  );
  if (m) {
    const qtyNum = parseQuantityToNumber(m[1]);
    const qtyRaw = normalizeQuantityRawForDisplay(m[1]);
    const unit = normalizeUnit(m[2]);
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

  const lNoTrailingParen = l.replace(/\s*\([^)]*\)\s*$/g, '').trim();

  // "X g/ml/... de ..."
  m = lNoTrailingParen.match(new RegExp(`^${QTY_USED}\\s*(kg|g|mg|l|dl|cl|ml)\\b\\s*(?:de\\s+|d['’]\\s*)?(.+)$`, 'i'));
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
      `^${QTY_USED}\\s+(?:càc|cac|cc|${CUILL_RE}\\s*(?:à|a)\\s*caf(?:e|é)|c\\.?\\s*(?:à|a)\\s*c\\.?)\\s*(?:de\\s+|d['’]\\s*)?(.+)$`,
      'i'
    )
  );
  if (m) {
    const qtyRaw = normalizeQuantityRawForDisplay(m[1]);
    const qtyNum = parseQuantityToNumber(m[1]);
    const name = cleanParsedNameLocal(m[m.length - 1]);
    if (
      name &&
      !looksLikeActionSentence(name) &&
      !looksLikeStepVerbLine(name) &&
      !looksLikeStepLine(name)
    ) {
      return { name, quantity: qtyNum ?? 0, quantityRaw: qtyRaw || undefined, unit: 'càc' };
    }
  }

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
    const name = cleanParsedNameLocal(m[m.length - 1]);
    if (
      name &&
      !looksLikeActionSentence(name) &&
      !looksLikeStepVerbLine(name) &&
      !looksLikeStepLine(name)
    ) {
      return { name, quantity: qtyNum ?? 0, quantityRaw: qtyRaw || undefined, unit: 'càs' };
    }
  }

  // unités “humaines” : gousse, tranche, nid, bâton, botte...
  m = l.match(
    new RegExp(
      `^${QTY_USED}\\s+(gousses?|tranches?|sachets?|verres?|tasses?|bottes?|b[âa]tons?|nids?|pi[nñ]c[ée]es?|pinc[ée]es?|pièces?|pieces?)\\s+(?:de\\s+|d['’]\\s*)?(.+)$`,
      'i'
    )
  );

  if (m) {
    const qtyRaw = normalizeQuantityRawForDisplay(m[1]);
    const qtyNum = parseQuantityToNumber(m[1]);
    const rawUnit = normSpaces(m[2]).toLowerCase();

    let unit = normalizeUnit(m[2]);
    if (/^bottes?$/.test(rawUnit)) unit = 'botte';
    if (/^b[âa]tons?$/.test(rawUnit)) unit = 'bâton';
    if (/^nids?$/.test(rawUnit)) unit = 'nid';

    const name = cleanParsedNameLocal(m[3]);

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
        unit: unit || '',
      };
    }
  }


  // "poivre au goût", "persil au goût", "épices au goût", etc.
  m = l.match(/^(.+?)\s+au\s+go[uû]t$/i);
  if (m) {
    const name = postProcessIngredientName(m[1]);
    if (
      name &&
      !looksLikeActionSentence(name) &&
      !looksLikeStepVerbLine(name) &&
      !looksLikeStepLine(name)
    ) {
      return {
        name,
        quantity: 0,
        unit: '',
        note: `${name} au goût`
      };
    }
  }

  // "10 tomates de calibre moyen ou 15-20 tomates cocktail"
  // On garde la borne basse en quantité et on simplifie le nom pour le pricing.
  m = l.match(
    new RegExp(
      `^(?<qtyMain>${QTY_USED})\\s+(?<nameMain>[a-zà-öø-ÿœ' -]+?)\\s+de\\s+calibre\\s+.+?\\s+ou\\s+\\d+\\s*[-–]\\s*\\d+\\s+(?<altName>[a-zà-öø-ÿœ' -]+)$`,
      'i'
    )
  );
  if (m) {
    const qtyToken = firstDefinedGroup(m.groups, ['qtyMain']);
    const qtyRaw = normalizeQuantityRawForDisplay(qtyToken);
    const qtyNum = parseQuantityToNumber(qtyToken);
    const name = postProcessIngredientName(firstDefinedGroup(m.groups, ['nameMain']));

    if (name) {
      return {
        name,
        quantity: qtyNum ?? 0,
        quantityRaw: qtyRaw || undefined,
        unit: 'pièce',
      };
    }
  }

  // quantité + nom sans unité : "2 œufs", "3 tomates", "1/2 poireau"
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

  return null;
}

module.exports = {
    parseOcrIngredient,
}