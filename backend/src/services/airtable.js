// backend/src/services/airtable.js
const Airtable = require('airtable');
const { stripAccents } = require('../utils/units');

// ========= CONFIG : noms de colonnes EXACTS dans ta table =========
const COL_NAME = 'NOM';
const COL_UNIT = 'Unité (g,ml, pièce)';
const COL_REF_QTY = 'Quantité de référence';   // ex: 1000 pour g/ml, 1 pour pièce
const COL_BUY_PRICE = "Prix d'achat";          // prix payé pour la quantité de référence
// Certaines tables ont déjà un prix normalisé :
const COL_PRICE_KG_L_PIECE = 'Prix kg/L/piéce'; // déjà €/g, €/ml ou €/pièce dans ta base
const COL_PRICE_AU_KG_L = 'Prix au kg/L';       // €/kg ou €/L
// (NOUVEAU) Colonne "type" (select: g, cl, L, ml, pièce, botte, etc.)
const COL_UNIT_KIND = "Type d'unité"; // adapte si ta colonne s'appelle "Type" au lieu de "Type..."
// ==================================================================

const BASE_ID = process.env.AIRTABLE_BASE_ID;
const TABLE = process.env.AIRTABLE_TABLE || 'Ingredients';

if (!BASE_ID) console.warn('[Airtable] AIRTABLE_BASE_ID manquant');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(BASE_ID);

// =========================
// Cache (avec TTL 1 minute)
// =========================
const TTL_MS = 60 * 1000;
const _cache = new Map(); // key -> { value, t }
const now = () => Date.now();
function cacheGet(key) {
  const e = _cache.get(key);
  if (!e) return null;
  if (now() - e.t > TTL_MS) { _cache.delete(key); return null; }
  return e.value;
}
function cacheSet(key, value) {
  _cache.set(key, { value, t: now() });
}

// ----- Utils d’unité -----
function canonUnit(uRaw) {
  const u = String(uRaw || '')
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // retire accents
  if (!u) return null;

  if (['g', 'gramme', 'grammes'].includes(u)) return 'g';
  if (['kg', 'kilogramme', 'kilogrammes'].includes(u)) return 'kg';
  if (['mg'].includes(u)) return 'mg';

  if (['ml', 'millilitre', 'millilitres'].includes(u)) return 'ml';
  if (['l', 'litre', 'litres'].includes(u)) return 'l';
  if (['cl'].includes(u)) return 'cl';
  if (['dl'].includes(u)) return 'dl';

  if (['piece', 'pièce', 'unite', 'unité', 'pc', 'botte'].includes(u)) return 'piece';
  return u; // inconnu -> brut
}

