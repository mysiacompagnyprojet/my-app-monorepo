// backend/src/routes/ingredients-base.js
const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../services/supabaseAdmin');
const { getIngredientPriceByName } = require('../services/supabase');

// GET /ingredients-base
router.get('/', async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('ingredients_base')
            .select([
                'nom',
                'unite_g_ml_piece',
                'type_unite',
                'nombre',
                'gramme_par_piece',
                'densite_g_ml',
                'quantite_de_reference',
                'prix_d_achat',
                'prix_kg_l_piece',
                'synonyme',
        ].join(','))
        .order('nom', { ascending: true })

        if (error) return res.status(500).json({ ok: false, error: error.message })
        return res.json({ ok: true, data })
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'INGREDIENTS_BASE_FAILED' })
    }
});

//Get ingredient bases price
router.get('/price', async (req, res) => {
    const { name, unit } = req.query;

    if (!name) {
        return res.status(400).json({ OK: false, error: 'name require'});
    }

    try {
        const result = await getIngredientPriceByName(name, unit);
        return res.json({ ok: true, result }); 
    } catch (e) {
        console.error(e);
        return res.status(500).json({ ok: false, error: 'price lookup failed'})
    }
});

module.exports = router;