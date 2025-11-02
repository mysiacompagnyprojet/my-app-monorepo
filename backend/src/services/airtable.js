// backend/src/services/airtable.js
require('dotenv').config();
const Airtable = require('airtable');
//const { stripAccents } = require('../utils/units');

// ─────────────────────────────────────────────────────────────
// CONFIG : noms de table/colonnes (peuvent venir du .env)
// ─────────────────────────────────────────────────────────────

// Table principale (Ingrédients)
const TABLE = process.env.AIRTABLE_TABLE || 'Ingredients';

// Table des alias (Option B propre)
const ALIASES_TABLE = process.env.AIRTABLE_ALIASES_TABLE || 'Aliases';

// (Optionnel) Lookup des synonymes côté Ingrédients (si tu l’as ajoutée)
// const COL_SYNONYMS_LOOKUP = process.env.AIRTABLE_FIELD_SYNONYMS_LOOKUP || 'Synonymes';

// Colonnes de la table Ingrédients (on conserve TES intitulés exacts)
const COL_NAME              = process.env.AIRTABLE_FIELD_NAME || 'NOM';
const COL_UNIT              = process.env.AIRTABLE_FIELD_UNIT || 'Unité (g,ml, pièce)';
const COL_REF_QTY           = process.env.AIRTABLE_FIELD_REF_QTY || 'Quantité de référence';
const COL_BUY_PRICE         = process.env.AIRTABLE_FIELD_BUY_PRICE || "Prix d'achat";
const COL_PRICE_KG_L_PIECE  = process.env.AIRTABLE_FIELD_PPU || 'Prix kg/L/piéce'; // libellé tel que dans ta base
const COL_PRICE_AU_KG_L     = process.env.AIRTABLE_FIELD_PRIX || 'Prix au kg/L';
const COL_UNIT_KIND         = process.env.AIRTABLE_FIELD_UNIT_KIND || "Type d'unité"; // select: g, ml, pièce...

// Colonnes de la table Aliases
const COL_ALIAS_NAME        = process.env.AIRTABLE_ALIAS_COL_ALIAS || 'alias';
const COL_ALIAS_LINK        = process.env.AIRTABLE_ALIAS_COL_LINK  || 'ingredient';

// ─────────────────────────────────────────────────────────────

const BASE_ID = process.env.AIRTABLE_BASE_ID;
if (!BASE_ID) console.warn('[Airtable] AIRTABLE_BASE_ID manquant');
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(BASE_ID);

// =========================
// Cache (TTL 1 minute)
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
  const priceKgLPiece = Number(fields[COL_PRICE_KG_L_PIECE] ?? NaN); // déjà €/g, €/ml, €/pièce
  const priceAuKgL    = Number(fields[COL_PRICE_AU_KG_L] ?? NaN);    // €/kg ou €/L

  // on préfère le "Type..." si présent ; sinon on retombe sur "Unité (g/ml, pièce)"
  const unitRaw = fields[COL_UNIT_KIND] ?? fields[COL_UNIT];
  const { unit: baseU, factor } = toBaseUnit(unitRaw);

  // log debug OK (facultatif)
  const itemName = fields[COL_NAME] ?? '(inconnu)';
  const unitUtf8 = unitRaw ? Buffer.from(String(unitRaw), 'utf8').toString('utf8') : null;
  console.log('[AIRTABLE]', { itemName, unitRaw, utf8: unitUtf8 });

  // Cas 1 : "Prix kg/L/pièce" déjà normalisé -> PAS de /1000
  if (Number.isFinite(priceKgLPiece)) {
    return { ppu: priceKgLPiece, unit: baseU };
  }

  // Cas 2 : "Prix au kg/L" (€/kg ou €/L) -> convertir vers €/g ou €/ml
  if (Number.isFinite(priceAuKgL)) {
    if (baseU === 'g' || baseU === 'ml') return { ppu: priceAuKgL / 1000, unit: baseU };
    if (baseU === 'piece')               return { ppu: priceAuKgL,        unit: 'piece' }; // cas exotique
  }

  // Cas 3 : fallback -> ppu = Prix d’achat / (Quantité de référence convertie vers l’unité de base)
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

