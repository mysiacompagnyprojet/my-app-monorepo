// backend/src/services/supabase.js
'use strict';

const { supabaseAdmin } = require('./supabaseAdmin');

// -------------------------
// LOGS optionnels
// -------------------------
const DEBUG = process.env.SUPABASE_DEBUG === '1';
const dlog = (...args) => { if (DEBUG) console.debug(...args); };

// -------------------------
// Cache TTL 1 min (comme avant)
// -------------------------
const TTL_MS = 60 * 1000;
const _cache = new Map();
const now = () => Date.now();

function cacheGet(key) {
const e = _cache.get(key);
if (!e) return null;
if (now() - e.t > TTL_MS) { _cache.delete(key); return null; }
return e.value;
}
function cacheSet(key, value) { _cache.set(key, { value, t: now() }); }

// -------------------------
// Helpers nombres / unités
// -------------------------
function toNumberLoose(v) {
if (v == null) return NaN;
if (typeof v === 'number') return v;
const s = String(v).replace(/\u00A0/g, ' ').trim().replace(',', '.');
const n = parseFloat(s);
return Number.isFinite(n) ? n : NaN;
}

function canonUnit(uRaw) {
const u = String(uRaw || '')
.trim()
.toLowerCase()
.normalize('NFD')
.replace(/[\u0300-\u036f]/g, '');
if (!u) return null;

if (['g', 'gramme', 'grammes'].includes(u)) return 'g';
if (['kg', 'kilogramme', 'kilogrammes'].includes(u)) return 'kg';
if (['mg'].includes(u)) return 'mg';

if (['ml', 'millilitre', 'millilitres'].includes(u)) return 'ml';
if (['l', 'litre', 'litres'].includes(u)) return 'l';
if (['cl'].includes(u)) return 'cl';
if (['dl'].includes(u)) return 'dl';

if (['piece', 'pièce', 'unite', 'unité', 'pc', 'botte'].includes(u)) return 'piece';
return u;
}

function toBaseUnit(unit) {
const u = canonUnit(unit);

if (u === 'mg') return { unit: 'g', factor: 0.001 };
if (u === 'kg') return { unit: 'g', factor: 1000 };
if (u === 'g') return { unit: 'g', factor: 1 };

if (u === 'cl') return { unit: 'ml', factor: 10 };
if (u === 'dl') return { unit: 'ml', factor: 100 };
if (u === 'l') return { unit: 'ml', factor: 1000 };
if (u === 'ml') return { unit: 'ml', factor: 1 };

if (u === 'piece') return { unit: 'piece', factor: 1 };

return { unit: 'piece', factor: 1 };
}

function toBaseQty(qty, unit) {
const { unit: baseU, factor } = toBaseUnit(unit);
return { qty: Number(qty || 0) * factor, unit: baseU };
}

function roundPPU(ppu, unit) {
if (!Number.isFinite(ppu)) return null;
const decimals = unit === 'g' || unit === 'ml' ? 5 : unit === 'piece' ? 3 : 4;
return Number(ppu.toFixed(decimals));
}

// -------------------------
// Synonymes texte (colonne "synonyme")
// -------------------------
function normalizeName(s = '') {
return String(s)
.toLowerCase()
.normalize('NFD')
.replace(/[\u0300-\u036f]/g, '')
.replace(/œ/g, 'oe')
.replace(/[^a-z0-9\s]/g, ' ')
.replace(/\b(d|de|du|des|la|le|les|l)\b/g, ' ')
.replace(/\s+/g, ' ')
.trim()
.replace(/oeufs?$/, 'oeuf')
.replace(/pommes?\sde terre$/, 'pomme de terre');
}

function parseSynonymsCell(v) {
if (!v) return [];
return String(v)
.split(/[\n;,|]+/g)
.map((x) => x.trim())
.filter(Boolean);
}

