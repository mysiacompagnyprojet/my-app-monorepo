// backend/src/routes/import-ocr.js
const express = require('express');
const multer = require('multer');
const { createWorker } = require('tesseract.js');
const { parseRawLine } = require('../utils/ingredients');
const { checkAndIncrementLimit } = require('../utils/limits');

const router = express.Router();

// --- Upload: mémoire + limite 8 Mo
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

// --- Auth simple comme ailleurs
function needAuth(req, res, next) {
  if (!req.user?.userId) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// OCR worker partagé (évite de relancer Tesseract à chaque fois)
let workerPromise;
async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      // Avec les nouvelles versions de tesseract.js,
      // createWorker prend directement la langue en paramètre.
      // Plus besoin de loadLanguage / initialize.
      const worker = await createWorker('fra+eng');
      return worker;
    })();
  }
  return workerPromise;
}

// ─────────────────────────────────────────────────────────────
// Heuristiques nettoyage / découpe
// ─────────────────────────────────────────────────────────────

// lignes “poubelles”
const JUNK_PATTERNS = [
  /we use cookies/i,
  /privacy policy/i,
  /cookies? policy/i,
  /^ok$/i,
  /^ok privacy policy$/i,
  /\.com\b/i,
];

function isJunk(line) {
  return JUNK_PATTERNS.some((re) => re.test(line));
}

// “Portions : 4”
function extractServings(lines) {
  for (const l of lines) {
    const m = l.match(/portions?\s*:\s*(\d+)/i);
    if (m) return parseInt(m[1], 10) || 1;
  }
  return 1;
}

// Sépare ingrédients / étapes à partir du texte OCR
function splitIngredientsAndSteps(text) {
  const rawLines = String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const lines = rawLines.filter((l) => !isJunk(l));
  const servings = extractServings(lines);

  const idxIngr = lines.findIndex((l) => /^ingr[ée]dients?/i.test(l));
  const idxInstr = lines.findIndex(
    (l, idx) =>
      idx > (idxIngr >= 0 ? idxIngr : -1) && /(instructions?|étape\s*1|etape\s*1)/i.test(l)
  );

  const ingredientLines = [];
  const stepLines = [];

  // Ingrédients: entre "Ingrédients" et "Instructions"
  if (idxIngr >= 0) {
    const end = idxInstr >= 0 ? idxInstr : lines.length;
    for (let i = idxIngr + 1; i < end; i++) {
      let line = lines[i];
      if (!line) continue;

      // ignorer les méta fréquentes
      if (/^préparation\b/i.test(line)) continue;
      if (/^cuisson\b/i.test(line)) continue;
      if (/^temps total\b/i.test(line)) continue;
      if (/^portions?\b/i.test(line)) continue;
      if (/^instructions?/i.test(line)) continue;

      // enlève puces
      line = line.replace(/^[•\-·\u2022]+\s*/, '').trim();
      if (!line) continue;

      ingredientLines.push(line);
    }
  }

  // Étapes: après "Instructions"/"Étape 1"
  if (idxInstr >= 0) {
    for (let i = idxInstr + 1; i < lines.length; i++) {
      let line = lines[i];
      if (!line) continue;
      if (isJunk(line)) continue;

      line = line.replace(/^étape\s*\d+\s*:\s*/i, '');
      line = line.replace(/^etape\s*\d+\s*:\s*/i, '');
      line = line.replace(/^\d+\.\s*/, '');
      line = line.trim();
      if (!line) continue;

      stepLines.push(line);
    }
  }

  const effectiveIngredients = ingredientLines.length ? ingredientLines : [];
  const effectiveSteps =
    stepLines.length || !effectiveIngredients.length ? stepLines || lines : stepLines;

  return { servings, ingredientLines: effectiveIngredients, stepLines: effectiveSteps };
}

// ─────────────────────────────────────────────────────────────
// Route: POST /import/ocr
// ─────────────────────────────────────────────────────────────
router.post('/ocr', needAuth, upload.single('file'), async (req, res) => {
  try {
    // 1) Fichier requis
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'Image manquante' });
    }

    // 2) Limite gratuite AVANT de consommer du CPU
    //    (adapte 'lunch' en 'dinner' si tu veux le même compteur que /import/url)
    const chk = await checkAndIncrementLimit(req.user.userId, 'lunch');
    if (!chk.allowed) {
      return res.status(402).json({ ok: false, error: 'limit_reached' });
    }

    // 3) OCR
    const worker = await getWorker();
    const { data } = await worker.recognize(req.file.buffer);
    const text = String(data?.text || '').trim();
    if (!text) {
      return res.status(400).json({ ok: false, error: 'Texte OCR vide' });
    }

    // 4) Découpage + parsing ingrédients
    const { servings, ingredientLines, stepLines } = splitIngredientsAndSteps(text);

    const ingredients = ingredientLines.map((line) => {
      const parsed = parseRawLine(line);
      if (parsed) {
        return {
          name: parsed.name || parsed.nameCanon || line,
          quantity: Number(parsed.quantity ?? parsed.quantityNum ?? 0),
          unit: parsed.unit || 'g',
        };
      }
      return { name: line, quantity: 0, unit: 'g' };
    });

    // Titre : laisse vide pour que l’utilisateur renomme (ou prends la 1re ligne si tu préfères)
    const draft = {
      title: '',
      servings,
      imageUrl: null,
      notes: '',
      steps: stepLines,
      ingredients,
    };

    return res.json({ ok: true, draft });
  } catch (e) {
    console.error('POST /import/ocr error:', e);
    return res.status(500).json({ ok: false, error: e.message || 'ocr_error' });
  }
});

module.exports = router;

