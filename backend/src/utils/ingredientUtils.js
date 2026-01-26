//backend/src/utils/ingredientUtils

//stringUtils
const { normSpaces, looksLikeStepNumberedLine } = require('../utils/stringUtils');

const QTY_USED =
  '([0-9]+(?:[.,][0-9]+)?|[0-9]+\\s+[0-9]+\\/[0-9]+|[0-9]+\\/[0-9]+|½|⅓|⅔|¼|¾|⅛|⅜|⅝|⅞)';

const CUILL_RE = 'cuill(?:e|è)re(?:s)?';

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

  // ✅ UI TikTok / Instagram : "NomDuCompte → Suivre"
  if (/→\s*suivre\b/i.test(t)) return true;
  if (/^[a-z0-9._'’ -]{2,40}\s*→\s*suivre\b/i.test(t)) return true;

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
    'suivre',
    'recommandations',
    'explorer',
    'ajoutez un commentaire',
    'ajouter un commentaire',
    'gif',
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

function looksLikeStepLine(line) {
  return looksLikeStepVerbLine(line) || looksLikeStepNumberedLine(line);
}

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
  if (
    t === 'cac' ||
    t === 'càc' ||
    t === 'cc' ||
    (t.includes('cuill') && (t.includes('cafe') || t.includes('café')))
  ) {
    return 'càc';
  }

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

// ✅ phrases d'action “sans numérotation”
function looksLikeActionSentence(line) {
  const t = normSpaces(line).toLowerCase();
  return /\b(bien\s+mélanger|couvrir|cuire|laisser|retirer|poursuivre|réchauffer|servir|préchauffer|étaler|étalez|etalez|détailler|dorer|déposer|fendre|farci[er]|passer|préparer|preparez|préparez|employer|utiliser|assaisonner)\b/i.test(
    t
  );
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

// ✅ helper unités seules (évite que "g" parte à la corbeille)
function isUnitToken(line) {
  const t = normSpaces(line);
  return /^(g|kg|mg|ml|cl|dl|l)$/i.test(t);
}

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
  const src = (lines || []).map((x) => normSpaces(x)).filter(Boolean);

  const out = [];
  let buffer = '';

  const flush = () => {
    const s = normSpaces(buffer);
    if (s) out.push(s);
    buffer = '';
  };

  for (let i = 0; i < src.length; i++) {
    const cur = src[i];
    const next = i + 1 < src.length ? src[i + 1] : '';

    // 1) Cas fort "nombre seul" suivi d'une unité seule => on commence/continue un bloc
    // Ex: "200" + "g" + "de farine" ...
    if (/^\d{1,4}$/.test(cur) && isUnitToken(next)) {
      flush(); // on ferme ce qu'on avait avant pour éviter mélange
      buffer = `${cur} ${next}`;
      i++; // on consomme l'unité
      continue;
    }

    // 2) Unité seule => si buffer finit par un nombre, on colle ; sinon on sort en ligne seule
    // Ex: ["200", "g"] déjà géré par (1), mais on couvre d'autres variants.
    if (isUnitToken(cur)) {
      if (buffer && /\b\d{1,4}\s*$/.test(buffer)) {
        buffer = `${buffer} ${cur}`;
        continue;
      }
      // si on n'a pas de buffer, on garde l'unité (utile pour certains rescues)
      flush();
      out.push(cur);
      continue;
    }

    // 3) Si pas de buffer, on démarre
    if (!buffer) {
      buffer = cur;
      continue;
    }

    // 4) Heuristiques de collage (version "ocrText" + protections "import-ocr")
    const bufIsNumber = /^\d{1,4}$/.test(buffer);
    const bufEndsDe = /\b(de|d['’])\s*$/i.test(buffer);

    const nextStartsDe = /^(de|d['’])\b/i.test(cur);
    const curIsFragment = isIngredientFragmentLine(cur);
    const curIsUnit = isUnitToken(cur);

    // 4a) Si le buffer se termine par un connecteur ou un nombre, on colle
    if (bufIsNumber || bufEndsDe) {
      buffer = `${buffer} ${cur}`;
      continue;
    }

    // 4b) Si la ligne courante est un fragment (de / d' / adjectif ingrédient / petit bout), on colle
    if (nextStartsDe || curIsFragment || curIsUnit) {
      buffer = `${buffer} ${cur}`;
      continue;
    }

    // 4c) Sinon on flush et on redémarre
    flush();
    buffer = cur;
  }

  flush();

  // Nettoyage final : resserre les espaces
  return out.map((s) => normSpaces(s)).filter(Boolean);
}


module.exports = {
    QTY_USED,
    CUILL_RE,
    fixCommonOcrQuantityUnitBugs,
    isIngredientsHeader,
    isPreparationHeader,
    looksLikeDateNoise,
    looksLikeCountersNoise,
    looksLikeSocialNoise,
    looksLikeStepLine,
    postProcessIngredientName,
    normalizeQuantityRawForDisplay,
    parseQuantityToNumber,
    normalizeUnit,
    looksLikeActionSentence,
    looksLikeStepVerbLine,
    isUnitToken,
    isIngredientFragmentLine,
    joinWrappedLinesForIngredients,
}