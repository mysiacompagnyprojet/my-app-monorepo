

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

const DEFAULT_TITLE = 'Recette importée';


function normalizeTitleJoinPiece(s) {
  // Nettoyage léger spécifique "titre"
  let t = cleanTitleCandidate(s);
  t = sanitizePickedTitle(t);

  // remplace les "+" OCR qui servent souvent de séparateur
  t = t.replace(/\s*\+\s*/g, ' ');

  // retire les étoiles/bullets décoratifs en fin (ex: "Cannelle⭑")
  t = t.replace(/[⭑★☆✦✧✨]+$/g, '');

  return normSpaces(t);
}

function isMetaInfoLineForTitle(s) {
  const t = stripDiacritics(normSpaces(s)).toLowerCase();
  if (!t) return false;

  //labels/meta
  if (
    /^(portions?|portion|temps|calories?|cuisson|difficulte|difficulté|prep|prépa|preparation|préparation)\b/.test(t)
  ) return true;

  // formes "temps:" "portions"
  if (
    /^(portions?|temps|calories?|cuisson|difficulte|difficulté)\b\s*[---]/.test(t)
  ) return true;

  // durées isolées
  if (
    /^\d+\s*(h|heure|heures|min|mins|minute|minutes)\b/.test(t)
   
  ) return true;

  return false;
}

// Détecte les lignes "meta" qui ne doivent JAMAIS être des titres.
// Exemples : "Temps de préparation : 25mn", "Cuisson : 25 mn", "Difficulté: Très facile", "Portions", "Calories"
function isMetaInfoLineForTitle(line) {
  // On normalise les espaces (ex: espaces multiples -> 1 seul espace)
  const t = normSpaces(String(line || ''));
  // Si vide -> pas meta (mais ça ne sera pas un titre non plus)
  if (!t) return false;

  // On passe en minuscule pour comparer sans se soucier des majuscules
  const low = t.toLowerCase();

  return (
    /^temps\b.*s/i.test(low) ||
    /^cuisson\b.*s/i.test(low) ||
    /^difficult[eé]?\b/i.test(low) ||
    /^portions?\b/i.test(low) ||
    /^calories?\b/i.test(low)
  );
}

