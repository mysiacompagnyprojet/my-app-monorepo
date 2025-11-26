// backend/src/routes/import-url.js
const express = require('express');
const cheerio = require('cheerio');
const { prisma } = require('../lib/prisma');
const { parseRawLine } = require('../utils/ingredients');
const { checkAndIncrementLimit } = require('../utils/limits');

// Adapters par site
const parseMarmiton = require('../parsers/marmiton');
const parseSchaer = require('../parsers/schaer');
const parseMangerBouger = require('../parsers/mangerbouger');
const parseCuisineAddict = require('../parsers/cuisineaddict');
const parseGeneric = require('../parsers/generic');

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

function selectParser(host) {
  if (host.includes('marmiton.org')) return parseMarmiton;
  if (host.includes('schaer.com')) return parseSchaer;
  if (host.includes('mangerbouger.fr')) return parseMangerBouger;
  if (host.includes('cuisineaddict.com')) return parseCuisineAddict;

  // Fallback pour tous les autres sites
  return parseGeneric;
}

// ──────────────────────────────────────────────
// Route POST /import/url
// ──────────────────────────────────────────────

router.post('/url', needAuth, async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url) {
      return res
        .status(400)
        .json({ ok: false, error: 'url manquante' });
    }

    // Limite gratuite
    const chk = await checkAndIncrementLimit(req.user.userId, 'dinner');
    if (!chk.allowed) {
      return res
        .status(402)
        .json({ ok: false, error: 'limit_reached' });
    }

    const host = hostnameOf(url);

    // Récupération de la page avec un User-Agent "navigateur"
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

      // Cas particuliers : Facebook / Instagram bloqués
      if (/facebook\.com|instagram\.com/.test(host)) {
        msg =
          "Ce site bloque l'accès automatique. Utilise l’import photo (OCR) pour cette recette.";
      }

      return res
        .status(400)
        .json({ ok: false, error: msg });
    }

    const html = await r.text();
    const $ = cheerio.load(html);

    // Sélection de l’adapter en fonction du site
    const parser = selectParser(host);

    // Chaque adapter doit retourner un objet "draft" :
    // { title, servings, imageUrl, notes, steps, ingredients }
    const draft = await parser($, url);

    if (!draft || typeof draft !== 'object') {
      return res.status(500).json({
        ok: false,
        error: 'parse_error',
      });
    }

    return res.json({ ok: true, draft });
  } catch (e) {
    console.error('POST /import/url error:', e);
    return res
      .status(400)
      .json({ ok: false, error: e.message || 'parse error' });
  }
});

module.exports = router;


