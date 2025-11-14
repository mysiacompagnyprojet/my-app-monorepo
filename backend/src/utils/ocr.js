// backend/src/utils/ocr.js
const { createWorker } = require('tesseract.js');

let workerPromise;
async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker({ logger: () => {} });
      await worker.loadLanguage('fra+eng');
      await worker.initialize('fra+eng');
      return worker;
    })();
  }
  return workerPromise;
}

/**
 * OCR d'un Buffer image -> string (texte brut)
 */
async function ocrFromBuffer(buf) {
  const worker = await getWorker();
  const { data: { text } } = await worker.recognize(buf);
  return String(text || '').trim();
}

/**
 * Heuristique très simple pour séparer ingrédients/étapes
 */
function splitIngredientsAndSteps(text) {
  const raw = text.replace(/\r/g, '');
  const lines = raw.split('\n').map(s => s.trim()).filter(Boolean);

  // Cherche des sections "Ingrédients" / "Préparation"
  let ingIdx = lines.findIndex(l => /ingr[ée]dients?/i.test(l));
  let prepIdx = lines.findIndex(l => /(pr[ée]paration|[ée]tapes?)/i.test(l));

  let ingLines = [];
  let stepLines = [];

  if (ingIdx >= 0 && prepIdx >= 0) {
    const a = Math.min(ingIdx, prepIdx);
    const b = Math.max(ingIdx, prepIdx);
    if (/ingr/i.test(lines[a])) {
      ingLines = lines.slice(a + 1, b);
      stepLines = lines.slice(b + 1);
    } else {
      stepLines = lines.slice(a + 1, b);
      ingLines = lines.slice(b + 1);
    }
  } else if (ingIdx >= 0) {
    ingLines = lines.slice(ingIdx + 1);
  } else if (prepIdx >= 0) {
    stepLines = lines.slice(prepIdx + 1);
  } else {
    // Pas de titres repérés : heuristique
    ingLines = lines.filter(l => /(\d|\bg\b|\bkg\b|\bml\b|\bl\b|cuill|œuf|oeuf|farine|sucre|beurre|huile)/i.test(l));
    stepLines = lines.filter(l => !ingLines.includes(l));
  }

  return { ingLines, stepLines };
}

module.exports = { ocrFromBuffer, splitIngredientsAndSteps };
