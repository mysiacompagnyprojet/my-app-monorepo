// backend/src/routes/shopping-list.js
// LEVEL: ROUTE
// import autorisés : middleware-services-lib-utils-dependances externes(express, etc)
// import interdits : routes-frontend-parsers-ocr
// importé uniquement par src-index
const express = require('express');
const { prisma } = require('../lib/prisma');
const { mergeIngredients } = require('../utils/ingredients');
const { enrichIngredientWithCost } = require('../utils/costs');
const { normalizeKey } = require('../utils/stringUtils')

const router = express.Router();

function needAuth(req, res, next) {
  if (!req.user?.userId) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

/* get/shopping-list
Liste toutes les listes de coursesde l'utilisateur  */
router.get('/', needAuth, async (req, res) =>{
  try {
     const lists = await prisma.shoppingList.findMany({
      where: { userId: req.user.userId },
      orderBy: { createAt: 'desc' },
      select: {
        id: true,
        totalPrice: true,
        createAt: true,
        _count: {
          select: {
            recipes: true,
            items: true,
          },
        },
      },
    });
    return res.json({
      ok: true,
      shoppingLists: lists,
    });
  } catch (e) {
    console.error('GET /shopping-list error:', e);
    return res.status(500).json({ ok: false, error: 'internal error', message: e?.message });
  }
});


/* get/shopping-list/:id detail d'une liste de courses */
router.get('/:id', needAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const shoppingList = await prisma.shoppingList.findFirst({
      where: {
        id,
        userId: req.user.userId,
      },
      select: {
        id: true,
        totalPrice: true,
        createdAt: true,
        recipes: {
          select: {
            recipe: {
              select: {
                id: true,
                title: true,
              },
            },
          },
        },
        items: {
          orderBy: [
            { category: 'asc' },
            { ingredientName: 'asc' },
          ],
          select: {
            id: true,
            ingredientName: true,
            totalQuantity: true,
            unit: true,
            totalPrice: true,
            category: true,
          },
        },
      },  
    });

    if (!shoppingList) {
      return res.status(404).json({ ok: false, error: 'SHOPPING_LIST_NOT_FOUND' });
    }

    return res.json({
      ok: true,
      shoppingList: {
        ...shoppingList,
        recipes: shoppingList.recipes.map((r) => r.recipe),
      },
    });
  } catch (e) {
    console.error('GET /shopping-list/:id error', e);
    return res.status(500).json({ ok: false, error: 'internal error', message: e?.message });
  }
});

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
            id: null,
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
          id: enriched?.id ?? null,
          unitNormalized: enriched?.unitNormalized ?? null,
          category: enriched?.unitNormalized ?? null,
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

    //Création shopping list
    const shoppingList = await prisma.shoppingList.create({
      data: {
        userId: req.user.userId,
        totalPrice: totals.buyPrice,
      },
    });

    //liaison recettes
    await prisma.shoppingListRecipe.createMany({
      data: recipes.map(r => ({
        shoppingListId: shoppingList.id,
        recipeId: r.id
      }))
    });

    // Sauvegarde ingredients
    await prisma.shoppingListItem.createMany({
      data: pricedItems.map(item => ({
        shoppingListId: shoppingList.id,
        ingredientName: item.name,
        totalQuantity: item.quantity,
        unit: item.unit,
        totalPrice: item.buyPrice || 0,
        category: item.category || "other"
      }))
    });

    return res.json({
      ok: true,
      shoppingListId: shoppingList.id,
      items: pricedItems,
      totals,
    });
  } catch (e) {
    console.error('POST /shopping-list error:', e);
    return res.status(500).json({ ok: false, error: 'internal error', message: e?.message });
  }
});




module.exports = router;
