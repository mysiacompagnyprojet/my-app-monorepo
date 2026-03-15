// backend/src/routes/recipes.js
// LEVEL: ROUTE
// import autorisés : middleware-services-lib-utils-dependances externes(express, etc)
// import interdits : routes-frontend-parsers-ocr
// importé uniquement par src-index
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient()

const { supabaseAuth } = require('../middleware/supabaseAuth');
const needAuth = supabaseAuth;

const { cleanAndNormalizeIngredients, tidyName, normalizeUnit } = require('../utils/ingredients');

// ✅ Source de vérité prix + conversions (densité + gramsPerPiece)
const { enrichIngredientWithCost } = require('../utils/costs');
const { canonUnit, toBaseQty } = require('../utils/units');

const { getPricingPolicy } = require('../services/importLimits');
const DEBUG_OCR = process.env.OCR_DEBUG !== 'production';
const dlog = (...args) => { if (DEBUG_OCR) console.log(...args); };

/**
* ✅ PATCH: enrichissement "à la volée" pour l'affichage (SANS migration DB)
* Objectif : que le GET /recipes et GET /recipes/:id renvoient aussi :
* - buyPriceEur (prix du pack)
* - buyRefQty / buyRefUnit (quantité du pack)
* - buyLabel (label/pack)
* - unitPriceBuy (€/unité)
*
* Comme tu l’as vu, ces champs existent déjà dans POST /recipes/enrich-ingredients,
* mais ils n’étaient pas renvoyés par les GET (d’où 0,00€ / — côté fiche recette).
*/
async function enrichIngredientsForResponse(ingredients) {
const list = Array.isArray(ingredients) ? ingredients : []

return Promise.all(
list.map(async (ing) => {
const base = {
name: String(ing?.name || '').trim(),
quantity: Number(ing?.quantity || 0) || 0,
unit: String(ing?.unit || '').trim(),
}

if (!base.name) {
return {
...ing,
buyPriceEur: null,
buyLabel: null,
buyRefQty: null,
buyRefUnit: null,
priceStatus: 'invalid',
priceMessage: 'Nom d’ingrédient vide',
}
}

// On réutilise la même source de vérité que l'import (costs.js / Airtable)
const enriched = await enrichIngredientWithCost(base)

return {
...ing,

// On garde les champs existants si déjà présents en DB, sinon on prend l'enrichissement
id: enriched?.id ?? ing?.id ?? null,
unitPriceBuy: enriched?.unitPriceBuy ?? ing?.unitPriceBuy ?? null,
costRecipe: enriched?.costRecipe ?? ing?.costRecipe ?? null,

// ✅ Champs "produit/pack" (ce que tu veux afficher sur la fiche recette)
buyPriceEur: enriched?.buyPriceEur ?? null,
buyLabel: enriched?.buyLabel ?? null,
buyRefQty: enriched?.buyRefQty ?? null,
buyRefUnit: enriched?.buyRefUnit ?? null,

// ✅ Pour affichage UX si besoin
priceStatus: enriched?.priceStatus ?? null,
priceMessage: enriched?.priceMessage ?? null,

...(enriched?.note ? { note: enriched.note } : {}),
}
})
)
}

/**
* ✅ totalCostEur "à la volée" (SANS migration DB)
* On additionne costRecipe (le coût de la quantité utilisée dans la recette).
*/
function computeTotalCostEur(ingredients) {
const list = Array.isArray(ingredients) ? ingredients : []
const total = list.reduce((acc, ing) => {
const v = ing?.costRecipe
const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(String(v).replace(',', '.')) : NaN
return acc + (Number.isFinite(n) ? n : 0)
}, 0)
return Number.isFinite(total) ? total : 0
}

