// backend/src/routes/import-ocr/demoResponseHelpers.js
// LEVEL: ROUTE
// Construit une réponse sécurisée pour le mode test gratuit sans compte

'use strict';

function isFinitePositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function findMostExpensiveIngredientIndex(ingredients) {
  const list = Array.isArray(ingredients) ? ingredients : [];

  let bestIndex = -1;
  let bestCost = -1;

  for (let i = 0; i < list.length; i += 1) {
    const ing = list[i];
    const cost = ing?.costEur;

    if (!isFinitePositiveNumber(cost)) continue;
    if (ing?.priceMatched === false) continue;

    if (cost > bestCost) {
      bestCost = cost;
      bestIndex = i;
    }
  }

  return bestIndex;
}

function buildDemoOcrSuccessResponse({ draft, trial }) {
  const ingredients = Array.isArray(draft?.ingredients) ? draft.ingredients : [];
  const visibleIngredientIndex = findMostExpensiveIngredientIndex(ingredients);

  const demoIngredients = ingredients.map((ing, index) => {
    const isVisible = index === visibleIngredientIndex;

    return {
      name: String(ing?.name || '').trim(),
      quantity: Number(ing?.quantity || 0),
      unit: String(ing?.unit || '').trim(),
      quantityRaw: ing?.quantityRaw || undefined,
      priceMatched: typeof ing?.priceMatched === 'boolean' ? ing.priceMatched : undefined,
      pricing: isVisible
        ? {
            visible: true,
            locked: false,
            costEur: ing?.costEur ?? null,
          }
        : {
            visible: false,
            locked: true,
          },
    };
  });

  return {
    ok: true,
    demo: true,
    trial: {
      used: Number(trial?.used ?? 0),
      limit: Number(trial?.limit ?? 0),
      remaining: Number(trial?.remaining ?? 0),
    },
    recipe: {
      title: String(draft?.title || '').trim(),
      servings: Number(draft?.servings || 0),
      imageUrl: draft?.imageUrl || null,
      notes: String(draft?.notes || ''),
      ingredients: demoIngredients,
      steps: Array.isArray(draft?.steps) ? draft.steps : [],
    },
    totals: {
      recipe: { locked: true },
      courses: { locked: true },
    },
    budgetBadge: { locked: true },
    economySuggestion: { locked: true },
    actions: {
      canSave: false,
      requiresAccount: true,
      createAccountUrl: '/create-account',
    },
  };
}

module.exports = {
  buildDemoOcrSuccessResponse,
};