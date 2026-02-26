// backend/src/services/supabase.js
// LEVEL: SERVICE
// import autorisés : lib-utils generaux-dependances externes
// import interdits : routes-frontend-parsers-ocr-services
// importé uniquement par routes-services
'use strict';

const { supabaseAdmin } = require('./supabaseAdmin');
const { canonUnit, toBaseUnit } = require('../utils/units')

// -------------------------
// LOGS optionnels
// -------------------------
const DEBUG_OCR = process.env.OCR_DEBUG !== 'production';
const dlog = (...args) => { if (DEBUG_OCR) console.debug(...args); };

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
.replace(/\r/g, '')
.toLowerCase()
.normalize('NFD')
.replace(/[\u0300-\u036f]/g, '')
.replace(/œ/g, 'oe')
.replace(/[^a-z0-9\s]/g, ' ')
.replace(/\b(d|de|du|des|la|le|les|l)\b/g, ' ')
.replace(/\s+/g, ' ')
.trim()
.replace(/^oeufs?$/g, 'oeuf')
.replace(/^pommes?\s+de\s+terre$/g, 'pomme de terre');
}

function parseSynonymsCell(v) {
if (!v) return [];
return String(v)
.replace(/\r/g, '')
.split(/[\n,;|]+/g)
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

{/*la fonction été comme ceci avant d'être remplacé par celle ci-dessous le 26/02 - a supprimer si c'est ok
  function getBuyPackInfo(row, unitRawForBase) {
const packUnitRaw = row.type_unite ?? unitRawForBase;
const { unit: baseU, factor } = toBaseUnit(packUnitRaw);

const buyPrice = toNumberLoose(row.prix_d_achat);
//const refQty = toNumberLoose(row.quantite_de_reference);
const packQty = toNumberLoose(row.unite_g_ml_piece);

return {
buyPrice: Number.isFinite(buyPrice) ? buyPrice : null,
refQty: Number.isFinite(packQty) ? packQty : null,
refUnit: baseU || null,
refQtyInBase: Number.isFinite(packQty) ? packQty * factor : null,
};
}*/}

function getBuyPackInfo(row, unitRaw) {
 const buyPrice = toNumberLoose(row?.prix_d_achat);
 if (!Number.isFinite(buyPrice) || buyPrice <= 0) {
   return { buyPrice: null, refQty: null, refUnit: null };
 }

 const unitU = row?.type_unite ?? unitRaw ?? row?.unite_g_ml_piece;
 const { unit: baseU, factor } = toBaseUnit(unitU); // baseU: 'g'|'ml'|'piece'

 // ✅ quantité pack réelle = unite_g_ml_piece (pas quantite_de_reference)
 const packQtyRaw = toNumberLoose(row?.unite_g_ml_piece);

 if (baseU === 'piece') {
   // pack en pièces: on préfère nombre, sinon 1
   const n = toNumberLoose(row?.nombre);
   const refQty = Number.isFinite(n) && n > 0 ? n : 1;
   return { buyPrice, refQty, refUnit: 'piece' };
 }

 if (!Number.isFinite(packQtyRaw) || packQtyRaw <= 0) {
   return { buyPrice, refQty: null, refUnit: baseU };
 }

 // si unite_g_ml_piece est en kg/l/cl/... on ramène en base via factor
 const refQty = packQtyRaw * factor;

 return { buyPrice, refQty, refUnit: baseU };
}

// Prix unitaire: priorité à prix_kg_l_piece, sinon fallback prix_d_achat / quantite_de_reference
function computePPUFromRow(row) {
// Dans ta table tu as : type_unite (probablement "g/ml/piece" ou similaire)
// et unite_g_ml_piece (libellé affichage).
// Pour le calcul base, on préfère type_unite s’il est propre.
const unitRaw = row.type_unite ?? row.unite_g_ml_piece;
const { unit: baseU, factor } = toBaseUnit(unitRaw);

// 1) prix_kg_l_piece (comme anciennement Airtable: €/kg, €/L, €/pièce)
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
  console.log('[getIngredientpriceName] suapabase called with', JSON.stringify(name), 'unit:', preferUnitRaw);
const raw = String(name || '').trim();
if (!raw) return null;

const cacheKey = `n:${raw.toLowerCase()}:u:${canonUnit(preferUnitRaw || '') || ''}`;
const fromCache = cacheGet(cacheKey);
if (fromCache !== null) return fromCache;

// ⚠️ Mets le nom EXACT de ta table ici.
// Si tu as créé "Ingredients_base" avec une majuscule, évite : renomme-la en lowercase.
const TABLE = 'ingredients_base'; // <-- à adapter si besoin

// 0) Tentative "synonyme" (préfiltre SQL + match exact normalisé)
try {
 const wanted = normalizeName(raw);
 const head = wanted.split(' ') [0];
 // préfiltre : uniquement les lignes dont la cellule synonyme contient quelque chose proche
 const { data: synRows, error: synErr } = await supabaseAdmin
   .from(TABLE)
   .select('id, nom, unite_g_ml_piece, type_unite, nombre, gramme_par_piece, densite_g_ml, quantite_de_reference, prix_d_achat, prix_kg_l_piece, synonyme')
   .ilike('synonyme', `%${head}%`)
   .limit(50);
  
    console.log('SYN PREFILTER', {
      raw,
      wanted,
      count: synRows?.length,
      synErr: synErr?.message
    });

 if (!synErr && Array.isArray(synRows) && synRows.length) {
   const candidates = [];

   for (const row of synRows) {
     const synList = parseSynonymsCell(row.synonyme);
     const synNorms = synList.map(normalizeName).filter(Boolean);
     console.log('DEBUG SYN:', {
      raw,
      wanted,
      synList,
      synNorms
     });
     if (!synNorms.includes(wanted)) continue;

     const { ppu, unit, reason } = computePPUFromRow(row);
     const ppuRounded = roundPPU(ppu, unit);
     const packInfo = getPackPieceConversion(row, unit);
     const buyInfo = getBuyPackInfo(row, row.type_unite ?? row.unite_g_ml_piece);
     console.log('[BUYINFO]', raw, buyInfo);
     const density = toNumberLoose(row.densite_g_ml);

     candidates.push({
       id: row.id,
       name: row.nom ?? raw,
       unit,
       pricePerUnit: Number.isFinite(ppuRounded) ? ppuRounded : null,

       buyPrice: buyInfo.buyPrice,
       buyPriceEur: buyInfo.buyPrice,
       refQty: buyInfo.refQty,
       refUnit: buyInfo.refUnit,
       buyRefQty: buyInfo.refQty,
       buyRefUnit: buyInfo.refUnit,

       ...packInfo,

       gramsPerPiece: toNumberLoose(row.gramme_par_piece) || null,
       density_g_per_ml: Number.isFinite(density) ? density : null,

       priceStatus: reason ? 'missing_price' : 'ok',
       priceMessage: reason ? "Prix manquant pour cet ingrédient (PPU introuvable)" : undefined,
     });
   }

   if (candidates.length) {
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
.ilike('nom', `%${raw}%`) // match exact si raw sans %
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
id: picked.id, // idem: compat
name: picked.nom ?? raw,
unit,
pricePerUnit: Number.isFinite(ppuRounded) ? ppuRounded : null,

buyPrice: buyInfo.buyPrice,
buyPriceEur: buyInfo.buyPrice,
refQty: buyInfo.refQty,
refUnit: buyInfo.refUnit,
buyRefQty: buyInfo.refQty,
buyRefUnit: buyInfo.refUnit,

...packInfo,
gramsPerPiece: toNumberLoose(picked.gramme_par_piece) || null,
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

module.exports = { getIngredientPriceByName };