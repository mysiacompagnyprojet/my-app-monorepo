// backend/src/utils/costs.js
const { getIngredientPriceByName, canonUnit, toBaseQty } = require('../services/airtable');

// Règles "gratuit" (évite Airtable + évite faux calculs)
function normalizeKey(s = '') {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // enlève accents
    .replace(/[^a-z0-9\s&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Enrichit un ingrédient avec Airtable + calcule le coût.
 * ✅ Gère :
 * - conversions standard (kg/mg -> g, cl/dl/l -> ml)
 * - densité (g <-> ml) via density_g_per_ml
 * - gousse / pièce via gramsPerPiece / mlPerPiece
 *
 * @param {{ name: string, quantity?: number, unit?: string }} i
 * @returns {Promise<{
 *  name: string,
 *  quantity: number,
 *  unit: string,
 *  airtableId: string|null,
 *  unitPriceBuy: number|null,
 *  costRecipe: number|null,
 *  unitNormalized?: string|null,
 *  note?: string
 * }>}
 */
async function enrichIngredientWithCost(i) {
  const base = {
    name: String(i?.name || '').trim(),
    quantity: Number(i?.quantity || 0) || 0,
    unit: String(i?.unit || '').trim(),
  };

  // Garde-fou
  if (!base.name) {
    return {
      ...base,
      airtableId: null,
      unitPriceBuy: null,
      costRecipe: 0,
      unitNormalized: null,
      note: 'nom vide',
    };
  }

  // 0) Règles "gratuit"
  const key = normalizeKey(base.name);

  const isWater = key === 'eau' || key.startsWith('eau ');
  const isSaltPepper =
    key === 'sel' ||
    key === 'poivre' ||
    key === 'sel & poivre' ||
    key === 'sel&poivre' ||
    key.includes('sel & poivre') ||
    key.includes('sel et poivre') ||
    (key.includes('poivre') && key.includes('sel'));

  if (isWater || isSaltPepper) {
    return {
      ...base,
      airtableId: null,
      unitPriceBuy: 0,
      costRecipe: 0,
      unitNormalized: null,
    };
  }

  // 1) Lookup Airtable (en tenant compte de l'unité recette si possible)
  const pricing = await getIngredientPriceByName(base.name, base.unit);
  if (!pricing) {
    return {
      ...base,
      airtableId: null,
      unitPriceBuy: null,
      costRecipe: 0,
      unitNormalized: null,
      note: 'non trouvé dans Airtable',
    };
  }

  const priceUnit = pricing.unit; // 'g' | 'ml' | 'piece'
  const pricePerUnit = Number(pricing.pricePerUnit);

  if (!Number.isFinite(pricePerUnit) || pricePerUnit <= 0) {
    return {
      ...base,
      airtableId: pricing.airtableId ?? null,
      unitPriceBuy: null,
      costRecipe: 0,
      unitNormalized: priceUnit || null,
      note: 'prix unitaire invalide',
    };
  }

  const uRecipe = canonUnit(base.unit); // ex: 'cl' => 'cl'
  const qty = Number(base.quantity || 0);

  // 2) Conversion densité (g <-> ml) si dispo
  // density = g/ml
  const density = Number(pricing.density_g_per_ml);

  if (Number.isFinite(density) && density > 0) {
    // recette en volume -> Airtable en g
    if (priceUnit === 'g' && ['ml', 'cl', 'dl', 'l'].includes(uRecipe)) {
      const b = toBaseQty(qty, uRecipe); // -> ml
      if (b.unit === 'ml' && Number.isFinite(b.qty)) {
        const qtyG = Number(b.qty) * density; // g = ml * densité
        const cost = qtyG * pricePerUnit;

        return {
          ...base,
          airtableId: pricing.airtableId ?? null,
          unitPriceBuy: pricePerUnit,
          costRecipe: cost,
          unitNormalized: 'g',
          note: 'conversion densité (ml→g)',
        };
      }
    }

    // recette en masse -> Airtable en ml
    if (priceUnit === 'ml' && ['g', 'kg', 'mg'].includes(uRecipe)) {
      const b = toBaseQty(qty, uRecipe); // -> g
      if (b.unit === 'g' && Number.isFinite(b.qty)) {
        const qtyMl = Number(b.qty) / density; // ml = g / densité
        const cost = qtyMl * pricePerUnit;

        return {
          ...base,
          airtableId: pricing.airtableId ?? null,
          unitPriceBuy: pricePerUnit,
          costRecipe: cost,
          unitNormalized: 'ml',
          note: 'conversion densité (g→ml)',
        };
      }
    }
  }

  // 3) Conversion pièce -> g/ml via Airtable
  if (uRecipe === 'piece' && priceUnit === 'g') {
    const gpp = Number(pricing.gramsPerPiece);
    if (Number.isFinite(gpp) && gpp > 0) {
      const qtyG = qty * gpp;
      const cost = qtyG * pricePerUnit;

      return {
        ...base,
        airtableId: pricing.airtableId ?? null,
        unitPriceBuy: pricePerUnit,
        costRecipe: cost,
        unitNormalized: 'g',
        note: 'conversion pièce→g (Airtable)',
      };
    }
  }

  if (uRecipe === 'piece' && priceUnit === 'ml') {
    const mpp = Number(pricing.mlPerPiece);
    if (Number.isFinite(mpp) && mpp > 0) {
      const qtyMl = qty * mpp;
      const cost = qtyMl * pricePerUnit;

      return {
        ...base,
        airtableId: pricing.airtableId ?? null,
        unitPriceBuy: pricePerUnit,
        costRecipe: cost,
        unitNormalized: 'ml',
        note: 'conversion pièce→ml (Airtable)',
      };
    }
  }

  // 4) Conversion standard (kg/mg->g, cl/dl/l->ml) si compatible direct
  const b = toBaseQty(qty, uRecipe); // -> g/ml/piece (base)
  if (b && b.unit === priceUnit && Number.isFinite(b.qty)) {
    const cost = Number(b.qty) * pricePerUnit;

    return {
      ...base,
      airtableId: pricing.airtableId ?? null,
      unitPriceBuy: pricePerUnit,
      costRecipe: cost,
      unitNormalized: priceUnit || null,
    };
  }

  // 5) Sinon : incompatible
  return {
    ...base,
    airtableId: pricing.airtableId ?? null,
    unitPriceBuy: pricePerUnit,
    costRecipe: 0,
    unitNormalized: priceUnit || null,
    note: 'unité incompatible (conversion manquante)',
  };
}

module.exports = { enrichIngredientWithCost };




