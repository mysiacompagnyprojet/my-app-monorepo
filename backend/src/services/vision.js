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


function pickLikelyInstagramTitle(text) {
  const lines = String(text || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^[•·⚫●○◦\-\*]+\s*/g, '').trim()); // enlève puces

  const isUiNoise = (l) => {
    if (/^\d{1,2}:\d{2}$/.test(l)) return true;
    if (/\b(4g|5g|lte|wifi|wi-fi)\b/i.test(l)) return true;
    if (/^\d{1,3}%$/.test(l)) return true;
    return false;
  };

  const looksLikeAction = (l) => {
    // on évite de prendre une étape comme titre
    return /\b(ajouter|mixer|égoutter|egoutter|cuire|préchauffer|faire|mettre|verser|chauffer|mélanger|melanger|couper|laver)\b/i.test(l);
  };

  // 1) Pattern "nouvelle recette" (avec ou sans crochets, avec : - etc.)
  for (const l of lines) {
    const m = l.match(/(?:\[\s*)?nouvelle\s+recette(?:\s*\])?\s*[:\-–—]?\s*(.+)$/i);
    if (m && m[1]) {
      const cand = m[1].trim();
      if (cand.length >= 4 && cand.length <= 80 && !looksLikeAction(cand) && !isUiNoise(cand)) return cand;
    }
  }

  // 2) Fallback scoring : meilleure ligne courte “titre-like”
  let best = null;
  let bestScore = -1;

  for (const l of lines) {
    if (!l) continue;
    if (isUiNoise(l)) continue;

    // garde-fous
    if (l.length < 4 || l.length > 80) continue;
    if (/[.!?…]$/.test(l)) continue;          // titres IG rarement finissent par "."
    if (looksLikeAction(l)) continue;          // évite "Egoutter..."
    if (/\b\d+\s*(g|kg|ml|cl|dl|l)\b/i.test(l)) continue; // évite lignes ingrédient

    // doit ressembler à un titre : 2 mots mini (ex: "Nuggets de pois chiches")
    const words = l.split(/\s+/).filter(Boolean);
    if (words.length < 2) continue;

    // score
    let score = 0;
    // bonus si mots "plat"
    if (/\b(nuggets?|galettes?|cookies?|gâteau|gateau|salade|poulet|pois\s+chiches?)\b/i.test(l)) score += 5;
    // bonus si contient "de" (souvent titre FR)
    if (/\bde\b/i.test(l)) score += 2;
    // bonus ligne plutôt courte
    score += Math.max(0, 80 - l.length) / 20;

    if (score > bestScore) {
      bestScore = score;
      best = l;
    }
  }

  return best;
}

async function cropTop(buf, ratio = 0.32) {
  const img = sharp(buf);
  const meta = await img.metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  if (!w || !h) return buf;


  const topH = Math.max(1, Math.round(h * ratio));
  return await img.extract({ left: 0, top: 0, width: w, height: topH }).toBuffer();
}




/**
 * OCR Google Vision sur un buffer image
 * @param {Buffer} buf
 * @param {{ lang?: string }} opts
 * @returns {Promise<string>}
 */
async function ocrFromBuffer(buf, opts = {}) {
  const c = getClient();
  const lang = (opts.lang || 'fr').toLowerCase();


  // Vision: languageHints = meilleure détection + moins de mix langues
  const requestFor = (b) => ({
    image: { content: b },
    imageContext: {
      languageHints: lang === 'en' ? ['en'] : ['fr'],
    },
  });


  // 1) OCR du haut (Instagram: titre/username)
  let topText = '';
  try {
    const topBuf = await cropTop(buf, 0.32);
    const [topRes] = await c.documentTextDetection(requestFor(topBuf));
    topText =
      topRes?.fullTextAnnotation?.text ||
      topRes?.textAnnotations?.[0]?.description ||
      '';
    topText = String(topText || '').trim();
  } catch (e) {
    topText = '';
  }


  // 2) OCR complet (ingrédients + étapes)
  const [result] = await c.documentTextDetection(requestFor(buf));
  let text =
    result?.fullTextAnnotation?.text ||
    result?.textAnnotations?.[0]?.description ||
    '';
  text = String(text || '').trim();


  // 3) Si on détecte un vrai titre dans le haut, on le prépend au texte complet
  const title = pickLikelyInstagramTitle(topText);
  if (title) {
    const already = text.toLowerCase().includes(title.toLowerCase());
    if (!already) {
      text = `${title}\n${text}`;
    }
  }


  return text;
}


module.exports = { ocrFromBuffer };
