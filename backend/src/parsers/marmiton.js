// backend/src/parsers/marmiton.js
const { parseRawLine } = require('../utils/ingredients');

// ───────────────── Helpers communs ─────────────────

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

function normalizeSteps(rawSteps = []) {
  return rawSteps
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .map((s) =>
      s
        .replace(/^[\s•\-·\u2022]*\d+[\.\)]\s*/, '')      // enlève "1. ", "2)"
        .replace(/^Étape\s*\d+\s*:?/i, '')               // enlève "Étape 1 :"
        .trim()
    );
}

// Nettoyage + cas particuliers pour le nom / unité
function beautifyIngredient(ing) {
  let name = String(ing.name || '').trim();
  let unit = ing.unit || '';

  name = name.replace(/\s+/g, ' ').trim();

  // Cas 1 : "Cuillères à soupe d'huile" → Huile + unité "cas"
  let m = name.match(/^Cuill[eè]res?\s+à\s+soupe\s+d['’](.+)$/i)
    || name.match(/^Cuill[eè]re\s+à\s+soupe\s+d['’](.+)$/i);
  if (m) {
    name = m[1].trim();
    if (!unit || unit === 'piece') unit = 'cas';
  }

  // Cas 2 : "Cuillères à café de ..." → nom simple + unité "cac"
  let m2 = name.match(/^Cuill[eè]res?\s+à\s+caf[ée]\s+de\s+(.+)$/i)
    || name.match(/^Cuill[eè]re\s+à\s+caf[ée]\s+de\s+(.+)$/i);
  if (m2) {
    name = m2[1].trim();
    if (!unit || unit === 'piece') unit = 'cac';
  }

  // Cas 3 : "Verres de bière" → Bière + unité "verre"
  let mb = name.match(/^Verres?\s+de\s+(.+)$/i);
  if (mb) {
    name = mb[1].trim();
    if (!unit || unit === 'piece') unit = 'verre';
  }

  name = name.replace(/\s+/g, ' ').trim();
  if (name) name = name.charAt(0).toUpperCase() + name.slice(1);

  return { ...ing, name, unit };
}

// Parse et nettoie les lignes d’ingrédients
function parseIngredientLines(lines = []) {
  return lines
    .map((l) => String(l || '').trim())
    .filter(Boolean)
    .map((rawLine) => {
      let line = rawLine;

      // "1/2" ou "1 / 2" → "0,5"
      line = line.replace(/(\d+)\s*\/\s*(\d+)/g, (m, a, b) => {
        const num = parseFloat(a);
        const den = parseFloat(b);
        if (!den) return m;
        return (num / den).toString().replace('.', ',');
      });

      const parsed = parseRawLine(line);

      if (parsed) {
        let unit = parsed.unit || '';
        let name = parsed.nameCanon || parsed.name || rawLine;

        // Normalisation des unités "cuillère à soupe / café" si parseRawLine les a vues
        if (unit) {
          const uNorm = unit
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();

          if (uNorm.includes('cuillere') && uNorm.includes('soupe')) {
            unit = 'cas';
          } else if (
            uNorm.includes('cuillere') &&
            (uNorm.includes('cafe') || uNorm.includes('caf'))
          ) {
            unit = 'cac';
          }
        }

        return beautifyIngredient({
          name,
          quantity: parsed.quantityNum ?? parsed.quantity ?? 0,
          unit,
        });
      }

      // Fallback : tout dans le nom
      return beautifyIngredient({
        name: rawLine,
        quantity: 0,
        unit: '',
      });
    });
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

// ───────────────── Export principal ─────────────────

module.exports = async function parseMarmiton($, url) {
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

    // Ingrédients textes
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

    // Temps → Notes
    const prep = formatIsoDuration(recipeJson.prepTime);
    const cook = formatIsoDuration(recipeJson.cookTime);
    const total = formatIsoDuration(recipeJson.totalTime);

    const notesParts = [];
    if (total) notesParts.push(`Temps total : ${total}`);
    if (prep) notesParts.push(`Préparation : ${prep}`);
    if (cook) notesParts.push(`Cuisson : ${cook}`);
    notes = notesParts.join('\n');
  } else {
    // Fallback HTML Marmiton (au cas où pas de JSON-LD)
    title =
      $('h1').first().text().trim() ||
      $('title').text().trim() ||
      'Recette importée';

    const ING_REGEX =
      /(\d|g\b|kg\b|ml\b|cl\b|l\b|cuill|œuf|oeuf|lait|farine|sucre|beurre|huile|sel|poivre)/i;

    const listCandidates = $('[itemprop="recipeIngredient"], .ingredient, li')
      .map((i, el) => $(el).text().trim())
      .get()
      .filter(Boolean);

    rawIngredients = listCandidates.filter((t) => ING_REGEX.test(t));

    const pSteps = $(
      '.recipe-preparation__list li, .preparation__list li, .recipe-steps li, p'
    )
      .map((i, el) => $(el).text().trim())
      .get()
      .filter(Boolean);

    steps = pSteps.slice(0, 30);

    imageUrl =
      $('[itemprop="image"]').attr('src') ||
      $('img').first().attr('src') ||
      null;

    servings = 1;
    notes = '';
  }

  if (!steps.length) {
    steps = [
      'Ajouter ici les étapes de la recette (non détectées automatiquement).',
    ];
  }

  const ingredients = parseIngredientLines(rawIngredients);
  const normalizedSteps = normalizeSteps(steps);

  return {
    title,
    servings,
    imageUrl,
    notes,
    steps: normalizedSteps,
    ingredients,
  };
};

