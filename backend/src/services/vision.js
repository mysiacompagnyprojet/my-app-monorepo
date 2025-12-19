// backend/src/services/vision.js
'use strict';

const vision = require('@google-cloud/vision');
const sharp = require('sharp');

// Client singleton
let client;
function getClient() {
  if (!client) client = new vision.ImageAnnotatorClient();
  return client;
}

function normSpaces(s) {
  return String(s || '')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// Retire emojis/pictos au début/fin + ponctuation “bordure”
function stripEdgeEmojisAndPunct(s) {
  let t = normSpaces(s);

  t = t
    // ponctuation/bullets au bord
    .replace(/^[\s·•\-\–—\*\.\,\;\:\(\)\[\]{}"“”'’]+/g, '')
    .replace(/[\s·•\-\–—\*\.\,\;\:\(\)\[\]{}"“”'’]+$/g, '')
    // emojis (range large)
    .replace(/^[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]+/gu, '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]+$/gu, '');

  // re-nettoie
  t = t
    .replace(/^[\s·•\-\–—\*\.\,\;\:\(\)\[\]{}"“”'’]+/g, '')
    .replace(/[\s·•\-\–—\*\.\,\;\:\(\)\[\]{}"“”'’]+$/g, '');

  return normSpaces(t);
}

function cleanTitleLine(s) {
  let t = stripEdgeEmojisAndPunct(s);
  // évite titres finissant par "." etc
  t = t.replace(/[.!?…]+$/g, '');
  return stripEdgeEmojisAndPunct(t);
}

function isUiNoise(l) {
  const t = normSpaces(l);
  if (!t) return true;

  if (/^\d{1,2}:\d{2}$/.test(t)) return true;
  if (/\b(4g|5g|lte|wifi|wi-fi)\b/i.test(t) && /\b\d{1,3}\b/.test(t)) return true;
  if (/^\d{1,3}%$/.test(t)) return true;

  // Facebook header
  if (/^publication\s+de\b/i.test(t)) return true;

  return false;
}

function looksLikeIngredientLine(l) {
  const t = normSpaces(l).toLowerCase();
  if (!t) return false;

  // commence par quantité/unité
  if (/^\s*(\d+([.,]\d+)?|\d+\s+\d+\/\d+|\d+\/\d+|½|⅓|⅔|¼|¾|⅛|⅜|⅝|⅞)\b/.test(t)) return true;
  if (/\b\d+\s*(g|kg|mg|ml|cl|dl|l)\b/i.test(t)) return true;

  // headers
  if (/^ingr[ée]dients?\b/i.test(t)) return true;
  if (/^temps\s+de\s+(préparation|cuisson)\b/i.test(t)) return true;
  if (/^portions?\b/i.test(t)) return true;

  return false;
}

function looksLikeStepAction(l) {
  const t = normSpaces(l).toLowerCase();
  if (!t) return false;
  return /\b(ajouter|mixer|égoutter|egoutter|cuire|pr[ée]chauffer|faire|mettre|verser|chauffer|m[ée]langer|melanger|couper|laver|assaisonner|assaisonnez|enfourner|étaler|etaler)\b/i.test(
    t
  );
}

function pickLikelyTitleFromText(text) {
  const lines = String(text || '')
    .split('\n')
    .map((s) => cleanTitleLine(s))
    .filter(Boolean);

  // 0) si une ligne "Nouvelle recette: X"
  for (const l of lines) {
    const m = l.match(/(?:\[\s*)?nouvelle\s+recette(?:\s*\])?\s*[:\-–—]?\s*(.+)$/i);
    if (m && m[1]) {
      const cand = cleanTitleLine(m[1]);
      if (
        cand.length >= 4 &&
        cand.length <= 90 &&
        !isUiNoise(cand) &&
        !looksLikeStepAction(cand) &&
        !looksLikeIngredientLine(cand)
      ) {
        return cand;
      }
    }
  }

  // 1) scoring : meilleure ligne “titre-like”
  let best = null;
  let bestScore = -1;

  for (const raw of lines) {
    const l = cleanTitleLine(raw);
    if (!l) continue;
    if (isUiNoise(l)) continue;

    // garde-fous
    if (l.length < 4 || l.length > 90) continue;
    if (/[.!?…]$/.test(l)) continue;
    if (looksLikeStepAction(l)) continue;
    if (looksLikeIngredientLine(l)) continue;
    if (/\d/.test(l)) continue;

    // au moins 2 mots
    const words = l.split(/\s+/).filter(Boolean);
    if (words.length < 2) continue;

    // score
    let score = 0;

    // bonus si contient un mot “plat”
    if (/\b(croque|monsieur|ap[ée]ritif|nuggets?|galettes?|cookies?|g[âa]teau|gateau|salade|poulet|tarte|quiche)\b/i.test(l))
      score += 8;

    // bonus si majuscules en début (souvent titre)
    if (/^[A-ZÀ-ÖØ-Þ]/.test(l)) score += 2;

    // bonus si contient "de" (souvent titre FR)
    if (/\bde\b/i.test(l)) score += 1;

    // bonus si longueur raisonnable (pas trop long)
    score += Math.max(0, 90 - l.length) / 15;

    if (score > bestScore) {
      bestScore = score;
      best = l;
    }
  }

  return best;
}

async function cropTop(buf, ratio = 0.32) {
  const img = sharp(buf).rotate(); // respecte EXIF orientation
  const meta = await img.metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  if (!w || !h) return buf;

  const topH = Math.max(1, Math.round(h * ratio));
  return await img.extract({ left: 0, top: 0, width: w, height: topH }).toBuffer();
}

// Bande (zone au milieu), très utile sur Facebook où le titre est sous la photo
async function cropBand(buf, topRatio = 0.30, heightRatio = 0.45) {
  const img = sharp(buf).rotate();
  const meta = await img.metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  if (!w || !h) return buf;

  const top = Math.max(0, Math.round(h * topRatio));
  const height = Math.max(1, Math.round(h * heightRatio));

  // sécurité: ne pas dépasser
  const safeHeight = Math.min(height, Math.max(1, h - top));

  return await img.extract({ left: 0, top, width: w, height: safeHeight }).toBuffer();
}

async function visionDetectTextFromBuffer(buf, lang = 'fr') {
  const c = getClient();
  const langHints = lang && String(lang).toLowerCase() === 'en' ? ['en'] : ['fr'];

  const request = {
    image: { content: buf },
    imageContext: { languageHints: langHints },
  };

  const [result] = await c.documentTextDetection(request);

  let text =
    result?.fullTextAnnotation?.text ||
    result?.textAnnotations?.[0]?.description ||
    '';

  return normSpaces(text);
}

/**
 * OCR Google Vision sur un buffer image -> string (texte brut)
 * - On OCR aussi une zone TOP + une BANDE CENTRALE pour capter les titres Facebook/IG.
 */
async function ocrFromBuffer(buf, opts = {}) {
  const lang = (opts.lang || 'fr').toLowerCase();

  // 1) OCR complet (source de vérité)
  const fullText = await visionDetectTextFromBuffer(buf, lang);

  // 2) OCR TOP
  let topText = '';
  try {
    const topBuf = await cropTop(buf, 0.32);
    topText = await visionDetectTextFromBuffer(topBuf, lang);
  } catch (e) {
    topText = '';
  }

  // 3) OCR bande centrale (où se trouve souvent le titre sur FB)
  let bandText = '';
  try {
    const bandBuf = await cropBand(buf, 0.30, 0.45);
    bandText = await visionDetectTextFromBuffer(bandBuf, lang);
  } catch (e) {
    bandText = '';
  }

  // 4) Pick title depuis (TOP + BAND)
  const title = pickLikelyTitleFromText(`${topText}\n${bandText}`);

  // 5) Prépend si trouvé
  let out = fullText;
  if (title) {
    const already = out.toLowerCase().includes(String(title).toLowerCase());
    if (!already) out = `${title}\n${out}`;
  }

  return out;
}

/**
 * Variante debug (ne casse rien) : renvoie texte + extraits top/band + titre choisi
 */
async function ocrFromBufferWithDebug(buf, opts = {}) {
  const lang = (opts.lang || 'fr').toLowerCase();

  const fullText = await visionDetectTextFromBuffer(buf, lang);

  let topText = '';
  try {
    const topBuf = await cropTop(buf, 0.32);
    topText = await visionDetectTextFromBuffer(topBuf, lang);
  } catch (e) {
    topText = '';
  }

  let bandText = '';
  try {
    const bandBuf = await cropBand(buf, 0.30, 0.45);
    bandText = await visionDetectTextFromBuffer(bandBuf, lang);
  } catch (e) {
    bandText = '';
  }

  const pickedTitle = pickLikelyTitleFromText(`${topText}\n${bandText}`);

  let combined = fullText;
  if (pickedTitle) {
    const already = combined.toLowerCase().includes(String(pickedTitle).toLowerCase());
    if (!already) combined = `${pickedTitle}\n${combined}`;
  }

  return {
    text: combined,
    debug: {
      pickedTitle: pickedTitle || null,
      topTextSample: topText ? String(topText).slice(0, 500) : null,
      bandTextSample: bandText ? String(bandText).slice(0, 500) : null,
      fullTextSample: fullText ? String(fullText).slice(0, 300) : null,
    },
  };
}

module.exports = {
  ocrFromBuffer,
  ocrFromBufferWithDebug,
};