function isTitleNoiseLabel(line) {
  const t = normSpaces(line);
  if (!t) return false;

  // Un seul "mot" tout en majuscules, court => souvent un label déco (FARINE, SUCRE, LEVURE...)
  if (/^[A-ZÀ-ÖØ-Þ]{3,12}$/.test(t)) return true;

  return false;
}
function isTitleNoiseLabel(line) {
  const t = normSpaces(String(line || ''));
  if (!t) return false;

  const low = t.toLowerCase();
  if (
    /^[a-zà-öø-ÿ'-]{3,12}$/i.test(t) &&
    [
      'farine',
      'sucre',
      'levure',
      'beurre',
      'sel',
      'poivre',
      'huile',
      'lait',
      'oeufs',
      'Œufs',
    ].includes(low)
  ) {
    return true;
  }

  // 1 seul mot, tout en majuscules, court => typique label déco
  if (/^[A-ZÀ-ÖØ-Þ]{3,12}$/.test(t)) return true;
  // "Recette" / "Recettes"
  if (/^recettes?$/i.test(t)) return true;

  // "de Wendy", "de Marine", etc. (auteur)
  if (/^de\s+[a-zà-öø-ÿ'-]{2,}$/i.test(t)) return true;

  return false;
}

function looksLikePlausibleTitleLine(line) {
  const t = cleanTitleCandidate(line);
  if (!t) return false;

  // pas un header/temps/servings
  if (isIngredientsHeader(t)) return false;
  if (isPreparationHeader(t)) return false;
  if (extractServingsFromLine(t)) return false;
  if (looksLikeTimeInfoLine(t)) return false;

  // pas une étape / pas un ingrédient
  if (looksLikeStepLine(t)) return false;
  if (parseOcrIngredient(t)) return false;

  // longueur réaliste, pas de digits
  if (t.length < 6 || t.length > 90) return false;
  if (/\d/.test(t)) return false;

  // évite titres génériques
  if (isGenericSiteTitle(t)) return false;

  // doit contenir au moins une lettre
  if (!/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(t)) return false;

  return true;
}

function canJoinTitleLines(prev, next) {
  const a = normSpaces(prev);
  const b = normSpaces(next);
  if (!a || !b) return false;

  // pas de join si l'une des lignes est "meta"
  if (isIngredientsHeader(b) || isPreparationHeader(b) || extractServingsFromLine(b)) return false;
  if (looksLikeTimeInfoLine(b)) return false;
  if (looksLikeStepLine(b) || parseOcrIngredient(b)) return false;

  // heuristiques de collage (lignes de titre souvent courtes)
  const aEndsOpen = /[,/&+–—-]\s*$/.test(a) || /\b(et|de|d['’]|du|des|à|a)\s*$/i.test(a);

  const bLooksContinuation = /^[A-ZÀ-ÖØ-Þa-zà-öø-ÿ]/.test(b) && !/^\d/.test(b) && b.length <= 60;

  // on colle si :
  // - la 1ère finit "ouverte" (virgule, &, +, "à", "de", etc.)
  // - OU la 1ère est courte et la 2e ressemble clairement à une continuation
  if (aEndsOpen) return true;
  if (a.length <= 40 && bLooksContinuation) return true;

  return false;
}

function canJoinTitleLines(prev, next) {
  const a = normSpaces(prev);
  const b = normSpaces(next);
  if (!a || !b) return false;

  if (/^ingr[ée]dients?\b/i.test(b)) return false;
  if (/^(préparation|preparation|instructions?)\b/i.test(b)) return false;
  if (/\b(temps|cuisson|portions?|calories?)\b/i.test(b)) return false;

  if (parseOcrIngredient(b)) return false;
  if (looksLikeStepTitle(b)) return false;

  const aEndsOpen = /[,/&+–—-]\s*$/.test(a) || /\b(et|de|d['’]|du|des|à|a)\s*$/i.test(a);
  const bLooksContinuation = /^[A-ZÀ-ÖØ-Þa-zà-öø-ÿ]/.test(b) && !/^\d/.test(b) && b.length <= 60;

  if (aEndsOpen) return true;
  if (a.length <= 40 && bLooksContinuation) return true;

  return false;
}

function normSpaces(s) {
  return String(s || '')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function isBadTitleCandidate(s) {
  if (!s) return true;
  const t = String(s).trim().toLowerCase();
  if (!t) return true;
  if (/^sauce\s+/i.test(t)) return false;

  // ❌ Si le titre commence par une info meta ("temps:", "cuisson:", "difficulté:", etc.) -> ce n'est pas un titre de recette
  // ^ = début de la chaîne \b = limite de mot (évite des faux positifs) \s* = espaces optionnels [:–—-]? = ponctuation possible après le mot
  if (/^(temps|cuisson|difficult[ée]|difficulte|portions?|calories?)\b\s*[:–—-]/i.test(t)) {
    return true;
  }

  // domaine / site
  if (t.includes('.com') || t.includes('.fr')) return true;

  // mots exacts bloqués (UI / sections)
  if (BAD_TITLE_WORDS.includes(t)) return true;

  // commence par un chiffre
  if (/^\d/.test(t)) return true;

  //ajoute le 20/01 - rejete si le titre est uniquement une unité
  if (/^(ml|cl|dl|l|g|gr|kg)$/i.test(t.trim())) return true;

  // commence par quantité + unité
  if (/^\d+([.,]\d+)?\s*(g|gr|kg|ml|cl|dl|l)\b/i.test(t)) return true;

  // contient une unité -> souvent un ingrédient / bruit
  //remplacer par le if du dessus le 20/01 - if (/\b(g|gr|kg|ml|cl)\b/i.test(t)) return true;

  // accroches émotionnelles
  return EMOTIONAL_TITLE_PATTERNS.some((r) => r.test(t));
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

module.export = {
    BAD_TITLE_WORDS,
    EMOTIONAL_TITLE_PATTERNS,
    DEFAULT_TITLE,
    normalizeTitleJoinPiece,
    isMetaInfoLineForTitle,
    isMetaInfoLineForTitle,
    isTitleNoiseLabel,
    isTitleNoiseLabel,
    looksLikePlausibleTitleLine,
    canJoinTitleLines,
    normSpaces,
    isBadTitleCandidate,
    isBlacklistedUiTitle,
}