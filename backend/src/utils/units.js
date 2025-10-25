// backend/src/utils/units.js
function stripAccents(s = '') {
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
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
    u === 'botte' || u === 'bottes' || u === "botte(s)"
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

function convertUnitForPricing(name, qty, unitRecipe, unitPrice) {
  const recU = canonUnit(unitRecipe);
  const priceU = canonUnit(unitPrice);
  if (recU === 'piece' && priceU === 'g') {
    const key = stripAccents(String(name || '').toLowerCase().trim());
    const weight = PIECE_TO_G[key];
    if (!weight) {
      return { qty, unit: recU, note: 'conversion pièce→g manquante' };
    }
    return { qty: Number(qty || 0) * Number(weight || 0), unit: 'g' };
  }
  return { qty: Number(qty || 0), unit: recU };
}

module.exports = {
  stripAccents,
  canonUnit,
  normalizeUnit,
  toBaseUnit,
  toBaseQty,
  convertUnitForPricing,
  PIECE_TO_G,
};



