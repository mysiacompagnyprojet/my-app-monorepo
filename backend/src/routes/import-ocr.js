// backend/src/routes/import-ocr.js
import express from 'express'
import multer from 'multer'
import Tesseract from 'tesseract.js'
import { parseRawLine } from '../utils/ingredients.js'

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } })
const router = express.Router()

function needAuth(req, res, next) {
if (!req.user?.userId) return res.status(401).json({ error: 'Unauthorized' })
next()
}

router.post('/ocr', needAuth, upload.single('file'), async (req, res) => {
try {
if (!req.file) return res.status(400).json({ ok: false, error: 'Image manquante' })
const buffer = req.file.buffer
const { data } = await Tesseract.recognize(buffer, 'fra+eng')
const text = (data.text || '').replace(/\r/g, '')
const lines = text.split('\n').map(s => s.trim()).filter(Boolean)

// Heuristique: premières lignes → titre, lignes suivantes → ingrédients, puis étapes
const title = lines[0] || 'Recette'
const rawIngredients = lines.slice(1, 30).filter(l => /(\d|g|kg|ml|l|cuill|oeuf|farine|sucre|sel)/i.test(l))
const steps = lines.slice(1).filter(l => l.length > 20).slice(0, 10)

const ingredients = rawIngredients.map(parseRawLine).filter(Boolean)

res.json({ ok: true, draft: { title, servings: 1, steps, imageUrl: null, ingredients } })
} catch (e) {
res.status(400).json({ ok: false, error: e.message })
}
})

export default router
