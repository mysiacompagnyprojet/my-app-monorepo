// backend/src/routes/shopping-list.js
const express = require('express');
const { prisma } = require('../lib/prisma');
const { mergeIngredients } = require('../utils/ingredients');
const { getIngredientPriceByName } = require('../services/airtable');
const { canonUnit, convertUnitForPricing } = require('../utils/units');

const router = express.Router();

function needAuth(req, res, next) {
  if (!req.user?.userId) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// Normalise pour règles "gratuit" (eau / sel / poivre)
function normalizeKey(s = '') {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // enlève accents
    .replace(/[^a-z0-9\s&]/g, ' ')   // garde lettres/chiffres/espace/&
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Conversion minimale pour la logique "densité" :
 * - g/kg/mg => g
 * - ml/cl/dl/l => ml
 * - piece => piece (inchangé)
 */
function toBaseQtyForDensity(qty, unitRaw) {
  const u = canonUnit(unitRaw);
  const n = Number(qty || 0);

  if (!Number.isFinite(n)) return { qty: NaN, unit: u || null };

  // Masse -> g
  if (u === 'mg') return { qty: n * 0.001, unit: 'g' };
  if (u === 'kg') return { qty: n * 1000, unit: 'g' };
  if (u === 'g') return { qty: n, unit: 'g' };

  // Volume -> ml
  if (u === 'cl') return { qty: n * 10, unit: 'ml' };
  if (u === 'dl') return { qty: n * 100, unit: 'ml' };
  if (u === 'l') return { qty: n * 1000, unit: 'ml' };
  if (u === 'ml') return { qty: n, unit: 'ml' };

  // Pièce / inconnu
  return { qty: n, unit: u || null };
}

/**
 * POST /shopping-list
 * body: { recipeIds: string[] }
 */
router.post('/', needAuth, async (req, res) => {
  try {
    const { recipeIds } = req.body || {};
    if (!Array.isArray(recipeIds) || recipeIds.length === 0) {
      return res.status(400).json({ ok: false, error: 'recipeIds[] requis' });
    }

    // On ne traite que les recettes appartenant à l'utilisateur
    const recipes = await prisma.recipe.findMany({
      where: { id: { in: recipeIds }, userId: req.user.userId },
      select: {
        id: true,
        title: true,
        ingredients: {
          select: { name: true, quantity: true, unit: true },
        },
      },
    });

    // Aplatit tous les ingrédients
    const allLines = recipes.flatMap((r) =>
      r.ingredients.map((i) => ({
        name: i.name,
        quantity: Number(i.quantity || 0),
        unit: i.unit,
      }))
    );

    // Fusionne par (name + unit)
    const merged = mergeIngredients(allLines);

    const pricedItems = await Promise.all(
      merged.map(async (l) => {
        // 0) Règles "gratuit" (ne pas appeler Airtable)
        const key = normalizeKey(l.name);

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
            name: l.name,
            unit: l.unit,
            quantity: l.quantity,
            unitPriceBuy: 0,
            recipeCost: 0,
            buyPrice: 0,
            airtableId: null,
            unitNormalized: null,
          };
        }

        // 1) Sinon, on cherche le prix dans Airtable
        const price = await getIngredientPriceByName(l.name, l.unit);

        if (!price) {
          return {
            ...l,
            unitPriceBuy: null,
            recipeCost: 0,
            buyPrice: 0,
            airtableId: null,
            unitNormalized: null,
            note: 'non trouvé dans Airtable',
          };
        }

        const priceUnit = price.unit; // 'g' | 'ml' | 'piece'
        const unitRecipeCanon = canonUnit(l.unit);
        const pricePerUnit = Number(price.pricePerUnit);

        // ✅ 2) Conversion spéciale densité (g <-> ml) si Airtable fournit density_g_per_ml
        // density = g/ml
        const density = Number(price.density_g_per_ml);

        if (Number.isFinite(density) && density > 0 && Number.isFinite(pricePerUnit)) {
          const qtyNum = Number(l.quantity || 0);

          // recette volume -> pricing en g
          if (priceUnit === 'g' && ['ml', 'cl', 'dl', 'l'].includes(unitRecipeCanon)) {
            const base = toBaseQtyForDensity(qtyNum, unitRecipeCanon); // -> ml
            if (base.unit === 'ml' && Number.isFinite(base.qty)) {
              const qtyG = Number(base.qty) * density; // g = ml * densité
              const recipeCost = qtyG * pricePerUnit;

              return {
                name: l.name,
                unit: l.unit,
                quantity: l.quantity,
                unitPriceBuy: pricePerUnit,
                recipeCost,
                buyPrice: recipeCost,
                airtableId: price.airtableId ?? null,
                unitNormalized: 'g',
                note: 'conversion densité (ml→g)',
              };
            }
          }

          // recette g -> pricing en ml
          if (priceUnit === 'ml' && ['g', 'kg', 'mg'].includes(unitRecipeCanon)) {
            const base = toBaseQtyForDensity(qtyNum, unitRecipeCanon); // -> g
            if (base.unit === 'g' && Number.isFinite(base.qty)) {
              const qtyMl = Number(base.qty) / density; // ml = g / densité
              const recipeCost = qtyMl * pricePerUnit;

              return {
                name: l.name,
                unit: l.unit,
                quantity: l.quantity,
                unitPriceBuy: pricePerUnit,
                recipeCost,
                buyPrice: recipeCost,
                airtableId: price.airtableId ?? null,
                unitNormalized: 'ml',
                note: 'conversion densité (g→ml)',
              };
            }
          }
        }

        // ✅ 3) Priorité conversion "pièce -> g/ml" via Airtable (gramsPerPiece / mlPerPiece)
        if (
          unitRecipeCanon === 'piece' &&
          priceUnit === 'g' &&
          Number.isFinite(Number(price.gramsPerPiece)) &&
          Number.isFinite(pricePerUnit)
        ) {
          const qtyG = Number(l.quantity || 0) * Number(price.gramsPerPiece);
          const recipeCost = qtyG * pricePerUnit;

          return {
            name: l.name,
            unit: l.unit,
            quantity: l.quantity,
            unitPriceBuy: pricePerUnit,
            recipeCost,
            buyPrice: recipeCost,
            airtableId: price.airtableId ?? null,
            unitNormalized: 'g',
            note: 'conversion pièce→g (Airtable)',
          };
        }

        if (
          unitRecipeCanon === 'piece' &&
          priceUnit === 'ml' &&
          Number.isFinite(Number(price.mlPerPiece)) &&
          Number.isFinite(pricePerUnit)
        ) {
          const qtyMl = Number(l.quantity || 0) * Number(price.mlPerPiece);
          const recipeCost = qtyMl * pricePerUnit;

          return {
            name: l.name,
            unit: l.unit,
            quantity: l.quantity,
            unitPriceBuy: pricePerUnit,
            recipeCost,
            buyPrice: recipeCost,
            airtableId: price.airtableId ?? null,
            unitNormalized: 'ml',
            note: 'conversion pièce→ml (Airtable)',
          };
        }

        // 4) Conversion standard (ex: cl->ml, kg->g, etc.) via ton util existant
        const conv = convertUnitForPricing(l.name, l.quantity, unitRecipeCanon, priceUnit);

        let recipeCost = 0;
        let buyPrice = 0;
        let note;

        if (
          Number.isFinite(pricePerUnit) &&
          conv &&
          conv.unit === priceUnit &&
          Number.isFinite(Number(conv.qty))
        ) {
          recipeCost = Number(conv.qty) * pricePerUnit;
          buyPrice = recipeCost;
        } else {
          note = (conv && conv.note) || 'unité incompatible (conversion manquante)';
        }

        return {
          name: l.name,
          unit: l.unit,
          quantity: l.quantity,
          unitPriceBuy: Number.isFinite(pricePerUnit) ? pricePerUnit : null,
          recipeCost,
          buyPrice,
          airtableId: price.airtableId ?? null,
          unitNormalized: priceUnit || null,
          ...(note ? { note } : {}),
        };
      })
    );

    // Totaux
    const totals = pricedItems.reduce(
      (acc, row) => {
        acc.recipeCost += Number(row.recipeCost || 0);
        acc.buyPrice += Number(row.buyPrice || 0);
        return acc;
      },
      { recipeCost: 0, buyPrice: 0 }
    );

    return res.json({
      ok: true,
      items: pricedItems,
      totals,
    });
  } catch (e) {
    console.error('POST /shopping-list error:', e);
    return res.status(500).json({ ok: false, error: 'internal error' });
  }
});

module.exports = router;