function normalizeName(s='') {
  return String(s)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // accents
    .replace(/œ/g, 'oe')
    .replace(/[^a-z0-9\s]/g, ' ')                      // ponctuation → espace
    .replace(/\b(d|de|du|des|la|le|les|l)\b/g, ' ')    // petits mots
    .replace(/\s+/g, ' ')                              // espaces multiples
    .trim()
    // pluriels très courants
    .replace(/oeufs?$/, 'oeuf')
    .replace(/pommes? de terre$/, 'pomme de terre');
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

// Récupère les synonymes depuis une colonne Lookup (désactivé pour l’instant)
// function extractSynonymsFromFields(fields) {
//   const v = fields[COL_SYNONYMS_LOOKUP];
//   if (!v) return [];
//   if (Array.isArray(v)) return v.map(String).map(s => s.trim()).filter(Boolean);
//   return String(v).split(',').map(s => s.trim()).filter(Boolean);
// }

// ─────────────────────────────────────────────────────────────
// LOOKUP ALIASES : exact + fuzzy (tolère œ/oe et fautes légères)
// ─────────────────────────────────────────────────────────────
async function findAliasTargetId(raw) {
  const safe = String(raw || '').trim();
  if (!safe) return null;

  // 1) Essai exact via filterByFormula (rapide)
  try {
    const exact = await base(ALIASES_TABLE)
      .select({
        maxRecords: 1,
        filterByFormula: `LOWER({${COL_ALIAS_NAME}}) = LOWER("${safe.replace(/"/g, '\\"')}")`,
      })
      .all();

    if (exact.length) {
      const rec = exact[0];
      const link = rec.get(COL_ALIAS_LINK);
      if (Array.isArray(link) && link.length) return link[0];
    }
  } catch (e) {
    console.warn('[Airtable] lookup Aliases (exact) ignoré:', e?.message || e);
  }

  // 2) Fuzzy : on compare côté JS
  try {
    const wanted = normalizeName(safe);
    const batch = await base(ALIASES_TABLE).select({ maxRecords: 200 }).all();

    let best = null;
    for (const r of batch) {
      const aliasVal = String(r.get(COL_ALIAS_NAME) ?? '');
      const norm = normalizeName(aliasVal);
      if (!norm) continue;

      const dist = levenshtein(wanted, norm);
      const maxLen = Math.max(wanted.length, norm.length) || 1;
      const ratio = 1 - dist / maxLen;

      if (!best || ratio > best.ratio) {
        best = { r, ratio };
      }

      if (norm === wanted) {
        const link = r.get(COL_ALIAS_LINK);
        if (Array.isArray(link) && link.length) return link[0];
      }
    }

    if (best && best.ratio >= 0.82) {
      const link = best.r.get(COL_ALIAS_LINK);
      if (Array.isArray(link) && link.length) return link[0];
    }
  } catch (e) {
    console.warn('[Airtable] lookup Aliases (fuzzy) ignoré:', e?.message || e);
  }

  return null;
}

/**
 * Retourne:
 *  {
 *    airtableId,
 *    name,
 *    unit,
 *    pricePerUnit
 *  }
 * ou null si non trouvé.
 */
async function getIngredientPriceByName(name) {
  const raw = String(name || '').trim();
  if (!raw) return null;

  const cacheKey = `n:${raw.toLowerCase()}`;
  const fromCache = cacheGet(cacheKey);
  if (fromCache !== null) return fromCache;

  // 1) Essai exact sur Ingrédients
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

  // 2) Recherche via table Aliases
  const targetId = await findAliasTargetId(raw);
  if (targetId) {
    const ingrRec = await base(TABLE).find(targetId);
    const fields = ingrRec.fields || {};
    const { ppu, unit } = computePPUFromRow(fields);
    const out = {
      airtableId: ingrRec.id,
      name: fields[COL_NAME] || raw,
      unit,
      pricePerUnit: Number.isFinite(ppu) ? ppu : null,
    };
    cacheSet(cacheKey, out);
    return out;
  }

  // 3) Fallback fuzzy : Ingrédients (sans synonymes pour l’instant)
  const wanted = normalizeName(raw);
  const batch = await base(TABLE).select({ maxRecords: 200 }).all();

  let best = null;
  for (const r of batch) {
    const fields = r.fields || {};
    const baseName = String(fields[COL_NAME] ?? '');
    const candList = [baseName]; // + extractSynonymsFromFields(fields) (désactivé)

    for (const candidate of candList) {
      const candNorm = normalizeName(candidate);
      const dist = levenshtein(wanted, candNorm);
      const maxLen = Math.max(wanted.length, candNorm.length) || 1;
      const ratio = 1 - dist / maxLen;

      if (!best || ratio > best.ratio) {
        best = { r, ratio, matchedLabel: candidate };
      }
    }
  }

  if (best && best.ratio >= 0.82) {
    const r = best.r;
    const fields = r.fields || {};
    const { ppu, unit } = computePPUFromRow(fields);
    const out = {
      airtableId: r.id,
      name: fields[COL_NAME] ?? best.matchedLabel,
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


