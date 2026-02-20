// backend/src/utils/sectionHeaders.js
// LEVEL: UTIL (section headers)
// import autorisés : stringUtils
// import interdits : ingredientUtils, ingredientParser, ocr*, services, routes, prisma

'use strict';
const { normSpaces } = require('../utils/stringUtils');

function isIngredientsHeader(line) {
  const t = normSpaces(line).toLowerCase();
  if (/^ingr[ée]dients?\b/.test(t)) return true;
  if (/^ingr[ée]dients?\s+pour\s+\d+\s*/.test(t)) return true;
  if (/^pour\s+\d+\s*personnes?\b.*\bil\b.*\bfaut\b/.test(t)) return true;
  return false;
}

function isPreparationHeader(line) {
  const t = normSpaces(line).toLowerCase();
  return /^préparation\b/.test(t) || /^preparation\b/.test(t) || /^instructions?\b/.test(t);
}

function isStepsHeader(line) {
  const t = normSpaces(line).toLowerCase();
  return (
    /^d[eé]roul[eé]\s*:?\s*$/.test(t) ||
    /^étapes?\b/.test(t) ||
    /^etapes?\b/.test(t) ||
    /^m[ée]thode\b/.test(t) ||
    /^r[ée]alisation\b/.test(t) 
  );
}

module.exports = {
    isIngredientsHeader,
    isPreparationHeader,
    isStepsHeader
}    