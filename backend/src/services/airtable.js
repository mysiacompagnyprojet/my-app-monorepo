// backend/src/services/airtable.js
require('dotenv').config();
const Airtable = require('airtable');

// ─────────────────────────────────────────────────────────────
// LOGS : coupés par défaut. Mettre AIRTABLE_DEBUG=1 pour les voir
// ─────────────────────────────────────────────────────────────
const DEBUG = process.env.AIRTABLE_DEBUG === '1';
const dlog = (...args) => {
  if (DEBUG) console.debug(...args);
};

// ─────────────────────────────────────────────────────────────
// CONFIG : noms de table/colonnes (peuvent venir du .env)
// ─────────────────────────────────────────────────────────────

// Table principale (Ingrédients)
const TABLE = process.env.AIRTABLE_TABLE || 'Ingrédients';

// Table des alias
const ALIASES_TABLE = process.env.AIRTABLE_ALIASES_TABLE || 'Aliases';

// Colonnes de la table Ingrédients
const COL_NAME = process.env.AIRTABLE_FIELD_NAME || 'NOM';
const COL_UNIT = process.env.AIRTABLE_FIELD_UNIT || 'Unité (g,ml, pièce)';
const COL_REF_QTY = process.env.AIRTABLE_FIELD_REF_QTY || 'Quantité de référence';
const COL_BUY_PRICE = process.env.AIRTABLE_FIELD_BUY_PRICE || "Prix d'achat";

// ✅ NOUVEAU : colonne "Nombre" (nb de pièces/cubes dans le paquet)
const COL_FIELD_COUNT = process.env.AIRTABLE_FIELD_COUNT || 'Nombre';
const COL_GRAMS_PER_PIECE = process.env.AIRTABLE_FIELD_COL_GRAM || 'Gramme par pièce';

// ⚠️ IMPORTANT : bien respecter l’accent : "pièce" (è), pas "piéce"
const COL_PRICE_KG_L_PIECE = process.env.AIRTABLE_FIELD_PPU || 'Prix kg/L/pièce';
const COL_UNIT_KIND = process.env.AIRTABLE_FIELD_UNIT_KIND || "Type d'unité";

// ✅ NOUVEAU : Synonyme (texte)
const COL_SYNONYMS = process.env.AIRTABLE_FIELD_SYNONYMS || 'Synonyme';

// Colonnes de la table Aliases
const COL_ALIAS_NAME = process.env.AIRTABLE_ALIAS_COL_ALIAS || 'Alias';
const COL_ALIAS_LINK = process.env.AIRTABLE_ALIAS_COL_LINK || 'Ingrédients';

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
  if (now() - e.t > TTL_MS) {
    _cache.delete(key);
    return null;
  }
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

// ----- Arrondi lisible du prix unitaire -----
function roundPPU(ppu, unit) {
  if (!Number.isFinite(ppu)) return null;

  const decimals =
    unit === 'g' || unit === 'ml'
      ? 5
      : unit === 'piece'
      ? 3
      : 4;

  return Number(ppu.toFixed(decimals));
}

