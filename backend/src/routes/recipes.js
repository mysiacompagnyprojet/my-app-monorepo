// backend/src/routes/recipes.js
// LEVEL: ROUTE
// import autorisés : middleware-services-lib-utils-dependances externes(express, etc)
// import interdits : routes-frontend-parsers-ocr
// importé uniquement par src-index
const express = require('express');
const router = express.Router();
console.log("RECIPES ROUTE LOAPED");
const { prisma } = require('../lib/prisma');
const { buildPersistedPricing } = require('../services/recipePricing')
const { supabaseAuth } = require('../middleware/supabaseAuth');
const { getPricingPolicy } = require('../services/importLimits');
// ✅ Source de vérité prix + conversions (densité + gramsPerPiece)
const { enrichIngredientWithCost } = require('../utils/costs');
const needAuth = supabaseAuth;


const DEBUG_OCR = process.env.OCR_DEBUG === '1';

function stripRecipePrices(recipe) {
  if (!recipe) return recipe;

  return {
    ...recipe,
    totalCostEur: null,
    totalCoursesEur: null,
    ingredients: Array.isArray(recipe.ingredients)
      ? recipe.ingredients.map((ing) => ({
          ...ing,
          unitPriceBuy: null,
          costRecipe: null,
          buyPriceEur: null,
          buyRefQty: null,
          buyRefUnit: null,
          buyLabel: null,
          gramsPerPiece: null,
          density_g_per_ml: null,
          mlPerPiece: null,
          priceStatus: 'locked',
          priceMessage: 'Prix réservé aux utilisateurs Premium',
        }))
      : recipe.ingredients,
  };
}


async function buildEconomySuggestion(ingredients, totalCostEur) {
 const list = Array.isArray(ingredients) ? ingredients : []

 const priced = list
   .map((ing) => {
     const cost =
       typeof ing?.costEur === 'number'
         ? ing.costEur
         : typeof ing?.costRecipe === 'number'
         ? ing.costRecipe
         : 0

     const sourceIngredientId =
       typeof ing?.ingredientBaseId === 'string' && ing.ingredientBaseId.trim()
         ? ing.ingredientBaseId.trim()
         : typeof ing?.id === 'string' && ing.id.trim()
         ? ing.id.trim()
         : null

     return {
       name: String(ing?.name || '').trim(),
       cost,
       sourceIngredientId,
     }
   })
   .filter((ing) => ing.name && ing.cost > 0 && ing.sourceIngredientId)

 if (!priced.length) return null

 const mostExpensive = priced.sort((a, b) => b.cost - a.cost)[0]

 const substitutions = await prisma.ingredientSubstitution.findMany({
   where: { sourceIngredientId: mostExpensive.sourceIngredientId },
   orderBy: { rank: 'asc' },
   select: {
     targetIngredientId: true,
     label: true,
     substitutionType: true,
     note: true,
     rank: true,
   },
 })

 if (!substitutions.length) {
   return {
     ingredientName: mostExpensive.name,
     substitutions: [],
     savingEur: null,
     newTotalEur: null,
     label: 'Alternative possible selon la recette',
     note: null,
   }
 }

 const targetIds = substitutions.map((s) => s.targetIngredientId)

 const targets = await prisma.ingredients_base.findMany({
   where: { id: { in: targetIds } },
   select: {
     id: true,
     nom: true,
     prix_d_achat: true,
   },
 })

 const targetById = new Map(targets.map((t) => [t.id, t]))

 const enrichedSubs = substitutions
   .map((s) => {
     const target = targetById.get(s.targetIngredientId)
     return {
       id: s.targetIngredientId,
       name: target?.nom || null,
       buyPriceEur:
         typeof target?.prix_d_achat === 'number'
           ? target.prix_d_achat
           : target?.prix_d_achat != null
           ? Number(target.prix_d_achat)
           : null,
     }
   })
   .filter((s) => s.name)

 // V1 honnête : économie estimée simple tant qu’on n’a pas les quantités de substitution
 const savingEur = mostExpensive.cost * 0.2
 const newTotalEur =
   typeof totalCostEur === 'number' && Number.isFinite(totalCostEur)
     ? Math.max(0, totalCostEur - savingEur)
     : null

 return {
   ingredientName: mostExpensive.name,
   substitutions: enrichedSubs,
   savingEur,
   newTotalEur,
   label: substitutions[0]?.label || 'Alternative possible selon la recette',
   note: substitutions[0]?.note || null,
 }
}

