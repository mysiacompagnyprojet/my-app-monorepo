// backend/src/utils/costs.js
const { getIngredientPriceByName, canonUnit, toBaseQty } = require('../services/airtable');

/**
* Nettoyage “soft” du nom pour maximiser le match Airtable.
* - enlève contenus entre parenthèses
* - enlève certains trailers type "selon votre ..."
* - trim + espaces
*/
function cleanNameForPricing(name) {
let s = String(name || '').trim();
if (!s) return '';

// enlève (....)
s = s.replace(/\([^)]*\)/g, ' ');

// enlève "selon ..." (souvent ajouté par OCR / recettes)
s = s.replace(/\bselon\b.*$/i, ' ');

// espaces
s = s.replace(/\s+/g, ' ').trim();

return s;
}

/**
* Unités "spéciales" => on les traite comme pièce.
* Exemple: gousse = pièce
*/
function canonUnitExtended(uRaw) {
const u = canonUnit(uRaw);
if (!u) return null;

// gousse / gousses -> piece
if (u === 'gousse' || u === 'gousses') return 'piece';

return u;
}

/**
* Convertit une quantité de recette vers une unité cible (g/ml/piece) quand c'est simple.
* Retourne { qty, unit } ou null si conversion impossible.
*/
function convertRecipeToPricingUnit(qty, unitRaw, targetUnit) {
const unitCanon = canonUnitExtended(unitRaw);
const q = Number(qty || 0);
if (!Number.isFinite(q)) return null;

// d’abord on passe en base (g/ml/piece) selon l’unité recette
// ⚠️ toBaseQty de airtable.js gère déjà cl/dl/l etc via canonUnit(),
// mais canonUnit() ne connaît pas "gousse". On le traite en amont.
if (unitCanon === 'piece') {
return { qty: q, unit: 'piece' };
}

const base = toBaseQty(q, unitCanon); // => { qty, unit: 'g'|'ml'|'piece' }
if (!base || !base.unit) return null;

// si la base correspond à la target => OK
if (base.unit === targetUnit) return base;

// sinon, on ne convertit pas ici (densité g<->ml géré plus bas)
return base; // on renvoie quand même base pour densité éventuelle
}

/**
* Enrichit un ingrédient avec Airtable + calcule costRecipe en g/ml/piece
* en gérant:
* - conversions standard (cl->ml, kg->g, etc.)
* - densité (g<->ml) si Airtable fournit density_g_per_ml
* - piece/gousse -> g ou ml si Airtable fournit gramsPerPiece/mlPerPiece
*
* @param {{ name: string, quantity?: number, unit?: string }} i
* @returns {Promise<{
* name: string,
* quantity: number,
* unit: string,
* airtableId: string|null,
* unitPriceBuy: number|null,
* costRecipe: number|null,
* priceMatched?: boolean,
* note?: string
* }>}
*/
async function enrichIngredientWithCost(i) {
const rawName = String(i?.name || '').trim();
const name = cleanNameForPricing(rawName);
const quantity = Number(i?.quantity || 0) || 0;
const unitRaw = String(i?.unit || '').trim();

const outBase = {
name: rawName || name,
quantity,
unit: unitRaw,
};

if (!name) {
return {
...outBase,
airtableId: null,
unitPriceBuy: null,
costRecipe: 0,
priceMatched: false,
note: 'nom vide',
};
}

// ⚠️ preferUnitRaw = l’unité recette pour choisir un record compatible si plusieurs
const pricing = await getIngredientPriceByName(name, unitRaw);

if (!pricing) {
return {
...outBase,
airtableId: null,
unitPriceBuy: null,
costRecipe: 0,
priceMatched: false,
note: 'non trouvé dans Airtable',
};
}

const priceUnit = pricing.unit; // 'g' | 'ml' | 'piece'
const pricePerUnit = Number(pricing.pricePerUnit);
const density = Number(pricing.density_g_per_ml); // g/ml
const gramsPerPiece = Number(pricing.gramsPerPiece);
const mlPerPiece = Number(pricing.mlPerPiece);

if (!Number.isFinite(pricePerUnit) || pricePerUnit <= 0) {
return {
...outBase,
airtableId: pricing.airtableId ?? null,
unitPriceBuy: null,
costRecipe: 0,
priceMatched: Boolean(pricing.airtableId),
note: 'pricePerUnit invalide',
};
}

// 1) Conversion simple vers base
const base = convertRecipeToPricingUnit(quantity, unitRaw, priceUnit);
if (!base || !base.unit || !Number.isFinite(base.qty)) {
return {
...outBase,
airtableId: pricing.airtableId ?? null,
unitPriceBuy: pricePerUnit,
costRecipe: 0,
priceMatched: Boolean(pricing.airtableId),
note: 'conversion de base impossible',
};
}

// 2) Cas direct: base.unit === priceUnit
if (base.unit === priceUnit) {
return {
...outBase,
airtableId: pricing.airtableId ?? null,
unitPriceBuy: pricePerUnit,
costRecipe: base.qty * pricePerUnit,
priceMatched: Boolean(pricing.airtableId),
};
}

// 3) Cas "piece" recette → pricing en g/ml via gramsPerPiece/mlPerPiece
// (inclut gousse car canonUnitExtended la traite comme piece)
if (base.unit === 'piece' && priceUnit === 'g' && Number.isFinite(gramsPerPiece) && gramsPerPiece > 0) {
const qtyG = base.qty * gramsPerPiece;
return {
...outBase,
airtableId: pricing.airtableId ?? null,
unitPriceBuy: pricePerUnit,
costRecipe: qtyG * pricePerUnit,
priceMatched: Boolean(pricing.airtableId),
note: 'conversion piece→g (gramsPerPiece)',
};
}

if (base.unit === 'piece' && priceUnit === 'ml' && Number.isFinite(mlPerPiece) && mlPerPiece > 0) {
const qtyMl = base.qty * mlPerPiece;
return {
...outBase,
airtableId: pricing.airtableId ?? null,
unitPriceBuy: pricePerUnit,
costRecipe: qtyMl * pricePerUnit,
priceMatched: Boolean(pricing.airtableId),
note: 'conversion piece→ml (mlPerPiece)',
};
}

// 4) Cas densité g<->ml
if (Number.isFinite(density) && density > 0) {
// recette en ml (base.unit=ml) pricing en g
if (base.unit === 'ml' && priceUnit === 'g') {
const qtyG = base.qty * density; // g = ml * densité
return {
...outBase,
airtableId: pricing.airtableId ?? null,
unitPriceBuy: pricePerUnit,
costRecipe: qtyG * pricePerUnit,
priceMatched: Boolean(pricing.airtableId),
note: 'conversion densité (ml→g)',
};
}

// recette en g (base.unit=g) pricing en ml
if (base.unit === 'g' && priceUnit === 'ml') {
const qtyMl = base.qty / density; // ml = g / densité
return {
...outBase,
airtableId: pricing.airtableId ?? null,
unitPriceBuy: pricePerUnit,
costRecipe: qtyMl * pricePerUnit,
priceMatched: Boolean(pricing.airtableId),
note: 'conversion densité (g→ml)',
};
}
}

// 5) Sinon: pas de conversion trouvée
return {
...outBase,
airtableId: pricing.airtableId ?? null,
unitPriceBuy: pricePerUnit,
costRecipe: 0,
priceMatched: Boolean(pricing.airtableId),
note: 'unité incompatible (conversion manquante)',
};
}

module.exports = { enrichIngredientWithCost, cleanNameForPricing };




