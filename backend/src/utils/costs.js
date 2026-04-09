// backend/src/utils/costs.js
// LEVEL: DOMAIN-UTIL (business)
// import autorisés : utils mais pour fichier indépendant et bas niveau - constantes neutres
// import interdits : routes-services-middlewares-parsers-utils ocr-supabase-prisma
// importé uniquement par routes-services
const { canonUnit, toBaseQty } = require('../utils/units')
const { getIngredientPriceByName, getIngredientPriceById } = require('../services/supabase')

/**
* Nettoyage “soft” du nom pour maximiser le match Airtable.
* - enlève contenus entre parenthèses
* - enlève certains trailers type "selon votre ..."
* - trim + espaces
*/
function cleanNameForPricing(name) {
let s = String(name || '').trim()
if (!s) return ''

// enlève (....)
s = s.replace(/\([^)]*\)/g, ' ')

// enlève "selon ..." (souvent ajouté par OCR / recettes)
s = s.replace(/\bselon\b.*$/i, ' ')

//enléve les qualificatifs pour trouver l'ingredient$
s = s.replace(
    /\b(eminced?|émincé(?:e|es)?|hach[ée](?:e|es)?|coup[ée](?:e|es)?|rondelles?|en\s+rondelles?)\b/gi, ' ');

// espaces
s = s.replace(/\s+/g, ' ').trim()

return s
}

/**
* Unités "spéciales" => on les traite comme pièce.
* Exemple: gousse = pièce
*
* NOTE: canonUnit() ne connaît pas forcément ces mots (OCR),
* donc on les mappe ici.
*/
function canonUnitExtended(uRaw) {
const u0 = String(uRaw || '').trim().toLowerCase()
if (!u0) return null

// ✅ cuillères (OCR)
if (u0 === 'càs' || u0 === 'cas' || u0 === 'cs') return 'tbsp'
if (u0 === 'càc' || u0 === 'cac' || u0 === 'cc') return 'tsp'

// ✅ pièces (OCR)
if (u0 === 'pièce' || u0 === 'pièces' || u0 === 'piece' || u0 === 'pieces' || u0 === 'pcs' ||
    u0 === 'sachet' || u0 === 'sachets'
) return 'piece'

const u = canonUnit(uRaw) || u0
if (!u) return null

// unités OCR → unités canoniques
if (u === 'gousse' || u === 'gousses') return 'piece'
if (u === 'tranche' || u === 'tranches') return 'piece'
if (u === 'sachet' || u === 'sachets') return 'piece'

//if (u === 'cuillere' || u === 'cuillère' || u === 'cuilleres' || u === 'cuillères') return 'piece'

// sécurité (accent)
if (u === 'pièce' || u === 'pièces') return 'piece'

return u
}

/**
* Convertit une quantité de recette vers une unité cible (g/ml/piece) quand c'est simple.
* Retourne { qty, unit } ou null si conversion impossible.
*/
function convertRecipeToPricingUnit(qty, unitRaw, targetUnit) {
    const unitCanon = canonUnitExtended(unitRaw)
    const q = Number(qty || 0)
    if (!Number.isFinite(q)) return null

    const u0 = String(unitRaw || '').trim().toLowerCase()
    if (
        u0 === 'pincée' || u0 === 'pincées' || u0 === 'pincee' ||
        u0 === 'pincees'
    ) {
        return null
    }

    if (unitCanon === 'tbsp' || unitCanon === 'tsp') {
    const ml = q * (unitCanon === 'tbsp' ? 15 : 5);

        if (targetUnit === 'ml') return {
            qty: ml,
            unit: 'ml'
        };

        return { qty: ml, unit: 'ml' };
    }

    // d’abord on passe en base (g/ml/piece) selon l’unité recette
    // ⚠️ toBaseQty de airtable.js gère déjà cl/dl/l etc via canonUnit(),
    // mais canonUnit() ne connaît pas "gousse". On le traite en amont.
    if (unitCanon === 'piece') {
        return { qty: q, unit: 'piece' }
    }

    const base = toBaseQty(q, unitCanon) // => { qty, unit: 'g'|'ml'|'piece' }
    if (!base || !base.unit) return null

    // si la base correspond à la target => OK
    if (base.unit === targetUnit) return base

    // sinon, on ne convertit pas ici (densité g<->ml géré plus bas)
    return base // on renvoie quand même base pour densité éventuelle
}

