// backend/src/routes/shopping-list.js
const express = require('express');
const { prisma } = require('../lib/prisma');
const { mergeIngredients } = require('../utils/ingredients');
const { getIngredientPriceByName } = require('../services/airtable');

const router = express.Router();

function needAuth(req, res, next) {
  if (!req.user?.userId) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// POST /shopping-list { recipeIds: string[] }
router.post('/', needAuth, async (req, res) => {
  const { recipeIds } = req.body;
  if (!Array.isArray(recipeIds) || recipeIds.length === 0) {
    return res.status(400).json({ ok: false, error: 'recipeIds requis' });
  }

  const recipes = await prisma.recipe.findMany({
    where: { id: { in: recipeIds } },
    select: { id: true, title: true, ingredients: true },
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
      withPrices.push({ ...l, recipeCost: 0, buyPrice: 0, airtableId: null });
      continue;
    }
    const recipeCost = (l.quantity || 0) * (price.pricePerUnit || 0);
    const buyPrice = recipeCost;
    totalRecipeCost += recipeCost;
    totalBuyPrice += buyPrice;
    withPrices.push({
      ...l,
      unitPriceBuy: price.pricePerUnit,
      recipeCost,
      buyPrice,
      airtableId: price.airtableId,
      unitNormalized: price.unit,
    });
  }

  res.json({
    ok: true,
    items: withPrices,
    totals: { recipeCost: totalRecipeCost, buyPrice: totalBuyPrice },
  });
});

module.exports = router;
