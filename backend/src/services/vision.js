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

function normalizeLangHint(langHint) {
  const l = String(langHint || '').trim();
  if (!l) return 'fr';
  // on garde juste "fr" / "en" si c’est "fr-FR"
  const base = l.split(',')[0].trim();
  const tag = base.split('-')[0].trim().toLowerCase();
  if (tag === 'fr') return 'fr';
  if (tag === 'en') return 'en';
  return 'fr';
}

/**
 * OCR détaillé (texte + fullTextAnnotation pour exploiter la géométrie)
 * Utilise documentTextDetection (meilleur pour pages longues / mobile)
 */
async function ocrFromBufferDetailed(buffer, opts = {}) {
  if (!buffer) {
    throw new Error('ocrFromBufferDetailed: buffer manquant');
  }

  const c = getClient();
  const lang = normalizeLangHint(opts.langHint);

  const [result] = await c.documentTextDetection({
    image: { content: buffer },
    imageContext: {
      languageHints: [lang],
    },
  });

  const text =
    result?.fullTextAnnotation?.text ||
    result?.textAnnotations?.[0]?.description ||
    '';

  return {
    text: String(text).trim(),
    fullTextAnnotation: result?.fullTextAnnotation || null,
  };
}

/**
 * OCR depuis un buffer image (PNG/JPG)
 * Compat : renvoie juste le texte (string) comme avant
 */
async function ocrFromBuffer(buffer, opts = {}) {
  const out = await ocrFromBufferDetailed(buffer, opts);
  return out.text;
}

module.exports = { ocrFromBuffer, ocrFromBufferDetailed };
