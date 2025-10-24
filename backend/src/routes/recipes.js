// backend/src/routes/recipes.js
const express = require('express');
const { prisma } = require('../lib/prisma');
const { enrichIngredientWithCost } = require('../utils/costs');
const { normalizeUnit } = require('../utils/units');
// ✅ Ajout pour le flux "from-draft"
const { cleanAndNormalizeIngredients } = require('../utils/ingredients'); // adapte le chemin/nom si besoin

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

/**
 * POST /recipes/from-draft/:draftId
 * Importe un brouillon (recipeDraft) en recette finale.
 * Pré-requis :
 *  - prisma.recipeDraft (avec champs: id, parsed, status, updatedAt, ...)
 *  - utils: cleanAndNormalizeIngredients(rawIngredients) -> [{ nameCanon, quantity, unit, ... }]
 *  - utils: enrichIngredientWithCost(base) -> enrichit via Airtable + calcule coûts
 *  - le modèle recipe accepte un champ JSON "source" { type: 'draft', draftId } (adapte si ton schéma diffère)
 */
router.post('/from-draft/:draftId', needAuth, async (req, res) => {
  try {
    const { draftId } = req.params;

    const draft = await prisma.recipeDraft.findUnique({ where: { id: draftId } });
    if (!draft) return res.status(404).json({ ok: false, error: 'DRAFT_NOT_FOUND' });

    if (!draft.parsed) {
      return res.status(400).json({ ok: false, error: 'DRAFT_NOT_PARSED', message: 'Remplis draft.parsed avant import.' });
    }

    // On récupère les infos "propres" depuis parsed
    const data = draft.parsed || {};
    const title = String(data.title || '').trim();
    if (!title) return res.status(400).json({ ok: false, error: "parsed.title manquant" });

    const servings = Number(data.servings || 1);
    const steps = Array.isArray(data.steps) ? data.steps : [];
    const imageUrl = data.imageUrl || null;
    const notes = typeof data.notes === 'string' ? data.notes : '';
    const rawIngredients = Array.isArray(data.ingredients) ? data.ingredients : [];

    // Nettoyage + normalisation (articles/pluriels/quantités + unit via normalizeUnit si utilisé dans l'util)
    const normalized = cleanAndNormalizeIngredients(rawIngredients);

    // Enrichissement via Airtable + coûts
    const ingData = await Promise.all(
      normalized.map(async (i) => {
        const base = {
          name: i.nameCanon,
          quantity: Number(i.quantity || 0),
          unit: i.unit || null,
        };
        return await enrichIngredientWithCost(base);
      })
    );

    // Création de la vraie recette
    const recipe = await prisma.recipe.create({
      data: {
        userId: req.user.userId,
        title,
        servings: Number.isFinite(servings) && servings > 0 ? servings : 1,
        steps,
        imageUrl: imageUrl || null,
        notes,
        ingredients: ingData.length ? { createMany: { data: ingData } } : undefined,
        // ⚠️ Assure-toi que ce champ existe dans ton schéma (JSON/Json)
        source: { type: 'draft', draftId },
      },
      include: { ingredients: true },
    });

    // Marque le draft comme importé
    await prisma.recipeDraft.update({
      where: { id: draftId },
      data: { status: 'imported', updatedAt: new Date() },
    });

    return res.json({ ok: true, recipe });
  } catch (e) {
    console.error('POST /recipes/from-draft error:', e);
    return res.status(500).json({ ok: false, error: 'internal error', message: e?.message });
  }
});

module.exports = router;
