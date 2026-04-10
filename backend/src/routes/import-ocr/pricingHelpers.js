// backend/src/routes/import-ocr/pricingHelpers.js
// LEVEL: ROUTE
// import autorisés : 
// import interdits : 
// importé uniquement par

'use strict';

const { normalizeLoose } = require('../../utils/stringUtils');
const { getIngredientPriceByName } = require('../../services/supabase');
const { convertUnitForPricing } = require('../../utils/units');

//Airtable pricing (v1)
function roundMoney(n) {
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Calcul le cout à partir :
 * ing: { name, quantity, unit }
 * priceRow: { unit: 'g'|'ml'|'piece', pricePerUnit: number, airtableId, ... }
 */
function computeIngredientCostEur(ing, priceRow) {
  if (!priceRow || !Number.isFinite(priceRow.pricePerUnit)) {
    return { price: null, costEur: 0, matched: false };
  }
  //si pas de quantité exploitable => on ne calcule pas le coût, mais on affiche le prix unitaire
  const qty = Number(ing?.quantity || 0);
  if (!Number.isFinite(qty) || qty <= 0) {
    return {
      price: { eurPer: priceRow.pricePerUnit, perUnit: priceRow.unit },
      costEur: 0,
      matched: true,
    };
  }

  // unit OCR
  const unitRaw = String(ing?.unit || '').trim();

  const converted = convertUnitForPricing(ing.name, qty, unitRaw, priceRow);

  // si conversion impossible, on affiche le prix unitaire, mais pas le cout calculeé
  if(!converted || converted.unit !== priceRow.unit) {
    return {
      price: { eurPer: priceRow.pricePerUnit, 
        perUnit: priceRow.unit
      },
      costEur: null,
      matched: true,
    };
  }

  const cost = converted.qty * Number(priceRow.pricePerUnit || 0);
  return {
    price: { eurPer: priceRow.pricePerUnit, perUnit: priceRow.unit },
    costEur: Number.isFinite(cost) ? roundMoney(cost) : null,
    matched: true,
  };
}

async function priceIngredients(ingredients, { dlog }= {}) {
  if (typeof dlog === 'function') {
    dlog('[debug][parsed ingredients]', ingredients);
  }

  let totalCostEur = 0;

  const pricedIngredients = await Promise.all(
    (ingredients || []).map(async (ing) => {
      try {
        // cas "sel" / "poivre" => on ne cherche pas de prix
        const n = String(ing?.name || '').trim().toLowerCase();
        if (n === 'sel' || n === 'poivre') {
          return {
            ...ing,
            price: null,
            costEur: 0,
            priceMatched: true, // on marque comme "ok" (pas d'alerte)
            pricingStatus: 'SKIPPED',
            id: null,
          };
        }
        const priceRow = await getIngredientPriceByName(ing.name, ing.unit);
        const { price, costEur, matched } = computeIngredientCostEur(ing, priceRow);

        if (typeof costEur === 'number' && Number.isFinite(costEur)) {
          totalCostEur += costEur;
        }

        return {
          ...ing,
          price,                          // { eurPer, perUnit } | null
          costEur,                        // number | null
          priceMatched: matched,          // boolean
          id: priceRow?.id|| null,

          buyPriceEur: priceRow?.buyPriceEur ?? priceRow?.buyPrice ?? null,
          buyRefQty: priceRow?.buyRefQty ?? priceRow?.refQty ?? null,
          buyRefUnit: priceRow?.buyRefUnit ?? priceRow?.refUnit ?? null,
        };
      } catch (e) {
        // si Airtable plante, on ne bloque pas l’OCR
        return {
          ...ing,
          price: null,
          costEur: 0,
          priceMatched: false,
          pricingStatus: 'ERROR',
          id: null,
        };
      }
    })
  );
  
  return { ingredients: pricedIngredients, totalCostEur: roundMoney(totalCostEur) };
}
// jusqu'ici Airtable pricing (v1)

//ajoute le 02/04/26 d'ici à - pour avoir un seul prix courses quand il y a deux ingredients identiques
function buildIngredientAggregateKey(row) {
  const name = normalizeLoose(row?.name || '');
  return name || '';
}

function annotateDuplicateCourses(ingredients) {
  const list = Array.isArray(ingredients) ? ingredients.map(x => ({ ...x })) : [];
  const seen = new Map();

  for (const row of list) {
    const key = buildIngredientAggregateKey(row);
    row.aggregateKey = key;

    if (!key) {
      row.isCoursesDuplicate = false;
      continue;
    }

    if (!seen.has(key)) {
      seen.set(key, true);
      row.isCoursesDuplicate = false;
    } else {
      row.isCoursesDuplicate = true;
    }
  }

  return list;
}
//ici






module.exports = {
    roundMoney,
    computeIngredientCostEur,
    priceIngredients,
    buildIngredientAggregateKey,
    annotateDuplicateCourses,
};