// ✅ NOUVEAU : calcule count + gramsPerPiece/mlPerPiece à partir d’Airtable
// packQty = ton champ "Unité (g,ml, pièce)" (poids/volume du paquet)
// count   = ton champ "Nombre" (nb de cubes/pièces dans le paquet)
function getPackPieceConversion(fields, unit) {
  const packQty = toNumberLoose(fields[COL_UNIT]);
  const countRaw = fields[COL_FIELD_COUNT];
  const count = toNumberLoose(countRaw);

  let gramsPerPiece = null;
  let mlPerPiece = null;

  if (Number.isFinite(packQty) && Number.isFinite(count) && count > 0) {
    if (unit === 'g') gramsPerPiece = packQty / count;
    if (unit === 'ml') mlPerPiece = packQty / count;
  }

  return {
    count: Number.isFinite(count) ? count : null,
    gramsPerPiece: Number.isFinite(gramsPerPiece) ? gramsPerPiece : null,
    mlPerPiece: Number.isFinite(mlPerPiece) ? mlPerPiece : null,
  };
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
    // la colonne est au kg/L/pièce, on convertit en g/ml/pièce
    let ppu = ppuNormalized;

    if (baseU === 'g') {
      //€/kg -> €/g
      ppu = ppuNormalized / 1000;
    } else if (baseU === 'ml') {
      //€/L -> €/ml
      ppu = ppuNormalized / 1000;
    } // pièce -> inchangé

    dlog('[PPU] normalized ok:', fields[COL_NAME] || fields.NOM, { baseU, ppuNormalized, ppu});
    return { ppu, unit: baseU };
  }

  // 2) fallback: prix d'achat / quantité de référence
  const buyPrice = toNumberLoose(fields[COL_BUY_PRICE]);
  const refQty = toNumberLoose(fields[COL_REF_QTY]);
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

function normalizeKey(s = '') {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // enlève accents
    .replace(/[^a-z0-9\s&]/g, ' ')   // garde lettres/chiffres/espace/&
    .replace(/\s+/g, ' ')
    .trim();
}