// -------------------------
// Conversions pack / pièce (si tu as les colonnes)
// gramme_par_piece, densite_g_ml, nombre
// -------------------------
function getPackPieceConversion(row, baseUnit) {
// Ici on utilise directement tes colonnes Supabase
const count = toNumberLoose(row.nombre);

const gramsPerPiece = toNumberLoose(row.gramme_par_piece);
// Si tu as une colonne ml_par_piece : ajoute-la. Sinon on reste null.
const mlPerPiece = null;

return {
count: Number.isFinite(count) ? count : null,
gramsPerPiece: Number.isFinite(gramsPerPiece) ? gramsPerPiece : null,
mlPerPiece: Number.isFinite(mlPerPiece) ? mlPerPiece : null,
};
}

function getBuyPackInfo(row, unitRawForBase) {
const { unit: baseU, factor } = toBaseUnit(unitRawForBase);

const buyPrice = toNumberLoose(row.prix_d_achat);
const refQty = toNumberLoose(row.quantite_de_reference);

return {
buyPrice: Number.isFinite(buyPrice) ? buyPrice : null,
refQty: Number.isFinite(refQty) ? refQty : null,
refUnit: baseU || null,
refQtyInBase: Number.isFinite(refQty) ? refQty * factor : null,
};
}

// Prix unitaire: priorité à prix_kg_l_piece, sinon fallback prix_d_achat / quantite_de_reference
function computePPUFromRow(row) {
// Dans ta table tu as : type_unite (probablement "g/ml/piece" ou similaire)
// et unite_g_ml_piece (libellé affichage).
// Pour le calcul base, on préfère type_unite s’il est propre.
const unitRaw = row.type_unite ?? row.unite_g_ml_piece;
const { unit: baseU, factor } = toBaseUnit(unitRaw);

// 1) prix_kg_l_piece (comme Airtable: €/kg, €/L, €/pièce)
const ppuNormalized = toNumberLoose(row.prix_kg_l_piece);
if (Number.isFinite(ppuNormalized) && ppuNormalized > 0) {
let ppu = ppuNormalized;
if (baseU === 'g') ppu = ppuNormalized / 1000;
else if (baseU === 'ml') ppu = ppuNormalized / 1000;
return { ppu, unit: baseU, reason: null };
}

// 2) fallback : prix_d_achat / quantite_de_reference
const buyPrice = toNumberLoose(row.prix_d_achat);
const refQty = toNumberLoose(row.quantite_de_reference);
if (Number.isFinite(buyPrice) && Number.isFinite(refQty) && refQty > 0) {
const refInBase = refQty * factor;
const ppu = buyPrice / refInBase;
return { ppu, unit: baseU, reason: null };
}

return { ppu: null, unit: baseU, reason: 'PPU_NOT_FOUND' };
}

