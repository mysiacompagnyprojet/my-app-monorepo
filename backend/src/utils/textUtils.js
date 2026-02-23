//backend/src/utils/textUtils
// LEVEL: UTIL (generic text helpers)
// import autorisés : stringUtils uniquement
// import interdits : routes, middleware, services, prisma, utils métier (ocr/ingredients/units)
// importé par : ocrText, ocrTitle, heuristics

const { normSpaces, cleanStepPrefix, cleanTitleCandidate, sanitizePickedTitle  } = require('../utils/stringUtils');

function normalizeForDedup(line) {
  return normSpaces(line)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTitleJoinPiece(s) {
  // Nettoyage léger spécifique "titre"
  let t = cleanTitleCandidate(s);
  t = sanitizePickedTitle(t);

  // remplace les "+" OCR qui servent souvent de séparateur
  t = t.replace(/\s*\+\s*/g, ' ');

  // retire les étoiles/bullets décoratifs en fin (ex: "Cannelle⭑")
  t = t.replace(/[⭑★☆✦✧✨]+$/g, '');

  return normSpaces(t);
}

// pour import ocr
function splitStepsFromLines(arr) {
      const out = [];
      for (const s0 of arr || []) {
        let s = String(s0 || '').replace(/\s+/g, ' ').trim();
        if (!s) continue;
        if (/^\d{1,3}$/.test(s)) continue;

        s = cleanStepPrefix(s);
        if (!s) continue;

        const parts = s
          .split(/(?<=\.)\s+/g)
          .map((x) => cleanStepPrefix(x))
          .filter(Boolean);

        if (parts.length >= 2 && (s.length >= 90 || parts.length >= 3)) out.push(...parts);
        else out.push(s);
      }
      return out;
}

// Découpage intelligent d'un gros paragraphe en étapes - pour generic.js
function splitStepsFromText(text) {
  if (!text) return [];

  // Séparer par ". " mais en gardant les phrases complètes
  const rawParts = text
    .split(/(?<=[.!?])\s+(?=[A-ZÉÈÊÎÏÔÛÀÂÇ])/)
    .map((t) => t.trim())
    .filter(Boolean);

  const verbs = [
    'mettre', 'ajouter', 'préchauffer', 'melanger', 'mélanger',
    'verser', 'hacher', 'couper', 'faire revenir', 'faire cuire',
    'cuire', 'assaisonner', 'répartir', 'mixer', 'transvaser',
    'râper', 'déglacer', 'enfourner', 'réserver'
  ];

  const steps = [];

  for (let part of rawParts) {
    const lower = part.toLowerCase();

    // Si la phrase commence clairement par un verbe → nouvelle étape
    const isStepStart = verbs.some((v) => lower.startsWith(v));

    if (isStepStart || steps.length === 0) {
      steps.push(part);
    } else {
      // sinon on fusionne dans l'étape précédente
      steps[steps.length - 1] += ' ' + part;
    }
  }

  return steps;
}



module.exports = {
    normalizeForDedup,
    normalizeTitleJoinPiece,
    splitStepsFromLines,
    splitStepsFromText,
}