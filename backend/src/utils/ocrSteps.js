// backend/src/utils/ocrSteps.js
// LEVEL: UTIL (OCR text parsing)
// import autorisés : 
// import interdits : 
// importé par : 

'use strict';

const { normSpaces } = require('./stringUtils');
const { parseOcrIngredient } = require('./ingredientParser');
const { isPreparationHeader, isStepsHeader } = require('./sectionHeaders');

function joinWrappedLinesForSteps(stepLines, opts = {}) {
    const {
        looksLikeSpoonMeasureIngredient = () => false,
    } = opts

  const out = [];
  let buffer = '';

  const flush = () => {
    const s = normSpaces(buffer);
    if (s) out.push(s);
    buffer = '';
  };

  for (const raw of stepLines) {
    const line = normSpaces(raw);

    const cleanedLine = normSpaces(line.replace(/^du commerce\)\.?\s*/i, ''));

    if (!cleanedLine) continue;

    if (isPreparationHeader(cleanedLine)) {
      flush();
      continue;
    }
    //ajouter le 23/02
    const bufferLooksIngredient = !!parseOcrIngredient(buffer) || looksLikeSpoonMeasureIngredient(buffer);
    const lineLooksIngredient = !!parseOcrIngredient(cleanedLine) || looksLikeSpoonMeasureIngredient(cleanedLine);

    if (buffer && bufferLooksIngredient && lineLooksIngredient) {
      flush();
      buffer = cleanedLine;
      continue;
    }

    if (buffer && bufferLooksIngredient && isStepsHeader(cleanedLine)) {
      flush();
      buffer = '';
      continue;
    }

    if (!buffer) {
      buffer = cleanedLine;
      continue;
    }

    const endsStrong = /[.!?…:]$/.test(buffer);
    const endsConnector = /\b(à|a|au|aux|de|d|d'|d’|des|du|sous|sur|puis|et)\s*$/i.test(buffer);

    const nextLooksContinuation =
      /^[a-zà-öø-ÿ’'"(]/.test(cleanedLine) ||
      /^\d/.test(cleanedLine) ||
      /^l['’]/i.test(cleanedLine) ||
      /^(puis|et|ensuite|alors|donc)\b/i.test(cleanedLine);

    const isShortWrapTail = 
      cleanedLine.length <= 20 &&
      !/^[A-ZÀ-Ö]{3,}$/.test(cleanedLine) &&
      !/^(ingred[ée]dients?|préparation|preparation|déroulé|deroule)\b/i.test(cleanedLine);

    const isVeryShortSentenceTail = 
    cleanedLine.length <= 28 &&
    /[.!?...]$/.test(cleanedLine) &&
    !/^(ingred[ée]dients?|préparation|preparation|déroulé|deroule)\b/i.test(cleanedLine);

    const endsContainerIntro = /\b(dans|sur|sous)\s+(un|une|le|la|les)\s*$/i.test(buffer);

    if (
      endsConnector ||
      endsContainerIntro ||
      (!endsStrong && nextLooksContinuation) || 
      isShortWrapTail || 
      isVeryShortSentenceTail
    ) { //
      buffer = `${buffer} ${cleanedLine}`;
    } else {
      flush();
      buffer = cleanedLine;
    }
  }
  flush();
  return out;
}

// ✅ Split "phrases" dans une étape quand elle contient plusieurs phrases.
// Objectif: éviter les lignes énormes type Facebook ("Étalez... Sur... Ajoutez... Recouvrez...").
// On ne split que si:
// - au moins 2 phrases (donc au moins 1 point suivi d'un espace)
// - ET la ligne est assez longue (sinon on laisse tranquille)
function splitStepsBySentences(steps) {
  const out = [];

  for (const s of steps || []) {
    const t = normSpaces(s);
    if (!t) continue;

    // trop court => on ne touche pas
    if (t.length < 140) {
      out.push(t);
      continue;
    }

    // On split sur ". " (point + espaces) en gardant le point.
    const parts = t
      .split(/(?<=\.)\s+/)
      .map(normSpaces)
      .filter(Boolean);

    // si ça ne produit pas au moins 2 morceaux, on garde tel quel
    if (parts.length < 2) {
      out.push(t);
      continue;
    }

    out.push(...parts);
  }

  return out;
}

function splitLongSteps(steps) {
  const out = [];
  for (const s of steps) {
    const t = normSpaces(s);
    if (t.length < 260) {
      out.push(t);
      continue;
    }

    const parts = t
      .split(/(?<=\.)\s+/)
      .map(normSpaces)
      .filter(Boolean);

    if (parts.length >= 2) out.push(...parts);
    else out.push(t);
  }
  return out;
}


module.exports = {
    joinWrappedLinesForSteps,
    splitStepsBySentences,
    splitLongSteps,
};