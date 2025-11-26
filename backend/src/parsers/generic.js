// backend/src/parsers/generic.js
const { parseRawLine } = require('../utils/ingredients');

// Convertit les durées ISO 8601 (PT10M, PT1H30M…)
function formatIsoDuration(d) {
  if (!d || typeof d !== 'string') return null;
  const m = d.match(/PT(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!m) return null;

  const h = m[1] ? parseInt(m[1], 10) : 0;
  const min = m[2] ? parseInt(m[2], 10) : 0;

  const parts = [];
  if (h) parts.push(`${h} h`);
  if (min) parts.push(`${min} min`);
  return parts.length ? parts.join(' ') : null;
}

// Normalise les étapes (on enlève les numéros au début)
function normalizeSteps(rawSteps = []) {
  return rawSteps
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .map((s) => s.replace(/^[\s•\-·\u2022]*\d+[\.\)]\s*/, '').trim());
}

// Nettoyage basique d’un ingrédient
function beautifyIngredient(ing) {
  let name = String(ing.name || '').trim();
  let unit = ing.unit || '';

  name = name.replace(/\bacheter ici\b/i, '').trim();
  name = name.replace(/\s+/g, ' ').trim();

  if (name) name = name.charAt(0).toUpperCase() + name.slice(1);

  return { ...ing, name, unit };
}

// Parse une liste de chaînes d’ingrédients -> { name, quantity, unit }
function parseIngredientLines(lines = []) {
  return lines
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .map((line) => {
      const parsed = parseRawLine(line);
      if (parsed) {
        return {
          name: parsed.nameCanon || parsed.name || line,
          quantity: parsed.quantityNum ?? parsed.quantity ?? 0,
          unit: parsed.unit || '',
        };
      }
      return { name: line, quantity: 0, unit: '' };
    })
    .map(beautifyIngredient);
}

// Essaie de trouver un objet Recipe dans les scripts JSON-LD
function extractRecipeFromJsonLd($) {
  let recipeJson = null;

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = $(el).contents().text();
      if (!raw) return;
      const data = JSON.parse(raw);

      const graph = Array.isArray(data['@graph'])
        ? data['@graph']
        : Array.isArray(data)
        ? data
        : [data];

      const found = graph.find((n) => {
        const t = n['@type'];
        return t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'));
      });

      if (found && !recipeJson) recipeJson = found;
    } catch {
      // ignore
    }
  });

  return recipeJson;
}

module.exports = async function parseGeneric($, url) {
  // 1) Essayer JSON-LD Recipe
  const recipeJson = extractRecipeFromJsonLd($);

  let title = '';
  let servings = 1;
  let steps = [];
  let imageUrl = null;
  let rawIngredients = [];
  let notes = '';

  if (recipeJson) {
    // Titre
    title = recipeJson.name || 'Recette importée';

    // Portions
    const ry = recipeJson.recipeYield;
    if (typeof ry === 'string') {
      const m = ry.match(/(\d+)/);
      if (m) servings = parseInt(m[1], 10) || 1;
    } else if (Number.isFinite(ry)) {
      servings = parseInt(ry, 10) || 1;
    }

    // Image
    imageUrl = Array.isArray(recipeJson.image)
      ? recipeJson.image[0]
      : recipeJson.image || null;

    // Ingrédients
    rawIngredients = Array.isArray(recipeJson.recipeIngredient)
      ? recipeJson.recipeIngredient
      : [];

    // Étapes
    if (Array.isArray(recipeJson.recipeInstructions)) {
      steps = recipeJson.recipeInstructions
        .map((i) => (typeof i === 'string' ? i : i?.text || ''))
        .filter(Boolean);
    } else if (typeof recipeJson.recipeInstructions === 'string') {
      steps = recipeJson.recipeInstructions
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    }

    // Temps → notes
    const prep = formatIsoDuration(recipeJson.prepTime);
    const cook = formatIsoDuration(recipeJson.cookTime);
    const total = formatIsoDuration(recipeJson.totalTime);

    const notesParts = [];
    if (total) notesParts.push(`Temps total : ${total}`);
    if (prep) notesParts.push(`Préparation : ${prep}`);
    if (cook) notesParts.push(`Cuisson : ${cook}`);
    notes = notesParts.join('\n');
  } else {
    // 2) Fallback HTML très générique
    title =
      $('h1').first().text().trim() ||
      $('title').text().trim() ||
      'Recette importée';

    const ING_REGEX =
      /(\d|g\b|kg\b|ml\b|cl\b|l\b|cuill|œuf|oeuf|lait|farine|sucre|beurre|huile|sel|poivre)/i;

    const listCandidates = $('li')
      .map((i, el) => $(el).text().trim())
      .get()
      .filter(Boolean);

    rawIngredients = listCandidates.filter((t) => ING_REGEX.test(t));

    const pSteps = $('p')
      .map((i, el) => $(el).text().trim())
      .get()
      .filter(Boolean);

    steps = pSteps.slice(0, 20);
    imageUrl = $('img').first().attr('src') || null;
    servings = 1;
    notes = '';
  }

  if (!steps.length) {
    steps = [
      'Ajouter ici les étapes de la recette (non détectées automatiquement).',
    ];
  }

  const ingredients = parseIngredientLines(rawIngredients);
  steps = normalizeSteps(steps);

  return {
    title,
    servings,
    imageUrl,
    notes,
    steps,
    ingredients,
  };
};
