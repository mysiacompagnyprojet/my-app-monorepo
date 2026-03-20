// backend/src/routes/ingredients-base.js
// LEVEL: ROUTE
// import autorisés : middleware-services-lib-utils,
// import interdits : routes-frontend-parsers-ocr
// importé uniquement par src-index
const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../services/supabaseAdmin');
const { getIngredientPriceByName } = require('../services/supabase');

function cleanNameForPricing(name) { // laisser cette fonction car on ne peut pas importer costs.js ici
let x = String(name || '').trim()
if (!x) return ''

// enlève (....)
x = x.replace(/\([^)]*\)/g, ' ')

// enlève "selon ..." (souvent ajouté par OCR / recettes)
x = x.replace(/\bselon\b.*$/i, ' ')

//enléve les qualificatifs pour trouver l'ingredient$
x = x.replace(
    /\b(eminced?|émincé(?:e|es)?|hach[ée](?:e|es)?|coup[ée](?:e|es)?|rondelles?|en\s+rondelles?)\b/gi, ' ');

// espaces
x = x.replace(/\s+/g, ' ').trim()

return x
}

// GET /ingredients-base
router.get('/', async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('ingredients_base')
            .select([
                'id',
                'nom',
                'unite_g_ml_piece',
                'type_unite',
                'nombre',
                'densite_g_ml',
                'quantite_de_reference',
                'prix_d_achat',
                'synonyme',
                'gramme_par_piece',
                'prix_kg_l_piece',
                'category,'
                
        ].join(','))
        .order('nom', { ascending: true })

        if (error) return res.status(500).json({ ok: false, error: error.message })
        return res.json({ ok: true, data })
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'INGREDIENTS_BASE_FAILED' })
    }
});

// GET /ingredients-base/suggest?q=beurre
router.get('/suggest', async (req, res) => {
    try {
        const qRaw = String(req.query.q || '').trim();

        if (!qRaw || qRaw.length < 2) {
        return res.json({ ok: true, items: [] });
        }

        const q = cleanNameForPricing(qRaw);

        const head = q.split(/\s+/)[0] || q;

        const { data, error } = await supabaseAdmin
            .from('ingredients_base')
            .select(`
                'id',
                'nom',
                'unite_g_ml_piece',
                'type_unite',
                'nombre',
                'densite_g_ml',
                'quantite_de_reference',
                'prix_d_achat',
                'synonyme',
                'gramme_par_piece',
                'prix_kg_l_piece',
                'category',
            `)
        .or(`nom.ilike.%${q}%,synonyme.ilike.%${q}%,nom.ilike.%${head}%,synonyme.ilike.%${head}%`)//.ilike('nom', `%${q}%`)
        .order('nom', { ascending: true })
        .limit(20);

        if (error) {
            return res.status(500).json({ ok: false, error: error.message });
        }

        return res.json({ ok: true, items: data });
        } catch (e) {
        console.error(e);
        return res.status(500).json({ ok: false, error: 'INGREDIENT_SUGGEST_FAILED' });
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