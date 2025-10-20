// backend/src/routes/dev-airtable.js
const express = require('express');
const { getIngredientPriceByName } = require('../services/airtable');

const router = express.Router();

/**
 * ⚙️ Route publique de test Airtable
 * Usage :
 *   GET /dev/airtable/lookup?name=Carotte
 */
router.get('/dev/airtable/lookup', async (req, res) => {
  const name = req.query.name || '';
  try {
    const r = await getIngredientPriceByName(name);
    res.json({ ok: true, input: name, result: r });
  } catch (e) {
    console.error('Error in /dev/airtable/lookup:', e);
    res.status(500).json({ ok: false, error: e?.message });
  }
});

module.exports = router;
