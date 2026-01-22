// backend/src/parsers/generic.js
const { parseRawLine } = require('../utils/ingredients');
const { splitStepsFromText } = require('../utils/textUtils')

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

// Normalise le texte des étapes
function normalizeSteps(rawSteps = []) {
  return rawSteps
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .map((s) =>
      s
        .replace(/^[\s•\-·\u2022]*\d+[\.\)]\s*/, '')
        .trim()
    );
}

// ───────────────── Beautify + règles FR ─────────────────

function beautifyIngredient(ing) {
  let name = String(ing.name || '').trim();
  let unit = ing.unit || '';
  let quantity = ing.quantity ?? 0;

  // Décodage HTML
  name = name.replace(/&#39;/g, "'").replace(/&amp;/g, '&');

  // Corriger le cas "Ousse(s) ail" → "Gousse(s) ail"
  name = name.replace(/^Ousse\(s\)\s+ail/i, "Gousse(s) ail");

  // Supprimer excès d'espaces
  name = name.replace(/\s+/g, ' ').trim();

  // ─── 1) ABRÉVIATION "C. à soupe ..." ────────────────────────────
  let mShort =
    name.match(/^C\.\s*à\s*soupe\s+(?:d['’]|de)?\s*(.+)$/i) ||
    name.match(/^C\.\s*a\s*soupe\s+(?:d['’]|de)?\s*(.+)$/i);
  if (mShort) {
    name = mShort[1].trim();
    if (!unit || unit === 'piece') unit = 'cas';
  }

  // ─── 2) Cuillère(s) à soupe ... ────────────────────────────────
  let m =
    name.match(/^Cuill[eè]res?\s+à\s+soupe\s+(?:d['’]|de)?\s*(.+)$/i) ||
    name.match(/^Cuill[eè]re\s+à\s+soupe\s+(?:d['’]|de)?\s*(.+)$/i);
  if (m) {
    name = m[1].trim();
    if (!unit || unit === 'piece') unit = 'cas';
  }

  // ─── 3) Cuillère(s) à café ... ─────────────────────────────────
  let m2 =
    name.match(/^Cuill[eè]res?\s+à\s+caf[ée]\s+(?:d['’]|de)?\s*(.+)$/i) ||
    name.match(/^Cuill[eè]re\s+à\s+caf[ée]\s+(?:d['’]|de)?\s*(.+)$/i);
  if (m2) {
    name = m2[1].trim();
    if (!unit || unit === 'piece') unit = 'cac';
  }

  // ─── 4) PINCEE(S) → unité pincee (gère "Pincée", "Pincées", "Pincée(s)") ──
  let mp = name.match(/^Pinc[ée]e?(?:\(s\)|s)?\s+(?:de\s+)?(.+)$/i);
  if (mp) {
    name = mp[1].trim();
    unit = 'pincee';
    if (quantity === 1 && ing.unit === 'piece') {
      quantity = 1;
    }
  }

  // ─── 5) VERRE(S) → unité verre (gère "Verre", "Verres", "Verre(s)") ─────
  let mv = name.match(/^Verre(?:s|\(s\))?\s+(?:d['’]|de)?\s*(.+)$/i);
  if (mv) {
    name = mv[1].trim();
    unit = 'verre';
  }

  // ─── 6) GRAIN(S) DE ... → garder "Grain de ..." ─────────────────
  let mg =
    name.match(/^Grains?\s+de\s+(.+)$/i) ||
    name.match(/^Grains?\s+(.+)$/i) ||
    name.match(/^Grain\s+(.+)$/i);
  if (mg) {
    name = `Grain de ${mg[1].trim()}`;
  }

  // Correction bruit "Rain poivre blanc" → "Grain de poivre blanc"
  if (/^Rain\s+/.test(name)) {
    name = name.replace(/^Rain\s+/, 'Grain de ');
  }

  // ─── 7) Gousses d'ail : forcer unité "piece" ────────────────────
  if (/gousse/i.test(name) && /ail/i.test(name)) {
    // Ex: "Gousse(s) ail", "Gousses d'ail"
    name = "Gousses d'ail";
    unit = 'piece';
    if (!quantity || quantity < 1) {
      quantity = ing.quantity ?? 0;
    }
  }

  // ─── 8) Sel et poivre sans vraie quantité ──────────────────────
  if (/^Sel[ ,]?\s*poivre$/i.test(name) && quantity === 1 && (unit === 'piece' || !unit)) {
    quantity = 0;
    unit = '';
  }

  // Capitalisation finale
  name = name.replace(/\s+/g, ' ').trim();
  if (name) name = name.charAt(0).toUpperCase() + name.slice(1);

  return { ...ing, name, unit, quantity };
}

// ───────────────── Parse des ingrédients ─────────────────

function parseIngredientLines(lines = []) {
  return lines
    .map((l) => String(l || '').trim())
    .filter(Boolean)
    .map((rawLine) => {
      let line = rawLine;

      // Fraction "1/2" → "0,5"
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
        let quantity = parsed.quantityNum ?? parsed.quantity ?? 0;

        return beautifyIngredient({
          name,
          quantity,
          unit,
        });
      }

      // fallback
      return beautifyIngredient({
        name: rawLine,
        quantity: 0,
        unit: '',
      });
    });
}

// ───────────────── Extraction JSON-LD ─────────────────

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
    } catch {}
  });

  return recipeJson;
}

// ───────────────── Fallback HTML : ingrédients & étapes ─────────────────

// Essaie d'abord de trouver un bloc "Ingrédients" puis la liste <ul>/<ol> juste après
function extractFallbackIngredients($) {
  // 1) Chercher un titre "Ingrédients"
  let ingContainer = null;

  $('h1, h2, h3, h4, h5, h6, strong, p').each((_, el) => {
    const txt = $(el).text().trim();
    if (/ingr[ée]dients?/i.test(txt)) {
      const nextList = $(el).nextAll('ul,ol').first();
      if (nextList && nextList.length) {
        ingContainer = nextList;
        return false; // break
      }
    }
  });

  if (ingContainer) {
    const items = ingContainer
      .find('li')
      .map((i, li) => $(li).text().trim())
      .get()
      .filter(Boolean);
    if (items.length) return items;
  }

  // 2) Sinon, on revient à l'ancien comportement générique
  const listCandidates = $('li')
    .map((i, el) => $(el).text().trim())
    .get()
    .filter(Boolean);

  const ING_REGEX =
    /(\d|g\b|kg\b|ml\b|cl\b|l\b|cuill|œuf|oeuf|lait|farine|sucre|beurre|huile|sel|poivre|pinc[ée]e?|verre|grain|moutarde|cr[èe]me|fromage|oignon|ail)/i;

  const liIngredients = listCandidates.filter((t) => ING_REGEX.test(t));
  return liIngredients.slice(0, 40);
}

function extractFallbackSteps($) {
  const pSteps = $('p')
    .map((i, el) => $(el).text().trim())
    .get()
    .filter(Boolean);

  // Découper les paragraphes trop longs
  const out = [];
  pSteps.slice(0, 20).forEach((p) => {
    if (p.length > 120) {
      // gros bloc → split intelligent
      splitStepsFromText(p).forEach((s) => out.push(s));
    } else {
      out.push(p);
    }
  });

  return out;
}

// ───────────────── Export principal ─────────────────

module.exports = async function parseGeneric($, url) {
  const recipeJson = extractRecipeFromJsonLd($);

  let title = '';
  let servings = 1;
  let steps = [];
  let imageUrl = null;
  let rawIngredients = [];
  let notes = '';

  if (recipeJson) {
    // JSON-LD
    title = recipeJson.name || 'Recette importée';

    const ry = recipeJson.recipeYield;
    if (typeof ry === 'string') {
      const m = ry.match(/(\d+)/);
      if (m) servings = parseInt(m[1], 10) || 1;
    } else if (Number.isFinite(ry)) {
      servings = parseInt(ry, 10) || 1;
    }

    imageUrl = Array.isArray(recipeJson.image)
      ? recipeJson.image[0]
      : recipeJson.image || null;

    rawIngredients = Array.isArray(recipeJson.recipeIngredient)
      ? recipeJson.recipeIngredient
      : [];

    // Étapes JSON-LD (avec découpe intelligente si gros bloc)
    if (Array.isArray(recipeJson.recipeInstructions)) {
      steps = recipeJson.recipeInstructions
        .map((i) => (typeof i === 'string' ? i : i?.text || ''))
        .filter(Boolean)
        .flatMap((s) => {
          if (s.length > 120) return splitStepsFromText(s);
          return [s];
        });
    } else if (typeof recipeJson.recipeInstructions === 'string') {
      const s = recipeJson.recipeInstructions.trim();
      steps = s.length > 120 ? splitStepsFromText(s) : [s];
    }

    const prep = formatIsoDuration(recipeJson.prepTime);
    const cook = formatIsoDuration(recipeJson.cookTime);
    const total = formatIsoDuration(recipeJson.totalTime);

    const notesParts = [];
    if (total) notesParts.push(`Temps total : ${total}`);
    if (prep) notesParts.push(`Préparation : ${prep}`);
    if (cook) notesParts.push(`Cuisson : ${cook}`);
    notes = notesParts.join('\n');
  } else {
    // Fallback HTML
    title =
      $('h1').first().text().trim() ||
      $('title').text().trim() ||
      'Recette importée';

    rawIngredients = extractFallbackIngredients($);
    steps = extractFallbackSteps($);

    imageUrl =
      $('meta[property="og:image"]').attr('content')?.trim() ||
      $('img').first().attr('src') ||
      null;

    servings = 1;
    notes = '';
  }

  if (!steps.length) {
    steps = ['Ajouter ici les étapes de la recette (non détectées automatiquement).'];
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
