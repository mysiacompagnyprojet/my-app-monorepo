// backend/src/utils/ocrTitle.js
// LEVEL: UTIL (title heuristics)
// import autorisés : utils bas niveau (stringUtils/titleUtils)
// import interdits : routes, middleware, services, prisma
// importé par : services/vision + utils/ocrText + parsers
'use strict';
const { cleanTitleCandidate } = require('../utils/stringUtils')
const { isValidRecipeTitleCandidate } = require('../utils/heuristics')
// Nettoyage léger


// Score pour départager plusieurs titres valides
function scoreTitleCandidate(s) {
  const t = cleanTitleCandidate(s);
  if (!isValidRecipeTitleCandidate(t)) return -9999;

  let score = 0;

  // bonus si contient des mots “plats”
  if (/\b(gratin|croque|monsieur|ap[ée]ritif|nuggets?|cookies?|g[âa]teau|gateau|tarte|quiche|poulet|salade|soupe)\b/i.test(t)) score += 10;

  // bonus si majuscules ou style titre
  if (/^[A-ZÀ-ÖØ-Þ]/.test(t)) score += 3;

  // bonus si 2+ mots
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length >= 2) score += 4;
  if (words.length >= 4) score += 2;

  // longueur raisonnable
  score += Math.max(0, 90 - t.length) / 15;

  return score;
}

// Choix “meilleur titre” parmi une liste
function pickBestTitle(candidates) {
  const list = (candidates || [])
    .map((x) => cleanTitleCandidate(x))
    .filter(Boolean);

  let best = null;
  let bestScore = -9999;

  for (const t of list) {
    const sc = scoreTitleCandidate(t);
    if (sc > bestScore) {
      bestScore = sc;
      best = t;
    }
  }

  return bestScore > -1000 ? best : null;
}

// Cas Nuggets : recoller "Nuggets de pois" + "chiches"
function tryMergeSplitTitle(linesOrCandidates) {
  const arr = (linesOrCandidates || []).map(cleanTitleCandidate).filter(Boolean);

  for (let i = 0; i < arr.length - 1; i++) {
    const a = arr[i];
    const b = arr[i + 1];
    if (/^nuggets?\s+de\s+pois$/i.test(a) && /^chiches?$/i.test(b)) {
      return 'Nuggets de pois chiches';
    }
  }
  return null;
}

module.exports = {
  scoreTitleCandidate,
  pickBestTitle,
  tryMergeSplitTitle,
};


