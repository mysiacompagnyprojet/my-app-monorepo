// backend/src/services/importLimits.js
const { prisma } = require("../lib/prisma");
const { resolveField } = require("../utils/limits");

// -----------------------------
// A) TON EXISTANT (NE PAS CASSER)
// -----------------------------

// Surcharges possibles par variables d'env, sinon valeurs ci-dessous.
const DEFAULT_CAPS = {
 breakfasts: Number(process.env.IMPORT_CAP_BREAKFASTS ?? 12),
 lunches:    Number(process.env.IMPORT_CAP_LUNCHES    ?? 12),
 snacks:     Number(process.env.IMPORT_CAP_SNACKS     ?? 12),
 dinners:    Number(process.env.IMPORT_CAP_DINNERS    ?? 12),
};

/**
* Gère tes limites d'import (breakfasts/lunches/snacks/dinners)
* Inchangé pour ne rien casser.
*/
async function checkAndIncrementLimit(userId, kind) {
 // Statut d'abonnement
 const u = await prisma.user.findUnique({
   where: { id: userId },
   select: { subscriptionStatus: true },
 });
 const sub = u?.subscriptionStatus; // 'active' = premium

 // Récupère/instancie le compteur
 let lim = await prisma.importLimit.findUnique({ where: { userId } });
 if (!lim) lim = await prisma.importLimit.create({ data: { userId } });

 // Clé + cap
 const field = resolveField(kind);
 const caps = DEFAULT_CAPS;
 const current = Number(lim[field] || 0);
 const cap = Number.isFinite(Number(caps[field])) ? Number(caps[field]) : 12;

 // Si non premium et déjà au plafond -> bloqué
 if (sub !== "active" && current >= cap) {
   return { allowed: false, reason: "limit_reached", current, cap };
 }

 // Sinon on incrémente le compteur
 await prisma.importLimit.update({
   where: { userId },
   data: { [field]: { increment: 1 } },
 });

 return { allowed: true, current: current + 1, cap };
}

// -----------------------------------------
// B) NOUVEAU : LIMITES FREEMIUM PRICING (10)
// -----------------------------------------

const LIMIT_KEYS = {
 PRICING_VISIBLE: "pricing_visible",
};

// Cap pricing visible (10 par défaut, surcharge possible par env)
const DEFAULTS = {
 [LIMIT_KEYS.PRICING_VISIBLE]: Number(process.env.PRICING_VISIBLE_CAP ?? 10),
};

function getCapForKey(key) {
 const v = DEFAULTS[key];
 return Number.isFinite(Number(v)) ? Number(v) : 10;
}

async function getOrCreateImportLimitRow(userId) {
 let row = await prisma.importLimit.findUnique({ where: { userId } });
 if (!row) {
   row = await prisma.importLimit.create({ data: { userId } });
 }
 return row;
}

/**
* API "getUsage" compatible avec ton besoin pricing.
* Retourne { used, limit, remaining } pour un key.
*
* NB: on implémente uniquement PRICING_VISIBLE pour l'instant.
*/
async function getUsage(userId, key) {
 if (key !== LIMIT_KEYS.PRICING_VISIBLE) {
   throw new Error(`Unsupported limit key: ${key}`);
 }

 const row = await getOrCreateImportLimitRow(userId);

 // IMPORTANT: nécessite la colonne pricingVisible (voir prérequis DB)
 const used = Number(row.pricingVisible ?? 0);
 const limit = getCapForKey(key);
 const remaining = Math.max(0, limit - used);

 return { used, limit, remaining };
}

/**
* Incrémente l'usage pricingVisible.
* Retourne { used, limit, remaining }.
*/
async function incrementUsage(userId, key, amount = 1) {
 if (key !== LIMIT_KEYS.PRICING_VISIBLE) {
   throw new Error(`Unsupported limit key: ${key}`);
 }

 // Assure que la ligne existe
 await getOrCreateImportLimitRow(userId);

 const updated = await prisma.importLimit.update({
   where: { userId },
   data: { pricingVisible: { increment: amount } },
   select: { pricingVisible: true },
 });

 const used = Number(updated.pricingVisible ?? 0);
 const limit = getCapForKey(key);
 const remaining = Math.max(0, limit - used);

 return { used, limit, remaining };
}

/**
* Politique pricing pour ton frontend :
* - premium (subscriptionStatus === 'active') => jamais flouté
* - free => flouté si used >= limit
*
* Retourne { blurPrices, used, limit, remaining }
*/
async function getPricingPolicy({ userId, plan }) {
 if (plan === "premium") {
   return {
     blurPrices: false,
     used: 0,
     limit: Infinity,
     remaining: Infinity,
   };
 }

 const usage = await getUsage(userId, LIMIT_KEYS.PRICING_VISIBLE);
 const blurPrices = usage.used >= usage.limit;

 return { blurPrices, ...usage };
}

module.exports = {
 // ancien export (inchangé)
 checkAndIncrementLimit,

 // nouveaux exports (pricing freemium)
 LIMIT_KEYS,
 getUsage,
 incrementUsage,
 getPricingPolicy,
};