function computeIngredientCostCourses(ing) {
 const buyPrice = typeof ing?.buyPriceEur === 'number' ? ing.buyPriceEur : null
 const refQty = typeof ing?.buyRefQty === 'number' ? ing.buyRefQty : null
 const refUnit = typeof ing?.buyRefUnit === 'string' ? ing.buyRefUnit : null

 if (buyPrice == null || refQty == null || refUnit == null) return 0

 let qBase = toBaseQty(Number(ing?.quantity || 0), String(ing?.unit || ''))
 const packBase = toBaseQty(refQty, refUnit)

 if (!qBase || !packBase) return 0

 if (qBase.unit === packBase.unit) {
   const packs = Math.max(1, Math.ceil(qBase.qty / packBase.qty))
   return packs * buyPrice
 }

 const gpp = typeof ing?.gramsPerPiece === 'number' ? ing.gramsPerPiece : null
 if (qBase.unit === 'piece' && packBase.unit === 'g' && gpp && gpp > 0) {
   qBase = { qty: qBase.qty * gpp, unit: 'g' }
   const packs = Math.max(1, Math.ceil(qBase.qty / packBase.qty))
   return packs * buyPrice
 }

 if (qBase.unit === 'g' && packBase.unit === 'piece' && gpp && gpp > 0) {
   qBase = { qty: qBase.qty / gpp, unit: 'piece' }
   const packs = Math.max(1, Math.ceil(qBase.qty / packBase.qty))
   return packs * buyPrice
 }

 const d = typeof ing?.density_g_per_ml === 'number' ? ing.density_g_per_ml : null
 if (d && d > 0) {
   if (qBase.unit === 'ml' && packBase.unit === 'g') {
     qBase = { qty: qBase.qty * d, unit: 'g' }
     const packs = Math.max(1, Math.ceil(qBase.qty / packBase.qty))
     return packs * buyPrice
   }

   if (qBase.unit === 'g' && packBase.unit === 'ml') {
     qBase = { qty: qBase.qty / d, unit: 'ml' }
     const packs = Math.max(1, Math.ceil(qBase.qty / packBase.qty))
     return packs * buyPrice
   }
 }

 return 0
}

