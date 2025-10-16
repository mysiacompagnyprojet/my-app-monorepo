// backend/src/utils/costs.js
const { getIngredientPriceByName } = require('../services/airtable');

async function enrichIngredientWithCost(i) {
  const pricing = await getIngredientPriceByName(i.name);
  if (!pricing) return { ...i, airtableId: null, unitPriceBuy: null, costRecipe: null };

  const sameUnit = !i.unit || !pricing.unit || i.unit.toLowerCase() === String(pricing.unit).toLowerCase();
  const costRecipe = sameUnit && Number.isFinite(i.quantity)
    ? i.quantity * Number(pricing.pricePerUnit)
    : null;

  return {
    ...i,
    airtableId: pricing.airtableId,
    unitPriceBuy: pricing.pricePerUnit ?? null,
    costRecipe
  };
}

module.exports = { enrichIngredientWithCost };