/**
* Helpers robustes: on essaye plusieurs noms possibles
* (utile si tu changes des clés côté airtable.js)
*/
function pickNumber(obj, keys) {
for (const k of keys) {
const v = obj?.[k]
const n = typeof v === 'string' ? Number(String(v).replace(',', '.')) : Number(v)
if (Number.isFinite(n)) return n
}
return null
}
function pickString(obj, keys) {
for (const k of keys) {
const v = obj?.[k]
if (typeof v === 'string' && v.trim()) return v.trim()
}
return null
}

function formatPackLabel(refQty, refUnit) {
const q = Number(refQty)
const u = String(refUnit || '').trim()
if (!Number.isFinite(q) || !u) return null

// affichage propre
if (u === 'g' || u === 'ml') {
// ex: 450 g, 1000 ml
return `${q} ${u}`
}
if (u === 'piece') {
// ex: 6 pièces
const n = Math.round(q)
return `${n} pièce${n > 1 ? 's' : ''}`
}
return `${q} ${u}`
}

/**
* Enrichit un ingrédient avec Airtable + calcule costRecipe en g/ml/piece
* en gérant:
* - conversions standard (cl->ml, kg->g, etc.)
* - densité (g<->ml) si Airtable fournit density_g_per_ml
* - piece/gousse -> g ou ml si Airtable fournit gramsPerPiece/mlPerPiece
*
* + ✅ NOUVEAU:
* - buyPriceEur : prix du pack en magasin (ex: pot 450g = 2.19)
* - buyRefQty / buyRefUnit : la quantité de référence du pack
* - buyLabel : texte affichable ("450 g", "1 L", "6 pièces")
*
* + ✅ IMPORTANT UX:
* - NE DOIT PAS BLOQUER si non trouvé / prix manquant
* - renvoie priceStatus + priceMessage
*
* @param {{ name: string, quantity?: number, unit?: string }} i
*/
async function enrichIngredientWithCost(i) {
    const rawName = String(i?.name || '').trim()
    const name = cleanNameForPricing(rawName)
    const quantity = Number(i?.quantity || 0) || 0
    const unitRaw = String(i?.unit || '').trim()

    const outBase = {
        name: rawName || name,
        quantity,
        unit: unitRaw,
        gramsPerPiece: null, 
        density_g_per_ml: null,
        mlPerPiece: null,
        category: null,
    }

    if (!name) {
        return {
            ...outBase,
            id: null,
            unitPriceBuy: null,
            buyPriceEur: null,
            buyRefQty: null,
            buyRefUnit: null,
            buyLabel: null,
            costRecipe: 0,
            priceMatched: false,
            gramsPerPiece: null, //gramsPerPiece ??
            density_g_per_ml: null,//density ??
            mlPerPiece: null, //mlPerPiece ??
            priceStatus: 'invalid',
            priceMessage: 'Nom d’ingrédient vide',
            note: 'nom vide',
            category,
        }
    }

    // ⚠️ preferUnitRaw = l’unité recette pour choisir un record compatible si plusieurs
    const pricing = i?.ingredientBaseId
    ? await getIngredientPriceById(i.ingredientBaseId)
    : await getIngredientPriceByName(name, unitRaw)

    const category = typeof pricing?.category === 'string' ? pricing.category : null
    console.log('[PRICING DEBUG]', name, {
        unitRaw,
        priceUnit: pricing?.unit,
        buyRefUnit: pricing?.buyRefUnit,
        buyRefQty: pricing?.buyRefQty,
        nombre: pricing?.count,
        gramsPerPiece: pricing?.gramsPerPiece,
    });

    if (!pricing) {
        return {
            ...outBase,
            id: null,
            unitPriceBuy: null,

            buyPriceEur: null,
            buyRefQty: null,
            buyRefUnit: null,
            buyLabel: null,

            costRecipe: 0,
            gramsPerPiece: null, //gramsPerPiece ??
            density_g_per_ml: null,//density ??
            mlPerPiece: null, //mlPerPiece ??
            priceMatched: false,
            priceStatus: 'not_found',
            priceMessage: "Ingrédient non trouvé dans la base",
        
            note: 'non trouvé dans la base',
            category,
        }
    }

    // ✅ Prix d'achat pack + infos pack (si airtable.js les renvoie)
    const buyPriceEur = pickNumber(pricing, ['buyPrice', 'buyPriceEur', 'buy_price', 'purchasePrice', 'purchase_price'])
    const buyRefQty = pickNumber(pricing, ['refQty', 'buyRefQty', 'referenceQty', 'ref_quantity', 'reference_quantity'])
    const buyRefUnit = pickString(pricing, ['refUnit', 'buyRefUnit', 'referenceUnit', 'ref_unit', 'reference_unit'])
    const buyLabel = formatPackLabel(buyRefQty, buyRefUnit)

    const priceUnit = pricing.unit // 'g' | 'ml' | 'piece'
    const pricePerUnit = Number(pricing.pricePerUnit)


    const gramsPerPiece = Number(pricing.gramsPerPiece)
    const density = Number(pricing.density_g_per_ml) // g/ml
    const mlPerPiece = Number(pricing.mlPerPiece)

    const gramsPerPieceOut = Number.isFinite(gramsPerPiece) && gramsPerPiece > 0 ? gramsPerPiece : null
    const densityOut = Number.isFinite(density) && density > 0 ? density: null
    const mlPerPieceOut = Number.isFinite(mlPerPiece) && mlPerPiece > 0 ? mlPerPiece : null

    // ✅ Cas "prix manquant" côté Airtable (PPU introuvable)
    // (airtable.js renvoie pricePerUnit=null + priceStatus=missing_price)
    if (!Number.isFinite(pricePerUnit) || pricePerUnit <= 0) {
        const msg =
        pricing?.priceMessage ||
        (pricing?.priceStatus === 'missing_price'
        ? 'Prix manquant pour cet ingrédient'
        : 'Prix unitaire invalide')

        return {
            ...outBase,
            id: pricing.id ?? null,
            unitPriceBuy: null,

            buyPriceEur,
            buyRefQty,
            buyRefUnit,
            buyLabel,

            costRecipe: 0,
            priceMatched: Boolean(pricing.id),
            priceStatus: pricing?.priceStatus === 'missing_price' ? 'missing_price' : 'invalid_price',
            priceMessage: msg,

            note: 'pricePerUnit invalide',

            gramsPerPiece: gramsPerPiece ?? null,
            density_g_per_ml: density ?? null,
            mlPerPiece: mlPerPiece ?? null,
            category,
        }
    }

    // 1) Conversion simple vers base
    const base = convertRecipeToPricingUnit(quantity, unitRaw, priceUnit)
    console.log('[BASE]', name, { quantity, unitRaw, priceUnit, base })
    if (!base || !base.unit || !Number.isFinite(base.qty)) {
        return {
            ...outBase,
            id: pricing.id ?? null,
            unitPriceBuy: pricePerUnit,

            buyPriceEur,
            buyRefQty,
            buyRefUnit,
            buyLabel,
            costRecipe: 0,
            gramsPerPiece: gramsPerPiece ?? null,
            density_g_per_ml: density ?? null,
            mlPerPiece: mlPerPiece ?? null,
            priceMatched: Boolean(pricing.id),
            priceStatus: 'conversion_failed',
            priceMessage: "Conversion d’unité impossible",
            note: 'conversion de base impossible',
            category,
        }
    }

    // 2) Cas direct: base.unit === priceUnit
    if (base.unit === priceUnit) {
        return {
            ...outBase,
            id: pricing.id ?? null,
            unitPriceBuy: pricePerUnit,

            buyPriceEur,
            buyRefQty,
            buyRefUnit,
            buyLabel,

            costRecipe: base.qty * pricePerUnit,
            gramsPerPiece: gramsPerPiece ?? null,
            density_g_per_ml: density ?? null,
            mlPerPiece: mlPerPiece ?? null,
            priceMatched: Boolean(pricing.id),
            priceStatus: 'ok',
            category,
        }
    }

    // 3) Cas "piece" recette → pricing en g/ml via gramsPerPiece/mlPerPiece
    if (base.unit === 'piece' && priceUnit === 'g' && Number.isFinite(gramsPerPiece) && gramsPerPiece > 0) {
        const qtyG = base.qty * gramsPerPiece
        const cost = qtyG * pricePerUnit;
        console.log('[BRANCH]', name, 'CASE=piece_to_g', { base, gramsPerPiece, pricePerUnit})
        console.log('[RETURN]', name, {
            unitRaw,
            base,
            priceUnit,
            gramsPerPiece,
            qtyG,
            pricePerUnit,
            costRecipe: qtyG * pricePerUnit,
        });
        return {
            ...outBase,
            id: pricing.id ?? null,
            unitPriceBuy: pricePerUnit,

            buyPriceEur,
            buyRefQty,
            buyRefUnit,
            buyLabel,

            costRecipe: qtyG * pricePerUnit,
            gramsPerPiece: gramsPerPiece ?? null,
            density_g_per_ml: density ?? null,
            mlPerPiece: mlPerPiece ?? null,
            priceMatched: Boolean(pricing.id),
            priceStatus: 'ok',
            note: 'conversion piece→g (gramsPerPiece)',
            category,
        }
    }

    if (base.unit === 'piece' && priceUnit === 'ml' && Number.isFinite(mlPerPiece) && mlPerPiece > 0) {
        const qtyMl = base.qty * mlPerPiece
        console.log('[BRANCH]', name, 'CASE=piece_to_ml', { base, mlPerPiece, pricePerUnit})
        return {
            ...outBase,
            id: pricing.id ?? null,
            unitPriceBuy: pricePerUnit,

            buyPriceEur,
            buyRefQty,
            buyRefUnit,
            buyLabel,

            costRecipe: qtyMl * pricePerUnit,
            gramsPerPiece: gramsPerPiece ?? null,
            density_g_per_ml: density ?? null,
            mlPerPiece: mlPerPiece ?? null,
            priceMatched: Boolean(pricing.id),
            priceStatus: 'ok',
            note: 'conversion piece→ml (mlPerPiece)',
            category,
        }
    }

    // 4) Cas densité g<->ml
    if (Number.isFinite(density) && density > 0) {
        // recette en ml (base.unit=ml) pricing en g
        if (base.unit === 'ml' && priceUnit === 'g') {
            const qtyG = base.qty * density // g = ml * densité
            console.log('[BRANCH]', name, 'CASE=density_ml_to_g', { base, density, pricePerUnit})

            return {
                ...outBase,
                id: pricing.id ?? null,
                unitPriceBuy: pricePerUnit,

                buyPriceEur,
                buyRefQty,
                buyRefUnit,
                buyLabel,

                costRecipe: qtyG * pricePerUnit,
                gramsPerPiece: gramsPerPiece ?? null,
                density_g_per_ml: density ?? null,
                mlPerPiece: mlPerPiece ?? null,
                priceMatched: Boolean(pricing.id),
                priceStatus: 'ok',
                note: 'conversion densité (ml→g)',
                category,
            }
        }

    // recette en g (base.unit=g) pricing en ml
    if (base.unit === 'g' && priceUnit === 'ml') {
        const qtyMl = base.qty / density // ml = g / densité
        console.log('[BRANCH]', name, 'CASE=density_g_to_ml', { base, density, pricePerUnit})
        return {
            ...outBase,
            id: pricing.id ?? null,
            unitPriceBuy: pricePerUnit,
            buyPriceEur,
            buyRefQty,
            buyRefUnit,
            buyLabel,
            costRecipe: qtyMl * pricePerUnit,
            gramsPerPiece: gramsPerPiece ?? null,
            density_g_per_ml: density ?? null,
            mlPerPiece: mlPerPiece ?? null,
            priceMatched: Boolean(pricing.id),
            priceStatus: 'ok',
            note: 'conversion densité (g→ml)',
            category,
        }
    }
}

    // 5) Sinon: pas de conversion trouvée
return {
...outBase,
id: pricing.id ?? null,
unitPriceBuy: pricePerUnit,
buyPriceEur,
buyRefQty,
buyRefUnit,
buyLabel,
costRecipe: 0,
gramsPerPiece: gramsPerPiece ?? null,
density_g_per_ml: density ?? null,
mlPerPiece: mlPerPiece ?? null,
priceMatched: Boolean(pricing.id),
priceStatus: 'incompatible_unit',
priceMessage: "Unité incompatible (conversion manquante)",
note: 'unité incompatible (conversion manquante)',
}
}

module.exports = { enrichIngredientWithCost, cleanNameForPricing, convertRecipeToPricingUnit }