// ----------------------------------------------------
// ✅ LA FONCTION QU’ON VEUT : getIngredientPriceByName
// ----------------------------------------------------
// Retour compatible avec l’ancien airtable.js
async function getIngredientPriceByName(name, preferUnitRaw) {
const raw = String(name || '').trim();
if (!raw) return null;

const cacheKey = `n:${raw.toLowerCase()}:u:${canonUnit(preferUnitRaw || '') || ''}`;
const fromCache = cacheGet(cacheKey);
if (fromCache !== null) return fromCache;

// ⚠️ Mets le nom EXACT de ta table ici.
// Si tu as créé "Ingredients_base" avec une majuscule, évite : renomme-la en lowercase.
const TABLE = 'ingredients_base'; // <-- à adapter si besoin

// 0) Tentative "synonyme" (match exact sur un des synonymes)
// Ici on fait simple: on récupère un batch et on cherche en JS.
try {
const wanted = normalizeName(raw);

const allKey = `all:${TABLE}`;
let batch = cacheGet(allKey);
if (!batch) {
const { data, error } = await supabaseAdmin
.from(TABLE)
.select('nom, unite_g_ml_piece, type_unite, nombre, gramme_par_piece, densite_g_ml, quantite_de_reference, prix_d_achat, prix_kg_l_piece, synonyme')
.order('nom', { ascending: true })
.limit(1000);

if (!error) {
batch = data || [];
cacheSet(allKey, batch);
} else {
dlog('[SUPABASE] batch load failed', error.message);
}
}

if (Array.isArray(batch) && batch.length) {
const candidates = [];

for (const row of batch) {
const synList = parseSynonymsCell(row.synonyme);
const synNorms = synList.map(normalizeName).filter(Boolean);
if (!synNorms.includes(wanted)) continue;

const { ppu, unit, reason } = computePPUFromRow(row);
const ppuRounded = roundPPU(ppu, unit);
const packInfo = getPackPieceConversion(row, unit);
const buyInfo = getBuyPackInfo(row, row.type_unite ?? row.unite_g_ml_piece);
const density = toNumberLoose(row.densite_g_ml);

candidates.push({
airtableId: row.id, // on garde la clé "airtableId" pour ne rien casser (tu pourras renommer plus tard)
name: row.nom ?? raw,
unit,
pricePerUnit: Number.isFinite(ppuRounded) ? ppuRounded : null,

buyPrice: buyInfo.buyPrice,
refQty: buyInfo.refQty,
refUnit: buyInfo.refUnit,

...packInfo,
density_g_per_ml: Number.isFinite(density) ? density : null,

priceStatus: reason ? 'missing_price' : 'ok',
priceMessage: reason ? "Prix manquant pour cet ingrédient (PPU introuvable)" : undefined,
});
}

if (candidates.length) {
// si plusieurs synonymes matchent, on prend le moins cher (comme avant)
candidates.sort((a, b) => {
const ap = Number.isFinite(a.pricePerUnit) ? a.pricePerUnit : Number.POSITIVE_INFINITY;
const bp = Number.isFinite(b.pricePerUnit) ? b.pricePerUnit : Number.POSITIVE_INFINITY;
return ap - bp;
});
const best = candidates[0];
cacheSet(cacheKey, best);
return best;
}
}
} catch (e) {
dlog('[SUPABASE] synonym lookup failed', e?.message || e);
}

// 1) Exact match sur nom (case-insensitive)
const { data: exact, error: errExact } = await supabaseAdmin
.from(TABLE)
.select('id, nom, unite_g_ml_piece, type_unite, nombre, gramme_par_piece, densite_g_ml, quantite_de_reference, prix_d_achat, prix_kg_l_piece, synonyme')
.ilike('nom', raw) // match exact si raw sans %
.limit(5);

if (errExact) {
cacheSet(cacheKey, null);
return null;
}

if (Array.isArray(exact) && exact.length) {
// Si tu veux gérer preferUnitRaw: filtre par base unit
let picked = exact[0];
if (preferUnitRaw) {
const preferredBase = toBaseUnit(preferUnitRaw)?.unit;
if (preferredBase) {
const same = exact.find((r) => {
const unitRaw = r.type_unite ?? r.unite_g_ml_piece;
const baseU = toBaseUnit(unitRaw)?.unit;
return baseU === preferredBase;
});
if (same) picked = same;
}
}

const { ppu, unit, reason } = computePPUFromRow(picked);
const ppuRounded = roundPPU(ppu, unit);
const packInfo = getPackPieceConversion(picked, unit);
const buyInfo = getBuyPackInfo(picked, picked.type_unite ?? picked.unite_g_ml_piece);
const density = toNumberLoose(picked.densite_g_ml);

const out = {
airtableId: picked.id, // idem: compat
name: picked.nom ?? raw,
unit,
pricePerUnit: Number.isFinite(ppuRounded) ? ppuRounded : null,

buyPrice: buyInfo.buyPrice,
refQty: buyInfo.refQty,
refUnit: buyInfo.refUnit,

...packInfo,
density_g_per_ml: Number.isFinite(density) ? density : null,

priceStatus: reason ? 'missing_price' : 'ok',
priceMessage: reason ? "Prix manquant pour cet ingrédient (PPU introuvable)" : undefined,
};

cacheSet(cacheKey, out);
return out;
}

cacheSet(cacheKey, null);
return null;
}

module.exports = { getIngredientPriceByName, canonUnit, toBaseUnit, toBaseQty };