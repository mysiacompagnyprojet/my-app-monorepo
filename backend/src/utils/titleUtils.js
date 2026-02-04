//backend/src/utils/titleUtils

//ingredientUtils
const { isIngredientsHeader, isPreparationHeader, looksLikeStepLine } = require('../utils/ingredientUtils')
//stringUtils
const { normSpaces, stripDiacritics, normalizeTitleCandidate, looksLikeTimeInfoLine } = require('../utils/stringUtils');
//utils
const { extractServingsFromLine } = require('../utils/units');
// ---------------- BAD TITLE (Cat-03) ----------------

const BAD_TITLE_WORDS = [
  'ingredients',
  'directions',
  'preparation',
  'préparation',
  'cuisson',
  'portions',
  'temps',
  'calories',
  'source',
  'recette',
  'yumrecette',
  'yum recette',
  'vumrecette',
  'vum recette',
  'site',
  'www',
  'primeal',
  'vinegar',
];

const  EMOTIONAL_TITLE_PATTERNS = [
  /ahah/i,
  /personne/i,
  /vous allez/i,
  /incroyable/i,
  /comment vous dire/i,
  /ce plat m'?a/i,
  /remonté[e]? le moral/i,
  /c['’]est\s+pas\s+comme/i,
  /\bet\s+maintenant\b/i,
];



function isMetaInfoLineForTitle(line) {
  const t = stripDiacritics(normSpaces(String(line || ''))).toLowerCase();
  if (!t) return false;

  // 1) Labels / entêtes meta (début de ligne)
  // ex: "Temps", "Temps de préparation", "Cuisson", "Difficulté", "Portions", "Calories", "Prépa", "Prep"
  if (/^(temps|cuisson|difficulte|difficulté|portions?|calories?|prep|prepa|prépa|preparation|préparation)\b/.test(t)) {
    return true;
  }

  // 2) Formes type "temps: 25 min" / "cuisson - 10 min" / "portions — 4"
  if (/^(temps|cuisson|difficulte|difficulté|portions?|calories?)\b\s*[:\-–—]/.test(t)) {
    return true;
  }

  // 3) Durées isolées (souvent captées en lignes seules)
  // ex: "25 min", "1 h", "45 minutes"
  if (/^\d+\s*(h|heure|heures|min|mins|mn|mns|minute|minutes)\b/.test(t)) {
    return true;
  }

  // 4) Cas fréquents "Temps de préparation", "Temps cuisson", etc.
  if (/^temps\s+(de\s+)?(preparation|préparation|cuisson)\b/.test(t)) {
    return true;
  }

  return false;
}


function isTitleNoiseLabel(line) {
  const t = normSpaces(String(line || ''));
  if (!t) return false;

  // "Recette" / "Recettes" (souvent un header)
  if (/^recettes?$/i.test(t)) return true;

  // "de Wendy", "de Marine", etc. (auteur)
  // (autorise apostrophe droite ou typographique)
  if (/^de\s+[a-zà-öø-ÿ'’-]{2,}$/i.test(t)) return true;

  // 1 seul mot, tout en MAJUSCULES, court => typique label déco
  // ex: "FARINE", "SUCRE"
  if (/^[A-ZÀ-ÖØ-Þ]{3,12}$/.test(t)) return true;

  // 1 seul mot "ingrédient ultra commun" => souvent un faux titre
  // (même si pas en majuscules)
  const low = t.toLowerCase();
  const isSingleWord = /^[a-zà-öø-ÿ'’-]{3,20}$/i.test(t);

  if (isSingleWord) {
    const NOISE_WORDS = new Set([
      'farine',
      'sucre',
      'levure',
      'beurre',
      'sel',
      'poivre',
      'huile',
      'lait',
      'oeuf',
      'oeufs',
      'œuf',
      'œufs',
    ]);
    if (NOISE_WORDS.has(low)) return true;
  }

  return false;
}


function isGenericSiteTitle(t) {
  const s = normSpaces(t).toLowerCase();
  if (!s) return true;

  // Cas déjà gérés
  if (s === 'recettes délice' || s === 'recettes delice') return true;
  if (/^recettes?\b/.test(s) && s.length <= 30) return true;

  // ✅ Nouveaux : noms de sites fréquents qui polluent le titre
  // Ex: "yumrecette", "yum recette", OCR foireux "vum reccette", etc.
  if (/\b(yum\s*recette|yumrecette|vum\s*recette|vum\s*reccette)\b/i.test(s)) return true;

  return false;
}

function looksLikePlausibleTitleLine(line, opts = {}) {
  const t = cleanTitleCandidate(line);
  if (!t) return false;

  const isIngredientLine =
    typeof opts.isIngredientLine === 'function' ? opts.isIngredientLine : null;

  // optionnel : si tu veux surcharger la détection de step depuis ailleurs
  const isStepLineFn =
    typeof opts.isStepLine === 'function' ? opts.isStepLine : looksLikeStepLine;

  // pas un header/temps/servings
  if (isIngredientsHeader(t)) return false;
  if (isPreparationHeader(t)) return false;
  if (extractServingsFromLine(t)) return false;
  if (looksLikeTimeInfoLine(t)) return false;

  // pas une étape / pas un ingrédient
  if (isStepLineFn(t)) return false;
  if (isIngredientLine && isIngredientLine(t)) return false;

  // longueur réaliste, pas de digits
  if (t.length < 6 || t.length > 90) return false;
  if (/\d/.test(t)) return false;

  // évite titres génériques
  if (isGenericSiteTitle(t)) return false;

  // doit contenir au moins une lettre
  if (!/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(t)) return false;

  return true;
}


function canJoinTitleLines(prev, next, opts = {}) {
  const a = normSpaces(prev);
  const b = normSpaces(next);
  if (!a || !b) return false;

  // ❌ On ne fusionne jamais des lignes qui contiennent une question (souvent un conseil) ajoute le 30/01
  if (/\?/.test(a) || /\?/.test(b)) return false;

  // ❌ On ne fusionne jamais des phrases "conseil" ajoute le 30/01
  if (/^\s*(pas de|tu peux|vous pouvez)\b/i.test(a) || /^\s*(pas de|tu peux|vous pouvez)\b/i.test(b)) return false;


  const isIngredientLine =
    typeof opts.isIngredientLine === 'function' ? opts.isIngredientLine : null;

  // pas de join si la 2e ligne est une section/meta
  if (isIngredientsHeader(b) || isPreparationHeader(b) || extractServingsFromLine(b)) return false;

  // garde-fou si ton isPreparationHeader ne couvre pas "instructions"
  if (/^instructions?\b/i.test(b)) return false;

  // meta temps/calories/etc.
  if (looksLikeTimeInfoLine(b)) return false;

  // pas de join si ça ressemble à step
  if (looksLikeStepLine(b) || looksLikeStepTitle(b)) return false;

  // pas de join si ingrédient (si on a le détecteur)
  if (isIngredientLine && isIngredientLine(b)) return false;

  // heuristiques de collage
  const aEndsOpen =
    /[,/&+–—-]\s*$/.test(a) ||
    /\b(et|de|d['’]|du|des|à|a)\s*$/i.test(a);

  const bLooksContinuation =
    /^[A-ZÀ-ÖØ-Þa-zà-öø-ÿ]/.test(b) &&
    !/^\d/.test(b) &&
    b.length <= 60;

  if (aEndsOpen) return true;
  if (a.length <= 40 && bLooksContinuation) return true;

  return false;
}


function isBadTitleCandidate(s) {
  const t = normSpaces(s).toLowerCase();
  if (!t) return true;

  // exception explicite
  if (/^sauce\s+/i.test(t)) return false;

  // meta en début (temps/cuisson/difficulté/portions/calories)
  if (/^(temps|cuisson|difficult[ée]|difficulte|portions?|calories?)\b\s*[:–—-]/i.test(t)) {
    return true;
  }

  // domaine / site
  if (t.includes('.com') || t.includes('.fr') || /\b\w+\.(com|fr|net|org)\b/i.test(t)) return true;

  // UI / labels blacklistés (boutons, "afficher la suite", etc.)
  if (isBlacklistedUiTitle(t)) return true;

  // commence par un chiffre (souvent étape, temps, compteur, etc.)
  if (/^\d/.test(t)) return true;

  // unité seule
  if (/^(ml|cl|dl|l|g|gr|kg)$/.test(t.trim())) return true;

  // commence par quantité + unité (souvent ingrédient)
  if (/^\d+([.,]\d+)?\s*(g|gr|kg|ml|cl|dl|l)\b/i.test(t)) return true;

  // step / action
  if (looksLikeStepTitle(t)) return true;

  // accroches émotionnelles
  if (looksLikeEmotionalHookTitle(t)) return true;
  if (EMOTIONAL_TITLE_PATTERNS?.some((r) => r.test(t))) return true;

  // mots exacts bloqués (sections, UI, etc.)
  if (BAD_TITLE_WORDS?.includes(t)) return true;

  return false;
}

function isBlacklistedUiTitle(s) {
  const t = normalizeTitleCandidate(s).toLowerCase();
  if (!t) return true;

  if (/→\s*suivre$/i.test(t)) return true;
  if (/\bsuivre$/i.test(t) && t.includes('→')) return true;

  if (t === 'toutes les publications' || t === 'toute les publications') return true;
  if (t === 'enregistré' || t === 'enregistree' || t === 'enregistrée') return true;

  if (t === 'recettes délice' || t === 'recettes delice') return true;
  if (t === 'recettes et délices' || t === 'recettes et delices') return true;

  if (t.startsWith('publication de')) return true;

  return false;
}

function sanitizePickedTitle(title) {
  let t = normSpaces(title);
  if (!t) return '';

  t = t.replace(/\s*(?:\.\.\.|…)?\s*afficher la suite.*$/i, '');
  t = t.replace(/\s*(?:\.\.\.|…)\s*$/g, '');
  t = t.replace(/\b(temps|portions?|calories)\b\s*$/i, '').trim();//ajoute le 20/01

  return normSpaces(t);
}

function looksLikeEmotionalHookTitle(raw) {
  const s0 = String(raw || '').trim();
  if (!s0) return false;

  const s = stripDiacritics(s0).toLowerCase();

  if (
    s.length > 60 &&
    !/\b(recette|gateau|gâteau|soupe|salade|pates?|pâtes?|riz|poulet|boeuf|bœuf|porc|poisson)\b/.test(s)
  ) {
    return true;
  }

  if (/[!?]{2,}/.test(s)) return true;
  if (/\bahah\b/.test(s)) return true;
  if (/\bpersonne\b/.test(s)) return true;

  if (/\b(j['’]ai|j[’']?|je|m['’]a|mon|ma|mes|moi)\b/.test(s)) return true;

  const hooks = [
    'comment vous dire',
    'vous allez adorer',
    'incroyable recette',
    'trop bonne',
    'trop bon',
    'un delice',
    'c est une tuerie',
    'vous devez absolument',
    'on raffole',
    'ca m a remonte le moral',
    'remonte le moral',
    'je signale toute copie',
    'protege par des droits d auteur',
  ];

  if (hooks.some((h) => s.includes(h))) return true;

  if (s.length > 45 && /\b(dit|mangeait|voici|ajoute|ajoutee|comment|dire|remonte)\b/.test(s)) return true;

  return false;
}

function looksLikeStepTitle(t) {
  const s = String(t || '').trim();
  if (!s) return false;
  return /^[-•*]?\s*(hacher|hachez|eplucher|epluchez|éplucher|épluchez|égoutter|egoutter|ajouter|mixer|mixez|cuire|faire|préchauffer|prechauffer|préparer|preparer|couper|laver|mettre|verser|chauffer|mélanger|melanger)\b/i.test(
    s
  );
}

function looksLikeLooseActionStep(line) {
  const t = normSpaces(String(line || ''));
  if (!t) return false;

  const low = stripDiacritics(t).toLowerCase();

  // 1) Début ultra typique d'étape: "Dans un saladier/bol/casserole..."
  if (/^dans\s+(un|une|le|la|les|du|de la|des)\b/.test(low)) return true;

  // 2) Verbes d'action fréquents (présent / impératif / OCR sans accents)
  // NB: on teste "startsWith" via regex début de ligne pour éviter de matcher un titre long
  if (
    /^(ajouter|ajoute|melanger|melange|verser|verse|cuire|cuit|faire|chauffer|chauffe|prechauffer|preparer|prepare|hacher|hache|egoutter|egoutte|laver|lave|couper|coupe|fouetter|fouette|battre|incorporer|incorpore|remuer|remue|peler|eplucher|mixer|mixe|decouper|decoupe|repartir|repartis|enfourner|enfourne|deposer|depose|finir|finis)\b/.test(
      low
    )
  ) {
    return true;
  }

  return false;
}

function looksLikeIngredientOnlyTitle(line) {
  const t = String(line || '');
  if (!t) return false;
  const low = stripDiacritics(t).toLowerCase();
  //"du thym", "de la farine", "des oeufs"
  if (/^(de|du|des)\s+(le|la|les|l')?\s*[a-z]{3,}$/.test(low) && low.length <= 18) {
    return true;
  }
  return false;
}

function looksLikeHookOrLongSentenceTitle(t) {
  const s = normalizeTitleCandidate(t);
  if (!s) return false;

  const low = stripDiacritics(s).toLowerCase();

  // typique "phrase Instagram" / accroche
  if (s.includes('?')) return true;
  if (low.includes('pas de')) return true;
  if (low.includes('tu peux')) return true;

  // trop long => souvent pas un vrai titre
  if (s.length > 45) return true;

  return false;
}

function looksLikeMeasureLineTitle(t) {
  const s = normalizeTitleCandidate(t);
  if (!s) return false;

  const low = stripDiacritics(String(t || '')).toLowerCase();// changer le 20/01/26 : (s).toLowerCase();

  // Un vrai titre (2+ mots) sans chiffres ne doit pas être classé "measure line"
  //NE PAS ENLEVER POUR RECETTE 6
  if (!/\d/.test(low) && low.split(/\s+/).length >= 3) return false;

  // commence par quantité/mesure/puce
  if (/^[-•*]?\s*\d/.test(s)) return true;
  if (/^[-•*]\s*/.test(s)) return true;

  // contient unités classiques
  if (/\b(g|gr|kg|ml|cl|dl|l)\b/.test(low)) return true;
  if (/\b(c\.?a\.?s|c\.?à\.?s|c\.?a\.?c|c\.?à\.?c)\b/.test(low)) return true;

  // ex: "I pincée", "1/2 c.à.c ..."
  if (/\b(pinc[ée]e|pincée)\b/.test(low)) return true;

  return false;
}

function looksTruncatedTitle(t) {
  // robuste aux accents combinés (ex: "a\u0300")
  const s = normSpaces(String(t || ''))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

  if (!s) return false;

  // finit par un connecteur => souvent titre coupé
  // NB: "à" devient "a" après suppression des accents
  return /\b(et|de|d['’]|du|des|a)\s*$/.test(s);
}


function visionLooksLikeSuffix(v) {
       if (!v) return false;
       if (v.length > 22) return false;
       return (
        /^a\s+l['’]/.test(v) ||
        /^a\s+la\b/.test(v) ||
        /^a\s+aux\b/.test(v) ||
        /^express\b/.test(v) ||
        /^maison\b/.test(v) ||
        /^facile\b/.test(v) ||
        /^rapide\b/.test(v)
       );
}

function stripEdgeEmojisAndPunct(s) { 
  let t = normSpaces(s);

  // retire emojis/pictos au début/fin (sans toucher au texte au centre)
  // (range large emojis + symboles fréquemment OCR)
  t = t
  .replace(/^[\s·•\-\–—\*\.\,\;\:\(\)\[\]{}"“”'’]+/g, '')
  .replace(/[\s·•\-\–—\*\.\,\;\:\(\)\[\]{}"“”'’]+$/g, '')
  .replace(/^[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]+/gu, '')
  .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]+$/gu, '');

  t = t
  .replace(/^[\s·•\-\–—\*\.\,\;\:\(\)\[\]{}"“”'’]+/g, '')
  .replace(/[\s·•\-\–—\*\.\,\;\:\(\)\[\]{}"“”'’]+$/g, '');
  return normSpaces(t);
}

function cleanTitleCandidate(input) {
  let s = normSpaces(input);

  // 1) nettoyage "bord" large (ponctuation/bullets/quotes)
  s = s
    .replace(/^[\s·•\-\–—\*\.,;:(){}\[\]"“”'’]+/g, '')
    .replace(/[\s·•\-\–—\*\.,;:(){}\[\]"“”'’]+$/g, '');

  // 2) enlève emojis/pictos en bordure (plus agressif mais safe)
  s = stripEdgeEmojisAndPunct(s);

  // 3) retire ponctuation de fin type "!!!", "…", "??"
  s = s.replace(/[.!?…]+$/g, '');

  // 4) re-nettoyage bord (au cas où)
  //s = stripEdgeEmojisAndPunct(s);

  s = normalizeTitleCandidate(s);

  return normSpaces(s);
}

function stripOcrTitleArtifacts(input) {
  let t = String(input || '').trim();
  if (!t) return t;

  // Normalise un peu avant de nettoyer
  t = t.replace(/\s+/g, ' ').trim();

  // 2) Enlève "_Ipetit" (ou "_Xxxxx") quand c’est un token isolé (souvent OCR)
  t = t.replace(/\s+\b_[A-Za-zÀ-ÖØ-öø-ÿ]{3,}\b\s*$/g, '').trim();

  // 3) Variantes "I petit" / "_Ipetit" (OCR fréquent)
  t = t.replace(/\s+\bI\s*petit\b\s*$/i, '').trim();
  t = t.replace(/\s+\b_Ipetit\b\s*$/i, '').trim();

  // 1) Enlève les tokens du type "C.R" / "C.R." quand c’est un token isolé
  // (On le retire surtout s’il est à la fin ou précédé d’un espace)
  t = t.replace(/\s+\b[A-Z]\.[A-Z](?:\.)?\b\s*$/g, '').trim();

  // Nettoyage final
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

module.exports = {
    BAD_TITLE_WORDS,
    EMOTIONAL_TITLE_PATTERNS,
    isMetaInfoLineForTitle,
    isTitleNoiseLabel,
    isGenericSiteTitle,
    looksLikePlausibleTitleLine,
    canJoinTitleLines,
    isBadTitleCandidate,
    isBlacklistedUiTitle,
    sanitizePickedTitle,
    looksLikeEmotionalHookTitle,
    looksLikeStepTitle,
    looksLikeLooseActionStep,
    looksLikeIngredientOnlyTitle,
    looksLikeHookOrLongSentenceTitle,
    looksLikeMeasureLineTitle,
    looksTruncatedTitle,
    visionLooksLikeSuffix,
    stripEdgeEmojisAndPunct,
    cleanTitleCandidate,
    stripOcrTitleArtifacts,
}