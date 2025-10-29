// backend/src/utils/ingredients.js
const { normalizeUnit, canonUnit } = require('./units');

/* ───────────────────────────── Nom d’ingrédient ─────────────────────────── */

const ARTICLE_RE_START = /^(de la|de l’|de l'|de|du|des|d’|d')\s+/i;

const PLURALS = new Map([
  ['oeufs', 'oeuf'],
  ['oignons', 'oignon'],
  ['tomates', 'tomate'],
  ['pommes de terre', 'pomme de terre'],
  ['carottes', 'carotte'],
  ['courgettes', 'courgette'],
  ['poivrons', 'poivron'],
  ["gousses d'ail", "gousse d'ail"],
  ["gousses d’ail", "gousse d'ail"],
  ['herbes', 'herbe'],
]);

function stripLeadingArticles(s) {
  let t = String(s || '').trim();
  t = t.replace(ARTICLE_RE_START, '');
  return t.trim();
}

// remet les apostrophes manquantes : "d olive" -> "d'olive"
function fixFrenchApostrophes(s) {
  let t = String(s || '');
  t = t.replace(/[’]/g, "'"); // apostrophe unique
  // d/l + espace + voyelle/h → d'/l'
  t = t.replace(/\bd\s+([aeiouhàâäéèêëîïôöùûüœ])/gi, "d'$1");
  t = t.replace(/\bl\s+([aeiouhàâäéèêëîïôöùûüœ])/gi, "l'$1");
  return t;
}

function normalizePluralPhrase(s) {
  const lower = String(s || '').toLowerCase();
  if (PLURALS.has(lower)) return PLURALS.get(lower);
  if (/^\w+s$/.test(lower)) return lower.replace(/s$/, '');
  return lower;
}

function tidyName(name) {
  let s = String(name || '').trim();
  s = s.replace(/\s+/g, ' ');
  s = fixFrenchApostrophes(s);
  s = stripLeadingArticles(s);       // ❗️on ne supprime QUE en début
  s = normalizePluralPhrase(s);

  // phrase case : tout en minuscule puis majuscule initiale
  s = s.toLowerCase();
  if (s) s = s.charAt(0).toUpperCase() + s.slice(1);

  return s;
}

/* ───────────────────────────── Quantités/Unités ─────────────────────────── */

function parseQuantity(q) {
  if (q == null) return undefined;
  if (typeof q === 'number') return Number.isFinite(q) ? q : undefined;
  const str = String(q).trim().replace(',', '.');

  // "1 1/2"
  const mix = str.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mix) {
    const [, a, b, c] = mix;
    return parseInt(a, 10) + parseInt(b, 10) / parseInt(c, 10);
  }

  // "1/2"
  const frac = str.match(/^(\d+)\/(\d+)$/);
  if (frac) return parseInt(frac[1], 10) / parseInt(frac[2], 10);

  const num = Number(str);
  return Number.isFinite(num) ? num : undefined;
}

/**
 * Canonise unité + quantité :
 * - s’appuie sur canonUnit/normalizeUnit
 * - convertit kg→g (×1000) et l→ml (×1000) en fonction de l’unité brute
 */
function canonizeUnitAndQuantity(unitRaw, qNum) {
  const uCanon = canonUnit(unitRaw) || normalizeUnit(unitRaw) || null;
  if (!uCanon) return { unit: null, quantityNum: qNum };

  const raw = String(unitRaw || '').toLowerCase();

  if (/^kg$|^kilogramme|^kilogrammes/.test(raw)) {
    return { unit: 'g', quantityNum: qNum != null ? qNum * 1000 : qNum };
  }
  if (/^l$|^litre|^litres/.test(raw)) {
    return { unit: 'ml', quantityNum: qNum != null ? qNum * 1000 : qNum };
  }

  return { unit: uCanon, quantityNum: qNum };
}

/* ───────────────────────────── Parsing & Merge ──────────────────────────── */

