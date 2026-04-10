// backend/src/routes/import-ocr/splitpipeline.js
// LEVEL: ROUTE
// import autorisés : 
// import interdits : 
// importé uniquement par 

'use strict';

const { prisma } = require('../../lib/prisma');
const {
  getPricingPolicy,
  incrementUsage,
  LIMIT_KEYS,
} = require('../../services/importLimits');

async function buildOcrSuccessResponse({ req, draft }) {
  const userId = req.userId || req.user?.userId;

  if (!userId) {
    return {
      ok: true,
      draft,
      pricingPolicy: null,
    };
  }

  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { subscriptionStatus: true },
  });

  const plan = u?.subscriptionStatus === 'active' ? 'premium' : 'free';

  const before = await getPricingPolicy({ userId, plan });
  const blurPrices = before.blurPrices;

  let after = before;
  if (plan !== 'premium' && !blurPrices) {
    after = await incrementUsage(userId, LIMIT_KEYS.PRICING_VISIBLE, 1);
  }

  return {
    ok: true,
    draft,
    pricingPolicy: {
      blurPrices,
      used: after.used,
      limit: after.limit,
      remaining: after.remaining,
    },
  };
}

module.exports = {
  buildOcrSuccessResponse,
};