function computeTotalCoursesEur(ingredients) {
 const list = Array.isArray(ingredients) ? ingredients : []
 const total = list.reduce((acc, ing) => acc + computeIngredientCostCourses(ing), 0)
 return Number.isFinite(total) ? total : 0
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
// GET /recipes → liste des recettes
// ─────────────────────────────────────────────
router.get('/', needAuth, async (req, res) => {
try {
const { userId } = req.user
const u = await prisma.user.findUnique({
 where: { id: userId },
 select: { subscriptionStatus: true },
});
const plan = u?.subscriptionStatus === 'active' ? 'premium' : 'free';

const policy = await getPricingPolicy({ userId, plan });

const limits = {
 blurPrices: policy.blurPrices, // flou à partir de la 11e
 used: policy.used,
 limit: policy.limit,
 remaining: Math.max(0, policy.limit - policy.used),
};
const { cat } = req.query

const recipesRaw = await prisma.recipe.findMany({
where: { userId,
  ...(cat && {
    categories: {
      some: {
        categoryId: String(cat),
      },
    },
  })
},
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

// ✅ (facultatif mais utile) si présent en DB
id: true,
unitPriceBuy: true,
},
},
},
})

// ✅ PATCH: enrichit ingrédients + calcule totalCostEur à la volée
const recipes = await Promise.all(
recipesRaw.map(async (r) => {
const enrichedIngredients = await enrichIngredientsForResponse(r.ingredients)
return {
...r,
ingredients: enrichedIngredients,
totalCostEur: computeTotalCostEur(enrichedIngredients),
totalCoursesEur: computeTotalCoursesEur(enrichedIngredients),
}
})
)

return res.json({ ok: true, recipes, limits })
} catch (e) {
console.error('GET /recipes error:', e)
return res.status(500).json({ ok: false, error: 'internal error' })
}
})

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
   const out = await Promise.all(
     list.map(async (i) => {
        console.log('[ENRICH IN]', { name: i?.name, unit: i?.unit, ingredientBaseId: i?.ingredientBaseId})
       const base = {
         name: String(i?.name || '').trim(),
         quantity: Number(i?.quantity || 0) || 0,
         unit: String(i?.unit || '').trim(),
         // ✅ pour ne pas rester “bloqué” sur le mauvais article quand plusieurs ont le même nom
         ingredientBaseId: i?.ingredientBaseId ?? null,
       }

       if (!base.name) {
         return {
           ...base,
           id: null,
           unitPriceBuy: null,
           buyPriceEur: null,
           buyRefQty: null,
           buyRefUnit: null,
           buyLabel: null,
           costEur: 0,
           priceMatched: false,
           priceStatus: 'invalid',
           priceMessage: "Nom d’ingrédient vide",
         }
       }

       const enriched = await enrichIngredientWithCost(base)

       return {
         name: base.name,
         quantity: base.quantity,
         unit: base.unit,
         ingredientBaseId: base.ingredientBaseId,

         id: enriched?.id ?? null,
         priceMatched: Boolean(enriched?.id),

         // €/unité (souvent €/g ou €/ml)
         unitPriceBuy: enriched?.unitPriceBuy ?? null,

         // ✅ prix recette
         costEur: Number(enriched?.costRecipe || 0),

         // ✅ prix pack
         buyPriceEur: enriched?.buyPriceEur ?? null,
         buyLabel: enriched?.buyLabel ?? null,
         buyRefQty: enriched?.buyRefQty ?? null,
         buyRefUnit: enriched?.buyRefUnit ?? null,

         gramsPerPiece: enriched?.gramsPerPiece ?? null,
         density_g_per_ml: enriched?.density_g_per_ml ?? null,
         mlPerPiece: enriched?.mlPerPiece ?? null,

         // ✅ statut/message ligne
         priceStatus: enriched?.priceStatus ?? null,
         priceMessage: enriched?.priceMessage ?? null,

         ...(enriched?.note ? { note: enriched.note } : {}),
       }
     })
   )

   console.log('[ENRICH RESULT sample]', out?.[0])
   console.log('[ENRICH RESULT keys]', Object.keys(out?.[0] || {}))

   return res.status(200).json({ ok: true, ingredients: out })
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
try {
const { draftId } = req.params

const draft = await prisma.recipeDraft.findUnique({
where: { id: draftId },
})

if (!draft) {
return res.status(404).json({ ok: false, error: 'DRAFT_NOT_FOUND' })
}

if (!draft.parsed) {
return res.status(400).json({
ok: false,
error: 'DRAFT_NOT_PARSED',
message: 'Remplis draft.parsed avant import.',
})
}

const data = draft.parsed || {}
const title = String(data.title || '').trim()
if (!title) {
return res.status(400).json({ ok: false, error: 'parsed.title manquant' })
}

const servings = Number(data.servings || 1)
const steps = Array.isArray(data.steps) ? data.steps : []
const imageUrl = data.imageUrl || null
const notes = typeof data.notes === 'string' ? data.notes : ''
const rawIngredients = Array.isArray(data.ingredients) ? data.ingredients : []

// 1) Normalisation forte
const normalized = cleanAndNormalizeIngredients(rawIngredients)

// 2) Enrichissement coûts via la source de vérité
const ingData = await Promise.all(
normalized.map(async (i) => {
const base = {
name: i.nameCanon,
quantity: i.quantityNum ?? 0,
unit: i.unit || 'piece',
}

const enriched = await enrichIngredientWithCost(base)

return {
...base,
id: enriched?.id ?? null,
unitPriceBuy: enriched?.unitPriceBuy ?? null,
costRecipe: enriched?.costRecipe ?? null,
}
})
)

// 3) Garde-fou final
const ingDataFinal = ingData.map((i) => ({
//...i,
name: tidyName(i.name),
quantity: Number(i.quantity || 0),
unit: canonUnit(i.unit) || normalizeUnit(i.unit) || 'piece',

airtableId: i.id ?? null,
unitPriceBuy: i.unitPriceBuy ?? null,
costRecipe: i.costRecipe ?? null,
}))
// console log a supprimer
dlog("req.userId =", req.userId);
dlog("req.user=", req.user);
const recipe = await prisma.recipe.create({
data: {
userId: req.user.userId,
title,
servings: Number.isFinite(servings) && servings > 0 ? servings : 1,
steps,
imageUrl,
notes,
ingredients: ingDataFinal.length ? { createMany: { data: ingDataFinal } } : undefined,
},
include: { ingredients: true },
})

await prisma.recipeDraft.update({
where: { id: draftId },
data: { status: 'imported', updatedAt: new Date() },
})

return res.json({ ok: true, recipe })
} catch (e) {
console.error('POST /recipes/from-draft error:', e)
return res.status(500).json({ ok: false, error: 'internal error', message: e?.message })
}
})

