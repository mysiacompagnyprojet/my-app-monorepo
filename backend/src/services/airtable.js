// backend/src/services/airtable.js
require('dotenv').config();
const Airtable = require('airtable');

// ─────────────────────────────────────────────────────────────
// LOGS : coupés par défaut. Mettre AIRTABLE_DEBUG=1 pour les voir
// ─────────────────────────────────────────────────────────────
const DEBUG = process.env.AIRTABLE_DEBUG === '1';
const dlog = (...args) => { if (DEBUG) console.debug(...args); };

// ─────────────────────────────────────────────────────────────
// CONFIG : noms de table/colonnes (peuvent venir du .env)
// Adapte TOUT ça depuis .env si besoin ; ces défauts collent à tes captures
// ─────────────────────────────────────────────────────────────

// Table principale (Ingrédients)
const TABLE = process.env.AIRTABLE_TABLE || 'Ingrédients';

// Table des alias
const ALIASES_TABLE = process.env.AIRTABLE_ALIASES_TABLE || 'Aliases';

// Colonnes de la table Ingrédients (tes intitulés exacts)
const COL_NAME      = process.env.AIRTABLE_FIELD_NAME      || 'NOM';
const COL_UNIT      = process.env.AIRTABLE_FIELD_UNIT      || 'Unité (g,ml, pièce)';
const COL_REF_QTY   = process.env.AIRTABLE_FIELD_REF_QTY   || 'Quantité de référence';
const COL_BUY_PRICE = process.env.AIRTABLE_FIELD_BUY_PRICE || "Prix d'achat";

// ⚠️ IMPORTANT : bien respecter l’accent : "pièce" (è), pas "piéce"
const COL_PRICE_KG_L_PIECE = process.env.AIRTABLE_FIELD_PPU || 'Prix kg/L/pièce';
const COL_UNIT_KIND        = process.env.AIRTABLE_FIELD_UNIT_KIND || "Type d'unité";

// Colonnes de la table Aliases
const COL_ALIAS_NAME = process.env.AIRTABLE_ALIAS_COL_ALIAS || 'Alias';
const COL_ALIAS_LINK = process.env.AIRTABLE_ALIAS_COL_LINK  || 'Ingrédients';

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

// ----- Helper nombres tolérant ("0,30" -> 0.30, etc.) -----
function toNumberLoose(v) {
  if (v == null) return NaN;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/\u00A0/g, ' ').trim().replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

// ----- Utils d’unité -----
function canonUnit(uRaw) {
  const u = String(uRaw || '')
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
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

  if (u === 'mg') return { unit: 'g',  factor: 0.001 };
  if (u === 'kg') return { unit: 'g',  factor: 1000 };
  if (u === 'g')  return { unit: 'g',  factor: 1 };

  if (u === 'cl') return { unit: 'ml', factor: 10 };
  if (u === 'dl') return { unit: 'ml', factor: 100 };
  if (u === 'l')  return { unit: 'ml', factor: 1000 };
  if (u === 'ml') return { unit: 'ml', factor: 1 };

  if (u === 'piece') return { unit: 'piece', factor: 1 };

  return { unit: 'piece', factor: 1 };
}

function toBaseQty(qty, unit) {
  const { unit: baseU, factor } = toBaseUnit(unit);
  return { qty: Number(qty || 0) * factor, unit: baseU };
}

// ----- Arrondi lisible du prix unitaire -----
function roundPPU(ppu, unit) {
  if (!Number.isFinite(ppu)) return null;
  const decimals =
    unit === 'g' || unit === 'ml' ? 5 :
    unit === 'piece'              ? 3 :
    4; // fallback

  return Number(ppu.toFixed(decimals));
}

// ----- Calcul du prix unitaire (par g/ml/pièce) -----
function computePPUFromRow(fields) {
  const unitRaw = fields[COL_UNIT_KIND] ?? fields[COL_UNIT];
  const { unit: baseU, factor } = toBaseUnit(unitRaw);

  const itemName = fields[COL_NAME] ?? '(inconnu)';
  const unitUtf8 = unitRaw ? Buffer.from(String(unitRaw), 'utf8').toString('utf8') : null;
  dlog('[AIRTABLE]', { itemName, unitRaw, utf8: unitUtf8 });

  // 1) prix normalisé prioritaire
  let ppuNormalized = toNumberLoose(fields[COL_PRICE_KG_L_PIECE]);
  if (Number.isFinite(ppuNormalized) && ppuNormalized > 0) {
    dlog('[PPU] normalized ok:', fields[COL_NAME] || fields.NOM, ppuNormalized);
    return { ppu: ppuNormalized, unit: baseU };
  }

  // 2) fallback: prix d'achat / quantité de référence
  const buyPrice = toNumberLoose(fields[COL_BUY_PRICE]);
  const refQty   = toNumberLoose(fields[COL_REF_QTY]);
  if (Number.isFinite(buyPrice) && Number.isFinite(refQty) && refQty > 0) {
    const refInBase = refQty * factor;
    const ppu = buyPrice / refInBase;
    dlog('[PPU] fallback buy/qty:', fields[COL_NAME] || fields.NOM, { buyPrice, refQty, ppu });
    return { ppu, unit: baseU };
  }

  throw new Error(`PPU introuvable pour ${fields[COL_NAME] || fields.NOM}`);
}

