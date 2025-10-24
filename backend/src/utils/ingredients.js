// backend/src/utils/ingredients.js

const { normalizeUnit, canonUnit } = require('./units');

/**
 * Fusionne les ingrédients ayant le même nom + unité (insensible à la casse).
 * Entrée: [{ name, quantity, unit }]
 * Sortie: mêmes champs, quantités cumulées.
 */
function mergeIngredients(lines = []) {
  const map = new Map();
  for (const l of lines) {
    if (!l) continue;
    const name = String(l.name || '').trim();
    const unit = canonUnit(l.unit) || 'piece';
    const key = `${name.toLowerCase()}|${unit}`;
    const prev = map.get(key);
    map.set(key, {
      name,
      unit,
      quantity: (prev?.quantity || 0) + Number(l.quantity || 0),
    });
  }
  return Array.from(map.values());
}

/**
 * Parse une ligne brute en { name, quantity, unit }
 * Exemples: "300 g spaghetti" → { name:'spaghetti', quantity:300, unit:'g' }
 *           "2 tomates"        → { name:'tomates',   quantity:2,   unit:'piece' }
 */
function parseRawLine(raw) {
  if (!raw) return null;
  const txt = String(raw).replace(/\s+/g, ' ').trim();

  // nombre + éventuelle unité + reste (nom)
  const m = txt.match(/^(\d+([.,]\d+)?)\s*(g|kg|mg|ml|l|dl|cl|pi[eè]ce|pce|pc|cs|cc|botte|unite|unité)?\s*(.*)$/i);
  if (m) {
    const quantity = parseFloat(m[1].replace(',', '.'));
    const unit = normalizeUnit(m[3] || 'piece') || 'piece';
    const name = (m[4] || '').trim() || 'ingrédient';
    return { name, quantity, unit };
  }
  // fallback: pas de quantité → 1 piece
  return { name: txt, quantity: 1, unit: 'piece' };
}

/**
 * Nettoie + normalise une liste d'ingrédients "bruts" (strings ou objets).
 * Retourne un tableau de { nameCanon, quantity, unit } prêt pour enrichissement coût.
 */
function cleanAndNormalizeIngredients(rawList = []) {
  // 1) Parse chaque entrée (string ou objet)
  const parsed = rawList
    .map((r) => {
      if (typeof r === 'string') return parseRawLine(r);
      if (r && typeof r === 'object') {
        return {
          name: String(r.name || r.title || r.label || '').trim() || 'ingrédient',
          quantity: Number(r.quantity ?? r.qty ?? 0) || 0,
          unit: normalizeUnit(r.unit || r.u || 'piece') || 'piece',
        };
      }
      return null;
    })
    .filter(Boolean);

  // 2) Fusionne doublons (nom + unité)
  const merged = mergeIngredients(parsed);

  // 3) Canonise sortie pour le backend (nameCanon en minuscule)
  return merged.map((i) => ({
    nameCanon: String(i.name).trim().toLowerCase(),
    quantity: Number(i.quantity || 0),
    unit: normalizeUnit(i.unit) || 'piece',
  }));
}

module.exports = {
  mergeIngredients,
  parseRawLine,
  cleanAndNormalizeIngredients,
};


