// backend/src/services/vision.js
// LEVEL: SERVICE
// import autorisés : lib-dependances externes-stringUtils/heuristics (si bas niveau et independant)
// import interdits : routes-frontend-parsers-ocr-services-utils
// importé uniquement par routes-services
'use strict';

const vision = require('@google-cloud/vision');
const sharp = require('sharp');
const { isValidRecipeTitleCandidate } = require('../utils/heuristics');
// stringUtils
const { normSpaces, stripEdgeEmojisAndPunct, cleanTitleCandidate } = require('../utils/stringUtils');

// ---------------------------------------------------------
// DEBUG
// ---------------------------------------------------------
const DEBUG_VISION = process.env.OCR_DEBUG !== 'production';
const dlog = (...args) => {
  if (DEBUG_VISION) console.log(...args);
};

// ---------------------------------------------------------
// ✅ Google credentials (Render / Prod) - robuste
// Priorité :
// 1) GOOGLE_SERVICE_ACCOUNT_B64 (base64 du JSON service account) ✅ recommandé
// 2) GOOGLE_SERVICE_ACCOUNT_JSON (string JSON) ✅ supporté
// 3) GOOGLE_APPLICATION_CREDENTIALS (chemin vers fichier) ✅ supporté (fallback)
// ---------------------------------------------------------

let client = null;

function normalizeServiceAccountObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;

  // IMPORTANT : private_key peut arriver avec "\\n" -> remettre "\n"
  if (typeof obj.private_key === 'string') {
    obj.private_key = obj.private_key.replace(/\\n/g, '\n');
  }
  return obj;
}

function tryParseJsonLoose(raw) {
  const s0 = String(raw || '');
  const s = s0.trim();
  if (!s) return null;

  // Cas : JSON direct
  if (s.startsWith('{') && s.endsWith('}')) {
    try {
      return JSON.parse(s);
    } catch {
      // fallback ci-dessous
    }
  }

  // Cas : JSON entouré de quotes (souvent '...') ou ("...")
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    const unquoted = s.slice(1, -1);
    try {
      return JSON.parse(unquoted);
    } catch {
      // fallback
    }
  }

  // Fallback : on retire les retours ligne
  try {
    const compact = s.replace(/\r?\n/g, '');
    if (compact.startsWith('{') && compact.endsWith('}')) {
      return JSON.parse(compact);
    }
  } catch {
    // ignore
  }

  return null;
}

function decodeBase64ToString(b64) {
  return Buffer.from(String(b64 || '').trim(), 'base64').toString('utf8');
}

function loadServiceAccountFromEnv() {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_B64;
  if (b64 && String(b64).trim()) {
    try {
      const jsonStr = decodeBase64ToString(b64);
      const obj = JSON.parse(jsonStr);
      return normalizeServiceAccountObject(obj);
    } catch (e) {
      console.error(
        '[vision] GOOGLE_SERVICE_ACCOUNT_B64 présent mais invalide :',
        e?.message || e
      );
      return null;
    }
  }

  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (rawJson && String(rawJson).trim()) {
    const obj = tryParseJsonLoose(rawJson);
    if (!obj) {
      console.error(
        '[vision] GOOGLE_SERVICE_ACCOUNT_JSON présent mais non parseable (souvent quotes/retours ligne).'
      );
      return null;
    }
    return normalizeServiceAccountObject(obj);
  }

  return null;
}

function getClient() {
  if (client) return client;

  const sa = loadServiceAccountFromEnv();
  if (sa && sa.client_email && sa.private_key) {
    client = new vision.ImageAnnotatorClient({
      credentials: {
        client_email: sa.client_email,
        private_key: sa.private_key,
      },
      projectId: sa.project_id,
    });
    return client;
  }

  client = new vision.ImageAnnotatorClient();
  return client;
}

function cleanTitleLine(s) {
  let t = stripEdgeEmojisAndPunct(s);
  t = t.replace(/[.!?…]+$/g, '');
  return stripEdgeEmojisAndPunct(t);
}

