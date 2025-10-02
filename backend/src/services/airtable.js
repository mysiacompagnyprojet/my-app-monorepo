// backend/src/services/airtable.js
const Airtable = require('airtable');

const apiKey = process.env.AIRTABLE_API_KEY;
const baseId = process.env.AIRTABLE_BASE_ID;
const tableName = process.env.AIRTABLE_TABLE || 'Ingredients';

if (!apiKey || !baseId) {
  console.warn('[Airtable] Variables manquantes: AIRTABLE_API_KEY / AIRTABLE_BASE_ID');
}

const base = apiKey && baseId ? new Airtable({ apiKey }).base(baseId) : null;

async function getIngredientPriceByName(name) {
  if (!base) return null;
  const records = await base(tableName)
    .select({ filterByFormula: `{name} = "${name}"`, maxRecords: 1 })
    .all();
  if (!records.length) return null;
  const r = records[0];
  return {
    airtableId: r.id,
    unit: r.get('unit'), // ex: g, ml, piece
    pricePerUnit: r.get('ppu'), // prix par unité normalisée
  };
}

module.exports = { getIngredientPriceByName };
