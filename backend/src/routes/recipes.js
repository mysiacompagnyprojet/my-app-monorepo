const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const { supabaseAuth } = require('../middleware/supabaseAuth');
const needAuth = supabaseAuth;



const {
  cleanAndNormalizeIngredients,
  enrichIngredientWithCost,
  tidyName,
  canonUnit,
  normalizeUnit,
} = require('../utils/ingredients');

// ─────────────────────────────────────────────
// GET /recipes → liste des recettes
// ─────────────────────────────────────────────
router.get('/', needAuth, async (req, res) => {
  try {
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
        ingredients: {
          select: {
            name: true,
            quantity: true,
            unit: true,
            costRecipe: true,
          },
        },
      },
    });

    res.json({ ok: true, recipes });
  } catch (e) {
    console.error('GET /recipes error:', e);
    res.status(500).json({ ok: false, error: 'internal error' });
  }
});

// ─────────────────────────────────────────────
// GET /recipes/:id → détail d’une recette
// ─────────────────────────────────────────────
router.get('/:id', needAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.user;

    const recipe = await prisma.recipe.findFirst({
      where: { id, userId },
      select: {
        id: true,
        title: true,
        servings: true,
        imageUrl: true,
        createdAt: true,
        notes: true,
        steps: true,
        ingredients: {
          select: {
            name: true,
            quantity: true,
            unit: true,
            costRecipe: true,
          },
        },
      },
    });

    if (!recipe) {
      return res.status(404).json({ ok: false, error: 'RECIPE_NOT_FOUND' });
    }

    res.json({ ok: true, recipe });
  } catch (e) {
    console.error('GET /recipes/:id error:', e);
    res.status(500).json({ ok: false, error: 'internal error' });
  }
});

// ─────────────────────────────────────────────
// POST /recipes → création manuelle
// ─────────────────────────────────────────────
router.post('/', needAuth, async (req, res) => {
  try {
    const body = req.body ?? {};
    let { title, servings, steps, imageUrl, notes, ingredients } = body;

    if (typeof steps === 'string') {
      try {
        steps = JSON.parse(steps);
      } catch {
        steps = [];
      }
    }

    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ ok: false, error: "Champ 'title' manquant ou invalide" });
    }

    servings = Number(servings ?? 1);
    if (!Number.isFinite(servings) || servings < 1) {
      return res.status(400).json({ ok: false, error: "Champ 'servings' doit être un nombre >= 1" });
    }

    steps = Array.isArray(steps) ? steps : [];
    if (imageUrl && typeof imageUrl === 'object' && imageUrl.url) {
      imageUrl = imageUrl.url;
    }

    notes = typeof notes === 'string' ? notes : '';
    ingredients = Array.isArray(ingredients) ? ingredients : [];

    // 1) Normalisation forte
    const normalized = cleanAndNormalizeIngredients(
      ingredients.map(i => ({
        name: i?.name,
        quantity: i?.quantity,
        unit: i?.unit,
      }))
    );

    // 2) Enrichissement coûts
    const ingData = await Promise.all(
      normalized.map(async (i) => {
        const base = {
          name: i.nameCanon,
          quantity: i.quantityNum ?? 0,
          unit: i.unit || 'piece',
        };

        const enriched = await enrichIngredientWithCost(base);

        return {
          ...base,
          airtableId: enriched?.airtableId ?? null,
          unitPriceBuy: enriched?.unitPriceBuy ?? null,
          costRecipe: enriched?.costRecipe ?? null,
        };
      })
    );

    // 3) Garde-fou final
    const ingDataFinal = ingData.map(i => ({
      ...i,
      name: tidyName(i.name),
      quantity: Number(i.quantity || 0),
      unit: canonUnit(i.unit) || normalizeUnit(i.unit) || 'piece',
    }));

    const recipe = await prisma.recipe.create({
      data: {
        userId: req.user.userId,
        title,
        servings,
        steps,
        imageUrl: imageUrl || null,
        notes,
        ingredients: ingDataFinal.length
          ? { createMany: { data: ingDataFinal } }
          : undefined,
      },
      include: { ingredients: true },
    });

    res.status(201).json({ ok: true, recipe });
  } catch (e) {
    console.error('POST /recipes error:', e);
    res.status(500).json({ ok: false, error: 'internal error', message: e?.message });
  }
});

// ─────────────────────────────────────────────
// POST /recipes/from-draft/:draftId → import OCR
// ─────────────────────────────────────────────
router.post('/from-draft/:draftId', needAuth, async (req, res) => {
  try {
    const { draftId } = req.params;

    const draft = await prisma.recipeDraft.findUnique({
      where: { id: draftId },
    });

    if (!draft) {
      return res.status(404).json({ ok: false, error: 'DRAFT_NOT_FOUND' });
    }

    if (!draft.parsed) {
      return res.status(400).json({
        ok: false,
        error: 'DRAFT_NOT_PARSED',
        message: 'Remplis draft.parsed avant import.',
      });
    }

    const data = draft.parsed || {};
    const title = String(data.title || '').trim();
    if (!title) {
      return res.status(400).json({ ok: false, error: 'parsed.title manquant' });
    }

    const servings = Number(data.servings || 1);
    const steps = Array.isArray(data.steps) ? data.steps : [];
    const imageUrl = data.imageUrl || null;
    const notes = typeof data.notes === 'string' ? data.notes : '';
    const rawIngredients = Array.isArray(data.ingredients) ? data.ingredients : [];

    const normalized = cleanAndNormalizeIngredients(rawIngredients);

    const ingData = await Promise.all(
      normalized.map(async (i) => {
        const base = {
          name: i.nameCanon,
          quantity: i.quantityNum ?? 0,
          unit: i.unit || 'piece',
        };

        const enriched = await enrichIngredientWithCost(base);

        return {
          ...base,
          airtableId: enriched?.airtableId ?? null,
          unitPriceBuy: enriched?.unitPriceBuy ?? null,
          costRecipe: enriched?.costRecipe ?? null,
        };
      })
    );

    const ingDataFinal = ingData.map(i => ({
      ...i,
      name: tidyName(i.name),
      quantity: Number(i.quantity || 0),
      unit: canonUnit(i.unit) || normalizeUnit(i.unit) || 'piece',
    }));

    const recipe = await prisma.recipe.create({
      data: {
        userId: req.user.userId,
        title,
        servings: Number.isFinite(servings) && servings > 0 ? servings : 1,
        steps,
        imageUrl,
        notes,
        ingredients: ingDataFinal.length
          ? { createMany: { data: ingDataFinal } }
          : undefined,
      },
      include: { ingredients: true },
    });

    await prisma.recipeDraft.update({
      where: { id: draftId },
      data: { status: 'imported', updatedAt: new Date() },
    });

    res.json({ ok: true, recipe });
  } catch (e) {
    console.error('POST /recipes/from-draft error:', e);
    res.status(500).json({ ok: false, error: 'internal error', message: e?.message });
  }
});

module.exports = router;