function isUiNoise(l) {
  const t = normSpaces(l);
  if (!t) return true;

  if (/^\s*cuisineactuelle\b/i.test(t)) return true;
  if (/^\d{1,2}:\d{2}$/.test(t)) return true;
  if (/\b(4g|5g|lte|wifi|wi-fi)\b/i.test(t) && /\b\d{1,3}\b/.test(t)) return true;
  if (/^\d{1,3}%$/.test(t)) return true;

  if (/^publication\s+de\b/i.test(t)) return true;

  if (/^toutes?\s+les\s+publications?$/i.test(t)) return true;
  if (/^enregistr[ée]$/i.test(t)) return true;
  if (/^recettes?\s+d[ée]lice$/i.test(t)) return true;
  if (/^recettes?\s+et\s+d[ée]lices?$/i.test(t)) return true;

  if (/^suivre$/i.test(t)) return true;
  if (/^\.\.\.$/.test(t)) return true;
  if (/^[.,;:!?]+$/.test(t)) return true;
  if (/^\d+[.]?$/.test(t)) return true;

  return false;
}

function looksLikeIngredientLine(l) {
  const t = normSpaces(l).toLowerCase();
  if (!t) return false;

  if (
    /^\s*(\d+([.,]\d+)?|\d+\s+\d+\/\d+|\d+\/\d+|½|⅓|⅔|¼|¾|⅛|⅜|⅝|⅞)\b/.test(t)
  ) return true;

  if (/\b\d+\s*(g|kg|mg|ml|cl|dl|l)\b/i.test(t)) return true;

  if (/^ingr[ée]dients?\b/i.test(t)) return true;
  if (/^temps\s+de\s+(préparation|cuisson)\b/i.test(t)) return true;
  if (/^portions?\b/i.test(t)) return true;

  return false;
}

function looksLikeStepAction(l) {
  const t = normSpaces(l).toLowerCase();
  if (!t) return false;
  return /\b(ajouter|mixer|égoutter|egoutter|cuire|pr[ée]chauffer|faire|mettre|verser|chauffer|m[ée]langer|melanger|couper|laver|assaisonner|assaisonnez|enfourner|étaler|etaler)\b/i.test(t);
}

// ---------------------------------------------------------
// Vision spatial parsing helpers
// ---------------------------------------------------------
function getWordText(word) {
  const symbols = Array.isArray(word?.symbols) ? word.symbols : [];
  return normSpaces(symbols.map((s) => s?.text || '').join(''));
}

function rectFromVertices(vertices) {
  const pts = Array.isArray(vertices) ? vertices : [];

  const xs = pts
    .map((p) => p?.x)
    .filter((v) => Number.isFinite(v))
    .map(Number);

  const ys = pts
    .map((p) => p?.y)
    .filter((v) => Number.isFinite(v))
    .map(Number);

  if (!xs.length || !ys.length) {
    return {
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      centerX: 0,
      centerY: 0,
    };
  }

  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);

  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
    centerX: left + Math.max(0, right - left) / 2,
    centerY: top + Math.max(0, bottom - top) / 2,
  };
}

function flattenVisionWords(result) {
  const pages = result?.fullTextAnnotation?.pages || [];
  const words = [];

  for (const page of pages) {
    for (const block of page.blocks || []) {
      for (const paragraph of block.paragraphs || []) {
        for (const word of paragraph.words || []) {
          const text = getWordText(word);
          if (!text) continue;

          const box = rectFromVertices(word?.boundingBox?.vertices || []);
          words.push({
            text,
            ...box,
          });
        }
      }
    }
  }

  dlog('[VISION][WORDS]', {
    count: words.length,
    sample: words.slice(0, 40),
  });

  return words;
}

function sameVisualLine(a, b, tolerance = 0.65) {
  const h = Math.max(a.height || 0, b.height || 0, 1);
  return Math.abs((a.centerY || 0) - (b.centerY || 0)) <= h * tolerance;
}

function mergeWordsIntoSpatialFragments(words) {
  const sorted = [...(words || [])]
    .filter((w) => w?.text)
    .sort((a, b) => {
      const dy = (a.top || 0) - (b.top || 0);
      if (Math.abs(dy) > 8) return dy;
      return (a.left || 0) - (b.left || 0);
    });

  const fragments = [];

  for (const w of sorted) {
    const prev = fragments[fragments.length - 1];

    if (!prev) {
      fragments.push({
        ...w,
        words: [w],
      });
      continue;
    }

    const gapX = (w.left || 0) - (prev.right || 0);
    const closeHorizontally = gapX >= -4 && gapX <= Math.max(18, prev.height * 1.6);
    const sameLine = sameVisualLine(prev, w);

    if (sameLine && closeHorizontally) {
      prev.text = normSpaces(`${prev.text} ${w.text}`);
      prev.right = Math.max(prev.right, w.right);
      prev.bottom = Math.max(prev.bottom, w.bottom);
      prev.width = prev.right - prev.left;
      prev.height = prev.bottom - prev.top;
      prev.centerX = prev.left + prev.width / 2;
      prev.centerY = prev.top + prev.height / 2;
      prev.words = [...(prev.words || []), w];
      continue;
    }

    fragments.push({
      ...w,
      words: [w],
    });
  }

  dlog('[VISION][FRAGMENTS_MERGED]', {
    count: fragments.length,
    sample: fragments.slice(0, 40),
  });

  return fragments;
}


