// backend/src/routes/shopping-list.js
const express = require('express');
const { prisma } = require('../lib/prisma');
const { mergeIngredients } = require('../utils/ingredients');
const { getIngredientPriceByName, toBaseUnit, toBaseQty } = require('../services/airtable');

const router = express.Router();

function needAuth(req, res, next) {
  if (!req.user?.userId) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// POST /shopping-list  { recipeIds: string[] }
router.post('/', needAuth, async (req, res) => {
  try {
    const { recipeIds } = req.body || {};
    if (!Array.isArray(recipeIds) || recipeIds.length === 0) {
      return res.status(400).json({ ok: false, error: 'recipeIds[] requis' });
    }

    // On ne renvoie que les recettes de l'utilisateur connecté
    const recipes = await prisma.recipe.findMany({
      where: { id: { in: recipeIds }, userId: req.user.userId },
      select: { id: true, title: true, ingredients: true },
    });

    // Aplatissement
    const allLines = recipes.flatMap((r) =>
      r.ingredients.map((i) => ({
        name: i.name,
        quantity: i.quantity,
        unit: i.unit,
      }))
    );

    // Fusion des lignes identiques (même name+unit)
    const merged = mergeIngredients(allLines);

    // Enrichissement avec prix Airtable
    let totalRecipeCost = 0;
    let totalBuyPrice = 0;
    const withPrices = [];

      for (const l of merged) {
    const price = await getIngredientPriceByName(l.name); // { unit:'g'|'ml'|'piece', pricePerUnit }
      if (!price || !price.pricePerUnit) {
    withPrices.push({
      ...l,
      unitPriceBuy: null,
      recipeCost: 0,
      buyPrice: 0,
      airtableId: price?.airtableId ?? null,
      unitNormalized: price?.unit ?? null,
    });
      continue;
  }

      // Si l'unité ne correspond pas exactement, on garde le coût simple (qty * ppu)
      const recipeU = toBaseUnit(l.unit); // { unit:'g'|'ml'|'piece', factor }
      const qtyInBase = recipeU.unit === 'g' || recipeU.unit === 'ml' || recipeU.unit === 'piece'
        ? (Number(l.quantity || 0) * recipeU.factor)
        : Number(l.quantity || 0);

      // 2) Si l’unité base du prix ne matche pas celle de la quantité, on ne sait pas convertir
      if (recipeU.unit !== price.unit) {
    // fallback : coût 0 (ou garde qty brute * ppu s’il y a un sens dans ton cas)
      withPrices.push({
      ...l,
      unitPriceBuy: price.pricePerUnit,
      recipeCost: 0,
      buyPrice: 0,
      airtableId: price.airtableId,
      unitNormalized: price.unit,
      note: 'unité incompatible (conversion manquante)',
    });
      continue;
  }

      const recipeCost = qtyInBase * price.pricePerUnit;
      const buyPrice = recipeCost; // même hypothèse

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
  } catch (e) {
    console.error('POST /shopping-list error:', e);
    res.status(500).json({ ok: false, error: 'internal error', message: e?.message });
  }
});

module.exports = router;
