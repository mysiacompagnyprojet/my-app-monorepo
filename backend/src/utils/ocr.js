// backend/src/utils/ocr.js
'use strict';

/**
 * SHIM OCR
 * ----------
 * Objectif : ne plus utiliser Tesseract par défaut.
 * - ocrFromBuffer => Google Vision (source de vérité)
 * - splitIngredientsAndSteps => on garde la version legacy (pour éviter toute régression
 *   si un vieux bout de code l'utilise encore)
 */

const { ocrFromBuffer } = require('../services/vision');

// ⚠️ On garde la fonction de split legacy pour compatibilité
const { splitIngredientsAndSteps } = require('./ocr.legacy');

module.exports = { ocrFromBuffer, splitIngredientsAndSteps };
