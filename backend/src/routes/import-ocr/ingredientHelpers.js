// backend/src/routes/import-ocr/ingredientHelpers.js
// LEVEL: ROUTE
// import autorisés : 
// import interdits : 
// importé uniquement par

'use strict';

const { normSpaces } = require('../../utils/stringUtils');

function cleanParsedIngredientName(name) {
  let s = normSpaces(name);
  if (!s) return '';

  s = s.replace(/\s*\*\s*cuisson\s+steak\s*:?\s*$/i, '');
  s = s.replace(/\s+ajouter\s+un\s+commentaire\.?\s*$/i, '');
  s = s.replace(/\s+si\s+vous\s+aimez.*$/i, '');
  s = s.replace(/\s+à\s+convenance\s*$/i, '');
  s = s.replace(/\s+ou\s+autre\s+[a-zà-öø-ÿœ' -]+$/i, '');
  s = s.replace(/\s+ou\s+herbes\s*$/i, '');
  s = s.replace(/\s*[:;,*]+$/g, '');

  return normSpaces(s);
}

function shouldDropParsedIngredientRow(row) {
  const name = normSpaces(row?.name || '');
  if (!name) return true;

  if (/^(m[aá]vem|ou m[aá]vem)$/i.test(name)) return true;
  if (/^ou$/i.test(name)) return true;
  if (/^assaisonn?ement steak:?$/i.test(name)) return true;
  if (/^assaisonn?ement pour steak$/i.test(name)) return true;
  if (/ajouter un commentaire/i.test(name)) return true;
  if (/^quelques gousses d['’]ail\b.*orni/i.test(name)) return true;
  if (/^(assaisonnement|assaisonement|cuisson|marinade|sauce)\b.*:$/i.test(name)) return true;

  return false;
}

module.exports = {
  cleanParsedIngredientName,
  shouldDropParsedIngredientRow,
};





