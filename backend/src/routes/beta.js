//backend/src/routes/beta.js
// LEVEL: ROUTE
// import autorisés : middleware-services-lib-utils generaux
// import interdits : routes-parsers-ocr-importocr-ingredient-title
// importé module.exports = router

const express = require('express')
const router = express.Router()

const { supabaseAdmin } = require('../services/supabaseAdmin')
const { supabaseAuth } = require('../middleware/supabaseAuth')
const { prisma } = require('../lib/prisma')

// ✅ on réutilise ta logique Supabase ImportLimit (key/used/limit)
const {
 getPricingPolicy,
 incrementUsage,
 LIMIT_KEYS,
} = require('../services/importLimits')

// ─────────────────────────────────────────────
// POST /beta/verify  (PUBLIC)
// ─────────────────────────────────────────────
router.post('/verify', async (req, res) => {
 try {
   const token = String(req.body?.token || '').trim()
   const deviceId = String(req.body?.deviceId || '').trim()

   if (!token) return res.status(400).json({ ok: false, error: 'TOKEN_REQUIRED', message: 'Token manquant.' })
   if (!deviceId) return res.status(400).json({ ok: false, error: 'DEVICE_REQUIRED', message: 'DeviceId manquant.' })

   const { data: invite, error } = await supabaseAdmin
     .from('beta_invites')
     .select('*')
     .eq('token', token)
     .maybeSingle()

   if (error) return res.status(500).json({ ok: false, error: 'DB_ERROR', message: error.message })
   if (!invite) return res.status(401).json({ ok: false, error: 'INVALID_TOKEN', message: 'Code bêta invalide.' })

   // 1) jamais utilisée → on bind à cet appareil
   if (!invite.used) {
     const now = new Date().toISOString()
     const { error: upErr } = await supabaseAdmin
       .from('beta_invites')
       .update({
         used: true,
         used_at: now,
         device_id: deviceId,
         device_bound_at: now,
       })
       .eq('id', invite.id)

     if (upErr) return res.status(500).json({ ok: false, error: 'UPDATE_ERROR', message: upErr.message })
     return res.json({ ok: true })
   }

   // 2) déjà utilisée → seulement si même device
   if (invite.device_id && invite.device_id !== deviceId) {
     return res.status(403).json({
       ok: false,
       error: 'DEVICE_MISMATCH',
       message: 'Ce code est déjà utilisé sur un autre appareil.',
     })
   }

   return res.json({ ok: true })
 } catch (e) {
   return res.status(500).json({ ok: false, error: 'SERVER_ERROR', message: 'Erreur serveur.' })
 }
})

// ─────────────────────────────────────────────
// AUTH REQUIRED pour le reste
// ─────────────────────────────────────────────
router.use(supabaseAuth)

// ─────────────────────────────────────────────
// GET /beta/pricing-policy
// renvoie blur + compteur (10 max en free)
// ─────────────────────────────────────────────
router.get('/pricing-policy', async (req, res) => {
 try {
   const userId = req.user?.userId
   if (!userId) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' })

   const u = await prisma.user.findUnique({
     where: { id: userId },
     select: { subscriptionStatus: true },
   })

   const plan = u?.subscriptionStatus === 'active' ? 'premium' : 'free'

   const policy = await getPricingPolicy({ userId, plan })

   return res.json({ ok: true, policy })
 } catch (e) {
   return res.status(500).json({ ok: false, error: 'SERVER_ERROR', message: e?.message || 'Erreur serveur.' })
 }
})

// ─────────────────────────────────────────────
// POST /beta/pricing-usage/increment
// optionnel : si tu veux incrémenter au moment “où on calcule les prix”
// ─────────────────────────────────────────────
router.post('/pricing-usage/increment', async (req, res) => {
 try {
   const userId = req.user?.userId
   if (!userId) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' })

   // incrémente 1 “recette pricée”
   const usage = await incrementUsage(userId, LIMIT_KEYS.PRICING_VISIBLE, 1)

   return res.json({ ok: true, usage })
 } catch (e) {
   return res.status(500).json({ ok: false, error: 'SERVER_ERROR', message: e?.message || 'Erreur serveur.' })
 }
})

module.exports = router