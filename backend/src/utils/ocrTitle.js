// backend/src/utils/ocrTitle.js
'use strict';

// ─────────────────────────────────────────────────────────────
// Nettoyage léger
// ─────────────────────────────────────────────────────────────
function norm(s) {
  return String(s || '')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function cleanTitleCandidate(s) {
  let t = norm(s);

  // retire ponctuation “bord”
  t = t.replace(/^[\s·•\-\–—\*\.,;:(){}[\]"“”'’]+/g, '');
  t = t.replace(/[\s·•\-\–—\*\.,;:(){}[\]"“”'’]+$/g, '');

  return norm(t);
}

// ─────────────────────────────────────────────────────────────
// Détection fragments ingrédients (faux titres)
// ─────────────────────────────────────────────────────────────
function looksLikeIngredientFragmentTitleForTitle(line) {
  const t = String(line || '')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();

  if (!t) return false;

  const low = t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  // Exception : "Sauce Big Mac", "Sauce César", etc.
  // On bloque uniquement "sauce de / sauce d’" (ingrédient)
  if (
    low.startsWith('sauce ') &&
    !/\bsauce\s+(de|d['’])\b/.test(low)
  ) {
    return false;
  }

  // "PURÉE DE", "SAUCE DE", "CONCENTRÉ DE", etc. — À LAISSER
  if (
    /^(puree|puree|puree|purée|pate|pâte|concentre|concentré|sauce|coulis)\s+(de|d['’])\b/.test(
      low
    )
  ) {
    return true;
  }

  // Mesures typiques d'ingrédients — À LAISSER
  const hasMeasureToken =
    /\b(c\.?\s*à\.?\s*s|c\.?\s*à\.?\s*c|cas|cac)\b/.test(low) ||
    /\b(pincee|pincees|cuillere|cuilleres|)\b/.test(low);

  const hasIngredientGrammer =
    /^(?:\d|i)\b/.test(low) ||
    /\b(de|d[''])\b/.test(low);

  // Fragments ingrédients très explicites — À LAISSER
  const hasIngredientFragment =
    /\b(en poudre|hach(e|es|ee|ees)|tres fins|finement|rape|rapee)\b/.test(
      low
    );

  if (
    hasMeasureToken &&
    hasIngredientGrammer &&
    hasIngredientFragment
  ) {
    return true;
  }

  // Infographies / listes compactes — À LAISSER
  if (/\s\|\s/.test(t)) return true;
  if (/\sI\s/.test(t)) return true;

  return false;
}

// ─────────────────────────────────────────────────────────────
// Faux titres UI / réseaux
// ─────────────────────────────────────────────────────────────
function isUiTitleBlacklisted(s) {
  const t = cleanTitleCandidate(s).toLowerCase();
  if (!t) return true;

  if (/^toutes?\s+les\s+publications?$/i.test(t)) return true;
  if (/^enregistr[ée]$/i.test(t)) return true;

  if (/^recettes?\s+d[ée]lice$/i.test(t)) return true;
  if (/^recettes?\s+et\s+d[ée]lices?$/i.test(t)) return true;

  if (/^publication\s+de\b/i.test(t)) return true;

  return false;
}

// ─────────────────────────────────────────────────────────────
// Détection phrases d'étapes
// ─────────────────────────────────────────────────────────────
function looksLikeStepSentence(s) {
  const t = cleanTitleCandidate(s);
  if (!t) return false;

  return /^[-•*]?\s*(égoutter|egoutter|ajouter|mixer|mixez|cuire|faire|préchauffer|prechauffer|préparer|preparer|couper|laver|mettre|verser|chauffer|mélanger|melanger|assaisonner|assaisonnez|enfourner|étaler|etaler)\b/i.test(
    t
  );
}

// ─────────────────────────────────────────────────────────────
// Assaisonnement seul (à rejeter)
// ─────────────────────────────────────────────────────────────
function isAssaisonnementOnly(s) {
  const t = cleanTitleCandidate(s).toLowerCase();
  if (!t) return true;

  if (t === 'sel & poivre') return true;
  if (t === 'sel et poivre') return true;
  if (t === 'salez et poivrez') return true;
  if (t === 'un peu de sel') return true;

  return false;
}

// ─────────────────────────────────────────────────────────────
// Validation candidat titre
// ─────────────────────────────────────────────────────────────
function isValidRecipeTitleCandidate(s) {
  const t = cleanTitleCandidate(s);
  if (!t) return false;

  // commence par "de / d'"
  if (/^(de|d['’])\s+/i.test(t)) return false;

  // titres coupés : "gratin de", "tarte aux", etc.
  if (/\b(de|d['’]|du|des|à|a|au|aux)\s*$/i.test(t)) return false;

  // longueur réaliste
  if (t.length < 4 || t.length > 90) return false;

  // blacklist UI / assaisonnement / étapes
  if (isUiTitleBlacklisted(t)) return false;
  if (isAssaisonnementOnly(t)) return false;
  if (looksLikeStepSentence(t)) return false;

  // éviter phrases complètes
  if (/[.!?…]/.test(t)) return false;

  // sections génériques
  if (/^ingr[ée]dients?\b/i.test(t)) return false;
  if (/^pr[ée]paration\b/i.test(t)) return false;
  if (/^temps\s+de\s+(préparation|cuisson)\b/i.test(t)) return false;

  // Assouplissement
  const words = t.split(/\s+/).filter(Boolean);

  if (words.length >= 2) return true;

  if (words.length === 1) {
    if (t.length < 6) return false;
    if (!/^[A-ZÀ-ÖØ-Þ]/.test(t)) return false;
    return true;
  }

  return false;
}

// ─────────────────────────────────────────────────────────────
// Score de priorité titre
// ─────────────────────────────────────────────────────────────
function scoreTitleCandidate(s) {
  const t = cleanTitleCandidate(s);
  if (!isValidRecipeTitleCandidate(t)) return -9999;

  let score = 0;

  // mots plats
  if (
    /\b(gratin|croque|monsieur|ap[ée]ritif|nuggets?|cookies?|g[âa]teau|gateau|tarte|quiche|poulet|salade|soupe)\b/i.test(
      t
    )
  ) {
    score += 10;
  }

  // style titre
  if (/^[A-ZÀ-ÖØ-Þ]/.test(t)) score += 3;

  // nombre de mots
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length >= 2) score += 4;
  if (words.length >= 4) score += 2;

  // longueur raisonnable
  score += Math.max(0, 90 - t.length) / 15;

  return score;
}

// ─────────────────────────────────────────────────────────────
// Choix meilleur titre
// ─────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────
// Cas spécifiques : titres coupés
// ─────────────────────────────────────────────────────────────
function tryMergeSplitTitle(linesOrCandidates) {
  const arr = (linesOrCandidates || [])
    .map(cleanTitleCandidate)
    .filter(Boolean);

  for (let i = 0; i < arr.length - 1; i++) {
    const a = arr[i];
    const b = arr[i + 1];

    if (
      /^nuggets?\s+de\s+pois$/i.test(a) &&
      /^chiches?$/i.test(b)
    ) {
      return 'Nuggets de pois chiches';
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────
module.exports = {
  cleanTitleCandidate,
  isValidRecipeTitleCandidate,
  scoreTitleCandidate,
  pickBestTitle,
  tryMergeSplitTitle,
  looksLikeIngredientFragmentTitleForTitle,
};
