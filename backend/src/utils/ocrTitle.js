// backend/src/utils/ocrTitle.js
'use strict';
const { cleanTitleCandidate } = require('../utils/titleUtils')
const { normSpaces } = require('../utils/textUtils')
// Nettoyage léger


function looksLikeIngredientFragmentTitleForTitle(line) {
  const t = String(line || '').replace(/\u00A0/g, ' ').replace(/[ \t]+/g, ' ').trim();
  if (!t) return false;

  const low = t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

    // Exception : titres de type "Sauce Big Mac", "Sauce César", etc.
    // On bloque uniquement "sauce de / sauce d’" (ingrédient), pas "sauce + nom" - A ALISSER
    if (low.startsWith('sauce ') && !/\bsauce\s+(de|d['’])\b/.test(low)) {
    return false;
    }

   // "PUREE DE", "SAUCE DE", "CONCENTRE DE", etc. - A LAISSER
   if (/^(puree|puree|puree|puree|pate|pate|concentre|concentre|sauce|coulis)\s+(de|d['’])\b/.test(low)) {
    return true;
   }

   // mesures très typiques des ingrédients - A LAISSER
   const hasMeasureToken =
   /\b(c\.?\s*a\.?\s*s|c\.?\s*a\.?\s*c|cas|cac)\b/.test(low) ||
   /\b(pincee|pincees|cuillere|cuilleres)\b/.test(low);

   const hasIngredientGrammar =
   /^(?:\d|i)\b/.test(low) ||
   /\b(de|d['’])\b/.test(low);

   // fragments très “ingrédients” - A LAISSER
   const hasIngredientFragment =
   /\b(en poudre|hach(e|es|ee|ees)|tres fins|finement|rape|rapee)\b/.test(low);

   if (hasMeasureToken && hasIngredientGrammar) return true;
   if (hasIngredientFragment && hasIngredientGrammar) return true;


   

   // Infographie / liste compacte type "en poudre I pincée I c.à.s ..." - A LAISSER
   if (/\s\|\s/.test(t)) return true;
   if (/\sI\s/.test(t)) return true;

   // Fragments finissant par qualificatifs ingrédient
   //if (/\b(en poudre|hach[eé]e?s?|tres\s+fin[s]?|tr[eè]s\s+fin[s]?|r[aâ]p[eé]e?s?)\b/.test(low)) {
   //return true;
   //}

   return false;
}

// Faux titres UI / réseaux
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

// Ressemble à une étape (verbe d’action au début)
function looksLikeStepSentence(s) {
  const t = cleanTitleCandidate(s);
  if (!t) return false;
  return /^[-•*]?\s*(égoutter|egoutter|ajouter|mixer|mixez|cuire|faire|préchauffer|prechauffer|préparer|preparer|couper|laver|mettre|verser|chauffer|mélanger|melanger|assaisonner|assaisonnez|enfourner|étaler|etaler)\b/i.test(
    t
  );
}

// Très important : rejeter les “sel & poivre”, “un peu de sel”, etc.
function isAssaisonnementOnly(s) {
  const t = cleanTitleCandidate(s).toLowerCase();
  if (!t) return true;

  if (t === 'sel & poivre' || t === 'sel et poivre') return true;
  if (t === 'salez et poivrez') return true;
  if (t === 'un peu de sel') return true;

  return false;
}

// Candidat acceptable ?
function isValidRecipeTitleCandidate(s) {
  const t = cleanTitleCandidate(s);
  if (!t) return false;

  // refuse les fragments d'ingrédients qui commencent par "de / d'"
  if (/^(de|d['’])\s+/i.test(t)) return false;

  // refuse les titres coupés : "gratin de", "tarte aux", etc.
  if (/\b(de|d['’]|du|des|à|a|au|aux)\s*$/i.test(t)) return false;

  // longueur réaliste
  if (t.length < 4 || t.length > 90) return false;

  // blacklist UI + assaisonnement + étapes
  if (isUiTitleBlacklisted(t)) return false;
  if (isAssaisonnementOnly(t)) return false;
  if (looksLikeStepSentence(t)) return false;

  // évite les phrases (ponctuation de phrase)
  if (/[.!?…]/.test(t)) return false;

  // évite “Ingrédients”, “Préparation”, etc.
  if (/^ingr[ée]dients?\b/i.test(t)) return false;
  if (/^pr[ée]paration\b/i.test(t)) return false;
  if (/^temps\s+de\s+(préparation|cuisson)\b/i.test(t)) return false;

  // ✅ assouplissement :
  // - 2+ mots : OK
  // - 1 mot : OK seulement si c'est "title-like" (commence par une majuscule et assez long)
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return true;

  if (words.length === 1) {
    // ex: "Crevettes", "Tiramisu"
    if (t.length < 6) return false;
    if (!/^[A-ZÀ-ÖØ-Þ]/.test(t)) return false;
    return true;
  }

  return false;
}

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
  cleanTitleCandidate,
  isValidRecipeTitleCandidate,
  scoreTitleCandidate,
  pickBestTitle,
  tryMergeSplitTitle,
  looksLikeIngredientFragmentTitleForTitle,
};


