// backend/src/utils/ocrInline.js
// LEVEL: UTIL (OCR text parsing)
// import autorisés : 
// import interdits : 
// importé par : 

'use strict';

const { parseOcrIngredient } = require('./ingredientParser');
const { normSpaces } = require('./stringUtils');
const {
  looksLikeNonIngredientGarbage,
  stripInlineSocialHandles,
  dedupeLines,
  containsNutritionMeta,
  containsTimeMeta,
  looksLikeCallToActionNoise,
  looksLikeNutritionMetaLine,
  looksLikeTimeMetaLine,
} = require('../utils/ocrNoise');

//ajoute le 01/04/26
function splitOnSlashOutsideFractions(text) {
  const s = normSpaces(text);
  if (!s) return [];

  const parts = [];
  let buffer = '';

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const prev = i > 0 ? s[i - 1] : '';
    const next = i + 1 < s.length ? s[i + 1] : '';

    const isFractionSlash = /\d/.test(prev) && /\d/.test(next);

    if (ch === '/' && !isFractionSlash) {
      const piece = normSpaces(buffer);
      if (piece) parts.push(piece);
      buffer = '';
      continue;
    }

    buffer += ch;
  }

  const tail = normSpaces(buffer);
  if (tail) parts.push(tail);

  return parts;
}

//ajoute le 01/04/26
function isMatchStartingInsideFraction(line, start) {
  if (start <= 0) return false;

  const prev = line[start - 1] || '';
  if (prev === '/') return true;

  const left = line.slice(Math.max(0, start - 4), start);
  return /\d\s*\/\s*$/.test(left);
}

//remplacer le 30/03/26
function normalizeInlineIngredientFragment(fragment) {
  let t = normSpaces(fragment);
  if (!t) return '';

  t = stripInlineSocialHandles(t);

  // "un sachet" / "une gousse" -> quantité explicite pour le parser
  t = t.replace(
    /\b(?:un|une)\s+(sachet|sachets|gousse|gousses|tranche|tranches|verre|verres|tasse|tasses|pincée|pincées|pincee|pincees)\b/gi,
    '1 $1'
  );

  // coupe les morceaux parasites après connecteur
  // ex: "150 g de sucre et 1 sachet de ..." -> "150 g de sucre"
  t = t.replace(
    /\b(et|ou)\s+\d+(?:[.,]\d+)?\s+(sachet|sachets|gousse|gousses|tranche|tranches|verre|verres|tasse|tasses|pincée|pincées|pincee|pincees)\b.*$/i,
    ''
  );

  // coupe les qualificatifs de phrase inutiles
  // ex: "200 g de beurre demi-sel bien froid et" -> "200 g de beurre demi-sel"
  t = t.replace(/\b(bien|très)\s+(froid|froide|froids|froides)\b.*$/i, '');

  // enlève les fins mortes
  t = t.replace(/\b(et|ou|de|du|des|au|aux)\b\s*$/i, '');
  t = t.replace(/\s*[.,;:!?]+$/g, '');

  //ajoute le 02/04/26
  t = t.replace(/\bpour\s+la\s+cuisson\b.*$/i, '');
  t = t.replace(/\bpour\s+la\s+cuisson\s+vapeur\b.*$/i, '');
  t = t.replace(/\bfinement\s+coup[ée]s?\b.*$/i, '');
  t = t.replace(/\bfinement\s+hach[ée]s?\b.*$/i, '');
  t = t.replace(/\s+[.,;:!?]+$/g, '');
  t = normSpaces(t);

  if (/\bhach$/.test(t.toLowerCase())) return '';

  return normSpaces(t);
}

