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
    .filter(Boolean);

  // Cherche un pattern IG fréquent : "... [NOUVELLE RECETTE] Nuggets de pois chiches"
  for (const l of lines) {
    const m = l.match(/\[\s*nouvelle\s+recette\s*\]\s*(.+)$/i);
    if (m && m[1] && m[1].trim().length >= 4) return m[1].trim();
  }

  // Sinon: prend une ligne courte “titre-like” (sans heure/4G/% etc.)
  for (const l of lines) {
    if (/^\d{1,2}:\d{2}$/.test(l)) continue;
    if (/\b(4g|5g|lte|wifi|wi-fi)\b/i.test(l)) continue;
    if (/^\d{1,3}%$/.test(l)) continue;
    if (l.length < 4 || l.length > 60) continue;
    if (/\b(ajouter|mixer|égoutter|egoutter|cuire|préchauffer|faire)\b/i.test(l)) continue; // évite les étapes
    return l;
  }

  return null;
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
