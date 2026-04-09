//backend/src/services/recipePricing.js
// LEVEL: ROUTE
// import autorisés : middleware-services-lib-utils-dependances externes(express, etc)
// import interdits : routes-frontend-parsers-ocr
// importé uniquement par src-index

const { enrichIngredientWithCost, convertRecipeToPricingUnit } = require('../utils/costs');
const { tidyName, normalizeUnit } = require('../utils/ingredients');
const { canonUnit, toBaseQty } = require('../utils/units');

const VALID_CATEGORIES = new Set([
  'vegetable',
  'fruit',
  'meat',
  'fish',
  'seafood',
  'dairy',
  'egg',
  'starch',
  'legume',
  'bakery',
  'spice',
  'condiment',
  'fat',
  'sweet',
  'drink',
  'frozen',
  'processed',
  'other',
]);

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function toNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'string') {
    const n = Number(value.replace(',', '.').trim());
    return Number.isFinite(n) ? n : 0;
  }

  return 0;
}

function normalizeKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}


function buildCoursesAggregateKey(ing) {
  if (ing?.ingredientBaseId) return `base:${ing.ingredientBaseId}`;
  if (ing?.airtableId) return `base:${ing.airtableId}`;
  const nameKey = normalizeKey(ing?.name);
  return nameKey ? `name:${nameKey}` : '';
}

function convertQtyToReferenceUnit(qty, fromUnit, targetUnit, row) {
  const converted = convertRecipeToPricingUnit(qty, fromUnit, targetUnit);

  if (converted && converted.unit === targetUnit) {
    return converted.qty;
  }

  if (!converted) return null;

  const gpp = typeof row?.gramsPerPiece === 'number' ? row.gramsPerPiece : null;
  if (gpp && gpp > 0) {
    if (converted.unit === 'piece' && targetUnit === 'g') {
      return converted.qty * gpp;
    }
    if (converted.unit === 'g' && targetUnit === 'piece') {
      return converted.qty / gpp;
    }
  }

  const d = typeof row?.density_g_per_ml === 'number' ? row.density_g_per_ml : null;
  if (d && d > 0) {
    if (converted.unit === 'ml' && targetUnit === 'g') {
      return converted.qty * d;
    }
    if (converted.unit === 'g' && targetUnit === 'ml') {
      return converted.qty / d;
    }
  }

  return null;
}


function computeGroupedCourses(enrichedIngredients) {
  const items = Array.isArray(enrichedIngredients) ? enrichedIngredients : [];
  const groups = new Map();

  for (const ing of items) {
    const key = buildCoursesAggregateKey(ing);
    if (!key) continue;

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ing);
  }

  let totalCoursesEur = 0;
  const seen = new Set();

  const itemsWithDupFlag = items.map((ing) => {
    const key = buildCoursesAggregateKey(ing);

    if (!key || !groups.has(key)) {
      return {
        ...ing,
        isCoursesDuplicate: false,
        groupedCostCourses: computeIngredientCostCourses(ing),
      };
    }

    if (seen.has(key)) {
      return {
        ...ing,
        isCoursesDuplicate: true,
        groupedCostCourses: null,
      };
    }

    seen.add(key);

    const grouped = groups.get(key);
    const totalQty = grouped.reduce((sum, row) => {
      const convertedQty = convertQtyToReferenceUnit(
        row.quantity,
        row.unit,
        ing.unit,
        row
      );

      return sum + (convertedQty != null ? convertedQty : 0);
    }, 0);

    const groupedRow = {
      ...ing,
      quantity: totalQty,
    };

    const groupedCostCourses = computeIngredientCostCourses(groupedRow);
    totalCoursesEur += groupedCostCourses;

    return {
      ...ing,
      isCoursesDuplicate: false,
      groupedCostCourses,
    };
  });

  return {
    itemsWithDupFlag,
    totalCoursesEur: roundMoney(totalCoursesEur),
  };
}

