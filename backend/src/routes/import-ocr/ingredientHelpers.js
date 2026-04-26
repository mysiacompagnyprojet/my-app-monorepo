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

  s = s.replace(/[↑■]+/g, '').trim();
  s = s.replace(/\s*\([^)]*$/g, '').trim();
  s = s.replace(/\s*\([^)]*\)\s*$/g, '').trim();

  s = s.replace(/\s*\*\s*cuisson\s+steak\s*:?\s*$/i, '');
  s = s.replace(/\s+ajouter\s+un\s+commentaire\.?\s*$/i, '');
  s = s.replace(/\s+si\s+vous\s+aimez.*$/i, '');
  s = s.replace(/\s+à\s+convenance\s*$/i, '');
  s = s.replace(/\s+ou\s+autre\s+[a-zà-öø-ÿœ' -]+$/i, '');
  s = s.replace(/\s+ou\s+herbes\s*$/i, '');
  s = s.replace(/\s+pour\s+(les\s+)?(boulettes?|sauce)\s*$/i, '');
  s = s.replace(/\s+\b(CA|B|A)\b\s*$/i, '');
  s = s.replace(/\s+\b(pour|personnes?)\b\s*$/i, '');
  s = s.replace(/\s*[:;,*]+$/g, '');

  s = s.replace(/^faline$/i, 'farine');
  s = s.replace(/^fate$/i, 'farine');
  s = s.replace(/^parmesan\s+râp$/i, 'parmesan râpé');
  s = s.replace(/^œufs?\s+(moyens?|gros|grosses|petits?|petites?)$/i, 'œufs');

  if (/^farine\s+d['’]huile\s+d['’]olive$/i.test(s)) s = 'farine';
  if (/^sel\s+ou\s+sel\s+fin$/i.test(s)) s = 'sel';
  if (/^poivre\b/i.test(s)) s = 'poivre';

  if (/^avocats?\s+m[uû]rs?\s+[àa]\s+point$/i.test(s)) s = 'avocats';
  if (/^huile\s+d['’]olive\s+extra\s+vierge$/i.test(s)) s = "huile d'olive";
  if (/^gingembre\s+frais\b/i.test(s)) s = 'gingembre frais';
  if (/^lait\s+ti[eè]d[ee]?$/i.test(s) || /^lait\s+ti[èe]?$/i.test(s)) s = 'lait';
  if (/^beurre\s+(mou|molle|fondu|fondue)$/i.test(s)) s = 'beurre';

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
  if (/[♡❤️♥]/.test(name)) return true;
  if (/\bw\s+\d{1,3}\s*[-–]\s*\d{1,3}\b/i.test(name)) return true;
  if (/^[^a-zà-öø-ÿœ]*$/i.test(name)) return true;
  if (/^rs\s*faktory\.?$/i.test(name)) return true;
  if (/^faktory$/i.test(name)) return true;
  if (/^jumbo\s+expedition$/i.test(name)) return true;
  if (/dr[oó]nar/i.test(name)) return true;
  if (/\b(saladier|cuill[eè]re\s+en\s+bois|plaque\s+de\s+four|rouleau\s+[àa]\s+p[aâ]tiss)\b/i.test(name)) return true;
  if (/^cuiller[ée]es?\s+[àa]\s+soupe\s+d['’]huile$/i.test(name)) return true;
  if (/\b(pour|personnes?|ca|fronger)$/i.test(name)) return true;

  return false;
}

module.exports = {
  cleanParsedIngredientName,
  shouldDropParsedIngredientRow,
};





