// backend/src/utils/units.js
function stripAccents(s = '') {
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function canonUnit(uRaw) {
  const u = stripAccents(String(uRaw || '').trim().toLowerCase());
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
  if (u === 'g')  return { unit: 'g', factor: 1 };

  if (u === 'cl') return { unit: 'ml', factor: 10 };
  if (u === 'dl') return { unit: 'ml', factor: 100 };
  if (u === 'l')  return { unit: 'ml', factor: 1000 };
  if (u === 'ml') return { unit: 'ml', factor: 1 };

  if (u === 'piece') return { unit: 'piece', factor: 1 };
  // fallback
  return { unit: 'piece', factor: 1 };
}

function toBaseQty(qty, unit) {
  const { unit: baseU, factor } = toBaseUnit(unit);
  return { qty: Number(qty || 0) * factor, unit: baseU };
}

/**
 * Dictionnaire (modifiable) : poids moyen d'1 pièce en grammes.
 * Mets uniquement les produits pour lesquels Airtable renvoie un PPU en "g",
 * afin qu'on puisse convertir "piece" -> "g" côté recette.
 */
const PIECE_TO_G = {
  // exemples (ajuste quand tu veux)
  'carotte': 80,
  'tomate': 120,
  'oignon': 110,
  'ail': 5,
};

/**
 * Convertit la quantité recette vers l'unité utilisée par le PPU Airtable,
 * uniquement pour le cas "piece" -> "g" selon un poids moyen défini ci-dessus.
 *
 * @param {string} name        - nom de l’ingrédient (pour lookup dans PIECE_TO_G)
 * @param {number} qty         - quantité reçue de la recette
 * @param {string} unitRecipe  - unité de la recette (canonisée)
 * @param {string} unitPrice   - unité de base du PPU (g/ml/piece)
 * @returns {{ qty: number, unit: string, note?: string }}
 */
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
  // autres cas: pas de conversion spéciale
  return { qty: Number(qty || 0), unit: recU };
}

module.exports = {
  stripAccents,
  canonUnit,
  toBaseUnit,
  toBaseQty,
  convertUnitForPricing,
  PIECE_TO_G,
};