// =====================
// Aide fuzzy (fallback)
// =====================

function normalizeName(s='') {
  return String(s)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/œ/g, 'oe')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(d|de|du|des|la|le|les|l)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
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

// ─────────────────────────────────────────────────────────────
// LOOKUP ALIASES : exact + fuzzy (tolère œ/oe et fautes légères)
// Toujours retourner l'ID string de l’ingrédient lié
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
      if (Array.isArray(link) && link.length) {
        const first = link[0];
        return typeof first === 'string' ? first : (first && first.id) || null;
      }
    }
  } catch (e) {
    if (DEBUG) console.warn('[Airtable] lookup Aliases (exact) ignoré:', e?.message || e);
  }

  // 2) Fuzzy : on compare côté JS
  try {
    const wanted = normalizeName(safe);
    const batch = await base(ALIASES_TABLE).select({ maxRecords: 1000 }).all();

    let best = null;
    for (const r of batch) {
      const aliasVal = r.get(COL_ALIAS_NAME);
      const aliases = Array.isArray(aliasVal) ? aliasVal : [aliasVal];
      for (const av of aliases) {
        const norm = normalizeName(String(av || ''));
        if (!norm) continue;

        const dist = levenshtein(wanted, norm);
        const maxLen = Math.max(wanted.length, norm.length) || 1;
        const ratio = 1 - dist / maxLen;

        if (!best || ratio > best.ratio) {
          best = { r, ratio };
        }
        if (norm === wanted) {
          const link = r.get(COL_ALIAS_LINK);
          if (Array.isArray(link) && link.length) {
            const first = link[0];
            return typeof first === 'string' ? first : (first && first.id) || null;
          }
        }
      }
    }

    if (best && best.ratio >= 0.82) {
      const link = best.r.get(COL_ALIAS_LINK);
      if (Array.isArray(link) && link.length) {
        const first = link[0];
        return typeof first === 'string' ? first : (first && first.id) || null;
      }
    }
  } catch (e) {
    if (DEBUG) console.warn('[Airtable] lookup Aliases (fuzzy) ignoré:', e?.message || e);
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

  // 1) Essai exact sur Ingrédients (évite les soucis d’accents avec une comparaison LOWER)
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
      pricePerUnit: roundPPU(ppu, unit),
    };
    cacheSet(cacheKey, out);
    return out;
  }

  // 2) Recherche via table Aliases (lien vers une ligne Ingrédients)
  const targetId = await findAliasTargetId(raw);
  if (targetId) {
    const ingrRec = await base(TABLE).find(targetId);
    const fields = ingrRec.fields || {};
    const { ppu, unit } = computePPUFromRow(fields);
    const out = {
      airtableId: ingrRec.id,
      name: fields[COL_NAME] || raw,
      unit,
      pricePerUnit: roundPPU(ppu, unit),
    };
    cacheSet(cacheKey, out);
    return out;
  }

  // 3) Fallback fuzzy : Ingrédients (sur le NOM)
  const wanted = normalizeName(raw);
  const batch = await base(TABLE).select({ maxRecords: 1000 }).all();

  let best = null;
  for (const r of batch) {
    const fields = r.fields || {};
    const baseName = String(fields[COL_NAME] ?? '');
    const candNorm = normalizeName(baseName);
    if (!candNorm) continue;

    const dist = levenshtein(wanted, candNorm);
    const maxLen = Math.max(wanted.length, candNorm.length) || 1;
    const ratio = 1 - dist / maxLen;

    if (!best || ratio > best.ratio) {
      best = { r, ratio, matchedLabel: baseName };
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
      pricePerUnit: roundPPU(ppu, unit),
    };
    cacheSet(cacheKey, out);
    return out;
  }

  cacheSet(cacheKey, null);
  return null;
}

module.exports = { getIngredientPriceByName, canonUnit, toBaseUnit, toBaseQty };
