// backend/src/services/vision.js
const vision = require('@google-cloud/vision');

let client;
function getClient() {
  if (!client) client = new vision.ImageAnnotatorClient();
  return client;
}

async function ocrFromBuffer(buffer) {
  const c = getClient();

  // Meilleur pour du texte dense (recettes)
  const [result] = await c.documentTextDetection({
    image: { content: buffer },
  });

  return (result?.fullTextAnnotation?.text || '').trim();
}

module.exports = { ocrFromBuffer };
