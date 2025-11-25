// backend/src/routes/import-url.js
const express = require('express');
const cheerio = require('cheerio');
const { prisma } = require('../lib/prisma');
const { parseRawLine } = require('../utils/ingredients');
const { checkAndIncrementLimit } = require('../utils/limits');

const router = express.Router();
const fetch = global.fetch;

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function needAuth(req, res, next) {
  if (!req.user?.userId) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

function hostnameOf(u) {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return '';
  }
}

// Convertit les durées ISO 8601 (PT10M, PT1H30M…)
function formatIsoDuration(d) {
  if (!d) return null;
  const m = d.match(/PT(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!m) return null;

  const h = m[1] ? parseInt(m[1]) : 0;
  const min = m[2] ? parseInt(m[2]) : 0;

  const parts = [];
  if (h) parts.push(`${h}h`);
  if (min) parts.push(`${min}min`);

  return parts.length ? parts.join(' ') : null;
}

// Normalise les étapes
function normalizeSteps(rawSteps = []) {
  return rawSteps
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .map((s) => s.replace(/^[\s•\-·\u2022]*\d+[\.\)]\s*/, '').trim());
}

// Beautifie les ingrédients
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

// ──────────────────────────────────────────────
// Route POST /import/url
// ──────────────────────────────────────────────

router.post('/url', needAuth, async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ ok: false, error: 'url manquante' });

    // Vérification limite gratuite
    const chk = await checkAndIncrementLimit(req.user.userId, 'dinner');
    if (!chk.allowed) {
      return res.status(402).json({ ok: false, error: 'limit_reached' });
    }

    const host = hostnameOf(url);

    // Fetch avec User-Agent navigateur
    const r = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
        'Accept-Language': 'fr-FR,fr;q=0.9',
      },
      redirect: 'follow',
    });

    if (!r.ok) {
      let msg = `fetch failed (${r.status})`;
      if (/facebook\.com|instagram\.com/.test(host)) {
        msg =
          "Ce site bloque l'accès automatique. Utilise l’import photo (OCR) pour cette recette.";
      }
      return res.status(400).json({ ok: false, error: msg });
    }

    const html = await r.text();
    const $ = cheerio.load(html);

    // ──────────────────────────────────────────────
    // 1) JSON-LD Recipe (PRIORITAIRE)
    // ──────────────────────────────────────────────

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
      } catch {}
    });

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
        if (m) servings = parseInt(m[1]) || 1;
      } else if (Number.isFinite(ry)) {
        servings = parseInt(ry) || 1;
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
      }

      // NOTES (prép, cuisson, total)
      const prep = formatIsoDuration(recipeJson.prepTime);
      const cook = formatIsoDuration(recipeJson.cookTime);
      const total = formatIsoDuration(recipeJson.totalTime);

      const notesParts = [];
      if (total) notesParts.push(`Temps total : ${total}`);
      if (prep) notesParts.push(`Préparation : ${prep}`);
      if (cook) notesParts.push(`Cuisson : ${cook}`);

      notes = notesParts.join('\n');
    }

    // ──────────────────────────────────────────────
    // 2) Fallback si pas de JSON-LD
    // ──────────────────────────────────────────────

    if (!recipeJson) {
      title =
        $('h1').first().text().trim() ||
        $('title').text().trim() ||
        'Recette importée';

      // Ingrédients heuristiques
      const listCandidates = $('li')
        .map((i, el) => $(el).text().trim())
        .get()
        .filter(Boolean);

      const ING_REGEX =
        /(\d|g\b|kg\b|ml\b|cl\b|l\b|cuill|œuf|oeuf|lait|farine|sucre|beurre|huile|sel|poivre)/i;

      rawIngredients = listCandidates.filter((t) => ING_REGEX.test(t));

      // Étapes heuristiques
      const pSteps = $('p')
        .map((i, el) => $(el).text().trim())
        .get()
        .filter(Boolean);

      steps = [...pSteps].slice(0, 20);

      imageUrl = $('img').first().attr('src') || null;
      servings = 1;
      notes = '';
    }

    // Si pas d’étapes : placeholder
    if (!steps.length) {
      steps = ['Ajouter ici les étapes de la recette (non détectées automatiquement).'];
    }

    // Parser et nettoyer ingrédients
    const ingredients = parseIngredientLines(rawIngredients);

    // Normaliser étapes
    steps = normalizeSteps(steps);

    // Draft final
    const draft = {
      title,
      servings,
      imageUrl,
      notes,
      steps,
      ingredients,
    };

    return res.json({ ok: true, draft });
  } catch (e) {
    console.error('POST /import/url error:', e);
    return res
      .status(400)
      .json({ ok: false, error: e.message || 'parse error' });
  }
});

module.exports = router;

