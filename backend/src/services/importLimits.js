//backend/src/services/importLimits
const { prisma } = require('../lib/prisma');
const { resolveField } = require('../utils/limits');

// Surcharges possibles par variables d'env, sinon valeurs ci-dessous.
const DEFAULT_CAPS = {
  breakfasts: Number(process.env.IMPORT_CAP_BREAKFASTS ?? 12),
  lunches:    Number(process.env.IMPORT_CAP_LUNCHES    ?? 12),
  snacks:     Number(process.env.IMPORT_CAP_SNACKS     ?? 12),
  dinners:    Number(process.env.IMPORT_CAP_DINNERS    ?? 12),
};

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
  if (sub !== 'active' && current >= cap) {
    return { allowed: false, reason: 'limit_reached', current, cap };
  }

  // Sinon on incrémente le compteur
  await prisma.importLimit.update({
    where: { userId },
    data: { [field]: { increment: 1 } },
  });

  return { allowed: true, current: current + 1, cap };
}

module.exports = {
    checkAndIncrementLimit
}