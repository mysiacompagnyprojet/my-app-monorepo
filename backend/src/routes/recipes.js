// backend/src/routes/recipes.js
const express = require('express');
const { prisma } = require('../lib/prisma');
const { enrichIngredientWithCost } = require('../utils/costs');
const { normalizeUnit } = require('../utils/units');

const router = express.Router();

function needAuth(req, res, next) {
  if (!req.user?.userId) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// GET /recipes
router.get('/', needAuth, async (req, res) => {
  const { userId } = req.user;
  const recipes = await prisma.recipe.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      servings: true,
      imageUrl: true,
      createdAt: true,
      ingredients: { select: { name: true, quantity: true, unit: true, costRecipe: true } },
    },
  });
  res.json({ ok: true, recipes });
});

// POST /recipes — crée une recette avec ingrédients enrichis (Airtable)
router.post('/', needAuth, async (req, res) => {
  console.log('POST /recipes req.user =', req.user);

  try {
    const body = req.body ?? {};
    let { title, servings, steps, imageUrl, notes, ingredients } = body;

    if (typeof steps === 'string') {
      try { steps = JSON.parse(steps); } catch { /* ignore */ }
    }

    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ ok: false, error: "Champ 'title' manquant ou invalide" });
    }

    if (servings == null) servings = 1;
    servings = Number(servings);
    if (!Number.isFinite(servings) || servings < 1) {
      return res.status(400).json({ ok: false, error: "Champ 'servings' doit être un nombre >= 1" });
    }

    if (steps == null) steps = [];
    if (!Array.isArray(steps)) {
      return res.status(400).json({ ok: false, error: "Champ 'steps' doit être un tableau" });
    }

    if (imageUrl && typeof imageUrl === 'object' && imageUrl.url) {
      imageUrl = imageUrl.url;
    }
    if (notes == null) notes = '';

    if (!Array.isArray(ingredients)) ingredients = [];
    const ingData = await Promise.all(
      ingredients.map(async (i) => {
        const base = {
          name: String(i?.name || '').trim(),
          quantity: Number(i?.quantity || 0),
          unit: normalizeUnit(i?.unit),
        };
        return await enrichIngredientWithCost(base); // { airtableId, unitPriceBuy, costRecipe, ... }
      })
    );

    console.log('POST /recipes req.user =', req.user);
    console.log('create data.userId =', req.user?.userId);
    console.log('ingData =', ingData);

    const recipe = await prisma.recipe.create({
      data: {
        userId: req.user.userId, // <-- UUID requis
        title,
        servings,
        steps,
        imageUrl: imageUrl || null,
        notes,
        ingredients: ingData.length ? { createMany: { data: ingData } } : undefined,
      },
      include: { ingredients: true },
    });

    return res.status(201).json({ ok: true, recipe });
  } catch (e) {
    console.error('POST /recipes error:', e);
    return res.status(500).json({ ok: false, error: 'internal error', message: e?.message });
  }
});

module.exports = router;
