//backend/src/utils/ingredientUtils
// LEVEL: UTIL
// import autorisés : stringUtils-units-heuristics-constantes neutres
// import interdits : routes-services-middlewares-parsers-utils ocr-supabase-prisma
// importé par import-ocr,vision,ocrText,ocrTitle

//stringUtils
const { normSpaces} = require('../utils/stringUtils');
const { looksLikeStepVerbLine, looksLikeActionSentence, looksLikeStepLine} = require('../utils/heuristics');


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
  s = s.replace(/^[·•●⚫■▪◦○\.\,\;\:\-–—]+\s*/g, '');

  return s;
}

function looksLikeListBullet(line) {
  const t = normSpaces(line);
  return /^[·•●⚫■▪◦○\-•*]\s+/.test(t);//laisser comme ceci ou l'ameliorer
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

  if (looksLikeStepLine(t) || looksLikeStepVerbLine(t) || looksLikeActionSentence(t)) {
    return false;
  }
  if (/@[a-z0-9._-]{2,}/i.test(t)) return true;
  if (/#\w{2,}/.test(t)) return true;

  if (/https?:\/\//i.test(t) || /\bwww\./i.test(t)) return true;

  if (/\b\d{1,9}\s*(likes?|j’aime|j'aime|comments?|commentaires?)\b/i.test(t)) return true;

  // ✅ UI TikTok / Instagram : "NomDuCompte → Suivre"
  if (/→\s*suivre\b/i.test(t)) return true;
  if (/^[a-z0-9._'’ -]{2,40}\s*→\s*suivre\b/i.test(t)) return true;

  //ajout du 01/04/26
  if (/^aim[ée]?\s+par\b/i.test(t)) return true;
  if (/^ajouter?\s+un\s+commentaire\b/i.test(t)) return true;
  if (/^j['’]aime\b/i.test(t)) return true;
  if (/^[qo]$/i.test(t)) return true;
  if (/^suivre$/i.test(t)) return true;

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

// le 29/03/26 remplacé par :
function postProcessIngredientName(name) {
  let n = normSpaces(name);
  if (!n) return '';

  if (/^huile\s+olive\b/i.test(n)) {
    n = n.replace(/^huile\s+olive\b/i, "huile d'olive");
  }

  // retire les débuts parasites fréquents
  n = n.replace(/^de\s+/i, '');
  // retire les restes de bornes hautes OCR mal découpées
  n = n.replace(/^(?:à|a)\s+\d+(?:[.,]\d+)?\s+/i, '');

  // retire les restes d'unités cuillère mal laissés dans le nom
  n = n.replace(/^(?:à|a)\s+\d+(?:[.,]\d+)?\s*(?:càs|cas|cs|càc|cac|cc)\s+(?:de\s+|d['’]\s*)?/i, '');
  n = n.replace(/^(?:càs|cas|cs|càc|cac|cc)\s+(?:de\s+|d['’]\s*)?/i, '');

  // retire les mesures naturelles descriptives quand elles sont laissées dans le nom
  n = n.replace(/^(?:(?:tr[eè]s\s+)?(?:belle?|petite?|petit|grande?|grand|grosse?|gros)\s+)?poign(?:ée|ee?)s?\s+(?:de\s+|d['’]\s*)?/i, '');
  n = n.replace(/^(?:à|a)\s*caf[ée]\s+(?:de\s+|d['’]\s*)?/i, '');
  n = n.replace(/^caf[ée]\s+(?:de\s+|d['’]\s*)?/i, '');
  n = n.replace(/^af[ée]\s+(?:de\s+|d['’]\s*)?/i, '');

  // retire les marques / pollutions OCR
  n = n.replace(/\bRecoltos\b/gi, '');
  n = n.replace(/\bDélico\b/gi, '');
  n = n.replace(/\bDelico\b/gi, '');
  n = n.replace(/\bRecettes?\s+Délice\b/gi, '');
  n = n.replace(/\bRecettes?\s+Delice\b/gi, '');

  // retire les suffixes numériques parasites
  n = n.replace(/\s+\d{3,6}\s*$/g, '');

  // retire la ponctuation parasite en fin
  n = n.replace(/\s*[.,;:!?]+$/g, '');

  // nettoie les restes de début/fin
  n = n.replace(/^[\s"'“”‘’([{]+/g, '');
  n = n.replace(/[\s"'“”‘’)\]}]+$/g, '');

  //ajoute le 01/04/26 - remplacer par celui du dessous le 01/04/26
  //n = n.replace(/^(?:à|a)\s+\d+(?:[.,]\d+)?\s*(kg|g|mg|l|dl|cl|ml)\s+(?:de\s+|d['']\s*)?/i, '');

  //remplace celui du dessus - le 01/04/26
  n = n.replace(/\b(coup[ée]e?s?\s+en\s+d[ée]s|coup[ée]e?s?|[ée]minc[ée]e?s?|hach[ée]e?s?|r[âa]p[ée]e?s?)\b/gi, '');
  n = n.replace(/\b(finement|grossi[èe]rement)\b/gi, '');
  n = normSpaces(n);

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
    if (Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && c !== 0) {
      return a + b / c;
    }
  }

  // "1/2"
  m = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (m) {
    const a = parseFloat(m[1]);
    const b = parseFloat(m[2]);
    if (Number.isFinite(a) && Number.isFinite(b) && b !== 0) {
      return a / b;
    }
  }

  // règle métier OCR :
  // sur une plage "10 à 12", on garde la borne basse
  m = s.match(/(\d+(?:[.,]\d+)?)\s*(?:-|à|a)\s*(\d+(?:[.,]\d+)?)/i);
  if (m) {
    const a = parseFloat(String(m[1]).replace(',', '.'));
    const b = parseFloat(String(m[2]).replace(',', '.'));
    if (Number.isFinite(a) && Number.isFinite(b)) {
      return Math.min(a, b);
    }
  }

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
  if (/^(peu\s+)?farineuse?\b/i.test(t)) return true;
  if (/^de\s+type\b/i.test(t)) return true;

  if (t.length <= 20 && /^[a-zà-öø-ÿ'’ -]+$/i.test(t) && !looksLikeStepLine(t)) return true;

  return false;
}

//ajouter le 23/02
function looksLikeNewIngredientStart(line, parseIngredientFn) {
 const t = normSpaces(line);

 if (looksLikeListBullet(t)) return true;
 if (/^\d+(?:[.,]\d+)?\b/.test(t)) return true;
 if (/^\d+\s*\/\s*\d+\b/.test(t)) return true;

 // cuillères
 if (/^\d+\s*(c\s*\.?\s*a\s*\.?\s*s|c\s*\.?\s*à\s*\.?\s*s|càs|cas)\b/i.test(t)) return true;

 //ingredients sans quantités
 const low = t.toLowerCase();
  if (/^(thym|basilic|persil|ciboulette|origan|romarin|menthe)\b/i.test(low)) return true;
  if (/^huile\b/i.test(low)) return true;
  if (/^(sel|poivre)\b/i.test(low)) return true;
  if (typeof parseIngredientFn === 'function' && !!parseIngredientFn(t)) return true;

 return false;
}

function joinWrappedLinesForIngredients(lines, parseIngredientFn) {
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
   //ajoute le 01/04/26
   if (/(\d+\s+\d+\/\d+|\d+\/\d+|½|⅓|⅔|¼|¾|⅛|⅜|⅝|⅞)/.test(cur)) {
      console.log('[JOIN INPUT]', cur);
    }
   const next = i + 1 < src.length ? src[i + 1] : '';

   const bufferHasOpenParen = buffer.includes('(') && !buffer.includes(')');
   const curLooksNewIngredientStart = looksLikeNewIngredientStart(cur, parseIngredientFn);

   // parenthèse ouverte => on recolle jusqu’à fermeture
   if (buffer && bufferHasOpenParen && !curLooksNewIngredientStart) {
     buffer = `${buffer} ${cur}`;
     continue;
   }
   if (buffer && bufferHasOpenParen && curLooksNewIngredientStart) {
     flush();
     buffer = cur;
     continue;
   }

   // 1) "200" + "g"
   if (/^\d{1,4}$/.test(cur) && isUnitToken(next)) {
      //ajoute le 01/04/26
      if (/(\d+\s+\d+\/\d+|\d+\/\d+|½|⅓|⅔|¼|¾|⅛|⅜|⅝|⅞)/.test(buffer)) {
        console.log('[JOIN BUFFER]', buffer);
      }

     flush();
     buffer = `${cur} ${next}`;
     i++;
     continue;
   }

   // 2) unité seule
   if (isUnitToken(cur)) {
     if (buffer && /\b\d{1,4}\s*$/.test(buffer)) {
       buffer = `${buffer} ${cur}`;
       continue;
     }
     flush();
     out.push(cur);
     continue;
   }

   // ✅ garde-fou : nouveau début ingrédient => on flush
   if (buffer && !bufferHasOpenParen && curLooksNewIngredientStart) {
     flush();
     buffer = cur;
     continue;
   }

   // 3) start buffer
   if (!buffer) {
     buffer = cur;
     continue;
   }

   // si la ligne commence par une parenthèse, on traite la note à part ex: "(büche) Quelques cerneaux" -> on colle "(büche)" à l’ingrédient précédent,
    // et on garde "Quelques cerneaux" comme nouvelle ligne.
    if (buffer && /^\(/.test(cur)) {
      const m = cur.match(/^\(([^)]+)\)\s*(.*)$/);
      if (m) {
        const note = `(${m[1]})`;
        const rest = normSpaces(m[2] || '');

        buffer = normSpaces(`${buffer} ${note}`);
        flush();

        if (rest) {
          buffer = rest; // reste devient une nouvelle ligne “ingredient-like”
        } else {
          buffer = '';
        }
        continue;
      }
    }

   // 4) heuristiques
   const bufIsNumber = /^\d{1,4}$/.test(buffer);
   const bufEndsDe = /\b(de|d['’])\s*$/i.test(buffer);

   const curStartsDe = /^(de|d['’])\b/i.test(cur);
   const curParsesAsIngredient = typeof parseIngredientFn === 'function' && !!parseIngredientFn(cur);
   const curIsFragment = isIngredientFragmentLine(cur);
   const curIsUnit = isUnitToken(cur);

   if (bufIsNumber || bufEndsDe) {
     buffer = `${buffer} ${cur}`;
     continue;
   }

   // ✅ FIX ICI
   if (!curLooksNewIngredientStart && !curParsesAsIngredient && (curStartsDe || curIsFragment || curIsUnit)) { //
     buffer = `${buffer} ${cur}`;
     continue;
   }

   flush();
   buffer = cur;
 }

 flush();
 return out.map((s) => normSpaces(s)).filter(Boolean);
}


module.exports = {
    fixCommonOcrQuantityUnitBugs,
    looksLikeDateNoise,
    looksLikeCountersNoise,
    looksLikeSocialNoise,
    postProcessIngredientName,
    normalizeQuantityRawForDisplay,
    parseQuantityToNumber,
    normalizeUnit,
    isUnitToken,
    isIngredientFragmentLine,
    joinWrappedLinesForIngredients,
    looksLikeListBullet,
}