// backend/src/services/airtable.js
const Airtable = require('airtable');

// ========= CONFIG : noms de colonnes EXACTS dans ta table =========
const COL_NAME = 'NOM';
const COL_UNIT = 'Unité (g/ml, pièce)';
const COL_REF_QTY = 'Quantité de référence';   // ex: 1000 pour g/ml, 1 pour pièce
const COL_BUY_PRICE = "Prix d'achat";          // prix payé pour la quantité de référence
// Certaines tables ont déjà un prix normalisé :
const COL_PRICE_KG_L_PIECE = 'Prix kg/L/pièce'; // si existe, sinon sera undefined
const COL_PRICE_AU_KG_L = 'Prix au kg/l';       // si existe, sinon sera undefined
// ==================================================================

const BASE_ID = process.env.AIRTABLE_BASE_ID;
const TABLE = process.env.AIRTABLE_TABLE || 'Ingredients';

if (!BASE_ID) console.warn('[Airtable] AIRTABLE_BASE_ID manquant');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(BASE_ID);

// ----- Utils d’unité -----
function canonUnit(uRaw) {
  const u = String(uRaw || '').trim().toLowerCase();
  if (!u) return null;
  // on renvoie l’unité "de base" utilisée pour le prix unitaire:
  // - grammes pour le solide:    'g'
  // - millilitres pour le liquide:'ml'
  // - unité/pièce:               'piece'
  if (['g', 'gramme', 'grammes'].includes(u)) return 'g';
  if (['kg', 'kilogramme', 'kilogrammes'].includes(u)) return 'kg'; // on convertira ensuite en 'g'
  if (['ml', 'millilitre', 'millilitres'].includes(u)) return 'ml';
  if (['l', 'litre', 'litres'].includes(u)) return 'l';              // on convertira ensuite en 'ml'
  if (['piece', 'pièce', 'unite', 'unité', 'pc'].includes(u)) return 'piece';
  return u; // au pire on renvoie brut
}

function toBaseUnit(unit) {
  // La "base" côté prix unitaire: g / ml / piece
  const u = canonUnit(unit);
  if (u === 'kg') return { unit: 'g', factor: 1000 };      // 1 kg -> 1000 g
  if (u === 'l')  return { unit: 'ml', factor: 1000 };     // 1 L  -> 1000 ml
  if (u === 'g' || u === 'ml' || u === 'piece') return { unit: u, factor: 1 };
  // fallback inconnu -> on traite comme "piece"
  return { unit: 'piece', factor: 1 };
}

function toBaseQty(qty, unit) {
  const { unit: baseU, factor } = toBaseUnit(unit);
  return { qty: Number(qty || 0) * factor, unit: baseU };
}

// ----- Calcul du prix unitaire (par g/ml/pièce) -----
function computePPUFromRow(fields) {
  // 1) Essaye d’utiliser un prix normalisé existant
  const priceKgLPiece = Number(fields[COL_PRICE_KG_L_PIECE] ?? NaN);
  const priceAuKgL    = Number(fields[COL_PRICE_AU_KG_L] ?? NaN);
  const unitRaw       = fields[COL_UNIT];
  const u = canonUnit(unitRaw);

  // Cas "pièce" : si le prix normalisé est par pièce, on peut le prendre tel quel
  if (u === 'piece') {
    if (!Number.isNaN(priceKgLPiece)) return { ppu: priceKgLPiece, unit: 'piece' };
    if (!Number.isNaN(priceAuKgL))    return { ppu: priceAuKgL,    unit: 'piece' };
  }

  // Cas g/ml : si la colonne est "prix au kg/l", on convertit vers g/ml
  // - prix €/kg -> €/g en divisant par 1000
  // - prix €/l  -> €/ml en divisant par 1000
  if (!Number.isNaN(priceKgLPiece)) {
    if (u === 'g' || u === 'kg') return { ppu: priceKgLPiece / 1000, unit: 'g' };
    if (u === 'ml' || u === 'l') return { ppu: priceKgLPiece / 1000, unit: 'ml' };
  }
  if (!Number.isNaN(priceAuKgL)) {
    if (u === 'g' || u === 'kg') return { ppu: priceAuKgL / 1000, unit: 'g' };
    if (u === 'ml' || u === 'l') return { ppu: priceAuKgL / 1000, unit: 'ml' };
  }

  // 2) Sinon, calcule: ppu = Prix d’achat / Quantité de référence
  const refQty = Number(fields[COL_REF_QTY] ?? NaN);
  const buyPrice = Number(fields[COL_BUY_PRICE] ?? NaN);
  if (!Number.isFinite(refQty) || refQty <= 0 || !Number.isFinite(buyPrice)) {
    return { ppu: null, unit: null };
  }

  // La quantité de référence est exprimée dans l’unité affichée (ex: 1000 g / 1000 ml / 1 pièce)
  const { unit: baseU, factor } = toBaseUnit(unitRaw);
  // Si refQty=1000 et unit=kg (rare), on convertit avant
  const refInBase = refQty * (canonUnit(unitRaw) === 'kg' || canonUnit(unitRaw) === 'l' ? 1000 : 1);

  const ppu = buyPrice / (refInBase || 1); // prix par g/ml/pièce
  return { ppu, unit: baseU };
}

// Cache simple
const cache = new Map(); // key = nom en minuscule

/**
 * Retourne:
 *  {
 *    airtableId,           // string
 *    name,                 // NOM (brut)
 *    unit,                 // 'g' | 'ml' | 'piece'  (unité "base")
 *    pricePerUnit          // prix par g/ml/pièce (nombre)
 *  }
 * ou null si non trouvé.
 */
async function getIngredientPriceByName(name) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return null;

  if (cache.has(key)) return cache.get(key);

  const formula = `LOWER({${COL_NAME}}) = LOWER("${key.replace(/"/g, '\\"')}")`;
  const records = await base(TABLE)
    .select({ filterByFormula: formula, maxRecords: 1 })
    .all();

  if (!records.length) { cache.set(key, null); return null; }
  const r = records[0];
  const fields = r.fields || {};

  const { ppu, unit } = computePPUFromRow(fields);
  const result = {
    airtableId: r.id,
    name: fields[COL_NAME] ?? name,
    unit,                             // base: g/ml/piece
    pricePerUnit: Number.isFinite(ppu) ? ppu : null,
  };

  cache.set(key, result);
  return result;
}

module.exports = { getIngredientPriceByName, canonUnit, toBaseUnit, toBaseQty };
