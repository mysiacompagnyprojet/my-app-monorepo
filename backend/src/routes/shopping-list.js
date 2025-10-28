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

/**
 * POST /shopping-list
 * body: { recipeIds: string[] }
 *
 * But : fusionner les ingrédients de plusieurs recettes de l'utilisateur,
 * enrichir avec les prix Airtable, et retourner les totaux.
 *
 * Réponse:
 * {
 *   ok: true,
 *   items: [{
 *     name, unit, quantity,
 *     unitPriceBuy, recipeCost, buyPrice,
 *     airtableId, unitNormalized, note?
 *   }],
 *   totals: { recipeCost, buyPrice }
 * }
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

    // Fusionne par (name + unit) pour totaliser les quantités
    const merged = mergeIngredients(allLines);

    // Enrichissement prix en parallèle (Airtable)
    const pricedItems = await Promise.all(
      merged.map(async (l) => {
        const price = await getIngredientPriceByName(l.name);

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

        const priceUnit = price.unit; // unité de base du PPU (g/ml/piece)
        const unitRecipeCanon = canonUnit(l.unit);

        // Conversion éventuelle (ex: piece -> g) pour matcher l’unité du PPU
        const conv = convertUnitForPricing(
          l.name,
          l.quantity,
          unitRecipeCanon,
          priceUnit
        );

        let recipeCost = 0;
        let buyPrice = 0;
        let note;

        const pricePerUnit = Number(price.pricePerUnit);

        if (
          Number.isFinite(pricePerUnit) &&
          conv &&
          conv.unit === priceUnit &&
          Number.isFinite(Number(conv.qty))
        ) {
          // Unités compatibles après conversion éventuelle
          recipeCost = Number(conv.qty) * pricePerUnit;
          // Hypothèse simple: on achète pile la quantité nécessaire
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