// ─────────────────────────────────────────────
// GET /recipes → liste des recettes - remplacer le 09/04/26
// ─────────────────────────────────────────────
router.get('/', needAuth, async (req, res) => {
  try {
    const { userId } = req.user;
    const { cat } = req.query;

    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { subscriptionStatus: true },
    });

    const plan = u?.subscriptionStatus === 'active' ? 'premium' : 'free';
    const policy = await getPricingPolicy({ userId, plan });

    const limits = {
      blurPrices: policy.blurPrices,
      used: policy.used,
      limit: policy.limit,
      remaining: Math.max(0, policy.limit - policy.used),
    };

    const recipes = await prisma.recipe.findMany({
      where: {
        userId,
        ...(cat && {
          categories: {
            some: {
              categoryId: String(cat),
            },
          },
        }),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        servings: true,
        imageUrl: true,
        createdAt: true,
        totalCostEur: true,
        totalCoursesEur: true,
      },
    });

    const safeRecipes = policy.blurPrices
  ? recipes.map(stripRecipePrices)
  : recipes;

  return res.json({ ok: true, recipes: safeRecipes, limits });
  } catch (e) {
    console.error('GET /recipes error:', e);
    return res.status(500).json({ ok: false, error: 'internal error' });
  }
});


// ─────────────────────────────────────────────
// POST /recipes/enrich-ingredients
// body: { ingredients: [{ name, quantity, unit }] }
// ─────────────────────────────────────────────
router.post('/enrich-ingredients', needAuth, async (req, res) => {
  const body = req.body ?? {}
  const list = Array.isArray(body.ingredients) ? body.ingredients : []

  if (!list.length) {
    return res.status(400).json({ ok: false, error: 'ingredients[] requis' })
  }

  try {
    const { userId } = req.user;

    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { subscriptionStatus: true },
    });

    const plan = u?.subscriptionStatus === 'active' ? 'premium' : 'free';
    const policy = await getPricingPolicy({ userId, plan });

    if (policy.blurPrices) {
      return res.status(200).json({
        ok: true,
        ingredients: list.map((i) => ({
          name: String(i?.name || '').trim(),
          quantity: Number(i?.quantity || 0) || 0,
          unit: String(i?.unit || '').trim(),
          ingredientBaseId: null,
          id: null,
          priceMatched: false,
          unitPriceBuy: null,
          costEur: null,
          buyPriceEur: null,
          buyLabel: null,
          buyRefQty: null,
          buyRefUnit: null,
          priceStatus: 'locked',
          priceMessage: 'Prix réservé aux utilisateurs Premium',
        })),
        totalCoursesEur: null,
        locked: true,
      });
    }

    const pricing = await buildPersistedPricing(list)


  const out = pricing.ingredientsForDb.map((ing) => ({
    name: ing.name,
    quantity: ing.quantity,
    unit: ing.unit,

    ingredientBaseId: ing.ingredientBaseId,
    id: ing.ingredientBaseId,

    priceMatched: Boolean(ing.ingredientBaseId),

    unitPriceBuy: ing.unitPriceBuy,

    costEur: ing.costRecipe,

    buyPriceEur: ing.buyPriceEur,
    buyLabel: ing.buyLabel,
    buyRefQty: ing.buyRefQty,
    buyRefUnit: ing.buyRefUnit,

    gramsPerPiece: ing.gramsPerPiece,
    density_g_per_ml: ing.density_g_per_ml,
    mlPerPiece: ing.mlPerPiece,
    category: ing.category,

    priceStatus: ing.priceStatus,
    priceMessage: ing.priceMessage,

    isCoursesDuplicate: ing.isCoursesDuplicate ?? false
  }))

   console.log('[ENRICH RESULT sample]', out?.[0])
   console.log('[ENRICH RESULT keys]', Object.keys(out?.[0] || {}))

   return res.status(200).json({ ok: true, ingredients: out, totalCoursesEur: pricing.totalCoursesEur })
 } catch (e) {
   console.error('POST /recipes/enrich-ingredients unexpected error:', e)

   // ✅ fallback “safe” : aucune logique métier ici
   const outError = list.map((i) => {
     const base = {
       name: String(i?.name || '').trim(),
       quantity: Number(i?.quantity || 0) || 0,
       unit: String(i?.unit || '').trim(),
       ingredientBaseId: i?.ingredientBaseId ?? null,
     }

     return {
       ...base,
       id: null,
       priceMatched: false,
       unitPriceBuy: null,
       costEur: 0,
       buyPriceEur: null,
       buyLabel: null,
       buyRefQty: null,
       buyRefUnit: null,
       priceStatus: 'error',
       priceMessage: 'Erreur calcul prix',
     }
   })

   return res.status(200).json({ ok: true, ingredients: outError })
 }
})


