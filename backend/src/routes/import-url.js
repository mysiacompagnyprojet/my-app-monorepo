// backend/src/routes/import-url.js
const express = require('express');
const cheerio = require('cheerio');
const { prisma } = require('../lib/prisma');
const { parseRawLine } = require('../utils/ingredients');

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

    const html = await (await fetch(url)).text();
    const $ = cheerio.load(html);

    // 1) JSON-LD Recipe
    let recipeJson = null;
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const raw = $(el).contents().text();
        const data = JSON.parse(raw);
        const graph = Array.isArray(data['@graph']) ? data['@graph'] : Array.isArray(data) ? data : [data];
        const found = graph.find((n) => {
          const t = n['@type'];
          return t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'));
        });
        if (found && !recipeJson) recipeJson = found;
      } catch (_) {}
    });

    let title = '',
      servings = 1,
      steps = [],
      imageUrl = null,
      rawIngredients = [];
    if (recipeJson) {
      title = recipeJson.name || '';
      const ry = recipeJson.recipeYield;
      servings = typeof ry === 'string' ? parseInt(ry) || 1 : parseInt(ry) || 1;
      steps = Array.isArray(recipeJson.recipeInstructions)
        ? recipeJson.recipeInstructions
            .map((i) => (typeof i === 'string' ? i : i?.text || ''))
            .filter(Boolean)
        : [];
      imageUrl = Array.isArray(recipeJson.image) ? recipeJson.image[0] : recipeJson.image || null;
      rawIngredients = Array.isArray(recipeJson.recipeIngredient) ? recipeJson.recipeIngredient : [];
    } else {
      // Fallback heuristique
      title = $('h1').first().text().trim() || $('title').text().trim() || 'Recette';
      const listCandidates = $('li')
        .map((i, el) => $(el).text().trim())
        .get();
      rawIngredients = listCandidates
        .filter((t) => /(\d|\bg\b|\bkg\b|\bml\b|\bl\b|cuill|oeuf|lait|farine|sucre)/i.test(t))
        .slice(0, 40);
      steps = $('p')
        .map((i, el) => $(el).text().trim())
        .get()
        .filter(Boolean)
        .slice(0, 12);
      imageUrl = $('img').first().attr('src') || null;
      servings = 1;
    }

    const ingredients = rawIngredients.map((line) => parseRawLine(line)).filter(Boolean);

    res.json({
      ok: true,
      draft: { title, servings, steps, imageUrl, ingredients },
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

module.exports = router;
