// backend/src/routes/import-ocr/helpers.js
// LEVEL: ROUTE
// import autorisés : 
// import interdits : 
// importé uniquement par 

'use strict';

const { stripBulletPrefix } = require ('../../utils/stringUtils')

function removeSocialHeaderLines(lines) {
  return (lines || []).filter((l) => !/^publication\s+de\b/i.test(String(l || '').trim()));
}

function isOcrZeroGramNoise(line) {
  const s = stripBulletPrefix(line)
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (/^o\s*[gq]$/i.test(s)) return true;
  if (/^0\s*g$/i.test(s)) return true;

  return false;
}

function isUnitOnlyLine(s) {
 const l = String(s || '')
   .trim()
   .toLowerCase()
   .normalize('NFD')
   .replace(/[\u0300-\u036f]/g, '');

 return [
   'g',
   'kg',
   'mg',
   'ml',
   'cl',
   'dl',
   'l',
   'cas',
   'càc',
   'càs',
   'c a s',
   'cac',
   'c a c',
   'cs',
   'cc'
 ].includes(l);
}

function uniqLines(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr || []) {
    const s = String(x || '').replace(/\s+/g, ' ').trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}



module.exports = {
    removeSocialHeaderLines,
    isOcrZeroGramNoise,
    isUnitOnlyLine,
    uniqLines,
  
};