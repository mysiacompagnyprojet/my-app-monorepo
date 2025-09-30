// backend/src/routes/shopping-list.js
import express from 'express'
import { prisma } from '../lib/prisma.js'
import { mergeIngredients } from '../utils/ingredients.js'
import { getIngredientPriceByName } from '../services/airtable.js'

const router = express.Router()

function needAuth(req, res, next) {
if (!req.user?.userId) return res.status(401).json({ error: 'Unauthorized' })
next()
}

// POST /shopping-list { recipeIds: string[] }
router.post('/', needAuth, async (req, res) => {
const { recipeIds } = req.body
if (!Array.isArray(recipeIds) || recipeIds.length === 0) {
return res.status(400).json({ ok: false, error: 'recipeIds requis' })
}

const recipes = await prisma.recipe.findMany({
where: { id: { in: recipeIds } },
select: { id: true, title: true, ingredients: true }
})

// Fusionner tous les ingrédients
const allLines = recipes.flatMap(r => r.ingredients.map(i => ({
name: i.name, quantity: i.quantity, unit: i.unit
})))
const merged = mergeIngredients(allLines)

// Prix
let totalRecipeCost = 0
let totalBuyPrice = 0
const withPrices = []
for (const l of merged) {
const price = await getIngredientPriceByName(l.name)
if (!price) {
withPrices.push({ ...l, recipeCost: 0, buyPrice: 0, airtableId: null })
continue
}
// Hypothèse V1: pricePerUnit correspond à 1 unité (g/ml/pièce)
const recipeCost = (l.quantity || 0) * (price.pricePerUnit || 0)
const buyPrice = recipeCost // V1 simple
totalRecipeCost += recipeCost
totalBuyPrice += buyPrice
withPrices.push({
...l,
unitPriceBuy: price.pricePerUnit,
recipeCost,
buyPrice,
airtableId: price.airtableId,
unitNormalized: price.unit
})
}

res.json({
ok: true,
items: withPrices,
totals: { recipeCost: totalRecipeCost, buyPrice: totalBuyPrice }
})
})

export default router
