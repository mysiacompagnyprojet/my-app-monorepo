// backend/src/utils/ocrText.js
'use strict';

function normSpaces(s) {
  return String(s || '')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function stripWeird(s) {
  return String(s || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r/g, '');
}

/* =========================
   TRASH / NOISE (iPhone + Social)
========================= */

function looksLikeEditorialNoise(line) {
  const t = normSpaces(line).toLowerCase();
  if (!t) return true;

  // phrases marketing / éditoriales
  if (
    /\b(tiktok|instagram|facebook|bonne maman|marmiton|yumrecette)\b/i.test(t) ||
    /\b(léger|riche|irrésistible|délicieux|savoureux)\b/i.test(t) &&
    !looksLikeStepLine(t) &&
    !parseOcrIngredient(t)
  ) {
    return true;
  }

  // mentions légales / sources
  if (
    /\b(source|droits d'auteur|copyright|©|tous droits réservés)\b/i.test(t)
  ) {
    return true;
  }

  return false;
}

function looksLikeBookRefNoise(line) {
  const t = normSpaces(line).toLowerCase();
  return /\bvoir\s+p\.?\s*\d+\b/.test(t);
}

// Exemple: "Préparation : 45 min ... 304"
function stripTrailingPageNumber(line) {
  let t = normSpaces(line);

  // retire un numéro final si le texte contient un marqueur de temps
  if (/\b(préparation|preparation|cuisson|min)\b/i.test(t)) {
    t = t.replace(/\s+\d{2,4}\s*$/g, '');
  }

  return normSpaces(t);
}

function looksLikeStatusBarNoise(line) {
  const t = normSpaces(line);

  if (/^\d{1,2}:\d{2}$/.test(t)) return true;
  if (/\b(4g|5g|lte|wifi|wi-fi)\b/i.test(t) && /\b\d{1,3}\b/.test(t)) return true;
  if (/^\d{1,3}%$/.test(t)) return true;

  return false;
}

// ✅ A) bruit "date" type "8 mai", "12 sept.", etc.
function looksLikeDateNoise(line) {
  const t = normSpaces(line).toLowerCase();
  if (!t) return false;

  const months =
    '(janv\\.?|janvier|fevr\\.?|févr\\.?|février|mars|avr\\.?|avril|mai|juin|juil\\.?|juillet|aout\\.?|août\\.?|sept\\.?|septembre|oct\\.?|octobre|nov\\.?|novembre|dec\\.?|déc\\.?|décembre)';
  const re = new RegExp(`^\\d{1,2}\\s+${months}(?:\\s+\\d{4})?\\b`, 'i');

  return re.test(t);
}

// ✅ bruit "compteurs" Facebook/IG du style "4681 Q 159 2630"
function looksLikeCountersNoise(line) {
  const t = normSpaces(line);
  if (!t) return false;

  // ex: "4681 Q 159 2630" / "Q 159 2630"
  const hasQ = /\bq\b/i.test(t);
  const nums = (t.match(/\d+/g) || []).length;

  // "Q" + au moins 2 nombres => bruit UI
  if (hasQ && nums >= 2) return true;

  return false;
}

function looksLikeSocialNoise(line) {
  const t = normSpaces(line).toLowerCase();

  if (/@[a-z0-9._-]{2,}/i.test(t)) return true;
  if (/#\w{2,}/.test(t)) return true;

  if (/https?:\/\//i.test(t) || /\bwww\./i.test(t)) return true;

  if (/\b\d{1,9}\s*(likes?|j’aime|j'aime|comments?|commentaires?)\b/i.test(t)) return true;

  const patterns = [
    'toutes les publications',
    'voir plus',
    'afficher la suite',
    'voir la traduction',
    'traduction',
    'répondre',
    'envoyer',
    'partager',
    's’abonner',
    "s'abonner",
    'abonne-toi',
    'abonne toi',
    'abonnez-vous',
    'abonnez vous',
    'publicité',
    'sponsorisé',
    'sponsorisee',
    'collaboration commerciale',
    'publication sponsorisée',
    'contenu sponsorisé',
    'paid partnership',
    'sponsored content',
    'link in bio',
    'swipe up',
    'shop now',
    'save this post',
    'save recipe',
    'comment below',
    'send to a friend',
    'follow for more',
    'original sound',
    'reposted from',
    'open app',
    'ouvrir l’app',
    "ouvrir l'app",
    'sign in',
    'log in',
    'subscribe to unlock',
    'notifications activées',
    'activer les notifications',
    'fermer',
    'retour',
  ];

  if (patterns.some((p) => t.includes(p))) return true;

  const emojiCount = (t.match(/[\u{1F300}-\u{1FAFF}]/gu) || []).length;
  if (emojiCount >= 4 && t.length < 50) return true;

  if (
    /\bon raffole\b/i.test(t) ||
    /\bvous devez absolument\b/i.test(t) ||
    /\btestez\b/i.test(t) ||
    /\bcuisineactuelle\b/i.test(t) ||
    (/\brecette de\b/i.test(t) && t.includes('@'))
  ) {
    return true;
  }

  return false;
}

function stripSocialHeaderPrefix(line) {
  let t = normSpaces(line);

  // "Publication de ..."
  t = t.replace(/^publication\s+de\s+/i, '').trim();

  // ✅ NEW: retire page name courant si collé devant le titre
  // ex "Recettes et Délices Mini Croque-Monsieur Apéritif"
  t = t.replace(/^recettes?\s*(?:et|&)\s*d[ée]lices?\b/i, '').trim();

  // ✅ NEW: nettoyage emojis/pictos au bord
  t = stripEdgeEmojisAndPunct(t);

  return normSpaces(t);
}

// ✅ Facebook: "Publication de <Page>" parfois collé au titre
//function stripSocialHeaderPrefix(line) {
//  let t = normSpaces(line);

  // Ex: "Publication de Recettes et Délices Mini Croque-Monsieur Apéritif"
  // Ex: "Publication de Recettes et Délices" (seul) -> on n'en fera rien
 // t = t.replace(/^publication\s+de\s+/i, '').trim();

  // Si ça commence encore par un nom de page "Recettes et Délices" + le titre derrière,
  // on ne peut pas connaître exactement où couper. On garde tout pour analyse,
  // mais on filtrera ensuite avec "looksLikePlausibleTitleLine".
 // return normSpaces(t);
//}

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

// ✅ helper unités seules (évite que "g" parte à la corbeille)
function isUnitToken(line) {
  const t = normSpaces(line);
  return /^(g|kg|mg|ml|cl|dl|l)$/i.test(t);
}

// ✅ bruit "page seule" (ex: "304")
function looksLikePageNumberOnly(line) {
  const t = normSpaces(line);
  return /^\d{2,4}$/.test(t);
}

function isMostlyNoise(line) {
  const t = normSpaces(line);
  if (!t) return true;

  // ✅ PATCH: ne pas jeter les unités seules ("g", "ml", etc.)
  if (isUnitToken(t)) return false;

  if (t.length <= 1) return true;

  const letters = (t.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g) || []).length;
  const digits = (t.match(/\d/g) || []).length;
  if (letters + digits === 0) return true;

  return false;
}

/* =========================
   DEDUP (cross-captures)
========================= */

function normalizeForDedup(line) {
  return normSpaces(line)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupeLines(lines) {
  const seen = new Set();
  const out = [];

  for (const l of lines) {
    const key = normalizeForDedup(l);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out;
}

/**
 * PATCH OCR (livres papier)
 * Recolle les mots coupés par un retour à la ligne avec tiret.
 */
function mergeHyphenWrappedLines(lines) {
  const out = [];
  for (const raw of lines) {
    const line = normSpaces(raw);
    if (!line) continue;

    const prev = out.length ? out[out.length - 1] : '';

    if (prev && /-$/.test(prev) && /^[a-zà-öø-ÿ]/i.test(line)) {
      out[out.length - 1] = normSpaces(prev.replace(/-$/, '') + line);
      continue;
    }

    out.push(line);
  }
  return out;
}

/* =========================
   CLEAN + TRASH
========================= */
//
function smartFilterWithTrashFromText(rawText) {
const cleaned = stripWeird(rawText);

// ✅ rawLines DOIT être déclaré ici
let rawLines = cleaned
.split('\n')
.map((s) => normSpaces(s))
.filter(Boolean);

rawLines = mergeHyphenWrappedLines(rawLines);

const lines = [];
const trash = [];

for (let i = 0; i < rawLines.length; i++) {
let l = rawLines[i];
l = stripTrailingPageNumber(l);

// ✅ PATCH: ne pas jeter une quantité seule si elle touche une unité
if (looksLikePageNumberOnly(l)) {
const prev = i > 0 ? rawLines[i - 1] : '';
const next = i + 1 < rawLines.length ? rawLines[i + 1] : '';

const prevIsUnit = isUnitToken(prev);
const nextIsUnit = isUnitToken(next);

if (prevIsUnit || nextIsUnit) {
lines.push(l);
continue;
}

trash.push(l);
continue;
}

if (isMostlyNoise(l)) {
trash.push(l);
continue;
}

if (looksLikeStatusBarNoise(l)) {
trash.push(l);
continue;
}

if (looksLikeDateNoise(l)) {
trash.push(l);
continue;
}

if (looksLikeCountersNoise(l)) {
trash.push(l);
continue;
}

if (looksLikeSocialNoise(l)) {
if (/^publication\s+de\s+/i.test(l)) {
const salvaged = stripSocialHeaderPrefix(l);
if (looksLikePlausibleTitleLine(salvaged)) {
lines.push(salvaged);
continue;
}
}
trash.push(l);
continue;
}

if (looksLikeBookRefNoise(l)) {
const m = l.match(/(\(.*?\bvoir\s+p\.?\s*\d+.*?\))|\bvoir\s+p\.?\s*\d+\b/i);
if (m && m[0]) trash.push(normSpaces(m[0]));
const cleanedLine = normSpaces(
l
.replace(/\(.*?\bvoir\s+p\.?\s*\d+.*?\)/gi, '')
.replace(/\bvoir\s+p\.?\s*\d+\b/gi, '')
);
if (cleanedLine && !isMostlyNoise(cleanedLine)) lines.push(cleanedLine);
continue;
}

if (looksLikeEditorialNoise(l)) {
  trash.push(l);
  continue;
}

lines.push(l);
}

return {
rawText: cleaned,
lines: dedupeLines(lines),
trash: dedupeLines(trash),
};
}
//
/* =========================
   SERVINGS / HEADERS
========================= */

function extractServingsFromLine(line) {
  const t = normSpaces(line).toLowerCase();

  let m = t.match(/ingr[ée]dients?\s+pour\s+(\d+)\s*(personnes|parts|portions)\b/i);
  if (m) return parseInt(m[1], 10);

  m = t.match(/\bpour\s+(\d+)\s*(personnes|parts|portions)\b/i);
  if (m) return parseInt(m[1], 10);

  m = t.match(/\bpour\s+(\d+)\s*(?:-|à|a)\s*(\d+)\s*(personnes|parts|portions)\b/i);
  if (m) return Math.max(parseInt(m[1], 10), parseInt(m[2], 10));

  m = t.match(/\bpour\s+(\d+)\s*personnes?\b.*\bil\b.*\bfaut\b/i);
  if (m) return parseInt(m[1], 10);

  // ✅ Facebook: "Portions : Environ 16 mini croques"
  m = t.match(/\bportions?\s*[:\-–—]?\s*(?:environ\s*)?(\d+)\b/i);
  if (m) return parseInt(m[1], 10);

  return null;
}

function isIngredientsHeader(line) {
  const t = normSpaces(line).toLowerCase();
  if (/^ingr[ée]dients?\b/.test(t)) return true;
  if (/^ingr[ée]dients?\s+pour\s+\d+\s*/.test(t)) return true;
  if (/^pour\s+\d+\s*personnes?\b.*\bil\b.*\bfaut\b/.test(t)) return true;
  return false;
}

function isPreparationHeader(line) {
  const t = normSpaces(line).toLowerCase();
  return /^préparation\b/.test(t) || /^preparation\b/.test(t) || /^instructions?\b/.test(t);
}

function looksLikeTimeInfoLine(line) {
  const t = normSpaces(line).toLowerCase();
  if (!t) return false;

  // Exemples acceptés :
  // "Préparation : 45 min" / "preparation 45 min"
  // "Cuisson : 20 minutes"
  // "Temps de préparation 15 minutes"
  const hasKeyword = /\b(préparation|preparation|cuisson|temps\s+de\s+préparation|temps\s+de\s+cuisson)\b/i.test(t);
  if (!hasKeyword) return false;

  // ✅ PATCH: accepte "minute(s)" en plus de "min"
  const hasDuration = /\b\d+\s*(min|mn|mns|minute|minutes|h|heure|heures)\b/i.test(t);

  return hasDuration;
}

/* =========================
   STEP / INGREDIENT HEURISTICS
========================= */

function looksLikeListBullet(line) {
  const t = normSpaces(line);
  return /^[-•*]\s+/.test(t);
}

function looksLikeStepVerbLine(line) {
  const t = normSpaces(line);
  if (!t) return false;

  return /\b(coupez|couper|lavez|laver|plongez|plonger|égouttez|egouttez|faites|faire|ajoutez|ajouter|mélangez|melangez|versez|remuez|salez|poivrez|assaisonnez|assaisonner|étalez|etalez|étaler|etaler|tartinez|tartiner|recouvrez|recouvrir|garnissez|garnir|nappez|saupoudrez|enfournez|laissez|poursuivez|servez|cuisez|cuire|chauffez|chauffer|préchauffez|prechauffez|préparez|preparez|préparer|preparer|montez|monter|disposer|disposez)\b/i.test(
  t
);
}
  //return /\b(coupez|couper|lavez|laver|plongez|plonger|égouttez|egouttez|faites|faire|ajoutez|ajouter|mélangez|melangez|versez|remuez|salez|poivrez|déposez|deposez|nappez|saupoudrez|enfournez|laissez|poursuivez|servez|cuisez|cuire|chauffez|chauffer|préparer|préparez|preparez|employer|utiliser|disposer|disposez|assaisonner|assaisonnez|étaler|étalez)\b/i.test(
  //  t
  //);
//}

// ✅ phrases d'action “sans numérotation”
function looksLikeActionSentence(line) {
  const t = normSpaces(line).toLowerCase();
  return /\b(bien\s+mélanger|couvrir|cuire|laisser|retirer|poursuivre|réchauffer|servir|préchauffer|étaler|étalez|etalez|détailler|dorer|déposer|fendre|farci[er]|passer|préparer|preparez|préparez|employer|utiliser|assaisonner)\b/i.test(
    t
  );
}

function looksLikeStepNumberedLine(line) {
  const t = normSpaces(line);
  if (!t) return false;
  if (/^\s*(étape|step)\s*\d+/i.test(t)) return true;
  if (/^\s*\d{1,2}\s*[\)\.\-:]/.test(t)) return true;
  return false;
}

function looksLikeStepLine(line) {
  return looksLikeStepVerbLine(line) || looksLikeStepNumberedLine(line);
}

function looksLikeStepContinuation(prevLine, line) {
  const prev = normSpaces(prevLine);
  const cur = normSpaces(line);
  if (!prev || !cur) return false;

  if (!looksLikeStepNumberedLine(prev)) return false;

  // ✅ continuation classique
  if (/^(le|la|les|l['’]|un|une|des|du|de|d['’]|au|aux|et|puis|ensuite|à|a)\b/i.test(cur)) return true;

  // ✅ Facebook: "recouverte..." / "immédiatement." après une étape numérotée
  if (/^[a-zà-öø-ÿ]/.test(cur)) return true;

  return false;
}

/* =========================
   STEP JOIN WRAPS
========================= */

function joinWrappedLinesForSteps(stepLines) {
  const out = [];
  let buffer = '';

  const flush = () => {
    const s = normSpaces(buffer);
    if (s) out.push(s);
    buffer = '';
  };

  for (const raw of stepLines) {
    const line = normSpaces(raw);

    const cleanedLine = normSpaces(line.replace(/^du commerce\)\.?\s*/i, ''));

    if (!cleanedLine) continue;

    if (isPreparationHeader(cleanedLine)) {
      flush();
      continue;
    }

    if (!buffer) {
      buffer = cleanedLine;
      continue;
    }

    const endsStrong = /[.!?…:]$/.test(buffer);
    const endsConnector = /\b(à|a|au|aux|de|d|d'|d’|des|du|sous|sur|puis|et)\s*$/i.test(buffer);

    const nextLooksContinuation =
      /^[a-zà-öø-ÿ’'"(]/.test(cleanedLine) ||
      /^\d/.test(cleanedLine) ||
      /^l['’]/i.test(cleanedLine) ||
      /^(puis|et|ensuite|alors|donc)\b/i.test(cleanedLine);

    if ((!endsStrong && nextLooksContinuation) || endsConnector) {
      buffer = `${buffer} ${cleanedLine}`;
    } else {
      flush();
      buffer = cleanedLine;
    }
  }

  flush();
  return out;
}

// ✅ Split "phrases" dans une étape quand elle contient plusieurs phrases.
// Objectif: éviter les lignes énormes type Facebook ("Étalez... Sur... Ajoutez... Recouvrez...").
// On ne split que si:
// - au moins 2 phrases (donc au moins 1 point suivi d'un espace)
// - ET la ligne est assez longue (sinon on laisse tranquille)
function splitStepsBySentences(steps) {
  const out = [];

  for (const s of steps || []) {
    const t = normSpaces(s);
    if (!t) continue;

    // trop court => on ne touche pas
    if (t.length < 140) {
      out.push(t);
      continue;
    }

    // On split sur ". " (point + espaces) en gardant le point.
    const parts = t
      .split(/(?<=\.)\s+/)
      .map(normSpaces)
      .filter(Boolean);

    // si ça ne produit pas au moins 2 morceaux, on garde tel quel
    if (parts.length < 2) {
      out.push(t);
      continue;
    }

    out.push(...parts);
  }

  return out;
}

function splitLongSteps(steps) {
  const out = [];
  for (const s of steps) {
    const t = normSpaces(s);
    if (t.length < 260) {
      out.push(t);
      continue;
    }

    const parts = t.split(/(?<=\.)\s+/).map(normSpaces).filter(Boolean);
    if (parts.length >= 2) out.push(...parts);
    else out.push(t);
  }
  return out;
}

/* =========================
   INGREDIENT PARSER (FR)
========================= */

/**
 * ✅ IMPORTANT (nouvelle règle)
 * - quantity => NUMBER (calculs)
 * - quantityRaw => STRING (affichage exact de ce que l'OCR a lu)
 *
 * Donc on sépare :
 * - parseQuantityToNumber() : retourne un number
 * - normalizeQuantityRawForDisplay() : retourne une string (ex: "1/2", "0,5", "0.5")
 */

function normalizeQuantityRawForDisplay(q) {
  let s = normSpaces(q);
  if (!s) return '';

  // garde la virgule si l'OCR l'a donnée (0,5)
  // mais convertit les fractions unicode vers "1/2", etc.
  const uni = {
    '½': '1/2',
    '⅓': '1/3',
    '⅔': '2/3',
    '¼': '1/4',
    '¾': '3/4',
    '⅛': '1/8',
    '⅜': '3/8',
    '⅝': '5/8',
    '⅞': '7/8',
  };

  if (uni[s]) return uni[s];

  // Normalise juste les espaces autour du "/"
  s = s.replace(/\s*\/\s*/g, '/');

  // Normalise espaces dans "1  1/2"
  s = s.replace(/\s+/g, ' ').trim();

  return s;
}

function parseQuantityToNumber(q) {
  const t = normSpaces(q).toLowerCase();
  if (!t) return null;

  // unicode -> ascii fraction
  const uni = {
    '½': '1/2',
    '⅓': '1/3',
    '⅔': '2/3',
    '¼': '1/4',
    '¾': '3/4',
    '⅛': '1/8',
    '⅜': '3/8',
    '⅝': '5/8',
    '⅞': '7/8',
  };

  let s = uni[t] ? uni[t] : t;

  // "1 1/2"
  let m = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (m) {
    const a = parseFloat(m[1]);
    const b = parseFloat(m[2]);
    const c = parseFloat(m[3]);
    if (Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && c !== 0) return a + b / c;
  }

  // "1/2"
  m = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (m) {
    const a = parseFloat(m[1]);
    const b = parseFloat(m[2]);
    if (Number.isFinite(a) && Number.isFinite(b) && b !== 0) return a / b;
  }

  // "4-6" => max
  m = s.match(/(\d+(?:[.,]\d+)?)\s*(?:-|à|a)\s*(\d+(?:[.,]\d+)?)/i);
  if (m) {
    const a = parseFloat(String(m[1]).replace(',', '.'));
    const b = parseFloat(String(m[2]).replace(',', '.'));
    if (Number.isFinite(a) && Number.isFinite(b)) return Math.max(a, b);
  }

  // nombre simple "0,5" ou "0.5" ou "2"
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function normalizeUnit(u) {
  const t = normSpaces(u).toLowerCase();

  if (['g', 'gr', 'gramme', 'grammes'].includes(t)) return 'g';
  if (['kg', 'kilo', 'kilos'].includes(t)) return 'kg';
  if (['ml'].includes(t)) return 'ml';
  if (['cl'].includes(t)) return 'cl';
  if (['dl'].includes(t)) return 'dl';
  if (['l', 'litre', 'litres'].includes(t)) return 'l';

  if (t === 'cas' || t === 'càs' || t === 'cs' || (t.includes('cuill') && t.includes('soupe'))) return 'càs';
  if (t === 'cac' || t === 'càc' || t === 'cc' || (t.includes('cuill') && (t.includes('cafe') || t.includes('café'))))
    return 'càc';

  if (t.includes('pinc')) return 'pincée';
  if (t.includes('gousse')) return 'gousse';
  if (t.includes('tranch')) return 'tranche';
  if (t.includes('sachet')) return 'sachet';
  if (t.includes('paquet')) return 'paquet';
  if (t.includes('boite') || t.includes('boîte')) return 'boîte';
  if (t.includes('verre')) return 'verre';
  if (t.includes('tasse')) return 'tasse';
  if (t.includes('pièce') || t.includes('piece') || t === 'u') return 'pièce';

  return t || '';
}

const QTY_USED =
  '([0-9]+(?:[.,][0-9]+)?|[0-9]+\\s+[0-9]+\\/[0-9]+|[0-9]+\\/[0-9]+|½|⅓|⅔|¼|¾|⅛|⅜|⅝|⅞)';

const CUILL_RE = 'cuill(?:e|è)re(?:s)?';

function postProcessIngredientName(name) {
  let n = normSpaces(name);

  if (/^huile\s+olive\b/i.test(n)) n = n.replace(/^huile\s+olive\b/i, "huile d'olive");
  n = n.replace(/^de\s+/i, '');

  n = n.replace(/\s+\d{3,6}\s*$/g, '');

  n = n.replace(/\bRecoltos\b/gi, '');
  n = n.replace(/\bDélico\b/gi, '');
  n = n.replace(/\bDelico\b/gi, '');
  n = n.replace(/\bRecettes?\s+Délice\b/gi, '');
  n = n.replace(/\bRecettes?\s+Delice\b/gi, '');

  return normSpaces(n);
}

function fixCommonOcrQuantityUnitBugs(rawLine) {
  let s = normSpaces(rawLine);

  s = s.replace(/\bc\.\s*à\s*soupe\b/gi, 'càs');
  s = s.replace(/\bc\s*à\s*soupe\b/gi, 'càs');
  s = s.replace(/\bc\.\s*a\s*soupe\b/gi, 'càs');

  s = s.replace(/\bc\.\s*à\s*caf[ée]\b/gi, 'càc');
  s = s.replace(/\bc\s*à\s*caf[ée]\b/gi, 'càc');
  s = s.replace(/\bc\.\s*a\s*caf[ée]\b/gi, 'càc');

  s = s.replace(/\(.*?\bvoir\s+p\.?\s*\d+.*?\)/gi, '');
  s = s.replace(/\bvoir\s+p\.?\s*\d+\b/gi, '');

  s = s.replace(/^(kg|g|mg|ml|cl|dl|l)\s+(\d+(?:[.,]\d+)?)\s+(de|d['’])\b/i, '$2 $1 $3');

  s = s.replace(/\b11\s+(de|d['’])\s*(lait|eau|crème|creme)\b/i, '1 l $1 $2');
  s = s.replace(/\b1l\b/gi, '1 l');
  s = s.replace(/^[·•\.\,\;\:\-–—]+\s*/g, '');

  return s;
}

function parseOcrIngredient(line) {
  const raw0 = normSpaces(line);
  if (!raw0) return null;

  // ✅ bruit OCR fréquent : "Og" / "0g" isolé
  if (/^o[gq]$/i.test(raw0) || /^0\s*g$/i.test(raw0)) return null;

  const raw = fixCommonOcrQuantityUnitBugs(raw0);

  if (isIngredientsHeader(raw)) return null;
  if (isPreparationHeader(raw)) return null;

  if (looksLikeDateNoise(raw)) return null;
  if (looksLikeCountersNoise(raw)) return null;
  if (looksLikeSocialNoise(raw)) return null;

  if (looksLikeStepLine(raw)) return null;

  let m = raw.match(/^(un peu de|selon goût|au goût)\s+(.+)$/i);
  if (m) {
    return { name: postProcessIngredientName(m[2]), quantity: 0, unit: '' };
  }

  const l = raw.replace(/^[-•*]\s+/, '');

  if (/^sel\s*&\s*poivre$/i.test(l)) {
    return { name: 'sel', quantity: 0, unit: '' };
  }
  if (/^poivre$/i.test(l)) {
    return { name: 'poivre', quantity: 0, unit: '' };
  }

  // "X g/ml/... de ..."
  m = l.match(new RegExp(`^${QTY_USED}\\s*(kg|g|mg|l|dl|cl|ml)\\b\\s*(?:de\\s+|d['’]\\s*)?(.+)$`, 'i'));
  if (m) {
    const qtyRaw = normalizeQuantityRawForDisplay(m[1]);
    const qtyNum = parseQuantityToNumber(m[1]);
    const unit = normalizeUnit(m[2]);
    const name = postProcessIngredientName(m[3]);
    if (name) return { name, quantity: qtyNum ?? 0, quantityRaw: qtyRaw || undefined, unit };
  }

  // cuillère à café
  m = l.match(
    new RegExp(
      `^${QTY_USED}\\s+(?:${CUILL_RE}\\s*(?:à|a)\\s*caf(?:e|é)|c\\.?\\s*(?:à|a)\\s*c\\.?|càc|cac|cc)\\s*(?:de|d['’])?\\s*(.+)$`,
      'i'
    )
  );
  if (m) {
    const qtyRaw = normalizeQuantityRawForDisplay(m[1]);
    const qtyNum = parseQuantityToNumber(m[1]);
    const name = postProcessIngredientName(m[2]);
    if (name) return { name, quantity: qtyNum ?? 0, quantityRaw: qtyRaw || undefined, unit: 'càc' };
  }

  // cuillère à soupe
  m = l.match(
    new RegExp(
      `^${QTY_USED}\\s+(?:${CUILL_RE}\\s*(?:à|a)\\s*soupe|c\\.?\\s*(?:à|a)\\s*s\\.?|càs|cas|cs)\\s*(?:de|d['’])?\\s*(.+)$`,
      'i'
    )
  );
  if (m) {
    const qtyRaw = normalizeQuantityRawForDisplay(m[1]);
    const qtyNum = parseQuantityToNumber(m[1]);
    const name = postProcessIngredientName(m[2]);
    if (name) return { name, quantity: qtyNum ?? 0, quantityRaw: qtyRaw || undefined, unit: 'càs' };
  }

  // unités “humaines”
  m = l.match(/^(\d+)\s+(gousses?|tranches?|sachets?|verres?|tasses?|pièces?|pieces?)\s+(?:de\s+|d['’])?(.+)$/i);
  if (m) {
    const qtyRaw = normalizeQuantityRawForDisplay(m[1]);
    const qtyNum = parseQuantityToNumber(m[1]);
    const unit = normalizeUnit(m[2]);
    const name = postProcessIngredientName(m[3]);
    if (name) return { name, quantity: qtyNum ?? 0, quantityRaw: qtyRaw || undefined, unit: unit || '' };
  }

  // Quantité + nom sans unité : "1/2 blanc de poireau"
  m = l.match(new RegExp(`^${QTY_USED}\\s+(.+)$`, 'i'));
  if (m) {
    const qtyRaw = normalizeQuantityRawForDisplay(m[1]);
    const qtyNum = parseQuantityToNumber(m[1]);
    let name = postProcessIngredientName(m[2]);

    if (/^(min|mins|minute|minutes)\b/i.test(name)) return null;

    if (looksLikeActionSentence(name) || looksLikeStepVerbLine(name) || looksLikeStepLine(name)) return null;

    if (name) return { name, quantity: qtyNum ?? 0, quantityRaw: qtyRaw || undefined, unit: 'pièce' };
  }

  // fallback
  m = l.match(/^(\d+)\s+(.+)$/);
  if (m) {
    const qtyRaw = normalizeQuantityRawForDisplay(m[1]);
    const qtyNum = parseQuantityToNumber(m[1]);
    const name = postProcessIngredientName(m[2]);
    if (name) return { name, quantity: qtyNum ?? 0, quantityRaw: qtyRaw || undefined, unit: 'pièce' };
  }

  return null;
}

function beautifyIngredients(items) {
  const list = Array.isArray(items) ? items.map((x) => ({ ...x })) : [];

  const idxButter = list.findIndex((it) => /\bbeurre\s+de\s+cacahu[eé]te\b/i.test(normSpaces(it?.name)));
  const idxPeanuts = list.findIndex((it) => /\bcacahu[eé]tes?\b/i.test(normSpaces(it?.name)));

  if (idxButter >= 0) {
    let bn = normSpaces(list[idxButter].name || '');

    bn = bn.replace(/\bRecettes?\s+Délice\b/gi, '').replace(/\bRecettes?\s+Delice\b/gi, '');
    bn = bn.replace(/\bRecoltos\b/gi, '').replace(/\bDélico\b/gi, '').replace(/\bDelico\b/gi, '');
    bn = bn.replace(/\s+\d{3,6}\s*$/g, '');

    const m = bn.match(/\bbeurre\s+de\s+cacahu[eé]te\b(.*)$/i);
    const tail = m ? normSpaces(m[1]) : '';

    bn = bn.replace(/\bbeurre\s+de\s+cacahu[eé]te\b.*$/i, 'beurre de cacahuete');
    list[idxButter].name = normSpaces(bn);

    if (tail && idxPeanuts >= 0) {
      const pn = normSpaces(list[idxPeanuts].name || '');
      const already = new RegExp(tail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(pn);
      if (!already) {
        list[idxPeanuts].name = normSpaces(`${pn} ${tail}`);
      }
    }
  }

  const out = [];
  const seen = new Set();

  for (const it of list) {
    const name = normSpaces(it.name || '');
    const quantityNum = Number(it.quantity || 0);
    const quantity = Number.isFinite(quantityNum) ? quantityNum : 0;
    const unit = it.unit == null ? '' : String(it.unit);
    const quantityRaw = typeof it.quantityRaw === 'string' ? normSpaces(it.quantityRaw) : '';

    if (!name) continue;

    // ✅ dedupe stable sur le number (calcul), pas sur l'affichage
    const key = `${name.toLowerCase()}|${unit.toLowerCase()}|${String(quantity)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const row = { name, quantity, unit };
    if (quantityRaw) row.quantityRaw = quantityRaw;

    out.push(row);
  }

  return out;
}

/* =========================
   TITLE (avec fallback sur ingrédients)
========================= */

function stripEdgeEmojisAndPunct(s) {
  let t = normSpaces(s);

  // retire emojis/pictos au début/fin (sans toucher au texte au centre)
  // (range large emojis + symboles fréquemment OCR)
  t = t
    .replace(/^[\s·•\-\–—\*\.\,\;\:\(\)\[\]{}"“”'’]+/g, '')
    .replace(/^[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]+/gu, '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]+$/gu, '')
    .replace(/[\s·•\-\–—\*\.\,\;\:\(\)\[\]{}"“”'’]+$/g, '');

  return normSpaces(t);
}

function cleanTitleCandidate(t) {
  let s = normSpaces(t);

  // ✅ NEW: enlève emojis/pictos en bordure
  s = stripEdgeEmojisAndPunct(s);

  s = s.replace(/[.!?…]+$/g, '');
  s = stripEdgeEmojisAndPunct(s);

  return normSpaces(s);
}
// (le reste de ton fichier title + split etc. est inchangé)
//function cleanTitleCandidate(t) {
 // let s = normSpaces(t);
 // s = s.replace(/^[·•\-\–—\*\.\,\;\:\s]+/g, '');
 // s = normSpaces(s);
 // s = s.replace(/[.!?…]+$/g, '');
 // return normSpaces(s);
//}

function isMostlyUppercaseTitle(line) {
  const t = normSpaces(line);
  if (!t) return false;
  if (t.length < 6 || t.length > 80) return false;
  if (/\d/.test(t)) return false;

  const letters = (t.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g) || []).length;
  if (!letters) return false;

  const upp = (t.match(/[A-ZÀ-ÖØ-Þ]/g) || []).length;
  return upp / letters >= 0.7;
}

function sanitizePickedTitle(title) {
  let t = normSpaces(title);
  if (!t) return '';

  t = t.replace(/\s*(?:\.\.\.|…)?\s*afficher la suite.*$/i, '');
  t = t.replace(/\s*(?:\.\.\.|…)\s*$/g, '');

  return normSpaces(t);
}

function isGenericSiteTitle(t) {
  const s = normSpaces(t).toLowerCase();
  if (s === 'recettes délice' || s === 'recettes delice') return true;
  if (/^recettes?\b/.test(s) && s.length <= 30) return true;
  return false;
}

function fabricateTitleFromIngredients(lines) {
  const L = lines.map(normSpaces).filter(Boolean);

  const scan = [];
  for (const l of L.slice(0, 60)) {
    if (isPreparationHeader(l)) break;
    scan.push(l);
  }

  const stopNames = new Set(['sel', 'poivre', 'eau', "eau d'", 'eau ', 'huile', "huile d'olive", 'beurre']);

  const found = [];
  const seen = new Set();

  for (const l0 of scan) {
    const l = normSpaces(l0);
    if (!l) continue;
    if (looksLikeStatusBarNoise(l) || looksLikeDateNoise(l) || looksLikeCountersNoise(l) || looksLikeSocialNoise(l)) continue;
    if (isIngredientsHeader(l) || extractServingsFromLine(l)) continue;
    if (looksLikeStepLine(l)) continue;

    const parsed = parseOcrIngredient(l);
    if (!parsed?.name) continue;

    const name = normSpaces(parsed.name).toLowerCase();
    if (!name) continue;

    if (stopNames.has(name)) continue;
    if (name.startsWith('eau')) continue;

    if (seen.has(name)) continue;
    seen.add(name);

    found.push(parsed.name);
    if (found.length >= 4) break;
  }

  if (found.length < 2) {
    for (const l0 of scan) {
      const l = normSpaces(l0);
      if (!l) continue;
      if (looksLikeStatusBarNoise(l) || looksLikeDateNoise(l) || looksLikeCountersNoise(l) || looksLikeSocialNoise(l)) continue;
      if (isIngredientsHeader(l) || extractServingsFromLine(l)) continue;
      if (looksLikeStepLine(l)) continue;

      const parsed = parseOcrIngredient(l);
      if (!parsed?.name) continue;

      const name = normSpaces(parsed.name).toLowerCase();
      if (!name) continue;
      if (name === 'sel' || name === 'poivre') continue;

      if (seen.has(name)) continue;
      seen.add(name);

      found.push(parsed.name);
      if (found.length >= 3) break;
    }
  }

  const top = found.slice(0, 3);
  if (top.length < 2) return null;

  const pretty = top.map((x) => normSpaces(x).toLowerCase());
  const title = pretty.length === 2 ? `${pretty[0]} & ${pretty[1]}` : `${pretty[0]}, ${pretty[1]} & ${pretty[2]}`;

  return title.charAt(0).toUpperCase() + title.slice(1);
}

function findExplicitTitleInFirstLines(lines, maxScan = 60) {
  const scan = lines.slice(0, maxScan).map(normSpaces).filter(Boolean);
  const candidates = [];

  for (let i = 0; i < scan.length; i++) {
    const raw = scan[i];

    const t0 = cleanTitleCandidate(raw);
    const t = sanitizePickedTitle(t0);
    if (!t) continue;

    if (isGenericSiteTitle(t)) continue;

    if (looksLikeStatusBarNoise(t)) continue;
    if (looksLikeDateNoise(t)) continue;
    if (looksLikeCountersNoise(t)) continue;
    if (looksLikeSocialNoise(t)) continue;

    if (isIngredientsHeader(t)) continue;
    if (isPreparationHeader(t)) continue;
    if (extractServingsFromLine(t)) continue;

    if (parseOcrIngredient(t)) continue;
    if (looksLikeStepLine(t)) continue;
    if (i > 0 && looksLikeStepContinuation(scan[i - 1], t)) continue;

    if (/^(sel|poivre|sel\s*&\s*poivre)\b/i.test(t)) continue;
    if (/^(temps|notes?)\b/i.test(t)) continue;

    if (t.length < 6 || t.length > 80) continue;
    if (/\d/.test(t)) continue;

    const hasUpper = /[A-ZÀ-ÖØ-Þ]/.test(t);
    const capsBonus = isMostlyUppercaseTitle(t) ? 80 : 0;

    if (/\b(et|de|d['’]|du|des|à|a)\s*$/i.test(t)) continue;

    candidates.push({
      t,
      score: capsBonus + (hasUpper ? 10 : 0) + (maxScan - i),
    });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].t;
}

function extractTitleFromStepHeader(lines) {
  const scan = (lines || []).slice(0, 80).map(normSpaces).filter(Boolean);

  for (const l of scan) {
    // ex: "4 Montez les mini Croque-Monsieur : Coupez ..."
    const m = l.match(/\b(montez|monter|préparez|preparez|préparer|preparer|réalisez|realisez|assemblez|assembler)\b\s+(?:le|la|les|l['’])\s+(.+?)\s*[:\-–—]/i);
    if (!m) continue;

    let candidate = cleanTitleCandidate(m[2]);
    candidate = sanitizePickedTitle(candidate);

    // évite trop long
    if (candidate && candidate.length >= 6 && candidate.length <= 80 && !/\d/.test(candidate)) {
      // capitalise juste la première lettre, sans tout casser
      return candidate.charAt(0).toUpperCase() + candidate.slice(1);
    }
  }
  return null;
}

function guessTitleFromLines(lines) {
  const head = lines.slice(0, 16).map(normSpaces).filter(Boolean);
  

  const explicit = findExplicitTitleInFirstLines(lines, 60);
  if (explicit) {
    const cleaned = sanitizePickedTitle(explicit);
    if (cleaned) return cleaned;
  }

  const fromStepHeader = extractTitleFromStepHeader(lines);
  if (fromStepHeader) return fromStepHeader;

  if (head.some((l) => extractServingsFromLine(l) || isIngredientsHeader(l))) {
    return fabricateTitleFromIngredients(lines) || 'Recette importée';
  }

  const ingredientLikeCount = head.filter((l) => {
    const t = normSpaces(l);
    if (/^[-•*·]\s+/.test(t)) return true;
    if (/^(un peu de|selon goût|au goût)\b/i.test(t)) return true;
    return !!parseOcrIngredient(t);
  }).length;

  if (ingredientLikeCount >= 3) {
    return fabricateTitleFromIngredients(lines) || 'Recette importée';
  }

  let prev = '';
  for (const l of head) {
    let t = cleanTitleCandidate(l);
    t = sanitizePickedTitle(t);
    if (!t) {
      prev = l;
      continue;
    }

    if (isGenericSiteTitle(t)) {
      prev = l;
      continue;
    }

    if (looksLikeStatusBarNoise(t)) {
      prev = l;
      continue;
    }
    if (looksLikeDateNoise(t)) {
      prev = l;
      continue;
    }
    if (looksLikeCountersNoise(t)) {
      prev = l;
      continue;
    }
    if (looksLikeSocialNoise(t)) {
      prev = l;
      continue;
    }
    if (isIngredientsHeader(t)) {
      prev = l;
      continue;
    }
    if (isPreparationHeader(t)) {
      prev = l;
      continue;
    }
    if (extractServingsFromLine(t)) {
      prev = l;
      continue;
    }

    if (looksLikeStepContinuation(prev, t)) {
      prev = l;
      continue;
    }

    if (/^[-•*·]\s+/.test(l)) {
      prev = l;
      continue;
    }
    if (/^(un peu de|selon goût|au goût)\b/i.test(t)) {
      prev = l;
      continue;
    }
    if (parseOcrIngredient(t)) {
      prev = l;
      continue;
    }

    if (/^(sel|poivre|sel\s*&\s*poivre)\b/i.test(t)) {
      prev = l;
      continue;
    }

    if (looksLikeStepLine(t)) {
      prev = l;
      continue;
    }

    if (/^(temps|notes?)\b/i.test(t)) {
      prev = l;
      continue;
    }

    if (t.length >= 6 && t.length <= 80 && !/\d/.test(t)) {
      const cleaned = sanitizePickedTitle(t);
      if (cleaned) return cleaned;
    }

    prev = l;
  }

  return fabricateTitleFromIngredients(lines) || 'Recette importée';
}

/* =========================
   (tout le reste splitIngredientsAndSteps / miniReflow est identique à ton fichier)
   Je le laisse inchangé pour éviter tout risque.
========================= */

// ---- Ton bloc "trailing ingredient block", "split", etc. reste inchangé ----
// (Je le garde tel quel en bas : il dépend de parseOcrIngredient, qui marche toujours.)

function isIngredientFragmentLine(line) {
  const t = normSpaces(line);
  if (!t) return false;

  if (looksLikeActionSentence(t) || looksLikeStepVerbLine(t) || looksLikeStepLine(t)) return false;

  if (/^\d{1,4}$/.test(t)) return true;
  if (/^(de|d['’])\b/i.test(t)) return true;
  if (/^(kg|g|mg|l|dl|cl|ml)\b/i.test(t)) return true;
  if (/^(grill[eé]es?|concass[eé]es?)\b/i.test(t)) return true;

  if (t.length <= 20 && /^[a-zà-öø-ÿ'’ -]+$/i.test(t) && !looksLikeStepLine(t)) return true;

  return false;
}

function joinWrappedLinesForIngredients(lines) {
  const out = [];
  let buffer = '';

  const flush = () => {
    const s = normSpaces(buffer);
    if (s) out.push(s);
    buffer = '';
  };

  for (const raw of lines) {
    const line = normSpaces(raw);
    if (!line) continue;

    if (!buffer) {
      buffer = line;
      continue;
    }

    const bufIsNumber = /^\d{1,4}$/.test(buffer);
    const bufEndsDe = /\b(de|d['’])\s*$/i.test(buffer);
    const nextStartsDe = /^(de|d['’])\b/i.test(line);
    const nextIsFragment = isIngredientFragmentLine(line);

    const nextIsUnit = isUnitToken(line);

    if (bufIsNumber || bufEndsDe || nextStartsDe || nextIsFragment || nextIsUnit) {
      buffer = `${buffer} ${line}`;
    } else {
      flush();
      buffer = line;
    }
  }

  flush();
  return out;
}

function extractTrailingIngredientBlock({ ingredientLines, stepLines }) {
  if (!stepLines || stepLines.length < 3) return { ingredientLines, stepLines };

  const start = Math.max(0, stepLines.length - 25);
  const tail = stepLines.slice(start);

  let lastIngredientLikeIdx = -1;
  let ingredientLikeCount = 0;

  for (let i = 0; i < tail.length; i++) {
    const l = normSpaces(tail[i]);

    if (looksLikeStatusBarNoise(l) || looksLikeDateNoise(l) || looksLikeCountersNoise(l) || looksLikeSocialNoise(l)) continue;
    if (isIngredientsHeader(l) || isPreparationHeader(l)) continue;

    const parsed = parseOcrIngredient(l);
    const like =
      !!parsed ||
      isIngredientFragmentLine(l) ||
      isUnitToken(l) ||
      /^\d{1,4}\s*(kg|g|mg|l|dl|cl|ml)\b/i.test(l);

    if (like) {
      ingredientLikeCount++;
      lastIngredientLikeIdx = i;
    }
  }

  if (ingredientLikeCount < 2 || lastIngredientLikeIdx < 0) return { ingredientLines, stepLines };

  let firstIdx = -1;
  for (let i = 0; i <= lastIngredientLikeIdx; i++) {
    const l = normSpaces(tail[i]);
    const parsed = parseOcrIngredient(l);
    const like =
      !!parsed ||
      isIngredientFragmentLine(l) ||
      isUnitToken(l) ||
      /^\d{1,4}\s*(kg|g|mg|l|dl|cl|ml)\b/i.test(l);
    if (like) {
      firstIdx = i;
      break;
    }
  }

  if (firstIdx < 0) return { ingredientLines, stepLines };

  const moveBlock = tail.slice(firstIdx).map(normSpaces).filter(Boolean);
  const joinedMoveBlock = joinWrappedLinesForIngredients(moveBlock);

  const newStepLines = stepLines.slice(0, start + firstIdx);
  const newIngredientLines = [...ingredientLines, ...joinedMoveBlock];

  return { ingredientLines: newIngredientLines, stepLines: newStepLines };
}

function splitCompoundIngredientLine(line) {
  const l = normSpaces(line);

  const m = l.match(
    /^(\d{1,4})\s*(kg|g|mg|l|dl|cl|ml)\s*(?:de\s+|d['’]\s*)(.+?)\s+(\d{1,4})\s*(?:de\s+|d['’]\s*)(.+)$/i
  );
  if (!m) return null;

  const qty1 = m[1];
  const unit = m[2];
  const name1 = m[3];
  const qty2 = m[4];
  const name2 = m[5];

  if (looksLikeStepLine(name2)) return null;

  return [`${qty1} ${unit} de ${name1}`, `${qty2} ${unit} de ${name2}`];
}

function expandCompoundIngredientLines(lines) {
  const out = [];
  for (const line of lines) {
    const t = normSpaces(line);

    if (/^sel\s*,\s*poivre$/i.test(t) || /^sel\s+et\s+poivre$/i.test(t)) {
      out.push('sel');
      out.push('poivre');
      continue;
    }

    const split = splitCompoundIngredientLine(t);
    if (split) out.push(...split);
    else out.push(t);
  }
  return out;
}

function salvageIngredientFragmentsFromNotes({ ingredientLines, notesLines }) {
  const keepNotes = [];
  const frags = [];

  for (const l of notesLines) {
    const t = normSpaces(l);
    if (!t) continue;

    if (isUnitToken(t) || isIngredientFragmentLine(t)) frags.push(t);
    else keepNotes.push(t);
  }

  if (frags.length === 0) return { ingredientLines, notesLines };

  const joined = joinWrappedLinesForIngredients(frags);

  for (const j0 of joined) {
    const j = normSpaces(j0);

    const m = j.match(/^(\d{1,4})\s*(kg|g|mg|l|dl|cl|ml)\s+de\s+beurre\s+de\s+cacahu[eé]te\s+(.+)$/i);

    if (m) {
      const qty = m[1];
      const unit = m[2];
      const tail = normSpaces(m[3]);

      ingredientLines.push(`${qty} ${unit} de beurre de cacahuete`);

      const idxPeanuts = ingredientLines.findIndex((x) => /\bcacahu[eé]tes?\b/i.test(normSpaces(x)));
      if (idxPeanuts >= 0 && tail) {
        ingredientLines[idxPeanuts] = normSpaces(`${ingredientLines[idxPeanuts]} ${tail}`);
      } else if (tail) {
        keepNotes.push(tail);
      }
      continue;
    }

    if (parseOcrIngredient(j) || /^\d{1,4}\s*(?:kg|g|mg|l|dl|cl|ml)\b/i.test(j)) {
      ingredientLines.push(j);
    } else {
      keepNotes.push(j);
    }
  }

  return { ingredientLines, notesLines: keepNotes };
}

function salvageBookColumnSnippets({ ingredientLines, notesLines }) {
  const notesText = notesLines.map(normSpaces).filter(Boolean).join(' ').toLowerCase();

  const outIng = [...ingredientLines];
  const outNotes = [...notesLines];

  for (let i = 0; i < outNotes.length; i++) {
    const t = normSpaces(outNotes[i]);
    if (/^sel\s*,\s*poivre$/i.test(t) || /^sel\s+et\s+poivre$/i.test(t) || /^sel\s*&\s*poivre$/i.test(t)) {
      outIng.push('sel');
      outIng.push('poivre');
      outNotes.splice(i, 1);
      i--;
    }
  }

  const idxCasDe = outIng.findIndex((l) =>
    /\b1\b.*\b(càs|cas|c\.\s*à\s*soupe|cuill(?:e|è)re\s+à\s+soupe)\b.*\bde\b/i.test(normSpaces(l))
  );
  if (idxCasDe >= 0 && notesText.includes('concentré de tomate')) {
    outIng[idxCasDe] = '1 càs de concentré de tomate';
  }

  const idxEcorce = outIng.findIndex((l) => /^1\s+morceau\s+d['’]écorce$/i.test(normSpaces(l)));
  if (
    idxEcorce >= 0 &&
    (notesText.includes("d'orange séchée") || notesText.includes("d’orange séchée") || notesText.includes('orange séchée'))
  ) {
    outIng[idxEcorce] = "1 morceau d'écorce d'orange séchée";
  }

  const idxPoivre = outIng.findIndex((l) => /^1\s+pointe\s+de\s+poivre$/i.test(normSpaces(l)));
  if (idxPoivre >= 0 && notesText.includes('cayenne')) {
    outIng[idxPoivre] = '1 pointe de poivre de Cayenne';
  }

  const idxBouquet = outIng.findIndex((l) => /^1\s+petit\s+bouquet\s+de$/i.test(normSpaces(l)));
  if (idxBouquet >= 0 && notesText.includes('persil')) {
    outIng[idxBouquet] = '1 petit bouquet de persil';
  }

  return { ingredientLines: outIng, notesLines: outNotes };
}

function rebalanceMisplacedLines({ ingredientLines, stepLines, notesLines }) {
  const newIng = [];
  const newSteps = [...stepLines];
  const newNotes = [];

  function isLikelyStep(line) {
    const t = normSpaces(line);
    if (!t) return false;
    return looksLikeActionSentence(t) || looksLikeStepVerbLine(t) || looksLikeStepLine(t);
  }

  for (const l of ingredientLines) {
    const t = normSpaces(l);
    if (!t) continue;

    if (isLikelyStep(t)) newSteps.push(t);
    else newIng.push(t);
  }

  for (const l of notesLines) {
    const t = normSpaces(l);
    if (!t) continue;

    if (isLikelyStep(t)) newSteps.push(t);
    else newNotes.push(t);
  }

  return { ingredientLines: newIng, stepLines: newSteps, notesLines: newNotes };
}

/* =========================
   ✅ NEW: Variantes => Notes
========================= */

function moveVariantsBlockToNotes({ stepLines, notesLines }) {
  const steps = Array.isArray(stepLines) ? stepLines : [];
  const notes = Array.isArray(notesLines) ? notesLines : [];

  const idx = steps.findIndex((l) => /^variantes?\s*:/i.test(normSpaces(l)));
  if (idx < 0) return { stepLines: steps, notesLines: notes };

  const moved = steps.slice(idx);
  const kept = steps.slice(0, idx);

  return { stepLines: kept, notesLines: [...notes, ...moved] };
}

  function looksLikeSpoonMeasureIngredient(line) {
  const s = String(line || '').replace(/\u00A0/g, ' ').trim();

  // 3 c.a.s. de ...
  // 3 càs de ...
  // 3 cas de ...
  // 3 c.à.s. de ...
  if (/^\d+\s*(c\s*\.?\s*a\s*\.?\s*s\s*\.?|c\s*\.?\s*à\s*\.?\s*s\s*\.?|càs|cas)\b/i.test(s)) {
  // souvent un ingrédient contient "de" ou "d'"
  if (/\b(d['’]?|de)\b/i.test(s)) return true;
  }
  return false;
  }

/* =========================
   SPLIT INGREDIENTS / STEPS / NOTES
========================= */

function splitIngredientsAndSteps(lines) {
  const L = lines.map(normSpaces).filter(Boolean);

  let servings = null;
  for (const l of L.slice(0, 50)) {
    const s = extractServingsFromLine(l);
    if (s) {
      servings = s;
      break;
    }
  }

  const idxIng = L.findIndex((l) => /^ingr[ée]dients?\b/i.test(l) || isIngredientsHeader(l));
  const idxPrep = L.findIndex((l) => /^préparation\b/i.test(l) || /^preparation\b/i.test(l) || isPreparationHeader(l));

  let ingredientLines = [];
  let stepLines = [];
  let notesLines = [];

  if (idxIng >= 0 && idxPrep >= 0 && idxPrep > idxIng) {
    ingredientLines = L.slice(idxIng + 1, idxPrep);
    stepLines = L.slice(idxPrep, L.length);
  } else if (idxIng >= 0) {
    // ✅ Tout ce qui est AVANT "Ingrédients" => meta (notes + servings potentiels)
    const head = L.slice(0, idxIng).map(normSpaces).filter(Boolean);
    for (const h of head) {
      const s = extractServingsFromLine(h);
      if (s && !servings) servings = s;

      if (looksLikeTimeInfoLine(h)) {
        notesLines.push(h);
        continue;
      }

      // garde d'autres lignes utiles (ex: "Variantes :" parfois)
      if (/^variantes?\b/i.test(h)) {
        notesLines.push(h);
        continue;
      }
    }

    const tail = L.slice(idxIng + 1);
    let inSteps = false;
    let prev = '';

    for (const l of tail) {
      if (!l) continue;

      if (isIngredientsHeader(l) || extractServingsFromLine(l)) {
        const s = extractServingsFromLine(l);
        if (s && !servings) servings = s;
        prev = l;
        continue;
      }
      if (looksLikeSpoonMeasureIngredient(l)) {
      ingredientLines.push(l);
      prev = l;
      continue;
      }


      if (!inSteps && (looksLikeStepLine(l) || looksLikeStepContinuation(prev, l))) inSteps = true;

      if (inSteps) stepLines.push(l);
      else ingredientLines.push(l);

      prev = l;
    }
  } else {
    let afterServingsHeader = false;
    let inIngredientBullets = false;
    let inSteps = false;
    let prev = '';

    for (const l0 of L) {
      const l = normSpaces(l0);
      if (!l) continue;

      // ✅ Temps préparation/cuisson => Notes (pas ingrédients, pas étapes)
      if (looksLikeTimeInfoLine(l)) {
        notesLines.push(l);
        prev = l;
        continue;
      }

      if (isIngredientsHeader(l)) {
        afterServingsHeader = true;
        inIngredientBullets = true;
        prev = l;
        continue;
      }

      if (extractServingsFromLine(l)) {
        afterServingsHeader = true;
        prev = l;
        continue;
      }

      if (!inSteps) {
        const parsed = parseOcrIngredient(l);
        const isBullet = looksLikeListBullet(l);

        if ((afterServingsHeader && (isBullet || parsed)) && !looksLikeStepLine(l)) {
          inIngredientBullets = true;
          ingredientLines.push(l);
          prev = l;
          continue;
        }
        if (looksLikeSpoonMeasureIngredient(l)) {
        ingredientLines.push(l);
        continue;
        }

        if (looksLikeStepLine(l) || looksLikeStepVerbLine(l) || looksLikeStepContinuation(prev, l)) {
          inSteps = true;
          stepLines.push(l);
          prev = l;
          continue;
        }

        if (inIngredientBullets) {
          notesLines.push(l);
          prev = l;
          continue;
        }

        if (parsed) ingredientLines.push(l);
        else notesLines.push(l);

        prev = l;
      } else {
        stepLines.push(l);
        prev = l;
      }
    }
  }

  ingredientLines = ingredientLines.filter((l) => !isIngredientsHeader(l) && !extractServingsFromLine(l));
  notesLines = notesLines.filter((l) => !isIngredientsHeader(l) && !extractServingsFromLine(l));

  const moved = extractTrailingIngredientBlock({ ingredientLines, stepLines });
  ingredientLines = moved.ingredientLines;
  stepLines = moved.stepLines;

  ingredientLines = expandCompoundIngredientLines(ingredientLines);

  const salvaged = salvageIngredientFragmentsFromNotes({ ingredientLines, notesLines });
  ingredientLines = salvaged.ingredientLines;
  notesLines = salvaged.notesLines;

  const fixedSnips = salvageBookColumnSnippets({ ingredientLines, notesLines });
  ingredientLines = fixedSnips.ingredientLines;
  notesLines = fixedSnips.notesLines;

  const rebalanced = rebalanceMisplacedLines({ ingredientLines, stepLines, notesLines });
  ingredientLines = rebalanced.ingredientLines;
  stepLines = rebalanced.stepLines;
  notesLines = rebalanced.notesLines;

  // ✅ NEW: si "Variantes :" est dans les steps => on bascule le bloc dans notes
  const movedVar = moveVariantsBlockToNotes({ stepLines, notesLines });
  stepLines = movedVar.stepLines;
  notesLines = movedVar.notesLines;

  stepLines = joinWrappedLinesForSteps(stepLines);

  // ✅ NEW: découpe en phrases si une ligne est longue et contient plusieurs phrases
  stepLines = splitStepsBySentences(stepLines);

  stepLines = splitLongSteps(stepLines);


  return { ingredientLines, stepLines, notesLines, servings };
}

function miniReflow({ ingredientLines, stepLines, notesLines }) {
  return [...ingredientLines, ...stepLines, ...notesLines];
}

module.exports = {
  smartFilterWithTrashFromText,
  splitIngredientsAndSteps,
  joinWrappedLinesForSteps,
  splitLongSteps,
  parseOcrIngredient,
  beautifyIngredients,
  guessTitleFromLines,
  extractServingsFromLine,
  miniReflow,
};