function extractInlineIngredientFragmentsFromLines(lines) {
  const out = [];

   //remplacé le 30/03/26
  const pushIfParsable = (frag) => {
    const t = normalizeInlineIngredientFragment(frag);
    if (!t) return;

    if (looksLikeNonIngredientGarbage(t)) return;
    if (containsNutritionMeta(t)) return;
    if (containsTimeMeta(t)) return;
    if (looksLikeCallToActionNoise(t)) return;
    if (/^.+\s+au\s+go[uû]t$/i.test(t)) return;
    if (/\bou\b/i.test(t) && !parseOcrIngredient(t) && t.length <= 60) return;
    if (looksLikeNutritionMetaLine(t)) return;
    if (looksLikeTimeMetaLine(t)) return;

    //ajoute le 02/04/26
    if (/^pour\s+la\s+(cuisson|cuisson vapeur|dorure|sauce|pâte|pate)\b/i.test(t)) return;
    if (/^pour\s+r[ée]aliser\b/i.test(t)) return;
    if (/^pour\s+faire\b/i.test(t)) return;

    const parsed = parseOcrIngredient(t);
    if (!parsed) return;

    const name = normSpaces(parsed.name || '');
    const low = name.toLowerCase();

    if (/^[a-z]$/i.test(name)) return;
    if (/^\d+$/.test(name)) return;
    if (/^[a-z]\d+$|^\d+[a-z]$/i.test(name)) return;
    if (/^(q|de|et|ou)$/i.test(low)) return;

    if (!low) return;
    if (low.length < 3) return;

    if (/^(de|et|ou|q)$/.test(low)) return;
    if (/\b(et|ou|de|du|des|au|aux)\b$/.test(low)) return;
    if (/\b(bien|très)\s+(froid|froide|froids|froides)\b/.test(low)) return;

    if (looksLikeNonIngredientGarbage(name)) return;
    if (/^(directions?|préparation|preparation|astuce)$/i.test(low)) return;
    if (/^(préchauffez|prechauffez|versez|ajoutez|incorporez|mélangez|melangez|laissez|dégustez|degustez)\b/i.test(low)) return;

    if(looksLikeNonIngredientGarbage(name)) return ;
    if(looksLikeNonIngredientGarbage(t)) return ;

    //ajoute temporairement le 01/04/26 - a enlever une fois test reussi
    if (/c\.?\s*à\s*caf|càc|cac|cc/i.test(t)) {
      console.log('[INLINE PUSH CANDIDATE]', { frag, normalized: t });
    }

    out.push(t);
  };


  const metricRe =
    /\b\d+(?:[.,]\d+)?\s*(?:kg|g|mg|l|dl|cl|ml)\s*(?:de\s+|d['’]\s*)?[a-zà-öø-ÿœ'’-]+(?:\s+[a-zà-öø-ÿœ'’-]+){0,4}\b/gi;

  const humanRe =
    /\b(?:un|une|\d+)\s+(?:sachet|sachets|gousse|gousses|tranche|tranches|verre|verres|tasse|tasses|pincée|pincées|pincee|pincees)\s*(?:de\s+|d['’]\s*)?[a-zà-öø-ÿœ'’-]+(?:\s+[a-zà-öø-ÿœ'’-]+){0,4}\b/gi;

  const eggRe =
    /\b\d+\s+(?:jaunes?\s+d['’](?:œufs?|oeufs?)|blancs?\s+d['’](?:œufs?|oeufs?)|œufs?|oeufs?)\b/gi;

  const source = (lines || []).map((x) => stripInlineSocialHandles(normSpaces(x))).filter(Boolean);  

  for (let i = 0; i < source.length; i++) {
    const cur = source[i];
    const next = i + 1 < source.length ? source[i + 1] : '';

    // 1) ligne seule - remplacer le 01/04/26
    for (const re of [metricRe, humanRe, eggRe]) {
      for (const match of cur.matchAll(re)) {
        const frag = match[0];
        const idx = match.index ?? -1;
        if (idx < 0) continue;

        if (isMatchStartingInsideFraction(cur, idx)) continue;

        pushIfParsable(frag);
      }
    }

    // 2) ligne + suivante (pour recoller "150 g" + "de sucre ...")
    if (next) {
      const merged = normSpaces(`${cur} ${next}`);

      //remplacer le 01/04/26
      for (const re of [metricRe, humanRe, eggRe]) {
        for (const match of merged.matchAll(re)) {
          const frag = match[0];
          const idx = match.index ?? -1;
          if (idx < 0) continue;

          if (isMatchStartingInsideFraction(merged, idx)) continue;

          pushIfParsable(frag);
        }
      }


      // cas spécial : première ligne finit par quantité+unité, la suivante commence par "de ..."
      const bridge = merged.match(
        /\b(\d+(?:[.,]\d+)?)\s*(kg|g|mg|l|dl|cl|ml)\s+(de\s+[a-zà-öø-ÿœ'’-]+(?:\s+[a-zà-öø-ÿœ'’-]+){0,4})\b/i
      );
      if (bridge) {
        pushIfParsable(`${bridge[1]} ${bridge[2]} ${bridge[3]}`);
      }
    }
  }

  return dedupeLines(out);
}




module.exports = {
    splitOnSlashOutsideFractions,
    isMatchStartingInsideFraction,
    normalizeInlineIngredientFragment,
    extractInlineIngredientFragmentsFromLines,
};