//backend/src/routes/images.js
// LEVEL: ROUTE
// import autorisés : express-middleware-services-lib-utils generaux
//import interdits : routes-parsers-ocr-importocr-ingredient-title
// importé module.exports = router 

const express = require('express')
const multer = require('multer')
const { supabaseAdmin } = require('../services/supabaseAdmin')

const router = express.Router()

// multer en mémoire (req.file.buffer)
const upload = multer({ storage: multer.memoryStorage() })

router.post('/recipe-image', upload.single('file'), async (req, res) => {
try {
if (!req.file) {
return res.status(400).json({ ok: false, error: 'NO_FILE' })
}

const imageFile = req.file
const safeName = String(imageFile.originalname || 'recipe.jpg').replace(/\s+/g, '-')
const imagePath = `recipes/${Date.now()}-${safeName}`

const { error: uploadError } = await supabaseAdmin.storage
.from('recipe-images')
.upload(imagePath, imageFile.buffer, {
contentType: imageFile.mimetype,
upsert: false,
})

if (uploadError) {
return res.status(500).json({
ok: false,
error: 'UPLOAD_FAILED',
message: uploadError.message,
})
}

const { data } = supabaseAdmin.storage.from('recipe-images').getPublicUrl(imagePath)

return res.json({
ok: true,
imageUrl: data.publicUrl,
})
} catch (e) {
return res.status(500).json({
ok: false,
error: 'SERVER_ERROR',
message: e?.message,
})
}
})

module.exports = router