// ─────────────────────────────────────────────
// POST /recipes/economy-suggestion
// body: { ingredients: [{ name, costEur, ingredientBaseId?, id? }], totalCostEur?: number }
// ─────────────────────────────────────────────
router.post('/economy-suggestion', needAuth, async (req, res) => {
 try {
  const { userId } = req.user;

  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { subscriptionStatus: true },
  });

  const plan = u?.subscriptionStatus === 'active' ? 'premium' : 'free';
  const policy = await getPricingPolicy({ userId, plan });

  if (policy.blurPrices) {
    return res.json({ ok: true, suggestion: null, locked: true });
  }
   const body = req.body ?? {}
   const ingredients = Array.isArray(body.ingredients) ? body.ingredients : []
   const totalCostEur =
     typeof body.totalCostEur === 'number' ? body.totalCostEur : Number(body.totalCostEur || 0)

   const suggestion = await buildEconomySuggestion(ingredients, totalCostEur)

   return res.json({ ok: true, suggestion })
 } catch (e) {
   console.error('POST /recipes/economy-suggestion error:', e)
   return res.status(500).json({ ok: false, error: 'internal error' })
 }
})


// ─────────────────────────────────────────────
// POST /recipes/from-draft/:draftId → import OCR
// ─────────────────────────────────────────────
router.post('/from-draft/:draftId', needAuth, async (req, res) => {
  console.log('[from_draft]', req.params.draftId);
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

    const pricing = await buildPersistedPricing(rawIngredients);
    console.log('[FROM_DRAFT][PARSED]', JSON.stringify(data, null, 2));
    console.log('[FROM_DRAFT][IMAGE_URL_FROM_PARSED]', data.imageUrl);
    console.log('[FROM_DRAFT][IMAGE_URL_VARIABLE]', imageUrl);

    const recipe = await prisma.recipe.create({
      data: {
        userId: req.user.userId,
        title,
        servings: Number.isFinite(servings) && servings > 0 ? servings : 1,
        steps,
        imageUrl,
        notes,
        totalCostEur: pricing.totalCostEur,
        totalCoursesEur: pricing.totalCoursesEur,
        pricingUpdatedAt: pricing.pricingUpdatedAt,
        ingredients: pricing.ingredientsForDb.length
          ? { createMany: { data: pricing.ingredientsForDb } }
          : undefined,
      },
      include: { ingredients: true },
    });

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

// ─────────────────────────────────────────────
// POST /recipes → création manuelle
// ─────────────────────────────────────────────
router.post('/', needAuth, async (req, res) => {
  console.log('[RECIPES][POST_CREATE][HIT]');
  console.log('[RECIPES][POST_CREATE][BODY_IMAGE]', req.body?.imageUrl);
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

    const pricing = await buildPersistedPricing(ingredients);

    const recipe = await prisma.recipe.create({
      data: {
        userId: req.user.userId,
        title: title.trim(),
        servings,
        steps,
        imageUrl: imageUrl || null,
        notes,
        totalCostEur: pricing.totalCostEur,
        totalCoursesEur: pricing.totalCoursesEur,
        pricingUpdatedAt: pricing.pricingUpdatedAt,
        ingredients: pricing.ingredientsForDb.length
          ? { createMany: { data: pricing.ingredientsForDb } }
          : undefined,
      },
      include: { ingredients: true },
    });

    return res.status(201).json({ ok: true, recipe });
  } catch (e) {
    console.error('POST /recipes error:', e);
    return res.status(500).json({ ok: false, error: 'internal error', message: e?.message });
  }
});

// ─────────────────────────────────────────────
// PUT /recipes/:id → modification d’une recette
// ─────────────────────────────────────────────
router.put('/:id', needAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.user;

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

    const existingRecipe = await prisma.recipe.findFirst({
      where: { id, userId },
      select: { id: true },
    });

    if (!existingRecipe) {
      return res.status(404).json({ ok: false, error: 'RECIPE_NOT_FOUND' });
    }

    const pricing = await buildPersistedPricing(ingredients);

    const recipe = await prisma.recipe.update({
      where: { id },
      data: {
        title: title.trim(),
        servings,
        steps,
        imageUrl: imageUrl || null,
        notes,
        totalCostEur: pricing.totalCostEur,
        totalCoursesEur: pricing.totalCoursesEur,
        pricingUpdatedAt: pricing.pricingUpdatedAt,
        ingredients: {
          deleteMany: {},
          ...(pricing.ingredientsForDb.length
            ? { createMany: { data: pricing.ingredientsForDb } }
            : {}),
        },
      },
      include: { ingredients: true },
    });

    return res.json({ ok: true, recipe });
  } catch (e) {
    console.error('PUT /recipes/:id error:', e);
    return res.status(500).json({ ok: false, error: 'internal error', message: e?.message });
  }
});



