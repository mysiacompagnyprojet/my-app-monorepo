// backend/src/routes/import-url.js
const express = require('express');
const cheerio = require('cheerio');
const { prisma } = require('../lib/prisma');
const { parseRawLine } = require('../utils/ingredients');
const { checkAndIncrementLimit } = require('../utils/limits');

const router = express.Router();
const fetch = global.fetch; // utiliser le fetch natif de Node 18+

function needAuth(req, res, next) {
  if (!req.user?.userId) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

router.post('/url', needAuth, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ ok: false, error: 'url manquante' });

    // ✅ Limite gratuite (type "dinner") — cap réglé dans utils/limits.js (par défaut 12)
    const chk = await checkAndIncrementLimit(req.user.userId, 'dinner');
    if (!chk.allowed) {
      return res.status(402).json({ ok: false, error: 'limit_reached' });
    }

    // ⚠️ On récupère la page avec des en-têtes "navigateur" pour éviter certains blocages
    const r = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
        'Accept-Language': 'fr-FR,fr;q=0.9',
      },
      redirect: 'follow',
    });

    if (!r.ok) {
      // ex : 403/404/bloqué par le site
      return res.status(400).json({ ok: false, error: `fetch failed (${r.status})` });
    }

    const html = await r.text();
    const $ = cheerio.load(html);

    // 1) JSON-LD Recipe (prioritaire)
    let recipeJson = null;
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const raw = $(el).contents().text();
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
      } catch (_) {}
    });

    let title = '';
    let servings = 1;
    let steps = [];
    let imageUrl = null;
    let rawIngredients = [];

    if (recipeJson) {
      title = recipeJson.name || '';

      // recipeYield peut être "4", "4 personnes", "Pour 6 personnes", etc.
      const ry = recipeJson.recipeYield;
      if (typeof ry === 'string') {
        const m = ry.match(/(\d+([.,]\d+)?)/);
        servings = m ? parseInt(m[1]) || 1 : 1;
      } else if (Number.isFinite(ry)) {
        servings = parseInt(ry) || 1;
      }

      steps = Array.isArray(recipeJson.recipeInstructions)
        ? recipeJson.recipeInstructions
            .map((i) => (typeof i === 'string' ? i : i?.text || ''))
            .filter(Boolean)
        : [];

      imageUrl = Array.isArray(recipeJson.image) ? recipeJson.image[0] : recipeJson.image || null;
      rawIngredients = Array.isArray(recipeJson.recipeIngredient) ? recipeJson.recipeIngredient : [];
    } else {
      // 2) Fallback heuristique (best-effort) si pas de JSON-LD
      title = $('h1').first().text().trim() || $('title').text().trim() || 'Recette';

      const listCandidates = $('li')
        .map((i, el) => $(el).text().trim())
        .get();

      rawIngredients = listCandidates
        .filter((t) =>
          /(\d|g\b|kg\b|ml\b|l\b|cuill|œuf|oeuf|lait|farine|sucre|beurre|huile|sel|poivre)/i.test(t)
        )
        .slice(0, 40);

      steps = $('p')
        .map((i, el) => $(el).text().trim())
        .get()
        .filter(Boolean)
        .slice(0, 12);

      imageUrl = $('img').first().attr('src') || null;
      servings = 1;
    }

    // 3) Enrichissement avec OpenGraph (pratique pour Facebook & co)
    const ogTitle = $('meta[property="og:title"]').attr('content')?.trim();
    const ogDesc = $('meta[property="og:description"]').attr('content')?.trim();
    const ogImage = $('meta[property="og:image"]').attr('content')?.trim();

    // Si le titre est vide ou très générique, on prend og:title
    if (!title || title.toLowerCase() === 'recette') {
      title = ogTitle || title || $('h1').first().text().trim() || $('title').text().trim() || 'Recette';
    }

    // Si pas d'image trouvée dans le JSON-LD / heuristique, on prend og:image
    if (!imageUrl && ogImage) {
      imageUrl = ogImage;
    }

    // Si pas d'ingrédients mais une description OG, on tente d'en extraire
    if ((!rawIngredients || rawIngredients.length === 0) && ogDesc) {
      const lines = ogDesc
        .split(/[\n•\-–·]|(?:\s{2,})/)
        .map((s) => s.trim())
        .filter(Boolean);

      const guessed = lines.filter((t) =>
        /(\d|g\b|kg\b|ml\b|l\b|cuill|œuf|oeuf|farine|sucre|beurre|huile)/i.test(t)
      );

      if (guessed.length) {
        rawIngredients = guessed.slice(0, 40);
      }

      const other = lines.filter((l) => !guessed.includes(l));
      if (other.length && steps.length === 0) {
        steps = other.slice(0, 12);
      }
    }

    // 4) Normalisation finale des ingrédients
    const ingredients = (rawIngredients || [])
      .map((line) => parseRawLine(line))
      .filter(Boolean)
      .map((x) => ({
        name: x.name,
        quantity: Number(x.quantity || 0),
        unit: x.unit || 'piece',
      }));

    return res.json({
      ok: true,
      draft: { title, servings, steps, imageUrl, ingredients },
    });
  } catch (e) {
    console.error('POST /import/url error:', e);
    return res.status(400).json({ ok: false, error: e.message || 'parse error' });
  }
});

module.exports = router;
