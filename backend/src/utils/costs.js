// backend/src/utils/costs.js

// Compat: accepte ../services/airtable OU ../services/airtable
let getIngredientPriceByName;
try {
  ({ getIngredientPriceByName } = require('../services/airtable'));
} catch {
  ({ getIngredientPriceByName } = require('../services/airtable'));
}

/**
 * Enrichit un ingrédient avec les infos Airtable:
 * - airtableId
 * - unitPriceBuy (pricePerUnit)
 * - costRecipe (quantity * pricePerUnit) si l’unité correspond
 *
 * @param {{ name: string, quantity?: number, unit?: string }} i
 * @returns {Promise<{
 *   name: string,
 *   quantity: number,
 *   unit: string,
 *   airtableId: string|null,
 *   unitPriceBuy: number|null,
 *   costRecipe: number|null
 * }>}
 */
async function enrichIngredientWithCost(i) {
  const pricing = await getIngredientPriceByName(i.name);

  if (!pricing) {
    return {
      ...i,
      airtableId: null,
      unitPriceBuy: null,
      costRecipe: null,
    };
  }

  const unitLower = (i.unit || '').toString().toLowerCase();
  const pricingUnitLower = (pricing.unit || '').toString().toLowerCase();

  const sameUnit =
    !unitLower || !pricingUnitLower || unitLower === pricingUnitLower;

  const qty = Number(i.quantity);
  const pricePerUnit = Number(pricing.pricePerUnit);

  const costRecipe =
    sameUnit && Number.isFinite(qty) && Number.isFinite(pricePerUnit)
      ? qty * pricePerUnit
      : null;

  return {
    ...i,
    airtableId: pricing.airtableId ?? null,
    unitPriceBuy: Number.isFinite(pricePerUnit) ? pricePerUnit : null,
    costRecipe,
  };
}

module.exports = { enrichIngredientWithCost };