// ─────────────────────────────────────────────
// POST /recipes → création manuelle
// ─────────────────────────────────────────────
router.post('/', needAuth, async (req, res) => {
try {
const body = req.body ?? {}
let { title, servings, steps, imageUrl, notes, ingredients } = body

if (typeof steps === 'string') {
try {
steps = JSON.parse(steps)
} catch {
steps = []
}
}

if (!title || typeof title !== 'string' || !title.trim()) {
return res.status(400).json({ ok: false, error: "Champ 'title' manquant ou invalide" })
}

servings = Number(servings ?? 1)
if (!Number.isFinite(servings) || servings < 1) {
return res.status(400).json({ ok: false, error: "Champ 'servings' doit être un nombre >= 1" })
}

steps = Array.isArray(steps) ? steps : []
if (imageUrl && typeof imageUrl === 'object' && imageUrl.url) {
imageUrl = imageUrl.url
}

notes = typeof notes === 'string' ? notes : ''
ingredients = Array.isArray(ingredients) ? ingredients : []

// 1) Normalisation forte
const normalized = cleanAndNormalizeIngredients(
ingredients.map((i) => ({
name: i?.name,
quantity: i?.quantity,
unit: i?.unit,
}))
)

// 2) Enrichissement coûts via source de vérité
const ingData = await Promise.all(
normalized.map(async (i) => {
const base = {
name: i.nameCanon,
quantity: i.quantityNum ?? 0,
unit: i.unit || 'piece',
}

const enriched = await enrichIngredientWithCost(base)

return {
...base,
id: enriched?.id ?? null,
unitPriceBuy: enriched?.unitPriceBuy ?? null,
costRecipe: enriched?.costRecipe ?? null,
}
})
)

// 3) Garde-fou final
const ingDataFinal = ingData.map((i) => ({
//...i,
name: tidyName(i.name),
quantity: Number(i.quantity || 0),
unit: canonUnit(i.unit) || normalizeUnit(i.unit) || 'piece',

airtableId: i.id ?? null,
unitPriceBuy: i.unitPriceBuy ?? null,
costRecipe: i.costRecipe ?? null,
}))

const recipe = await prisma.recipe.create({
data: {
userId: req.user.userId,
title,
servings,
steps,
imageUrl: imageUrl || null,
notes,
ingredients: ingDataFinal.length ? { createMany: { data: ingDataFinal } } : undefined,
},
include: { ingredients: true },
})

return res.status(201).json({ ok: true, recipe })
} catch (e) {
console.error('POST /recipes error:', e)
return res.status(500).json({ ok: false, error: 'internal error', message: e?.message })
}
})

// ─────────────────────────────────────────────
// GET /recipes/:id → détail d’une recette
// ⚠️ DOIT ÊTRE EN DERNIER (sinon il capture /enrich-ingredients etc.)
// ─────────────────────────────────────────────
router.get('/:id', needAuth, async (req, res) => {
try {
const { id } = req.params
const { userId } = req.user
const u = await prisma.user.findUnique({
 where: { id: userId },
 select: { subscriptionStatus: true },
});
const plan = u?.subscriptionStatus === 'active' ? 'premium' : 'free';

const policy = await getPricingPolicy({ userId, plan });

const limits = {
 blurPrices: policy.blurPrices, // flou à partir de la 11e
 used: policy.used,
 limit: policy.limit,
 remaining: Math.max(0, policy.limit - policy.used),
};

const recipeRaw = await prisma.recipe.findFirst({
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

// ✅ (facultatif mais utile) si présent en DB
id: true,
unitPriceBuy: true,
},
},
},
})

if (!recipeRaw) {
return res.status(404).json({ ok: false, error: 'RECIPE_NOT_FOUND' })
}

// ✅ PATCH: enrichit aussi buyPriceEur / buyRefQty / buyRefUnit + calcule totalCostEur
const enrichedIngredients = await enrichIngredientsForResponse(recipeRaw.ingredients)
const recipe = {
...recipeRaw,
ingredients: enrichedIngredients,
totalCostEur: computeTotalCostEur(enrichedIngredients),
totalCoursesEur: computeTotalCoursesEur(enrichedIngredients),
}

return res.json({ ok: true, recipe, limits })
} catch (e) {
console.error('GET /recipes/:id error:', e)
return res.status(500).json({ ok: false, error: 'internal error' })
}
})

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