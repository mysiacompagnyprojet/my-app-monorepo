// backend/src/routes/import-url.js
// LEVEL: ROUTE
// import autorisés : middleware-services-parsers-lib-utils,
// import interdits : routes-frontend
// importé uniquement par src-index

'use strict';

const express = require('express');
const cheerio = require('cheerio');
const { prisma } = require('../lib/prisma');

// Limites existantes (par repas / import)
const { checkAndIncrementLimit } = require('../services/importLimits');

// Limites freemium pricing (10 visibles)
const { getPricingPolicy, incrementUsage, LIMIT_KEYS } = require('../services/importLimits');

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
 if (host.includes('cuisine-addict.com')) return parseCuisineAddict;

 // Fallback pour tous les autres sites
 return parseGeneric;
}

/**
* Détecte si ce endpoint renvoie déjà un pricing exploitable.
* (Dans la plupart des cas URL import ne calcule pas les prix.)
* On incrémente la limite PRICING_VISIBLE uniquement si pricing présent,
* sinon le compteur sera incrémenté au moment où un autre endpoint calcule/affiche les prix.
*/
function draftHasPricing(draft) {
 if (!draft || typeof draft !== 'object') return false;
 if (Number.isFinite(draft.totalCostEur)) return true;
 if (Array.isArray(draft.ingredients)) {
   return draft.ingredients.some((x) => x && (x.price != null || x.costEur != null));
 }
 return false;
}

// ──────────────────────────────────────────────
// Route POST /import/url
// ──────────────────────────────────────────────

router.post('/url', needAuth, async (req, res) => {
 try {
   const { url } = req.body || {};
   if (!url) {
     return res.status(400).json({ ok: false, error: 'url manquante' });
   }

   const userId = req.user?.userId;

   // Limite gratuite EXISTANTE (ne pas casser)
   // (actuellement branchée sur 'dinner' chez toi)
   const chk = await checkAndIncrementLimit(userId, 'dinner');
   if (!chk.allowed) {
     return res.status(402).json({ ok: false, error: 'limit_reached' });
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

     return res.status(400).json({ ok: false, error: msg });
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

   // ---------------- Pricing freemium limits (10 visibles) ----------------
   // IMPORTANT: flou à partir de la 11e => on calcule blur AVANT incrément.
   // On n'incrémente PRICING_VISIBLE que si ce endpoint renvoie déjà un pricing.
   let limits = null;

   if (userId) {
     const u = await prisma.user.findUnique({
       where: { id: userId },
       select: { subscriptionStatus: true },
     });
     const plan = u?.subscriptionStatus === 'active' ? 'premium' : 'free';

     const policy = await getPricingPolicy({ userId, plan });
     const blurPrices = policy.blurPrices;

     let usage = policy;

     // N'incrémente que si pricing déjà présent dans le draft
     // (sinon ce serait injuste: URL import ne calcule souvent pas les prix)
     if (draftHasPricing(draft) && plan !== 'premium' && !blurPrices) {
       usage = await incrementUsage(userId, LIMIT_KEYS.PRICING_VISIBLE, 1);
     }

     limits = {
       blurPrices,
       used: usage.used,
       limit: usage.limit,
       remaining: Math.max(0, usage.limit - usage.used),
     };
   }

   return res.json({ ok: true, draft, limits });
 } catch (e) {
   console.error('POST /import/url error:', e);
   return res.status(400).json({ ok: false, error: e.message || 'parse error' });
 }
});

module.exports = router;