function parseAny(raw) {
  if (!raw) return null;

  // Objet { name, quantity, unit }
  if (typeof raw === 'object') {
    const nameCanon = tidyName(raw.name || raw.title || raw.label || 'ingrédient');
    const qNum = parseQuantity(raw.quantity ?? raw.qty);
    const { unit, quantityNum } = canonizeUnitAndQuantity(raw.unit || raw.u, qNum);
    return { nameCanon, quantityNum: quantityNum ?? 0, unit: unit || 'piece' };
  }

  // Chaîne "300 g spaghetti" / "2 tomates"
  const txt = String(raw).replace(/\s+/g, ' ').trim();
  const m = txt.match(/^(\d+([.,]\d+)?)\s*(g|kg|mg|ml|l|dl|cl|pi[eè]ce|pieces?|pce|pc|cs|cc|botte|unite|unité)?\s*(.*)$/i);
  if (m) {
    const qNum = parseQuantity(m[1]);
    const unitRaw = m[3] || 'piece';
    const restName = (m[4] || '').trim() || 'ingrédient';
    const nameCanon = tidyName(restName);
    const { unit, quantityNum } = canonizeUnitAndQuantity(unitRaw, qNum);
    return { nameCanon, quantityNum: quantityNum ?? 0, unit: unit || 'piece' };
  }

  // Fallback : pas de quantité → 1 piece
  return { nameCanon: tidyName(txt), quantityNum: 1, unit: 'piece' };
}

function mergeIngredientsCanon(lines = []) {
  const map = new Map();
  for (const l of lines) {
    if (!l) continue;
    const key = `${String(l.nameCanon || '').toLowerCase()}|${l.unit || 'piece'}`;
    const prev = map.get(key);
    map.set(key, {
      nameCanon: l.nameCanon,
      unit: l.unit || 'piece',
      quantityNum: (prev?.quantityNum || 0) + Number(l.quantityNum || 0),
    });
  }
  return Array.from(map.values());
}

/**
 * Nettoie + normalise une liste d'ingrédients (strings ou objets).
 * Sortie: [{ nameCanon, quantityNum, unit }]
 */
function cleanAndNormalizeIngredients(rawList = []) {
  const parsed = rawList.map(parseAny).filter(Boolean);
  return mergeIngredientsCanon(parsed).map(i => {
    const u = canonUnit(i.unit) || normalizeUnit(i.unit) || 'piece';
    return {
      nameCanon: i.nameCanon,                  // ex: "Pomme de terre"
      quantityNum: Number(i.quantityNum || 0), // ex: 500
      unit: u === 'piece' ? 'piece' : u,       // force ASCII sur 'piece'
    };
  });
}

/**
 * Fusion brut des lignes { name, quantity, unit[, costRecipe] }
 * → totalise par (tidyName(name) + unité canonisée)
 * Retour: [{ name, unit, quantity, costRecipe }]
 */
function mergeIngredients(rows = []) {
  const map = new Map();
  for (const r of rows || []) {
    if (!r) continue;
    const name = tidyName(r.name);
    const unit = canonUnit(r.unit) || normalizeUnit(r.unit) || 'piece';
    const qty = Number(r.quantity || 0);
    const cost = Number(r.costRecipe || 0);

    const key = `${name.toLowerCase()}|${unit}`;
    const prev = map.get(key);
    if (prev) {
      map.set(key, {
        name,
        unit,
        quantity: Number(prev.quantity) + qty,
        costRecipe: Number(prev.costRecipe || 0) + cost,
      });
    } else {
      map.set(key, {
        name,
        unit,
        quantity: qty,
        costRecipe: cost,
      });
    }
  }
  return Array.from(map.values());
}

module.exports = {
  cleanAndNormalizeIngredients,
  tidyName,
  parseQuantity,
  mergeIngredientsCanon,
  mergeIngredients, // 👈 ajouté pour /shopping-list
};
