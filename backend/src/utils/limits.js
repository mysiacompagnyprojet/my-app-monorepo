const { prisma } = require('../lib/prisma');

async function checkAndIncrementLimit(userId, kind /* 'breakfast' | 'lunch' | 'snack' | 'dinner' */) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { subscriptionStatus: true } });
  const sub = u?.subscriptionStatus;

  let lim = await prisma.importLimit.findUnique({ where: { userId } });
  if (!lim) lim = await prisma.importLimit.create({ data: { userId } });

  const caps = { breakfasts: 4, lunches: 8, snacks: 8, dinners: 8 };
  const field = kind + 's';
  const current = lim[field] || 0;
  const cap = caps[field] ?? 8;

  if (sub !== 'active' && current >= cap) {
    return { allowed: false, reason: 'limit_reached' };
  }

  await prisma.importLimit.update({
    where: { userId },
    data: { [field]: { increment: 1 } }
  });

  return { allowed: true };
}

module.exports = { checkAndIncrementLimit };