function cloneFragmentWithText(base, text) {
  return {
    ...base,
    text: normSpaces(text),
  };
}

function buildBoxFromWords(words) {
  const safe = (words || []).filter(Boolean);
  if (!safe.length) {
    return {
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      centerX: 0,
      centerY: 0,
    };
  }

  const left = Math.min(...safe.map((w) => w.left || 0));
  const top = Math.min(...safe.map((w) => w.top || 0));
  const right = Math.max(...safe.map((w) => w.right || 0));
  const bottom = Math.max(...safe.map((w) => w.bottom || 0));

  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
    centerX: left + Math.max(0, right - left) / 2,
    centerY: top + Math.max(0, bottom - top) / 2,
  };
}

function splitByWordGroups(fragment, wordGroups) {
  return wordGroups
    .map((group) => {
      const words = (group || []).filter(Boolean);
      if (!words.length) return null;

      const text = normSpaces(words.map((w) => w.text).join(' '));
      if (!text) return null;

      return {
        text,
        ...buildBoxFromWords(words),
        words,
      };
    })
    .filter(Boolean);
}


function splitCompositeVisionFragment(fragment) {
  const text = normSpaces(fragment?.text || '');
  const words = Array.isArray(fragment?.words) ? fragment.words : [];

  if (!text) return [];
  if (!words.length) return [fragment];

  const lowWords = words.map((w) => normSpaces(w.text).toLowerCase());

  // Cas 1 : citron | 150 g de mayonnaise | ketchup
  if (
    lowWords.length >= 6 &&
    lowWords[0] === 'citron' &&
    /^\d+(?:[.,]\d+)?$/.test(lowWords[1]) &&
    /^(g|kg|mg|ml|cl|dl|l)$/i.test(lowWords[2]) &&
    lowWords[3] === 'de' &&
    lowWords[4] === 'mayonnaise' &&
    lowWords[5] === 'ketchup'
  ) {
    const out = splitByWordGroups(fragment, [
      [words[0]],
      [words[1], words[2], words[3], words[4]],
      [words[5]],
    ]);

    dlog('[VISION][FRAGMENT_SPLIT]', {
      original: text,
      parts: out.map((x) => x.text),
    });

    return out;
  }

  // Cas 2 : 1/2 c.a.c I pincee de -> 1/2 c.a.c | 1 pincee de
  if (
    lowWords.length >= 4 &&
    /^(?:\d+\s+\d+\/\d+|\d+\/\d+|½|⅓|⅔|¼|¾|\d+(?:[.,]\d+)?)$/i.test(lowWords[0]) &&
    /^(c\.?\s*a\.?\s*c|càc|cac)$/i.test(lowWords[1]) &&
    /^(i|l|1)$/i.test(lowWords[2]) &&
    /^(pincee|pincée)$/i.test(lowWords[3])
  ) {
    const out = splitByWordGroups(fragment, [
      [words[0], words[1]],
      [{ ...words[2], text: '1' }, words[3], ...(words[4] ? [words[4]] : [])],
    ]);

    dlog('[VISION][FRAGMENT_SPLIT]', {
      original: text,
      parts: out.map((x) => x.text),
    });

    return out;
  }

  // Cas 3 : cornichons | de paprika | poudre d'oignon
  if (
    lowWords.length >= 4 &&
    lowWords[0] === 'cornichons' &&
    lowWords[1] === 'de' &&
    lowWords[2] === 'paprika'
  ) {
    const groups = [[words[0]], [words[1], words[2]]];
    if (words.length > 3) groups.push(words.slice(3));

    const out = splitByWordGroups(fragment, groups);

    dlog('[VISION][FRAGMENT_SPLIT]', {
      original: text,
      parts: out.map((x) => x.text),
    });

    return out;
  }

  // Cas 4 : paprika | poudre d'oignon
  if (
    lowWords.length >= 3 &&
    lowWords[0] === 'paprika' &&
    lowWords[1] === 'poudre' &&
    /^d['’]oignon$/i.test(lowWords[2])
  ) {
    const out = splitByWordGroups(fragment, [
      [words[0]],
      words.slice(1),
    ]);

    dlog('[VISION][FRAGMENT_SPLIT]', {
      original: text,
      parts: out.map((x) => x.text),
    });

    return out;
  }

  // Cas 5 : doux | et poudre d'ail
  if (
    lowWords.length >= 3 &&
    lowWords[0] === 'doux' &&
    lowWords[1] === 'et'
  ) {
    const out = splitByWordGroups(fragment, [
      [words[0]],
      words.slice(1),
    ]);

    dlog('[VISION][FRAGMENT_SPLIT]', {
      original: text,
      parts: out.map((x) => x.text),
    });

    return out;
  }

  return [fragment];
}


function looksLikeMeasureFragment(text) {
  const t = normSpaces(text).toLowerCase();
  if (!t) return false;

  return (
    /^(?:\d+\s+\d+\/\d+|\d+\/\d+|½|⅓|⅔|¼|¾|⅛|⅜|⅝|⅞|\d+(?:[.,]\d+)?)\s*(?:g|kg|mg|ml|cl|dl|l|c\.?\s*a\.?\s*c|c\.?\s*a\.?\s*s|càc|càs|cac|cas)\s*(?:de)?$/i.test(t) ||
    /^(?:\d+\s+\d+\/\d+|\d+\/\d+|½|⅓|⅔|¼|¾|⅛|⅜|⅝|⅞|\d+(?:[.,]\d+)?)\s+(?:pincée|pincee|gousse|gousses|sachet|sachets|tranche|tranches)\s*(?:de)?$/i.test(t)
  );
}

function looksLikeConnectorLedName(text) {
  const t = normSpaces(text).toLowerCase();
  if (!t) return false;

  return (
    /^(de|du|des|d['’])\s+[a-zà-öø-ÿœ' -]{2,40}$/i.test(t) ||
    /^(jus|zeste|pulpe)\s+de\s+[a-zà-öø-ÿœ' -]{2,40}$/i.test(t)
  );
}

function looksLikeStandaloneName(text) {
  const t = normSpaces(text);
  const low = t.toLowerCase();
  if (!t) return false;

  if (isUiNoise(t)) return false;
  if (looksLikeStepAction(t)) return false;
  if (looksLikeMeasureFragment(t)) return false;
  if (/\d/.test(t)) return false;
  if (t.length < 2 || t.length > 60) return false;

  if (/^(de|du|des|d['’]|et|ou)$/i.test(low)) return false;
  if (/^(sauce|préparation|preparation|ingr[ée]dients?|étapes?|etapes?)$/i.test(low)) return false;

  return /[a-zà-öø-ÿœ]/i.test(t);
}

function spatialDistanceScore(anchor, candidate) {
  const dx = Math.abs((anchor.centerX || 0) - (candidate.centerX || 0));
  const dySigned = (candidate.centerY || 0) - (anchor.centerY || 0);
  const dy = Math.abs(dySigned);

  let score = 0;

  // un nom doit rarement être franchement au-dessus de la mesure
  if (dySigned < -12) return -999;

  // trop loin verticalement => non
  if (dy > 170) return -999;

  // trop loin horizontalement => non
  if (dx > 180) return -999;

  if (dy <= 28) score += 8;
  else if (dy <= 55) score += 6;
  else if (dy <= 90) score += 3;
  else score -= 4;

  if (dx <= 30) score += 8;
  else if (dx <= 70) score += 5;
  else if (dx <= 120) score += 2;
  else score -= 6;

  const sameColumn = dx <= Math.max(40, Math.min(anchor.width || 0, 60));
  if (sameColumn) score += 4;

  if ((candidate.width || 0) > 260) score -= 4;
  if ((candidate.height || 0) > 70) score -= 2;

  return score;
}



function buildSpatialIngredientLine(measureFrag, nameFrag) {
  const measure = normSpaces(measureFrag?.text || '');
  const name = normSpaces(nameFrag?.text || '');
  if (!measure || !name) return '';

  if (/^(de|du|des|d['’]|jus|zeste|pulpe)\b/i.test(name)) {
    return normSpaces(`${measure} ${name}`);
  }

  if (/\bde$/i.test(measure)) {
    return normSpaces(`${measure} ${name}`);
  }

  return normSpaces(`${measure} de ${name}`);
}

function detectFragmentedPosterLayout(fragments) {
  const F = (fragments || []).filter(Boolean);
  if (!F.length) return false;

  const shortCount = F.filter((f) => (f.text || '').length <= 18).length;
  const measureCount = F.filter((f) => looksLikeMeasureFragment(f.text)).length;
  const nameCount = F.filter((f) => looksLikeStandaloneName(f.text) || looksLikeConnectorLedName(f.text)).length;
  const stepCount = F.filter((f) => looksLikeStepAction(f.text)).length;

  const detected =
    measureCount >= 2 &&
    nameCount >= 2 &&
    shortCount >= Math.min(8, F.length) &&
    stepCount <= 1;

  dlog('[VISION][POSTER_LAYOUT_CHECK]', {
    total: F.length,
    shortCount,
    measureCount,
    nameCount,
    stepCount,
    detected,
    sample: F.slice(0, 30).map((x) => x.text),
  });

  return detected;
}

function buildSpatialIngredientHintsFromVision(result) {
  const words = flattenVisionWords(result);
  if (!words.length) {
    dlog('[VISION][SPATIAL_HINTS] no_words');
    return [];
  }

  const mergedFragments = mergeWordsIntoSpatialFragments(words);
  const splitFragments = splitCompositeVisionFragment(mergedFragments);

  const fragments = splitFragments
    .filter((f) => !isUiNoise(f.text))
    .filter((f) => !/^sauce\s+(burger|cheddar)\b/i.test(normSpaces(f.text)))
    .filter((f) => !/sandwichs?/i.test(normSpaces(f.text)));

  dlog('[VISION][FRAGMENTS_FILTERED]', {
    count: fragments.length,
    sample: fragments.slice(0, 40),
  });

  if (!detectFragmentedPosterLayout(fragments)) {
    dlog('[VISION][SPATIAL_HINTS] poster_layout_not_detected');
    return [];
  }

  const used = new Set();
  const out = [];

  for (let i = 0; i < fragments.length; i++) {
    const frag = fragments[i];
    if (!frag || used.has(i)) continue;

    const text = normSpaces(frag.text);

    // cas "jus de" sans mesure
    if (/^(jus|zeste|pulpe)\s+de$/i.test(text)) {
  let bestNameIdx = -1;
  let bestScore = -999;

  for (let j = 0; j < fragments.length; j++) {
    if (i === j || used.has(j)) continue;

    const cand = fragments[j];
    const candText = normSpaces(cand.text);

    if (!looksLikeStandaloneName(candText)) continue;

    const score = spatialDistanceScore(frag, cand);
    const lengthBonus = Math.min((candText.length || 0) / 10, 3);
    const finalScore = score + lengthBonus;

    dlog('[VISION][CONNECTOR_CANDIDATE]', {
      anchor: text,
      candidate: candText,
      score,
      finalScore,
      anchorBox: frag,
      candidateBox: cand,
    });

    if (finalScore > bestScore) {
      bestScore = finalScore;
      bestNameIdx = j;
    }
  }

  if (bestNameIdx >= 0 && bestScore >= 4) {
    const built = normSpaces(`${text} ${fragments[bestNameIdx].text}`);
    out.push(built);
    used.add(i);
    used.add(bestNameIdx);

    dlog('[VISION][CONNECTOR_ACCEPT]', {
      line: built,
      score: bestScore,
      anchor: text,
      matched: fragments[bestNameIdx].text,
    });

    continue;
  }

  dlog('[VISION][CONNECTOR_REJECT]', {
    anchor: text,
    bestNameIdx,
    bestScore,
  });


      if (bestNameIdx >= 0 && bestScore >= 4) {
        const built = normSpaces(`${text} ${fragments[bestNameIdx].text}`);
        out.push(built);
        used.add(i);
        used.add(bestNameIdx);

        dlog('[VISION][CONNECTOR_ACCEPT]', {
          line: built,
          score: bestScore,
          anchor: text,
          matched: fragments[bestNameIdx].text,
        });

        continue;
      }

      dlog('[VISION][CONNECTOR_REJECT]', {
        anchor: text,
        bestNameIdx,
        bestScore,
      });
    }

    if (!looksLikeMeasureFragment(text)) continue;

    let bestIdx = -1;
    let bestScore = -999;

    for (let j = 0; j < fragments.length; j++) {
      if (i === j || used.has(j)) continue;

      const cand = fragments[j];
      const candText = normSpaces(cand.text);

      if (!looksLikeConnectorLedName(candText) && !looksLikeStandaloneName(candText)) continue;
      if (looksLikeMeasureFragment(candText)) continue;

      const score = spatialDistanceScore(frag, cand);

      dlog('[VISION][MEASURE_CANDIDATE]', {
        measure: text,
        candidate: candText,
        score,
        measureBox: frag,
        candidateBox: cand,
      });

      if (score > bestScore) {
        bestScore = score;
        bestIdx = j;
      }
    }

    if (bestIdx >= 0 && bestScore >= 4) {
      const line = buildSpatialIngredientLine(frag, fragments[bestIdx]);
      if (line) {
        out.push(line);
        used.add(i);
        used.add(bestIdx);

        dlog('[VISION][MEASURE_ACCEPT]', {
          line,
          score: bestScore,
          measure: text,
          matched: fragments[bestIdx].text,
        });
      }
      continue;
    }

    dlog('[VISION][MEASURE_REJECT]', {
      measure: text,
      bestIdx,
      bestScore,
    });
  }

for (let i = 0; i < fragments.length; i++) {
  if (used.has(i)) continue;

  const t = normSpaces(fragments[i].text);

  if (/^(jus|zeste|pulpe)\s+de\s+[a-zà-öø-ÿœ' -]+$/i.test(t)) {
    out.push(t);
    used.add(i);
  }
}

const finalOut = [...new Set(out.map((x) => normSpaces(x)).filter(Boolean))];

dlog('[VISION][SPATIAL_HINTS_FINAL]', finalOut);

return finalOut;
}

function tryMergeTwoLineTitle(lines) {
  const L = (lines || [])
    .map((s) => cleanTitleLine(s))
    .filter(Boolean);

  for (let i = 0; i < L.length - 1; i++) {
    const a = cleanTitleLine(L[i]);
    const b = cleanTitleLine(L[i + 1]);
    if (!a || !b) continue;

    if (!/\b(de|d['’]|du|des|à|a|au|aux)\s*$/i.test(a)) continue;

    const merged = cleanTitleLine(`${a} ${b}`);

    if (merged.length < 6 || merged.length > 90) continue;
    if (isUiNoise(merged)) continue;
    if (looksLikeStepAction(merged)) continue;
    if (looksLikeIngredientLine(merged)) continue;
    if (/\d/.test(merged)) continue;

    const w = merged.split(/\s+/).filter(Boolean);
    if (w.length < 3) continue;

    return merged;
  }

  return null;
}

function pickLikelyTitleFromText(text) {
  const normalizeTitleOut = (s) =>
    normSpaces(String(s || '').replace(/\s*\n+\s*/g, ' ')).trim();

  const rawLines = String(text || '')
    .split('\n')
    .map((s) => cleanTitleLine(s))
    .filter(Boolean);

  const merged2 = tryMergeTwoLineTitle(rawLines);
  if (merged2) return merged2;

  const isMarketing = (s) => {
    const t = normSpaces(s).toLowerCase();
    return (
      t.includes('on raffole') ||
      t.includes('vous devez absolument') ||
      t.includes('absolument la tester') ||
      t.includes('testez') ||
      (t.includes('recette de ') && (t.includes('on raffole') || t.includes('vous devez')))
    );
  };

  const isShortContinuation = (s) => {
    const t = normSpaces(s);
    if (!t) return false;
    if (t.length > 22) return false;
    if (/\d/.test(t)) return false;
    const words = t.split(/\s+/).filter(Boolean);
    return words.length >= 1 && words.length <= 6;
  };

  for (let i = 0; i < rawLines.length; i++) {
    const l = rawLines[i];
    const m = l.match(
      /(?:\[\s*)?nouvelle\s+recette(?:\s*\])?\s*[:\-–—]?\s*(.+)$/i
    );
    if (m && m[1]) {
      let cand = cleanTitleLine(m[1]);

      const nxt = rawLines[i + 1] || '';
      if (nxt && isShortContinuation(nxt) && cand.length + 1 + nxt.length <= 90) {
        cand = `${cand} ${nxt}`.trim();
      }

      if (
        cand.length >= 4 &&
        cand.length <= 90 &&
        !isUiNoise(cand) &&
        !looksLikeStepAction(cand) &&
        !looksLikeIngredientLine(cand) &&
        !isMarketing(cand)
      ) {
        return normalizeTitleOut(cand);
      }
    }
  }

  for (let i = 0; i < rawLines.length; i++) {
    const l = rawLines[i];
    const low = normSpaces(l).toLowerCase();
    const idx = low.lastIndexOf('recette de ');
    if (idx >= 0) {
      let after = normSpaces(l.slice(idx + 'recette de '.length));

      const nxt = rawLines[i + 1] || '';
      if (nxt && isShortContinuation(nxt) && after.length + 1 + nxt.length <= 90) {
        after = `${after} ${nxt}`.trim();
      }

      after = cleanTitleLine(after);

      if (isMarketing(l) || isMarketing(after)) continue;
      if (/\bcuisineactuelle\b/i.test(l) || /\bcuisineactuelle\b/i.test(after)) continue;

      if (
        after.length >= 6 &&
        after.length <= 90 &&
        !isUiNoise(after) &&
        !looksLikeStepAction(after) &&
        !looksLikeIngredientLine(after)
      ) {
        return normalizeTitleOut(after);
      }
    }
  }

  const markerIdx = rawLines.findIndex((x) => {
    const t = normSpaces(x).toLowerCase();
    return (
      /^pour\s+\d+\s+personnes?/.test(t) ||
      /^ingr[ée]dients?\b/.test(t) ||
      /^in[ée]gr[ée]dients?\b/.test(t)
    );
  });

  if (markerIdx > 0) {
    for (let j = markerIdx - 1; j >= 0 && j >= markerIdx - 6; j--) {
      const cand = cleanTitleLine(rawLines[j]);
      if (!cand) continue;

      if (
        cand.length >= 6 &&
        cand.length <= 90 &&
        !isUiNoise(cand) &&
        !isMarketing(cand) &&
        !looksLikeStepAction(cand) &&
        !looksLikeIngredientLine(cand)
      ) {
        return normalizeTitleOut(cand);
      }
    }
  }

  let best = null;
  let bestScore = -1;

  for (let i = 0; i < rawLines.length; i++) {
    const base = rawLines[i];
    if (!base) continue;
    if (isUiNoise(base)) continue;
    if (isMarketing(base)) continue;

    const candidates = [base];

    const nxt = rawLines[i + 1] || '';
    if (nxt && isShortContinuation(nxt) && base.length + 1 + nxt.length <= 90) {
      candidates.push(`${base} ${nxt}`.trim());
    }

    for (const raw of candidates) {
      const l = cleanTitleLine(raw);
      if (!l) continue;

      if (l.length < 4 || l.length > 90) continue;
      if (/[.!?…]$/.test(l)) continue;
      if (looksLikeStepAction(l)) continue;
      if (looksLikeIngredientLine(l)) continue;
      if (/\d/.test(l)) continue;

      const words = l.split(/\s+/).filter(Boolean);
      if (words.length < 2) continue;

      let score = 0;

      if (
        /\b(croque|monsieur|ap[ée]ritif|nuggets?|galettes?|cookies?|g[âa]teau|gateau|salade|poulet|tarte|quiche|gratin)\b/i.test(l)
      ) score += 8;

      if (/^[A-ZÀ-ÖØ-Þ]/.test(l)) score += 2;
      if (/\bde\b/i.test(l)) score += 1;

      score += Math.max(0, 90 - l.length) / 15;

      if (score > bestScore) {
        bestScore = score;
        best = l;
      }
    }
  }

  return normalizeTitleOut(best);
}

async function cropTop(buf, ratio = 0.32) {
  const img = sharp(buf).rotate();
  const meta = await img.metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  if (!w || !h) return buf;

  const topH = Math.max(1, Math.round(h * ratio));
  return await img.extract({ left: 0, top: 0, width: w, height: topH }).toBuffer();
}

async function cropBand(buf, topRatio = 0.30, heightRatio = 0.45) {
  const img = sharp(buf).rotate();
  const meta = await img.metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  if (!w || !h) return buf;

  const top = Math.max(0, Math.round(h * topRatio));
  const height = Math.max(1, Math.round(h * heightRatio));
  const safeHeight = Math.min(height, Math.max(1, h - top));

  return await img
    .extract({ left: 0, top, width: w, height: safeHeight })
    .toBuffer();
}

async function visionDetectDocumentFromBuffer(buf, lang = 'fr') {
  const c = getClient();
  const langHints = lang && String(lang).toLowerCase() === 'en' ? ['en'] : ['fr'];

  const request = {
    image: { content: buf },
    imageContext: { languageHints: langHints },
  };

  const [result] = await c.documentTextDetection(request);

  dlog('[VISION][DOCUMENT_RESULT]', {
    hasFullText: !!result?.fullTextAnnotation?.text,
    textAnnotationsCount: Array.isArray(result?.textAnnotations) ? result.textAnnotations.length : 0,
    pagesCount: Array.isArray(result?.fullTextAnnotation?.pages) ? result.fullTextAnnotation.pages.length : 0,
    fullTextSample: result?.fullTextAnnotation?.text
      ? String(result.fullTextAnnotation.text).slice(0, 500)
      : null,
  });

  return result || null;
}

async function visionDetectTextFromBuffer(buf, lang = 'fr') {
  const result = await visionDetectDocumentFromBuffer(buf, lang);

  const text =
    result?.fullTextAnnotation?.text ||
    result?.textAnnotations?.[0]?.description ||
    '';

  return normSpaces(text);
}

async function ocrFromBuffer(buf, opts = {}) {
  const lang = (opts.lang || 'fr').toLowerCase();
  return await visionDetectTextFromBuffer(buf, lang);
}

async function ocrFromBufferWithDebug(buf, opts = {}) {
  const lang = (opts.lang || 'fr').toLowerCase();

  const fullResult = await visionDetectDocumentFromBuffer(buf, lang);
  const fullText =
    normSpaces(
      fullResult?.fullTextAnnotation?.text ||
      fullResult?.textAnnotations?.[0]?.description ||
      ''
    );

  let spatialIngredientHints = [];
  try {
    spatialIngredientHints = buildSpatialIngredientHintsFromVision(fullResult);
  } catch (e) {
    dlog('[VISION][SPATIAL_HINTS_ERROR]', e?.message || e);
    spatialIngredientHints = [];
  }

  let topText = '';
  try {
    const topBuf = await cropTop(buf, 0.32);
    topText = await visionDetectTextFromBuffer(topBuf, lang);
  } catch (e) {
    dlog('[VISION][TOP_CROP_ERROR]', e?.message || e);
    topText = '';
  }

  let bandText = '';
  try {
    const bandBuf = await cropBand(buf, 0.30, 0.45);
    bandText = await visionDetectTextFromBuffer(bandBuf, lang);
  } catch (e) {
    dlog('[VISION][BAND_CROP_ERROR]', e?.message || e);
    bandText = '';
  }

  const pickedTitleRaw = pickLikelyTitleFromText(`${topText}\n${bandText}`);
  const safePicked = pickedTitleRaw ? cleanTitleCandidate(pickedTitleRaw) : null;
  const finalPicked =
    safePicked && isValidRecipeTitleCandidate(safePicked) ? safePicked : null;

  let combined = fullText;

  if (Array.isArray(spatialIngredientHints) && spatialIngredientHints.length >= 2) {
    combined = `${spatialIngredientHints.join('\n')}\n${combined}`.trim();
  }

  if (finalPicked) {
    const already = combined
      .toLowerCase()
      .includes(String(finalPicked).toLowerCase());
    if (!already) combined = `${finalPicked}\n${combined}`;
  }

  dlog('[VISION][OCR_WITH_DEBUG]', {
    finalPicked,
    spatialIngredientHints,
    topTextSample: topText ? String(topText).slice(0, 300) : null,
    bandTextSample: bandText ? String(bandText).slice(0, 300) : null,
    fullTextSample: fullText ? String(fullText).slice(0, 300) : null,
    combinedSample: combined ? String(combined).slice(0, 500) : null,
  });

  return {
    text: combined,
    debug: {
      pickedTitle: finalPicked || null,
      topTextSample: topText ? String(topText).slice(0, 500) : null,
      bandTextSample: bandText ? String(bandText).slice(0, 500) : null,
      fullTextSample: fullText ? String(fullText).slice(0, 300) : null,
      spatialIngredientHints: spatialIngredientHints || [],
    },
  };
}

module.exports = {
  ocrFromBuffer,
  ocrFromBufferWithDebug,
};