// ─────────────────────────────────────────────
// GET /recipes/:id → détail d’une recette
// ⚠️ DOIT ÊTRE EN DERNIER (sinon il capture /enrich-ingredients etc.)
// ─────────────────────────────────────────────
router.get('/:id', needAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.user;

    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { subscriptionStatus: true },
    });

    const plan = u?.subscriptionStatus === 'active' ? 'premium' : 'free';
    const policy = await getPricingPolicy({ userId, plan });

    const limits = {
      blurPrices: policy.blurPrices,
      used: policy.used,
      limit: policy.limit,
      remaining: Math.max(0, policy.limit - policy.used),
    };

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
        totalCostEur: true,
        totalCoursesEur: true,
        pricingUpdatedAt: true,
        ingredients: {
          select: {
            id: true,
            name: true,
            quantity: true,
            unit: true,
            ingredientBaseId: true,
            airtableId: true,
            unitPriceBuy: true,
            costRecipe: true,
            buyPriceEur: true,
            buyRefQty: true,
            buyRefUnit: true,
            buyLabel: true,
            gramsPerPiece: true,
            density_g_per_ml: true,
            mlPerPiece: true,
            category: true,
            isCoursesDuplicate: true,
            priceStatus: true,
            priceMessage: true,
          },
        },
      },
    });

    if (!recipe) {
      return res.status(404).json({ ok: false, error: 'RECIPE_NOT_FOUND' });
    }

    const safeRecipe = policy.blurPrices ? stripRecipePrices(recipe) : recipe;

    return res.json({ ok: true, recipe: safeRecipe, limits });
  } catch (e) {
    console.error('GET /recipes/:id error:', e);
    return res.status(500).json({ ok: false, error: 'internal error' });
  }
});

// ─────────────────────────────────────────────
// POST /recipes/:id/categories
// body: { categoryId: string }
// ─────────────────────────────────────────────
router.post('/:id/categories', needAuth, async (req, res) => {
 try {
   const { id } = req.params
   const { userId } = req.user
   const { categoryId } = req.body ?? {}

   if (!categoryId) {
     return res.status(400).json({ ok: false, error: 'categoryId requis' })
   }

   // Vérifie que la recette appartient au user
   const recipe = await prisma.recipe.findFirst({
     where: { id, userId },
     select: { id: true },
   })

   if (!recipe) {
     return res.status(404).json({ ok: false, error: 'RECIPE_NOT_FOUND' })
   }

   // Vérifie que la catégorie appartient au user
   const category = await prisma.recipeCategory.findFirst({
     where: { id: categoryId, userId },
     select: { id: true },
   })

   if (!category) {
     return res.status(404).json({ ok: false, error: 'CATEGORY_NOT_FOUND' })
   }

   await prisma.recipeOnCategory.create({
     data: {
       recipeId: id,
       categoryId,
     },
   })

   return res.json({ ok: true })
 } catch (e) {
   console.error('POST /recipes/:id/categories error:', e)
   return res.status(500).json({ ok: false, error: 'internal error' })
 }
})

module.exports = router