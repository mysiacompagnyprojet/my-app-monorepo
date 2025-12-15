// backend/src/services/vision.js
'use strict';

const vision = require('@google-cloud/vision');

// Client singleton
let client;
function getClient() {
  if (!client) client = new vision.ImageAnnotatorClient();
  return client;
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
  const request = {
    image: { content: buf },
    imageContext: {
      languageHints: lang === 'en' ? ['en'] : ['fr'],
    },
  };

  const [result] = await c.documentTextDetection(request);

  const text =
    result?.fullTextAnnotation?.text ||
    result?.textAnnotations?.[0]?.description ||
    '';

  return String(text || '').trim();
}

module.exports = { ocrFromBuffer };
