// backend/src/routes/recipe-categories.js
// LEVEL: ROUTE
const express = require('express')
const router = express.Router()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const { supabaseAuth } = require('../middleware/supabaseAuth')
const needAuth = supabaseAuth

// GET /recipe-categories
// → retourne les catégories (parents) + leurs enfants
router.get('/', needAuth, async (req, res) => {
 try {
   const { userId } = req.user

   const cats = await prisma.recipeCategory.findMany({
     where: { userId, parentId: null },
     orderBy: { name: 'asc' },
     include: {
       children: { orderBy: { name: 'asc' } },
     },
   })

   return res.json({ ok: true, categories: cats })
 } catch (e) {
   console.error('GET /recipe-categories error:', e)
   return res.status(500).json({ ok: false, error: 'internal error' })
 }
})

// POST /recipe-categories
// body: { name: string, parentId?: string|null }
// - parentId null/undefined => catégorie parent
// - parentId = <uuid> => sous-catégorie
router.post('/', needAuth, async (req, res) => {
 try {
   const { userId } = req.user
   const body = req.body ?? {}

   const name = String(body?.name || '').trim()
   const parentId = body?.parentId ? String(body.parentId) : null

   if (!name) {
     return res.status(400).json({ ok: false, error: 'name requis' })
   }

   // Empêche doublons au même niveau (même parentId)
   const existing = await prisma.recipeCategory.findFirst({
     where: { userId, parentId, name },
     select: { id: true },
   })
   if (existing) {
     return res.status(409).json({ ok: false, error: 'CATEGORY_EXISTS' })
   }

   // Si parentId fourni, on vérifie qu’il appartient au user
   if (parentId) {
     const parent = await prisma.recipeCategory.findFirst({
       where: { id: parentId, userId },
       select: { id: true },
     })
     if (!parent) {
       return res.status(404).json({ ok: false, error: 'PARENT_NOT_FOUND' })
     }
   }

   const created = await prisma.recipeCategory.create({
     data: { userId, name, parentId },
   })

   return res.status(201).json({ ok: true, category: created })
 } catch (e) {
   console.error('POST /recipe-categories error:', e)
   return res.status(500).json({ ok: false, error: 'internal error' })
 }
})

module.exports = router