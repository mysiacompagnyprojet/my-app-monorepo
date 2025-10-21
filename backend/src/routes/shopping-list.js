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

// POST /shopping-list { recipeIds: string[] }
router.post('/', needAuth, async (req, res) => {
  const { recipeIds } = req.body || {};
  if (!Array.isArray(recipeIds) || recipeIds.length === 0) {
    return res.status(400).json({ ok: false, error: 'recipeIds requis' });
  }

  // récupère recettes + ingrédients de l’utilisateur
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

  const allLines = recipes.flatMap((r) =>
    r.ingredients.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      unit: i.unit,
    }))
  );

  const merged = mergeIngredients(allLines);

  let totalRecipeCost = 0;
  let totalBuyPrice = 0;
  const withPrices = [];

  for (const l of merged) {
    const price = await getIngredientPriceByName(l.name);
    if (!price) {
      withPrices.push({
        ...l,
        unitPriceBuy: null,
        recipeCost: 0,
        buyPrice: 0,
        airtableId: null,
        unitNormalized: null,
        note: 'non trouvé dans Airtable',
      });
      continue;
    }

    const priceUnit = price.unit; // g / ml / piece (base PPU)
    const unitRecipeCanon = canonUnit(l.unit);

    // tente conversion "piece -> g" quand le PPU est en g
    const conv = convertUnitForPricing(l.name, l.quantity, unitRecipeCanon, priceUnit);

    let recipeCost = 0;
    let buyPrice = 0;
    let note;

    if (price.pricePerUnit && conv.unit === priceUnit) {
      // unités compatibles (après conversion éventuelle)
      recipeCost = Number(conv.qty) * Number(price.pricePerUnit);
      buyPrice = recipeCost; // si achat à la demande (sinon logique panier à définir)
      totalRecipeCost += recipeCost;
      totalBuyPrice += buyPrice;
    } else {
      // incompatibilité: on garde 0 et on documente
      note = conv.note || 'unité incompatible (conversion manquante)';
    }

    withPrices.push({
      name: l.name,
      unit: l.unit,
      quantity: l.quantity,
      unitPriceBuy: price.pricePerUnit,
      recipeCost,
      buyPrice,
      airtableId: price.airtableId,
      unitNormalized: priceUnit, // l’unité “base” du PPU (g/ml/piece)
      ...(note ? { note } : {}),
    });
  }

  res.json({
    ok: true,
    items: withPrices,
    totals: { recipeCost: totalRecipeCost, buyPrice: totalBuyPrice },
  });
});

module.exports = router;
