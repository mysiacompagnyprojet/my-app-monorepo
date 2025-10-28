// backend/src/utils/limits.js
const { prisma } = require('../lib/prisma');

// Petits plus : on permet de surcharger les plafonds par variables d'env (optionnel)
const DEFAULT_CAPS = {
  breakfasts: Number(process.env.IMPORT_CAP_BREAKFASTS ?? 4),
  lunches:    Number(process.env.IMPORT_CAP_LUNCHES    ?? 8),
  snacks:     Number(process.env.IMPORT_CAP_SNACKS     ?? 8),
  dinners:    Number(process.env.IMPORT_CAP_DINNERS    ?? 8),
};

/** Mappe 'breakfast'|'lunch'|'snack'|'dinner' -> clé de table */
function resolveField(kind) {
  const k = String(kind || '').toLowerCase();
  if (k === 'breakfast') return 'breakfasts';
  if (k === 'lunch')     return 'lunches';
  if (k === 'snack')     return 'snacks';
  if (k === 'dinner')    return 'dinners';
  // fallback sûr : on ne casse rien et on compte comme un dîner
  return 'dinners';
}

/**
 * Vérifie le quota et incrémente si autorisé.
 * @param {string} userId
 * @param {'breakfast'|'lunch'|'snack'|'dinner'} kind
 * @returns {Promise<{ allowed: boolean, reason?: string, current?: number, cap?: number }>}
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
  const cap = Number.isFinite(Number(caps[field])) ? Number(caps[field]) : 8;

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

/**
 * (Optionnel) Middleware prêt à l'emploi :
 * app.post('/import/url', supabaseAuth, limitGate('dinner'), handler)
 */
function limitGate(kind) {
  return async (req, res, next) => {
    try {
      const userId = req.user?.userId;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const gate = await checkAndIncrementLimit(userId, kind);
      if (!gate.allowed) {
        return res.status(402).json({ ok: false, error: 'limit_reached' });
      }
      next();
    } catch (e) {
      console.error('limitGate error:', e);
      return res.status(500).json({ ok: false, error: 'internal error' });
    }
  };
}

module.exports = { checkAndIncrementLimit, limitGate };

