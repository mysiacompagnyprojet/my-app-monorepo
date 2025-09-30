// backend/src/routes/recipes.js
import express from 'express'
import { prisma } from '../lib/prisma.js'
import { mergeIngredients } from '../utils/ingredients.js'

const router = express.Router()

// Middleware auth Supabase supposé déjà en place: req.user = { userId, email }
function needAuth(req, res, next) {
if (!req.user?.userId) return res.status(401).json({ error: 'Unauthorized' })
next()
}

// GET /recipes → liste des recettes de l'utilisateur
router.get('/', needAuth, async (req, res) => {
const { userId } = req.user
const recipes = await prisma.recipe.findMany({
where: { userId },
orderBy: { createdAt: 'desc' },
select: {
id: true, title: true, servings: true, imageUrl: true, createdAt: true,
ingredients: { select: { name: true, quantity: true, unit: true } }
}
})
res.json({ ok: true, recipes })
})

// POST /recipes → créer depuis l’éditeur manuel
router.post('/', needAuth, async (req, res) => {
const { userId } = req.user
const { title, servings, steps, imageUrl, notes, ingredients } = req.body
if (!title || !servings || !Array.isArray(ingredients)) {
return res.status(400).json({ ok: false, error: 'Champs manquants' })
}
const merged = mergeIngredients(ingredients)
const recipe = await prisma.recipe.create({
data: {
userId, title, servings: parseInt(servings, 10) || 1,
steps: Array.isArray(steps) ? steps : [],
imageUrl: imageUrl || null,
notes: notes || null,
ingredients: {
create: merged.map(l => ({
name: l.name, quantity: l.quantity, unit: l.unit
}))
}
},
include: { ingredients: true }
})
res.json({ ok: true, recipe })
})

export default router
