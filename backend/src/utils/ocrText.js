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

  // ex: "8 mai", "8 mai ⚫", "8 mai ·", "8 mai 2024"
  // On accepte aussi les abréviations usuelles.
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

function isMostlyNoise(line) {
  const t = normSpaces(line);
  if (!t) return true;
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

// ligne "liste" (souvent ingrédients sur réseaux) : "- 70 g de beurre", "• 2 oignons"
function looksLikeListBullet(line) {
  const t = normSpaces(line);
  return /^[-•*]\s+/.test(t);
}

// ligne qui ressemble à une étape "action" (verbes cuisine)
function looksLikeStepVerbLine(line) {
  const t = normSpaces(line);
  if (!t) return false;

  return /\b(coupez|couper|lavez|laver|plongez|plonger|égouttez|egouttez|faites|faire|ajoutez|ajouter|mélangez|melangez|versez|remuez|salez|poivrez|déposez|deposez|nappez|saupoudrez|enfournez|laissez|poursuivez|servez|cuisez|cuire|chauffez|chauffer)\b/i.test(
    t
  );
}

// ligne étape par numérotation (1., 2), Étape 1, etc.)
function looksLikeStepNumberedLine(line) {
  const t = normSpaces(line);
  if (!t) return false;
  if (/^\s*(étape|step)\s*\d+/i.test(t)) return true;
  if (/^\s*\d{1,2}\s*[\)\.\-:]/.test(t)) return true;
  return false;
}

// IMPORTANT : on NE considère PAS "puce -" comme étape à elle seule (sinon les ingrédients finissent en étapes)
function looksLikeStepLine(line) {
  return looksLikeStepVerbLine(line) || looksLikeStepNumberedLine(line);
}

