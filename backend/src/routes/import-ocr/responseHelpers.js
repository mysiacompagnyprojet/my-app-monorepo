// backend/src/routes/import-ocr/responseHelpers.js
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

function stripPricingFromDraft(draft) {
  if (!draft) return draft;

  return {
    ...draft,

    totalCostEur: null,
    totalShoppingCostEur: null,
    recipeCostEur: null,
    shoppingCostEur: null,
    pricePerServingEur: null,

    ingredients: Array.isArray(draft.ingredients)
      ? draft.ingredients.map((ingredient) => ({
          ...ingredient,

          price: null,
          priceEur: null,
          usedCostEur: null,
          buyCostEur: null,
          totalCostEur: null,
          shoppingCostEur: null,

          unitPriceEur: null,
          pricePerUnit: null,
          pricePerKg: null,
          pricePerL: null,

          matchedPrice: null,
          priceMatch: null,
          pricing: null,
          product: null,
        }))
      : draft.ingredients,
  };
}

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

  const shouldHidePrices = plan !== 'premium' && blurPrices;

  return {
    ok: true,
    draft: shouldHidePrices ? stripPricingFromDraft(draft) : draft,
    pricingPolicy: {
      blurPrices,
      pricesHidden: shouldHidePrices,
      used: after.used,
      limit: after.limit,
      remaining: after.remaining,
    },
  };
}

module.exports = {
  buildOcrSuccessResponse,
};