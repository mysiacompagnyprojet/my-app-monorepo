//backend/src/routes/beta
// LEVEL: ROUTE
// import autorisés : middleware-services-lib-utils generaux
//import interdits : routes-parsers-ocr-importocr-ingredient-title
// importé module.exports = router ou exports.routeur = routeur

const express = require('express')
const router = express.Router()
const { supabaseAdmin } = require('../services/supabaseAdmin')

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

module.exports = router