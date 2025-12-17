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
    // UI / plateformes
    'toutes les publications',
    'voir plus',
    'afficher la suite', // ✅ FB/IG
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
    // apps fermées
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

  // Promo / accroches éditoriales Instagram / Facebook
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

// ✅ helper unités seules (évite que "g" parte à la corbeille)
function isUnitToken(line) {
  const t = normSpaces(line);
  return /^(g|kg|mg|ml|cl|dl|l)$/i.test(t);
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

/* =========================
   CLEAN + TRASH
========================= */

function smartFilterWithTrashFromText(rawText) {
  const cleaned = stripWeird(rawText);

  const rawLines = cleaned
    .split('\n')
    .map((s) => normSpaces(s))
    .filter(Boolean);

  const lines = [];
  const trash = [];

  for (const l of rawLines) {
    if (isMostlyNoise(l)) {
      trash.push(l);
      continue;
    }
    if (looksLikeStatusBarNoise(l)) {
      trash.push(l);
      continue;
    }
    // ✅ A) date => trash
    if (looksLikeDateNoise(l)) {
      trash.push(l);
      continue;
    }
    // ✅ compteurs => trash
    if (looksLikeCountersNoise(l)) {
      trash.push(l);
      continue;
    }
    if (looksLikeSocialNoise(l)) {
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

/* =========================
   SERVINGS / HEADERS
========================= */

function extractServingsFromLine(line) {
  const t = normSpaces(line).toLowerCase();

  let m = t.match(/ingr[ée]dients?\s+pour\s+(\d+)\s*(personnes|parts|portions)\b/i);
  if (m) return parseInt(m[1], 10);

  m = t.match(/\bpour\s+(\d+)\s*(personnes|parts|portions)\b/i);
  if (m) return parseInt(m[1], 10);

  // "Pour 6 personnes, il vous faut :"
  m = t.match(/\bpour\s+(\d+)\s*personnes?\b.*\bil\b.*\bfaut\b/i);
  if (m) return parseInt(m[1], 10);

  return null;
}

function isIngredientsHeader(line) {
  const t = normSpaces(line).toLowerCase();
  if (/^ingr[ée]dients?\b/.test(t)) return true;
  if (/^ingr[ée]dients?\s+pour\s+\d+\s*/.test(t)) return true;

  // Instagram : "Pour 6 personnes, il vous faut :"
  if (/^pour\s+\d+\s*personnes?\b.*\bil\b.*\bfaut\b/.test(t)) return true;

  return false;
}

function isPreparationHeader(line) {
  const t = normSpaces(line).toLowerCase();
  return /^préparation\b/.test(t) || /^preparation\b/.test(t) || /^instructions?\b/.test(t);
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

  return /\b(coupez|couper|lavez|laver|plongez|plonger|égouttez|egouttez|faites|faire|ajoutez|ajouter|mélangez|melangez|versez|remuez|salez|poivrez|déposez|deposez|nappez|saupoudrez|enfournez|laissez|poursuivez|servez|cuisez|cuire|chauffez|chauffer)\b/i.test(
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

// ✅ B) continuation d’une étape numérotée
function looksLikeStepContinuation(prevLine, line) {
  const prev = normSpaces(prevLine);
  const cur = normSpaces(line);
  if (!prev || !cur) return false;

  if (!looksLikeStepNumberedLine(prev)) return false;

  return /^(le|la|les|l['’]|un|une|des|du|de|d['’]|au|aux|et|puis|ensuite|à|a)\b/i.test(cur);
}

/* =========================
   STEP JOIN WRAPS (fusion lignes OCR)
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
    if (!line) continue;

    if (isPreparationHeader(line)) {
      flush();
      continue;
    }

    if (!buffer) {
      buffer = line;
      continue;
    }

    const endsStrong = /[.!?…:]$/.test(buffer);
    const endsConnector = /\b(à|a|au|aux|de|d|d'|d’|des|du|sous|sur|puis|et)\s*$/i.test(buffer);

    const nextLooksContinuation =
      /^[a-zà-öø-ÿ’'"(]/.test(line) ||
      /^\d/.test(line) ||
      /^l['’]/i.test(line) ||
      /^(puis|et|ensuite|alors|donc)\b/i.test(line);

    if ((!endsStrong && nextLooksContinuation) || endsConnector) {
      buffer = `${buffer} ${line}`;
    } else {
      flush();
      buffer = line;
    }
  }

  flush();
  return out;
}

/* =========================
   INGREDIENT PARSER (FR)
========================= */

function parseQuantityFR(q) {
  const t = normSpaces(q).toLowerCase();
  if (!t) return null;

  let s = t.replace(',', '.');

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
  if (uni[s]) s = uni[s];

  let m = s.match(/(\d+(?:\.\d+)?)\s*(?:-|à|a)\s*(\d+(?:\.\d+)?)/i);
  if (m) return Math.max(parseFloat(m[1]), parseFloat(m[2]));

  m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (m) {
    const a = parseFloat(m[1]);
    const b = parseFloat(m[2]);
    const c = parseFloat(m[3]);
    if (c) return a + b / c;
  }

  m = s.match(/^(\d+)\/(\d+)$/);
  if (m) {
    const a = parseFloat(m[1]);
    const b = parseFloat(m[2]);
    if (b) return a / b;
  }

  m = s.match(/^(\d+(?:\.\d+)?)$/);
  if (m) return parseFloat(m[1]);

  return null;
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
  if (t === 'cac' || t === 'càc' || t === 'cc' || (t.includes('cuill') && (t.includes('cafe') || t.includes('café')))) return 'càc';

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

  // ✅ PATCH: retire codes finaux type "2630"
  n = n.replace(/\s+\d{3,6}\s*$/g, '');

  // ✅ PATCH: retire quelques marques/bruits vus dans tes tests
  n = n.replace(/\bRecoltos\b/gi, '');
  n = n.replace(/\bDélico\b/gi, '');
  n = n.replace(/\bDelico\b/gi, '');
  n = n.replace(/\bRecettes?\s+Délice\b/gi, '');
  n = n.replace(/\bRecettes?\s+Delice\b/gi, '');
  return normSpaces(n);
}

// micro-fix OCR : parfois "1 l de lait" => "11 de lait"
function fixCommonOcrQuantityUnitBugs(rawLine) {
  let s = normSpaces(rawLine);
  // ✅ PATCH OCR: parfois l'unité passe avant la quantité : "g 100 de ..." => "100 g de ..."
  // couvre g/kg/mg/ml/cl/dl/l
  s = s.replace(/^(kg|g|mg|ml|cl|dl|l)\s+(\d+(?:[.,]\d+)?)\s+(de|d['’])\b/i,'$2 $1 $3');
  s = s.replace(/\b11\s+(de|d['’])\s*(lait|eau|crème|creme)\b/i, '1 l $1 $2');
  s = s.replace(/\b1l\b/gi, '1 l');
  s = s.replace(/^[·•\.\,\;\:\-–—]+\s*/g, '');

  return s;
}

function parseOcrIngredient(line) {
  const raw0 = normSpaces(line);
  if (!raw0) return null;

  const raw = fixCommonOcrQuantityUnitBugs(raw0);

  if (isIngredientsHeader(raw)) return null;
  if (isPreparationHeader(raw)) return null;

  // ✅ faux ingrédients (UI / Facebook / IG)
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

  m = l.match(new RegExp(`^${QTY_USED}\\s*(kg|g|mg|l|dl|cl|ml)\\b\\s*(?:de\\s+|d['’]\\s*)?(.+)$`, 'i'));
  if (m) {
    const qty = parseQuantityFR(m[1]);
    const unit = normalizeUnit(m[2]);
    const name = postProcessIngredientName(m[3]);
    if (name) return { name, quantity: qty ?? 0, unit };
  }

  m = l.match(
    new RegExp(
      `^${QTY_USED}\\s+(?:${CUILL_RE}\\s*(?:à|a)\\s*caf(?:e|é)|c\\.?\\s*(?:à|a)\\s*c\\.?|càc|cac|cc)\\s*(?:de|d['’])?\\s*(.+)$`,
      'i'
    )
  );
  if (m) {
    const qty = parseQuantityFR(m[1]);
    const name = postProcessIngredientName(m[2]);
    if (name) return { name, quantity: qty ?? 0, unit: 'càc' };
  }

  m = l.match(
    new RegExp(
      `^${QTY_USED}\\s+(?:${CUILL_RE}\\s*(?:à|a)\\s*soupe|c\\.?\\s*(?:à|a)\\s*s\\.?|càs|cas|cs)\\s*(?:de|d['’])?\\s*(.+)$`,
      'i'
    )
  );
  if (m) {
    const qty = parseQuantityFR(m[1]);
    const name = postProcessIngredientName(m[2]);
    if (name) return { name, quantity: qty ?? 0, unit: 'càs' };
  }

  m = l.match(/^(\d+)\s+(gousses?|tranches?|sachets?|verres?|tasses?|pièces?|pieces?)\s+(?:de\s+|d['’])?(.+)$/i);
  if (m) {
    const qty = parseQuantityFR(m[1]);
    const unit = normalizeUnit(m[2]);
    const name = postProcessIngredientName(m[3]);
    if (name) return { name, quantity: qty ?? 0, unit: unit || '' };
  }

  m = l.match(/^(\d+)\s+(.+)$/);
  if (m) {
    const qty = parseQuantityFR(m[1]);
    const name = postProcessIngredientName(m[2]);
    if (name) return { name, quantity: qty ?? 0, unit: 'pièce' };
  }

  return null;
}

function beautifyIngredients(items) {
   // ✅ PATCH: si l'OCR colle "grillées concassées" (et/ou "Recettes Délice") au beurre de cacahuète,
  // on nettoie le beurre et on rattache les qualificatifs aux cacahuètes.
  const list = Array.isArray(items) ? items.map((x) => ({ ...x })) : [];

  const idxButter = list.findIndex((it) => /\bbeurre\s+de\s+cacahu[eé]te\b/i.test(normSpaces(it?.name)));
  const idxPeanuts = list.findIndex((it) => /\bcacahu[eé]tes?\b/i.test(normSpaces(it?.name)));

  if (idxButter >= 0) {
    let bn = normSpaces(list[idxButter].name || '');

    // enlève bruit page
    bn = bn.replace(/\bRecettes?\s+Délice\b/gi, '').replace(/\bRecettes?\s+Delice\b/gi, '');
    bn = bn.replace(/\bRecoltos\b/gi, '').replace(/\bDélico\b/gi, '').replace(/\bDelico\b/gi, '');
    bn = bn.replace(/\s+\d{3,6}\s*$/g, '');

    // capture qualificatifs à déplacer
    const m = bn.match(/\bbeurre\s+de\s+cacahu[eé]te\b(.*)$/i);
    const tail = m ? normSpaces(m[1]) : '';

    // nettoie le beurre (garde seulement "beurre de cacahuete")
    bn = bn.replace(/\bbeurre\s+de\s+cacahu[eé]te\b.*$/i, 'beurre de cacahuete');
    list[idxButter].name = normSpaces(bn);

    // si on a des qualificatifs (ex: "grillees concassees") et une ligne cacahuètes, on les rattache
    if (tail && idxPeanuts >= 0) {
      const pn = normSpaces(list[idxPeanuts].name || '');

      // évite duplication si déjà présent
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
    const quantity = Number.isFinite(it.quantity) ? it.quantity : 0;
    const unit = it.unit == null ? '' : String(it.unit);

    if (!name) continue;

    const key = `${name.toLowerCase()}|${unit.toLowerCase()}|${quantity}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ name, quantity, unit });
  }

  return out;
}

/* =========================
   TITLE (avec fallback sur ingrédients)
========================= */

function cleanTitleCandidate(t) {
  let s = normSpaces(t);
  s = s.replace(/^[·•\-\–—\*\.\,\;\:\s]+/g, '');
  s = normSpaces(s);
  s = s.replace(/[.!?…]+$/g, '');
  return normSpaces(s);
}

// ✅ nettoie un titre détecté (coupe "... Afficher la suite")
function sanitizePickedTitle(title) {
  let t = normSpaces(title);
  if (!t) return '';

  t = t.replace(/\s*(?:\.\.\.|…)?\s*afficher la suite.*$/i, '');
  t = t.replace(/\s*(?:\.\.\.|…)\s*$/g, '');

  return normSpaces(t);
}

// ✅ PATCH: ignore les titres "site/page" génériques
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
    candidates.push({ t, score: (hasUpper ? 10 : 0) + (maxScan - i) });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].t;
}

function guessTitleFromLines(lines) {
  const head = lines.slice(0, 16).map(normSpaces).filter(Boolean);

  const explicit = findExplicitTitleInFirstLines(lines, 60);
  if (explicit) {
    const cleaned = sanitizePickedTitle(explicit);
    if (cleaned) return cleaned;
  }

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
   C) TRAILING INGREDIENT BLOCK (fin de steps)
========================= */

function isIngredientFragmentLine(line) {
  const t = normSpaces(line);
  if (!t) return false;

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

    // ✅ PATCH: si la prochaine est une unité seule ("g") on colle aussi
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

/* =========================
   PATCH: split "double ingredient sur une ligne"
========================= */

function splitCompoundIngredientLine(line) {
  const l = normSpaces(line);

  // ex: "100 g de chocolat noir 100 de beurre de cacahuete"
  const m = l.match(
    /^(\d{1,4})\s*(kg|g|mg|l|dl|cl|ml)\s*(?:de\s+|d['’]\s*)(.+?)\s+(\d{1,4})\s*(?:de\s+|d['’]\s*)(.+)$/i
  );
  if (!m) return null;

  const qty1 = m[1];
  const unit = m[2];
  const name1 = m[3];
  const qty2 = m[4];
  const name2 = m[5];

  // safety: si la 2e partie ressemble à une étape, on ne split pas
  if (looksLikeStepLine(name2)) return null;

  return [`${qty1} ${unit} de ${name1}`, `${qty2} ${unit} de ${name2}`];
}

function expandCompoundIngredientLines(lines) {
  const out = [];
  for (const line of lines) {
    const split = splitCompoundIngredientLine(line);
    if (split) out.push(...split);
    else out.push(line);
  }
  return out;
}

/* =========================
   PATCH: récupérer fragments ingrédient perdus dans notes
_profite de isIngredientFragmentLine + joinWrappedLinesForIngredients
========================= */

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

    // cas: "100 g de beurre de cacahuete ..." + reste "grillees concassees ..."
    const m = j.match(
      /^(\d{1,4})\s*(kg|g|mg|l|dl|cl|ml)\s+de\s+beurre\s+de\s+cacahu[eé]te\s+(.+)$/i
    );

    if (m) {
      const qty = m[1];
      const unit = m[2];
      const tail = normSpaces(m[3]);

      ingredientLines.push(`${qty} ${unit} de beurre de cacahuete`);

      // rattache le tail aux cacahuètes si possible
      const idxPeanuts = ingredientLines.findIndex((x) => /\bcacahu[eé]tes?\b/i.test(normSpaces(x)));
      if (idxPeanuts >= 0 && tail) {
        ingredientLines[idxPeanuts] = normSpaces(`${ingredientLines[idxPeanuts]} ${tail}`);
      } else if (tail) {
        keepNotes.push(tail);
      }
      continue;
    }

    // sinon si ça ressemble à une vraie ligne ingrédient, on l'ajoute
    if (parseOcrIngredient(j) || /^\d{1,4}\s*(?:kg|g|mg|l|dl|cl|ml)\b/i.test(j)) {
      ingredientLines.push(j);
    } else {
      keepNotes.push(j);
    }
  }

  return { ingredientLines, notesLines: keepNotes };
}

/* =========================
   SPLIT (ingredients vs steps)
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
    const tail = L.slice(idxIng + 1);
    let inSteps = false;
    let prev = '';

    for (const l of tail) {
      if (!l) continue;
      if (isIngredientsHeader(l) || extractServingsFromLine(l)) {
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

  // ✅ PATCH: split des lignes "double ingrédient"
  ingredientLines = expandCompoundIngredientLines(ingredientLines);

  // ✅ PATCH: récupérer fragments ingrédient perdus dans notes (ex: 100 / g / de beurre de / cacahuete / grillees...)
  const salvaged = salvageIngredientFragmentsFromNotes({ ingredientLines, notesLines });
  ingredientLines = salvaged.ingredientLines;
  notesLines = salvaged.notesLines;

  return { ingredientLines, stepLines, notesLines, servings };
}

/* =========================
   MINI REFLOW
========================= */

function miniReflow({ ingredientLines, stepLines, notesLines }) {
  return [...ingredientLines, ...stepLines, ...notesLines];
}

module.exports = {
  smartFilterWithTrashFromText,
  splitIngredientsAndSteps,
  joinWrappedLinesForSteps,
  parseOcrIngredient,
  beautifyIngredients,
  guessTitleFromLines,
  extractServingsFromLine,
  miniReflow,
};