// ✅ B) continuation d’une étape numérotée (ex: "2. ...", puis ligne suivante "le beurre de ...")
function looksLikeStepContinuation(prevLine, line) {
  const prev = normSpaces(prevLine);
  const cur = normSpaces(line);
  if (!prev || !cur) return false;

  if (!looksLikeStepNumberedLine(prev)) return false;

  // débuts typiques de continuation
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

    // "Préparation :" => on ne l’ajoute pas
    if (isPreparationHeader(line)) {
      flush();
      continue;
    }

    if (!buffer) {
      buffer = line;
      continue;
    }

    const endsStrong = /[.!?…:]$/.test(buffer);

    // si la ligne précédente finit par un connecteur, on colle presque toujours
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

  // cuillères
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

// cuillere / cuillère / cuilleres / cuillères
const CUILL_RE = 'cuill(?:e|è)re(?:s)?';

function postProcessIngredientName(name) {
  let n = normSpaces(name);

  if (/^huile\s+olive\b/i.test(n)) n = n.replace(/^huile\s+olive\b/i, "huile d'olive");
  n = n.replace(/^de\s+/i, '');

  return n;
}

// micro-fix OCR : parfois "1 l de lait" => "11 de lait"
function fixCommonOcrQuantityUnitBugs(rawLine) {
  let s = normSpaces(rawLine);

  // "11 de lait" / "11 de eau" / "11 d’eau" -> "1 l de ..."
  s = s.replace(/\b11\s+(de|d['’])\s*(lait|eau|crème|creme)\b/i, '1 l $1 $2');

  // "1l" collé
  s = s.replace(/\b1l\b/gi, '1 l');

  // parfois le OCR met "—" ou "·" ou "." en tête
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

  // priorité : si c’est une vraie étape (verbe / numérotée), ce n’est PAS un ingrédient
  if (looksLikeStepLine(raw)) return null;

  // "un peu de sel"
  let m = raw.match(/^(un peu de|selon goût|au goût)\s+(.+)$/i);
  if (m) {
    return { name: postProcessIngredientName(m[2]), quantity: 0, unit: '' };
  }

  // Puces / tirets (ingrédients réseaux)
  const l = raw.replace(/^[-•*]\s+/, '');

  // "Sel & poivre" => on garde "sel" (et poivre si ligne séparée)
  if (/^sel\s*&\s*poivre$/i.test(l)) {
    return { name: 'sel', quantity: 0, unit: '' };
  }
  if (/^poivre$/i.test(l)) {
    return { name: 'poivre', quantity: 0, unit: '' };
  }

  // "400 g de ..." / "1 l de ..." / "200g flocons ..."
  m = l.match(new RegExp(`^${QTY_USED}\\s*(kg|g|mg|l|dl|cl|ml)\\b\\s*(?:de\\s+|d['’]\\s*)?(.+)$`, 'i'));
  if (m) {
    const qty = parseQuantityFR(m[1]);
    const unit = normalizeUnit(m[2]);
    const name = postProcessIngredientName(m[3]);
    if (name) return { name, quantity: qty ?? 0, unit };
  }

  // CUILLÈRE À/A CAFÉ
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

  // CUILLÈRE À/A SOUPE
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

  // "2 gousses d'ail" / "3 pièces ..."
  m = l.match(/^(\d+)\s+(gousses?|tranches?|sachets?|verres?|tasses?|pièces?|pieces?)\s+(?:de\s+|d['’])?(.+)$/i);
  if (m) {
    const qty = parseQuantityFR(m[1]);
    const unit = normalizeUnit(m[2]);
    const name = postProcessIngredientName(m[3]);
    if (name) return { name, quantity: qty ?? 0, unit: unit || '' };
  }

  // "1 oignon" => pièce
  m = l.match(/^(\d+)\s+(.+)$/);
  if (m) {
    const qty = parseQuantityFR(m[1]);
    const name = postProcessIngredientName(m[2]);
    if (name) return { name, quantity: qty ?? 0, unit: 'pièce' };
  }

  return null;
}

function beautifyIngredients(items) {
  const out = [];
  const seen = new Set();

  for (const it of items) {
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

  // coupe à "Afficher la suite" (Facebook/IG)
  t = t.replace(/\s*(?:\.\.\.|…)?\s*afficher la suite.*$/i, '');

  // enlève les "..." ou "…" restants en fin
  t = t.replace(/\s*(?:\.\.\.|…)\s*$/g, '');

  return normSpaces(t);
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

/**
 * ✅ Patch 1) : chercher un vrai titre "explicite" dans les premières lignes (pas seulement 16)
 * - ignore bruit / headers / ingrédients / étapes / continuations d’étapes
 * - renvoie le meilleur candidat ou null
 */
function findExplicitTitleInFirstLines(lines, maxScan = 60) {
  const scan = lines.slice(0, maxScan).map(normSpaces).filter(Boolean);
  const candidates = [];

  for (let i = 0; i < scan.length; i++) {
    const raw = scan[i];

    const t0 = cleanTitleCandidate(raw);
    const t = sanitizePickedTitle(t0);
    if (!t) continue;

    if (looksLikeStatusBarNoise(t)) continue;
    if (looksLikeDateNoise(t)) continue;
    if (looksLikeCountersNoise(t)) continue;
    if (looksLikeSocialNoise(t)) continue;

    if (isIngredientsHeader(t)) continue;
    if (isPreparationHeader(t)) continue;
    if (extractServingsFromLine(t)) continue;

    // jamais un ingrédient / une étape / une continuation d'étape
    if (parseOcrIngredient(t)) continue;
    if (looksLikeStepLine(t)) continue;
    if (i > 0 && looksLikeStepContinuation(scan[i - 1], t)) continue;

    if (/^(sel|poivre|sel\s*&\s*poivre)\b/i.test(t)) continue;
    if (/^(temps|notes?)\b/i.test(t)) continue;

    // contraintes titre
    if (t.length < 6 || t.length > 80) continue;
    if (/\d/.test(t)) continue;

    // petit bonus : titres ont souvent une majuscule quelque part
    const hasUpper = /[A-ZÀ-ÖØ-Þ]/.test(t);
    candidates.push({ t, score: (hasUpper ? 10 : 0) + (maxScan - i) });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].t;
}

function guessTitleFromLines(lines) {
  const head = lines.slice(0, 16).map(normSpaces).filter(Boolean);

  /**
   * ✅ Patch 2) : priorité au vrai titre s’il existe (même s’il est après les 16 premières lignes)
   * Sinon on garde EXACTEMENT le comportement actuel (fallback ingrédients).
   */
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

  // ✅ B) empêche une continuation d’étape de devenir un titre
  let prev = '';
  for (const l of head) {
    let t = cleanTitleCandidate(l);
    t = sanitizePickedTitle(t);
    if (!t) {
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

    // continuation d'étape numérotée => pas un titre
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

  // fragments fréquents OCR sur image ingrédients
  if (/^\d{1,4}$/.test(t)) return true; // ex: "100"
  if (/^(de|d['’])\b/i.test(t)) return true; // ex: "de beurre de"
  if (/^(kg|g|mg|l|dl|cl|ml)\b/i.test(t)) return true;
  if (/^(grill[eé]es?|concass[eé]es?)\b/i.test(t)) return true; // ex: "grillees", "concassees"

  // ligne courte "nom seul" possible (ex: "cacahuete")
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

    // si buffer est un nombre seul, ou finit par "de", ou la prochaine est un fragment "de ..."
    const bufIsNumber = /^\d{1,4}$/.test(buffer);
    const bufEndsDe = /\b(de|d['’])\s*$/i.test(buffer);
    const nextStartsDe = /^(de|d['’])\b/i.test(line);
    const nextIsFragment = isIngredientFragmentLine(line);

    if (bufIsNumber || bufEndsDe || nextStartsDe || nextIsFragment) {
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

  // On regarde les 25 dernières lignes max
  const start = Math.max(0, stepLines.length - 25);
  const tail = stepLines.slice(start);

  // Cherche un bloc en fin qui contient au moins 2 lignes "ingrédient-like"
  // et qui apparaît après les étapes (typiquement après "6.")
  let lastIngredientLikeIdx = -1;
  let ingredientLikeCount = 0;

  for (let i = 0; i < tail.length; i++) {
    const l = normSpaces(tail[i]);

    // ignore évident bruit social / header / date
    if (looksLikeStatusBarNoise(l) || looksLikeDateNoise(l) || looksLikeCountersNoise(l) || looksLikeSocialNoise(l)) continue;
    if (isIngredientsHeader(l) || isPreparationHeader(l)) continue;

    const parsed = parseOcrIngredient(l);
    const like = !!parsed || isIngredientFragmentLine(l) || /^\d{1,4}\s*(kg|g|mg|l|dl|cl|ml)\b/i.test(l);

    if (like) {
      ingredientLikeCount++;
      lastIngredientLikeIdx = i;
    }
  }

  // Pas assez d’indices => on ne touche à rien
  if (ingredientLikeCount < 2 || lastIngredientLikeIdx < 0) return { ingredientLines, stepLines };

  // On prend le bloc depuis la première ligne "ingrédient-like" du tail jusqu'à la fin
  let firstIdx = -1;
  for (let i = 0; i <= lastIngredientLikeIdx; i++) {
    const l = normSpaces(tail[i]);
    const parsed = parseOcrIngredient(l);
    const like = !!parsed || isIngredientFragmentLine(l) || /^\d{1,4}\s*(kg|g|mg|l|dl|cl|ml)\b/i.test(l);
    if (like) {
      firstIdx = i;
      break;
    }
  }

  if (firstIdx < 0) return { ingredientLines, stepLines };

  const moveBlock = tail.slice(firstIdx).map(normSpaces).filter(Boolean);

  // On recolle les fragments (100 / de beurre de / cacahuete)
  const joinedMoveBlock = joinWrappedLinesForIngredients(moveBlock);

  const newStepLines = stepLines.slice(0, start + firstIdx);
  const newIngredientLines = [...ingredientLines, ...joinedMoveBlock];

  return { ingredientLines: newIngredientLines, stepLines: newStepLines };
}

/* =========================
   SPLIT (ingredients vs steps)
========================= */

function splitIngredientsAndSteps(lines) {
  const L = lines.map(normSpaces).filter(Boolean);

  // servings
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

      // ✅ B) si on a une étape numérotée, et la ligne suivante est une continuation => on est en steps
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

        // ✅ B) bascule en steps aussi sur continuation d’étape numérotée
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

  // ✅ C) retire un bloc ingrédients en fin de steps (cas image ingrédients après étapes)
  const moved = extractTrailingIngredientBlock({ ingredientLines, stepLines });
  ingredientLines = moved.ingredientLines;
  stepLines = moved.stepLines;

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