function splitSynonymsCell(v) {
  if (v == null) return [];
  // cellule texte : on split sur ; , / ou retours ligne
  return String(v)
    .split(/[;\n,\/]+/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function recordHasSynonym(fields, rawName) {
  const wanted = normalizeKey(rawName);
  if (!wanted) return false;

  const synCell = fields[COL_SYNONYMS];
  const list = splitSynonymsCell(synCell);

  for (const s of list) {
    if (normalizeKey(s) === wanted) return true;
  }
  return false;
}

function levenshtein(a = '', b = '') {
  const m = a.length,
    n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

// ✅ Synonyme (texte) : accepte ; , | et retours ligne
function parseSynonymsCell(v) {
  if (!v) return [];
  return String(v)
    .split(/[\n;,|]+/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

// ✅ Choix "moins cher" (sur pricePerUnit) + fallback unité si égalité
function pickCheapest(candidates, preferUnitRaw) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const sorted = [...candidates].sort((a, b) => {
    const ap = Number.isFinite(a.pricePerUnit) ? a.pricePerUnit : Number.POSITIVE_INFINITY;
    const bp = Number.isFinite(b.pricePerUnit) ? b.pricePerUnit : Number.POSITIVE_INFINITY;
    return ap - bp;
  });

  const bestPrice = sorted[0].pricePerUnit;
  const ties = sorted.filter((c) => c.pricePerUnit === bestPrice);

  if (ties.length > 1 && preferUnitRaw) {
    const preferredBase = toBaseUnit(preferUnitRaw)?.unit;
    if (preferredBase) {
      const byUnit = ties.find((c) => c.unit === preferredBase);
      if (byUnit) return byUnit;
    }
  }

  return sorted[0];
}

// ─────────────────────────────────────────────────────────────
// LOOKUP ALIASES : exact + fuzzy
// Toujours retourner l'ID string de l’ingrédient lié
// ─────────────────────────────────────────────────────────────
async function findAliasTargetId(raw) {
  const safe = String(raw || '').trim();
  if (!safe) return null;

  // 1) Essai exact
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

  // 2) Fuzzy
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

        if (!best || ratio > best.ratio) best = { r, ratio };

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

function pickBestRecordByUnit(records, preferUnitRaw) {
  if (!Array.isArray(records) || records.length === 0) return null;
  if (!preferUnitRaw) return records[0];

  const preferredBase = toBaseUnit(preferUnitRaw)?.unit; // 'g' | 'ml' | 'piece'
  if (!preferredBase) return records[0];

  for (const r of records) {
    try {
      const fields = r.fields || {};
      const unitRaw = fields[COL_UNIT_KIND] ?? fields[COL_UNIT];
      const baseU = toBaseUnit(unitRaw)?.unit;
      if (baseU === preferredBase) return r;
    } catch {}
  }

  return records[0];
}

function pickCheapestRecord(records, preferUnitRaw) {
  if (!Array.isArray(records) || records.length === 0) return null;

  const preferredBase = preferUnitRaw ? toBaseUnit(preferUnitRaw)?.unit : null;

  // 1) Filtrer par compatibilité d’unité si possible
  let candidates = records;
  if (preferredBase) {
    const filtered = records.filter((r) => {
      try {
        const fields = r.fields || {};
        const unitRaw = fields[COL_UNIT_KIND] ?? fields[COL_UNIT];
        const baseU = toBaseUnit(unitRaw)?.unit;
        return baseU === preferredBase;
      } catch {
        return false;
      }
    });
    if (filtered.length) candidates = filtered;
  }

  // 2) Le moins cher (PPU)
  let best = null;
  for (const r of candidates) {
    try {
      const fields = r.fields || {};
      const { ppu, unit } = computePPUFromRow(fields);
      const ppuRounded = roundPPU(ppu, unit);
      if (!Number.isFinite(ppuRounded)) continue;

      if (!best || ppuRounded < best.ppu) best = { r, ppu: ppuRounded };
    } catch {}
  }

  return best ? best.r : candidates[0];
}

/**
 * Retourne:
 * {
 *   airtableId,
 *   name,
 *   unit,
 *   pricePerUnit,
 *   count,
 *   gramsPerPiece,
 *   mlPerPiece
 * }
 * ou null si non trouvé.
 */
async function getIngredientPriceByName(name, preferUnitRaw) {
  const raw = String(name || '').trim();
  if (!raw) return null;

  const cacheKey = `n:${raw.toLowerCase()}:u:${canonUnit(preferUnitRaw || '') || ''}`;
  const fromCache = cacheGet(cacheKey);
  if (fromCache !== null) return fromCache;

  // ───────────────────────────────────────────────────────────
  // 0) ✅ Synonyme (texte) : si match, choisir le MOINS CHER
  // ───────────────────────────────────────────────────────────
  try {
    const wanted = normalizeName(raw);

    const allKey = 'all:ingredients';
    let batch = cacheGet(allKey);
    if (!batch) {
      batch = await base(TABLE).select({ maxRecords: 1000 }).all();
      cacheSet(allKey, batch);
    }

    const candidates = [];

    for (const r of batch) {
      const fields = r.fields || {};
      const synList = parseSynonymsCell(fields[COL_SYNONYMS]);
      const synNorms = synList.map(normalizeName).filter(Boolean);

      if (!synNorms.includes(wanted)) continue;

      try {
        const { ppu, unit } = computePPUFromRow(fields);
        const ppuRounded = roundPPU(ppu, unit);
        if (!Number.isFinite(ppuRounded)) continue;

        const packInfo = getPackPieceConversion(fields, unit);

        candidates.push({
          airtableId: r.id,
          name: fields[COL_NAME] ?? raw,
          unit,
          pricePerUnit: ppuRounded,
          ...packInfo,
        });
      } catch {}
    }

    if (candidates.length) {
      const best = pickCheapest(candidates, preferUnitRaw);
      cacheSet(cacheKey, best);
      return best;
    }
  } catch (e) {
    if (DEBUG) console.warn('[Airtable] synonyms lookup failed:', e?.message || e);
  }

  // ───────────────────────────────────────────────────────────
  // 1) Essai exact sur Ingrédients
  // ───────────────────────────────────────────────────────────
  const formula = `LOWER({${COL_NAME}}) = LOWER("${raw.replace(/"/g, '\\"')}")`;
  const exact = await base(TABLE).select({ filterByFormula: formula, maxRecords: 5 }).all();

  if (exact.length) {
    const r = pickBestRecordByUnit(exact, preferUnitRaw);
    if (!r) {
      cacheSet(cacheKey, null);
      return null;
    }

    const fields = r.fields || {};
    const { ppu, unit } = computePPUFromRow(fields);
    const packInfo = getPackPieceConversion(fields, unit);

    const out = {
      airtableId: r.id,
      name: fields[COL_NAME] ?? raw,
      unit,
      pricePerUnit: roundPPU(ppu, unit),
      gramsPerPiece: toNumberLoose(fields[COL_GRAMS_PER_PIECE]),
      ...packInfo,
    };

    cacheSet(cacheKey, out);
    return out;
  }

  // ───────────────────────────────────────────────────────────
  // 1bis) Recherche via la colonne Synonyme (texte) dans Ingrédients
  // ───────────────────────────────────────────────────────────
  try {
    const rawEsc = raw.replace(/"/g, '\\"');
    const synFormula = `AND({${COL_SYNONYMS}} != "", FIND(LOWER("${rawEsc}"), LOWER({${COL_SYNONYMS}})) > 0)`;

    const synHits = await base(TABLE)
      .select({ filterByFormula: synFormula, maxRecords: 25 })
      .all();

    const strong = synHits.filter((rr) => recordHasSynonym(rr.fields || {}, raw));

    if (strong.length) {
      const rr = pickCheapestRecord(strong, preferUnitRaw);
      const fields = rr.fields || {};
      const { ppu, unit } = computePPUFromRow(fields);
      const packInfo = getPackPieceConversion(fields, unit);

      const out = {
        airtableId: rr.id,
        name: fields[COL_NAME] ?? raw,
        unit,
        pricePerUnit: roundPPU(ppu, unit),
        gramsPerPiece: toNumberLoose(fields[COL_GRAMS_PER_PIECE]),
        ...packInfo,
      };

      cacheSet(cacheKey, out);
      return out;
    }
  } catch (e) {
    if (DEBUG) console.warn('[Airtable] lookup Synonyme ignoré:', e?.message || e);
  }

  // ───────────────────────────────────────────────────────────
  // 2) Recherche via table Aliases (lien vers une ligne Ingrédients)
  // ───────────────────────────────────────────────────────────
  const targetId = await findAliasTargetId(raw);
  if (targetId) {
    const ingrRec = await base(TABLE).find(targetId);
    const fields = ingrRec.fields || {};
    const { ppu, unit } = computePPUFromRow(fields);
    const packInfo = getPackPieceConversion(fields, unit);

    const out = {
      airtableId: ingrRec.id,
      name: fields[COL_NAME] || raw,
      unit,
      pricePerUnit: roundPPU(ppu, unit),
      gramsPerPiece: toNumberLoose(fields[COL_GRAMS_PER_PIECE]),
      ...packInfo,
    };

    cacheSet(cacheKey, out);
    return out;
  }

  // ───────────────────────────────────────────────────────────
  // 3) Fallback fuzzy : Ingrédients (sur le NOM)
  // ───────────────────────────────────────────────────────────
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

    if (!best || ratio > best.ratio) best = { r, ratio, matchedLabel: baseName };
  }

  if (best && best.ratio >= 0.82) {
    const r = best.r;
    const fields = r.fields || {};
    const { ppu, unit } = computePPUFromRow(fields);
    const packInfo = getPackPieceConversion(fields, unit);

    const out = {
      airtableId: r.id,
      name: fields[COL_NAME] ?? best.matchedLabel,
      unit,
      pricePerUnit: roundPPU(ppu, unit),
      gramsPerPiece: toNumberLoose(fields[COL_GRAMS_PER_PIECE]),
      ...packInfo,
    };

    cacheSet(cacheKey, out);
    return out;
  }

  cacheSet(cacheKey, null);
  return null;
}

module.exports = { getIngredientPriceByName, canonUnit, toBaseUnit, toBaseQty };
