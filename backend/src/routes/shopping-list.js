// backend/src/routes/shopping-list.js
const express = require('express');
const { prisma } = require('../lib/prisma');
const { mergeIngredients } = require('../utils/ingredients');
const { enrichIngredientWithCost } = require('../utils/costs');

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
        // 0) Règles "gratuit"
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

        // 1) Source de vérité : enrich + conversions (densité + gousse)
        const enriched = await enrichIngredientWithCost({
          name: l.name,
          quantity: l.quantity,
          unit: l.unit,
        });

        // 2) Mapping réponse
        const recipeCost = Number(enriched?.costRecipe || 0);
        const unitPriceBuy = enriched?.unitPriceBuy ?? null;

        return {
          name: l.name,
          unit: l.unit,
          quantity: l.quantity,
          unitPriceBuy,
          recipeCost,
          buyPrice: recipeCost, // V1: achat = besoin
          airtableId: enriched?.airtableId ?? null,
          unitNormalized: enriched?.unitNormalized ?? null,
          ...(enriched?.note ? { note: enriched.note } : {}),
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
    return res.status(500).json({ ok: false, error: 'internal error', message: e?.message });
  }
});

module.exports = router;
