// backend/src/services/airtable.js
const Airtable = require('airtable');

const BASE_ID = process.env.AIRTABLE_BASE_ID; // ex: appp1vee43XRu4437  (PAS l'URL complète)
const TABLE = process.env.AIRTABLE_TABLE || 'Ingredients';

if (!BASE_ID) {
  console.warn('[Airtable] AIRTABLE_BASE_ID manquant');
}

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(BASE_ID);

/**
 * Retourne { airtableId, unit, pricePerUnit } ou null.
 * filterByFormula exact, insensible à la casse.
 */
async function getIngredientPriceByName(name) {
  const n = (name || '').trim();
  if (!n) return null;
  const formula = `LOWER({name}) = LOWER("${n.replace(/"/g, '\\"')}")`; // champ {name}
  const records = await base(TABLE)
    .select({ filterByFormula: formula, maxRecords: 1 })
    .all();

  if (!records.length) return null;
  const r = records[0];
  return {
    airtableId: r.id,
    unit: r.get('unit'),
    pricePerUnit: r.get('ppu'),
  };
}

module.exports = { getIngredientPriceByName };

