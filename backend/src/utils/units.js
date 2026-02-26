// backend/src/utils/units.js
// LEVEL: UTIL (foundation: units / conversions / servings regex)
// import autorisés : stringUtils
// import interdits : titleUtils, textUtils, heuristics, ingredient*, ocr*, services, routes, middleware, prisma
// importé par : tout le backend (utils/services/routes)

//stringUtils
const { normSpaces } = require('../utils/stringUtils');


function stripAccents(s = '') {
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function extractServingsFromLine(line) {
  const t = normSpaces(line).toLowerCase();

  let m = t.match(/ingr[ée]dients?\s+pour\s+(\d+)\s*(personnes|parts|portions)\b/i);
  if (m) return parseInt(m[1], 10);

  m = t.match(/\bpour\s+(\d+)\s*(personnes|parts|portions)\b/i);
  if (m) return parseInt(m[1], 10);

  m = t.match(/\bpour\s+(\d+)\s*(?:-|à|a)\s*(\d+)\s*(personnes|parts|portions)\b/i);
  if (m) return Math.max(parseInt(m[1], 10), parseInt(m[2], 10));

  m = t.match(/\bpour\s+(\d+)\s*personnes?\b.*\bil\b.*\bfaut\b/i);
  if (m) return parseInt(m[1], 10);

  // ✅ Facebook: "Portions : Environ 16 mini croques"
  m = t.match(/\bportions?\s*[:\-–—]?\s*(?:environ\s*)?(\d+)\b/i);
  if (m) return parseInt(m[1], 10);

  return null;
}
/**
 * Retourne l'unité canon (chaine courte, ascii):
 *  - poids:  mg, g, kg
 *  - volume: ml, cl, dl, l
 *  - pièce:  piece
 *  - cuillères: tbsp (cs), tsp (cc)
 *  - sinon:  renvoie la version nettoyée (best-effort)
 */
function canonUnit(uRaw) {
  const u0 = String(uRaw || '').trim().toLowerCase();
  if (!u0) return null;
  const u = stripAccents(u0);

  // poids
  if (u === 'mg') return 'mg';
  if (u === 'g' || u === 'gramme' || u === 'grammes') return 'g';
  if (u === 'kg' || u === 'kilogramme' || u === 'kilogrammes') return 'kg';

  // volume
  if (u === 'ml' || u === 'millilitre' || u === 'millilitres') return 'ml';
  if (u === 'cl') return 'cl';
  if (u === 'dl') return 'dl';
  if (u === 'l' || u === 'litre' || u === 'litres') return 'l';

  // pièces (toutes variantes → 'piece')
  if (
    u === 'piece' || u === 'pieces' ||
    u === 'pc' || u === 'pce' ||
    u === 'unite' || u === 'unites' ||
    u === 'pièce' || u === 'piéce' || u === 'pièces' ||
    u === 'botte' || u === 'bottes' || u === "botte(s)" ||

    //unités OCR courantes
    u === 'gousse' || u === 'gousses' ||
    u === 'tranche' || u === 'tranches' ||
    u === 'cuillere' || u === 'cuilleres' || 
    u === 'cuillère' || u === 'cuillères' 
  ) return 'piece';

  // cuillères
  if (u === 'cs' || u === 'cas' || u === 'càs' || u === 'c a s' || u === 'cuillere a soupe') return 'tbsp';
  if (u === 'cc' || u === 'cac' || u === 'càc' || u === 'c a c' || u === 'cuillere a cafe' || u === 'cuillere a café') return 'tsp';

  return u; // fallback best-effort
}

// alias “historique”
function normalizeUnit(uRaw) {
  return canonUnit(uRaw);
}

/**
 * Convertit une unité en base + facteur de conversion vers la base:
 *  - masse base = g
 *  - volume base = ml
 *  - pièce base = piece
 */
function toBaseUnit(unit) {
  const u = canonUnit(unit);

  // masse
  if (u === 'mg') return { unit: 'g', factor: 0.001 };
  if (u === 'kg') return { unit: 'g', factor: 1000 };
  if (u === 'g')  return { unit: 'g', factor: 1 };

  // volume
  if (u === 'cl') return { unit: 'ml', factor: 10 };
  if (u === 'dl') return { unit: 'ml', factor: 100 };
  if (u === 'l')  return { unit: 'ml', factor: 1000 };
  if (u === 'ml') return { unit: 'ml', factor: 1 };

  // autre → pièce
  return { unit: 'piece', factor: 1 };
}

function toBaseQty(qty, unit) {
  const { unit: baseU, factor } = toBaseUnit(unit);
  return { qty: Number(qty || 0) * factor, unit: baseU };
}

/** Poids moyen d'1 pièce en grammes (modifie selon tes besoins) */
const PIECE_TO_G = {
  carotte: 80,
  tomate: 120,
  oignon: 110,
  ail: 5,
};

function convertUnitForPricing(name, qty, unitRecipe, priceRow) {
  const q = Number(qty || 0);
  if (!Number.isFinite(q) || q <= 0) return null;

  const recU = canonUnit(unitRecipe);
  const targetU = priceRow?.unit;
  if (!targetU) return null;

  // 1- cuillères -> ml
  if (recU === 'tbsp' || recU === 'tsp') {
    const ml = q * (recU === 'tbsp' ? 15 : 5);

    if (targetU === 'ml') return {
      qty: ml,
      unit: 'ml'
    };

    if (targetU === 'g') {
      const d = Number(priceRow?.density_g_per_ml);
      if(Number.isInfinite(d) && d > 0) return {
        qty: ml * d,
        unit: 'g'
      };
      return null;
    }
    return null;
  }

  // 2- standard -> base (g/ml/piece)
  const base = toBaseQty(q, recU);
  if (!base) return null;

  if (base.unit === targetU) return base;

  // 3- piece <-> g via gramsPerPiece
  let gramsPerPiece = Number(priceRow?.gramsPerPiece);

  // fallback via piece to g si db vide
  if ((!Number.isFinite(gramsPerPiece) || gramsPerPiece <= 0) && name) {
    const key = stripAccents (String(name).toLowerCase().trim());
  }

  if (base.unit === 'piece' && targetU === 'g') {
    if(Number.isFinite(gramsPerPiece) && gramsPerPiece > 0) 
      return {
      qty: base.qty * gramsPerPiece,
      unit: 'g'
    };
    return null;
  }
  if (base.unit === 'g' && targetU === 'piece') {
    if(Number.isFinite(gramsPerPiece) && gramsPerPiece > 0) 
      return {
      qty: base.qty / gramsPerPiece,
      unit: 'piece'
    };
    return null;
  }

  // 4- ml <-> g via densité
  const density = Number(priceRow?.density_g_per_ml);
  if (base.unit === 'ml' && targetU === 'g') {
    if (Number.isFinite(density) && density > 0) return {
      qty: base.qty * d,
      unit: 'g'
    };
    return null;
  }
  
  if (base.unit === 'g' && targetU === 'ml') {
    if (Number.isFinite(density) && density > 0){
      return {
        qty: base.qty / density, 
        unit: 'ml'
      };
    }
    return null;
  }
  return null;
}

module.exports = {
  stripAccents,
  extractServingsFromLine,
  canonUnit,
  normalizeUnit,
  toBaseUnit,
  toBaseQty,
  convertUnitForPricing,
  PIECE_TO_G,
};



