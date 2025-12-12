// backend/src/services/vision.js

const vision = require('@google-cloud/vision');

let client;

function getClient() {
  if (client) return client;

  // Client Google Vision créé à la demande
  try {
    client = new vision.ImageAnnotatorClient();
    return client;
  } catch (err) {
    const hint =
      'Google credentials introuvables. Vérifie la variable GOOGLE_APPLICATION_CREDENTIALS ' +
      'et le fichier keys/vision-ocr.json.';
    const e = new Error(`${hint}\nOriginal: ${err.message}`);
    e.cause = err;
    throw e;
  }
}

/**
 * OCR depuis un buffer image (PNG/JPG)
 * Utilise documentTextDetection (meilleur pour pages longues / mobile)
 */
async function ocrFromBuffer(buffer) {
  if (!buffer) {
    throw new Error('ocrFromBuffer: buffer manquant');
  }

  const c = getClient();

  const [result] = await c.documentTextDetection({
    image: { content: buffer },
    imageContext: {
      languageHints: ['fr'], // ⭐ IMPORTANT pour recettes françaises
    },
  });

  // Cas normal (document OCR)
  const text =
    result?.fullTextAnnotation?.text ||
    // Fallback très rare mais utile
    result?.textAnnotations?.[0]?.description ||
    '';

  return String(text).trim();
}

module.exports = { ocrFromBuffer };