function computeIngredientCostCourses(ing) {
  const buyPrice = typeof ing?.buyPriceEur === 'number' ? ing.buyPriceEur : null;
  const refQty = typeof ing?.buyRefQty === 'number' ? ing.buyRefQty : null;
  const refUnit = typeof ing?.buyRefUnit === 'string' ? ing.buyRefUnit : null;

  if (buyPrice == null || refQty == null || !refUnit) return 0;

  let qBase = toBaseQty(toNumber(ing?.quantity), String(ing?.unit || ''));
  const packBase = toBaseQty(refQty, refUnit);

  if (!qBase || !packBase) return 0;

  if (qBase.unit === packBase.unit) {
    const packs = Math.max(1, Math.ceil(qBase.qty / packBase.qty));
    return packs * buyPrice;
  }

  const gpp = typeof ing?.gramsPerPiece === 'number' ? ing.gramsPerPiece : null;
  if (qBase.unit === 'piece' && packBase.unit === 'g' && gpp && gpp > 0) {
    qBase = { qty: qBase.qty * gpp, unit: 'g' };
    const packs = Math.max(1, Math.ceil(qBase.qty / packBase.qty));
    return packs * buyPrice;
  }

  if (qBase.unit === 'g' && packBase.unit === 'piece' && gpp && gpp > 0) {
    qBase = { qty: qBase.qty / gpp, unit: 'piece' };
    const packs = Math.max(1, Math.ceil(qBase.qty / packBase.qty));
    return packs * buyPrice;
  }

  const d = typeof ing?.density_g_per_ml === 'number' ? ing.density_g_per_ml : null;
  if (d && d > 0) {
    if (qBase.unit === 'ml' && packBase.unit === 'g') {
      qBase = { qty: qBase.qty * d, unit: 'g' };
      const packs = Math.max(1, Math.ceil(qBase.qty / packBase.qty));
      return packs * buyPrice;
    }

    if (qBase.unit === 'g' && packBase.unit === 'ml') {
      qBase = { qty: qBase.qty / d, unit: 'ml' };
      const packs = Math.max(1, Math.ceil(qBase.qty / packBase.qty));
      return packs * buyPrice;
    }
  }

  return 0;
}

async function buildPersistedPricing(rawIngredients) {
  const items = Array.isArray(rawIngredients) ? rawIngredients : [];

  const enrichedIngredients = await Promise.all(
    items.map(async (i) => {
      const base = {
        name: String(i?.name || '').trim(),
        quantity: toNumber(i?.quantity),
        unit: String(i?.unit || '').trim(),
        ingredientBaseId: i?.ingredientBaseId ?? i?.airtableId ?? null,
      };

      if (!base.name) {
        return {
          name: '',
          quantity: 0,
          unit: 'piece',
          ingredientBaseId: null,
          airtableId: null,
          unitPriceBuy: null,
          costRecipe: 0,
          buyPriceEur: null,
          buyRefQty: null,
          buyRefUnit: null,
          buyLabel: null,
          gramsPerPiece: null,
          density_g_per_ml: null,
          mlPerPiece: null,
          category: null,
          priceStatus: 'invalid',
          priceMessage: "Nom d’ingrédient vide",
          costCourses: 0,
        };
      }

      const enriched = await enrichIngredientWithCost(base);

      const row = {
        name: tidyName(base.name),
        quantity: toNumber(base.quantity),
        unit: canonUnit(base.unit) || normalizeUnit(base.unit) || 'piece',

        ingredientBaseId: enriched?.id ?? base.ingredientBaseId ?? null,
        airtableId: enriched?.id ?? base.ingredientBaseId ?? null,

        unitPriceBuy: enriched?.unitPriceBuy ?? null,
        costRecipe: toNumber(enriched?.costRecipe),

        buyPriceEur: enriched?.buyPriceEur ?? null,
        buyRefQty: enriched?.buyRefQty ?? null,
        buyRefUnit: enriched?.buyRefUnit ?? null,
        buyLabel: enriched?.buyLabel ?? null,

        gramsPerPiece: enriched?.gramsPerPiece ?? null,
        density_g_per_ml: enriched?.density_g_per_ml ?? null,
        mlPerPiece: enriched?.mlPerPiece ?? null,

        category: VALID_CATEGORIES.has(enriched?.category) ? enriched.category : null,
        priceStatus: enriched?.priceStatus ?? null,
        priceMessage: enriched?.priceMessage ?? null,
      };

      return {
        ...row,
        costCourses: computeIngredientCostCourses(row),
      };
    })
  );

  const totalCostEur = roundMoney(
    enrichedIngredients.reduce((sum, ing) => sum + toNumber(ing.costRecipe), 0)
  );

  const groupedCourses = computeGroupedCourses(enrichedIngredients);

  const totalCoursesEur = groupedCourses.totalCoursesEur;

  const ingredientsForDb = groupedCourses.itemsWithDupFlag.map(
    ({ costCourses, groupedCostCourses, ...rest }) => rest
  );

  return {
    ingredientsForDb,
    totalCostEur,
    totalCoursesEur,
    pricingUpdatedAt: new Date(),
  };
}

module.exports = {
  buildPersistedPricing,
  computeIngredientCostCourses,
};