function toBaseUnit(unit) {
  // La "base" côté prix unitaire: g / ml / piece
  const u = canonUnit(unit);

  if (u === 'mg') return { unit: 'g',  factor: 0.001 };  // 1 mg -> 0.001 g
  if (u === 'kg') return { unit: 'g',  factor: 1000 };   // 1 kg -> 1000 g
  if (u === 'g')  return { unit: 'g',  factor: 1 };

  if (u === 'cl') return { unit: 'ml', factor: 10 };     // 1 cl -> 10 ml
  if (u === 'dl') return { unit: 'ml', factor: 100 };    // 1 dl -> 100 ml
  if (u === 'l')  return { unit: 'ml', factor: 1000 };   // 1 L  -> 1000 ml
  if (u === 'ml') return { unit: 'ml', factor: 1 };

  if (u === 'piece') return { unit: 'piece', factor: 1 };

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
  const priceKgLPiece = Number(fields[COL_PRICE_KG_L_PIECE] ?? NaN); // déjà €/g, €/ml, €/pièce chez toi
  const priceAuKgL    = Number(fields[COL_PRICE_AU_KG_L] ?? NaN);    // €/kg ou €/L

  // on préfère le "Type..." si présent ; sinon on retombe sur "Unité (g/ml, pièce)"
  const unitRaw = fields[COL_UNIT_KIND] ?? fields[COL_UNIT];
  const { unit: baseU, factor } = toBaseUnit(unitRaw);

  const itemName = fields[COL_NAME] ?? '(inconnu)'; // on récupère le nom de l’ingrédient
  const unitUtf8 = unitRaw ? Buffer.from(String(unitRaw), 'utf8').toString('utf8') : null; // évite les erreurs si vide
  console.log('[AIRTABLE]', { itemName, unitRaw, utf8: unitUtf8 });


  // Cas 1 : ta colonne "Prix kg/L/pièce" est déjà normalisée -> PAS de /1000
  if (Number.isFinite(priceKgLPiece)) {
    return { ppu: priceKgLPiece, unit: baseU };
  }

  // Cas 2 : si on a "Prix au kg/l" (€/kg ou €/L), convertir vers €/g ou €/ml
  if (Number.isFinite(priceAuKgL)) {
    if (baseU === 'g' || baseU === 'ml') return { ppu: priceAuKgL / 1000, unit: baseU };
    if (baseU === 'piece')               return { ppu: priceAuKgL,        unit: 'piece' }; // cas exotique
  }

  // Cas 3 : fallback -> calcule: ppu = Prix d’achat / (Quantité de référence convertie vers l’unité de base)
  const refQty   = Number(fields[COL_REF_QTY] ?? NaN);
  const buyPrice = Number(fields[COL_BUY_PRICE] ?? NaN);

  if (Number.isFinite(refQty) && refQty > 0 && Number.isFinite(buyPrice)) {
    const refInBase = refQty * factor; // conversion kg/L/cl/dl -> g/ml
    const ppu = buyPrice / (refInBase || 1); // prix par g/ml/pièce
    return { ppu, unit: baseU };
  }

  return { ppu: null, unit: null };
}

// =====================
// Aide fuzzy (fallback)
// =====================
function normName(s = '') {
  return stripAccents(String(s).trim().toLowerCase());
}
function levenshtein(a = '', b = '') {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

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
  const raw = String(name || '').trim();
  if (!raw) return null;

  const cacheKey = `n:${raw.toLowerCase()}`;
  const fromCache = cacheGet(cacheKey);
  if (fromCache !== null) return fromCache;

  // 1) essai exact insensible à la casse sur COL_NAME
  const formula = `LOWER({${COL_NAME}}) = LOWER("${raw.replace(/"/g, '\\"')}")`;
  const exact = await base(TABLE)
    .select({ filterByFormula: formula, maxRecords: 1 })
    .all();

  if (exact.length) {
    const r = exact[0];
    const fields = r.fields || {};
    const { ppu, unit } = computePPUFromRow(fields);
    const out = {
      airtableId: r.id,
      name: fields[COL_NAME] ?? raw,
      unit,
      pricePerUnit: Number.isFinite(ppu) ? ppu : null,
    };
    cacheSet(cacheKey, out);
    return out;
  }

  // 2) fallback fuzzy: on prend un paquet et on choisit le plus proche
  const wanted = normName(raw);
  const batch = await base(TABLE).select({ maxRecords: 50 }).all();

  let best = null;
  for (const r of batch) {
    const fields = r.fields || {};
    const nm = String(fields[COL_NAME] ?? '');
    const dist = levenshtein(wanted, normName(nm));
    const maxLen = Math.max(wanted.length, nm.length) || 1;
    const ratio = 1 - dist / maxLen; // 0..1
    if (!best || ratio > best.ratio) {
      best = { r, dist, ratio };
    }
  }

  // petit seuil: tolère fautes courtes ou pluriels/singuliers
  if (best && (best.dist <= 2 || best.ratio >= 0.8)) {
    const r = best.r;
    const fields = r.fields || {};
    const { ppu, unit } = computePPUFromRow(fields);
    const out = {
      airtableId: r.id,
      name: fields[COL_NAME] ?? raw,
      unit,
      pricePerUnit: Number.isFinite(ppu) ? ppu : null,
    };
    cacheSet(cacheKey, out);
    return out;
  }

  cacheSet(cacheKey, null);
  return null;
}

module.exports = { getIngredientPriceByName, canonUnit, toBaseUnit, toBaseQty };
