//backend/src/services/supabaseAdmin
// LEVEL: SERVICE
// import autorisés : lib-dependances externes
// import interdits : routes-frontend-parsers-ocr-services
// importé uniquement par routes-services

const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants dans le backend')
}

const supabaseAdmin = createClient(url, key, {
auth: { persistSession: false },
})

module.exports = { supabaseAdmin }