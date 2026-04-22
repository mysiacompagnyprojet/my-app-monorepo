// backend/src/utils/ocrIngredients.js
// LEVEL: UTIL (OCR text parsing)
// import autorisés : 
// import interdits : 
// importé par : 

'use strict';

const { normSpaces } = require('./stringUtils');
const { parseOcrIngredient } = require('./ingredientParser');
const { looksLikeStatusBarNoise, looksLikeEditorialNoise, looksLikeUiDisplayNameNoise, looksLikeNonIngredientGarbage, looksLikeBareIngredientLine } = require('./ocrNoise');
const { looksLikeDateNoise, looksLikeCountersNoise, looksLikeSocialNoise, isUnitToken, isIngredientFragmentLine, joinWrappedLinesForIngredients, looksLikeListBullet } = require('./ingredientUtils');
const { isIngredientsHeader, isPreparationHeader, isStepsHeader }  = require('./sectionHeaders'); 
const { looksLikeStepVerbLine, looksLikeActionSentence, looksLikeStepLine} = require('../utils/heuristics');
const { splitOnSlashOutsideFractions }  = require('./ocrInline'); 


/**
 * ✅ IMPORTANT (nouvelle règle)
 * - quantity => NUMBER (calculs)
 * - quantityRaw => STRING (affichage exact de ce que l'OCR a lu)
 *
 * Donc on sépare :
 * - parseQuantityToNumber() : retourne un number
 * - normalizeQuantityRawForDisplay() : retourne une string (ex: "1/2", "0,5", "0.5")
 */

function beautifyIngredients(items) {
  const list = Array.isArray(items) ? items.map((x) => ({ ...x })) : [];

  const idxButter = list.findIndex((it) => /\bbeurre\s+de\s+cacahu[eé]te\b/i.test(normSpaces(it?.name)));
  const idxPeanuts = list.findIndex((it) => /\bcacahu[eé]tes?\b/i.test(normSpaces(it?.name)));

  if (idxButter >= 0) {
    let bn = normSpaces(list[idxButter].name || '');

    bn = bn.replace(/\bRecettes?\s+Délice\b/gi, '').replace(/\bRecettes?\s+Delice\b/gi, '');
    bn = bn.replace(/\bRecoltos\b/gi, '').replace(/\bDélico\b/gi, '').replace(/\bDelico\b/gi, '');
    bn = bn.replace(/\s+\d{3,6}\s*$/g, '');

    const m = bn.match(/\bbeurre\s+de\s+cacahu[eé]te\b(.*)$/i);
    const tail = m ? normSpaces(m[1]) : '';

    bn = bn.replace(/\bbeurre\s+de\s+cacahu[eé]te\b.*$/i, 'beurre de cacahuete');
    list[idxButter].name = normSpaces(bn);

    if (tail && idxPeanuts >= 0) {
      const pn = normSpaces(list[idxPeanuts].name || '');
      const already = new RegExp(tail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(pn);
      if (!already) {
        list[idxPeanuts].name = normSpaces(`${pn} ${tail}`);
      }
    }
  }

  const out = [];
  const seen = new Set();

  for (const it of list) {
    const name = normSpaces(it.name || '');
    const quantityNum = Number(it.quantity || 0);
    const quantity = Number.isFinite(quantityNum) ? quantityNum : 0;
    const unit = it.unit == null ? '' : String(it.unit);
    const quantityRaw = typeof it.quantityRaw === 'string' ? normSpaces(it.quantityRaw) : '';

    if (!name) continue;

    // ✅ dedupe stable sur le number (calcul), pas sur l'affichage
    const key = `${name.toLowerCase()}|${unit.toLowerCase()}|${String(quantity)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const row = { name, quantity, unit };
    if (quantityRaw) row.quantityRaw = quantityRaw;

    out.push(row);
  }

  return out;
}

function isStrictIngredientLine(line) {
 const p = parseOcrIngredient(line);
 if (!p) return false;

 // adapte aux champs réels de ton parser
 const qty = p.quantity ?? null;
 const qtyRaw = p.quantityRaw ?? null;

 return (qty != null && qty !== 0) || (typeof qtyRaw === 'string' && qtyRaw.trim() !== '');
}

function splitCompoundIngredientLine(line) {
  const l = normSpaces(line);

  const m = l.match(
    /^(\d{1,4})\s*(kg|g|mg|l|dl|cl|ml)\s*(?:de\s+|d['’]\s*)(.+?)\s+(\d{1,4})\s*(?:de\s+|d['’]\s*)(.+)$/i
  );
  if (!m) return null;

  const qty1 = m[1];
  const unit = m[2];
  const name1 = m[3];
  const qty2 = m[4];
  const name2 = m[5];

  if (looksLikeStepLine(name2)) return null;

  return [`${qty1} ${unit} de ${name1}`, `${qty2} ${unit} de ${name2}`];
}

//ajouter le 31/03/26 - modifie le 01/04/26
function splitCompositeIngredientLine(line) {
  const l = normSpaces(line);
  if (!l) return [line];

  // split "/" seulement hors fractions
  if (l.includes('/')) {
    const parts = splitOnSlashOutsideFractions(l);

    if (
      parts.length >= 2 &&
      parts.every(p => p.length < 40) &&
      !parts.some(p => /^\d+$/.test(p))
    ) {
      return parts;
    }
  }

  // split "ou" seulement si liste simple
  if ((l.match(/\bou\b/gi) || []).length >= 1) {
    if (/\b(si|sinon|facultatif|option|possible|selon|goût|gout)\b/i.test(l)) {
      return [line];
    }

    const parts = l
      .split(/\bou\b/i)
      .map(p => normSpaces(p))
      .filter(Boolean);

    if (
      parts.length >= 2 &&
      parts.every(p => p.length < 30 && !/[.!?]/.test(p))
    ) {
      return parts;
    }
  }

  return [line];
}

function expandCompoundIngredientLines(lines) {
  const out = [];
  for (const line of lines) {
    const t = normSpaces(line);

    if (/^sel\s*,\s*poivre$/i.test(t) || /^sel\s+et\s+poivre$/i.test(t)) {
      out.push('sel');
      out.push('poivre');
      continue;
    }

    const split = splitCompoundIngredientLine(t);
    if (split) out.push(...split);
    else out.push(t);
  }
  return out;
}

function salvageIngredientFragmentsFromNotes({ ingredientLines, notesLines }) {
  const keepNotes = [];
  const frags = [];

  for (const l of notesLines) {
    const t = normSpaces(l);
    if (!t) continue;

    if (isUnitToken(t) || isIngredientFragmentLine(t)) frags.push(t);
    else keepNotes.push(t);
  }

  if (frags.length === 0) return { ingredientLines, notesLines };

  const joined = joinWrappedLinesForIngredients(frags);

  for (const j0 of joined) {
    const j = normSpaces(j0);

    const m = j.match(/^(\d{1,4})\s*(kg|g|mg|l|dl|cl|ml)\s+de\s+beurre\s+de\s+cacahu[eé]te\s+(.+)$/i);

    if (m) {
      const qty = m[1];
      const unit = m[2];
      const tail = normSpaces(m[3]);

      ingredientLines.push(`${qty} ${unit} de beurre de cacahuete`);

      const idxPeanuts = ingredientLines.findIndex((x) => /\bcacahu[eé]tes?\b/i.test(normSpaces(x)));
      if (idxPeanuts >= 0 && tail) {
        ingredientLines[idxPeanuts] = normSpaces(`${ingredientLines[idxPeanuts]} ${tail}`);
      } else if (tail) {
        keepNotes.push(tail);
      }
      continue;
    }

    if (parseOcrIngredient(j) || /^\d{1,4}\s*(?:kg|g|mg|l|dl|cl|ml)\b/i.test(j)) {
      ingredientLines.push(j);
    } else {
      keepNotes.push(j);
    }
  }

  return { ingredientLines, notesLines: keepNotes };
}

function salvageBookColumnSnippets({ ingredientLines, notesLines }) {
  const notesText = notesLines.map(normSpaces).filter(Boolean).join(' ').toLowerCase();

  const outIng = [...ingredientLines];
  const outNotes = [...notesLines];

  for (let i = 0; i < outNotes.length; i++) {
    const t = normSpaces(outNotes[i]);
    if (
      /^sel\s*,\s*poivre$/i.test(t) ||
      /^sel\s+et\s+poivre$/i.test(t) ||
      /^sel\s*&\s*poivre$/i.test(t)
    ) {
      outIng.push('sel');
      outIng.push('poivre');
      outNotes.splice(i, 1);
      i--;
    }
  }

  const idxCasDe = outIng.findIndex((l) =>
    /\b1\b.*\b(càs|cas|c\.\s*à\s*soupe|cuill(?:e|è)re\s+à\s+soupe)\b.*\bde\b/i.test(normSpaces(l))
  );
  if (idxCasDe >= 0 && notesText.includes('concentré de tomate')) {
    outIng[idxCasDe] = '1 càs de concentré de tomate';
  }

  const idxEcorce = outIng.findIndex((l) => /^1\s+morceau\s+d['’]écorce$/i.test(normSpaces(l)));
  if (
    idxEcorce >= 0 &&
    (notesText.includes("d'orange séchée") ||
      notesText.includes("d’orange séchée") ||
      notesText.includes('orange séchée'))
  ) {
    outIng[idxEcorce] = "1 morceau d'écorce d'orange séchée";
  }

  const idxPoivre = outIng.findIndex((l) => /^1\s+pointe\s+de\s+poivre$/i.test(normSpaces(l)));
  if (idxPoivre >= 0 && notesText.includes('cayenne')) {
    outIng[idxPoivre] = '1 pointe de poivre de Cayenne';
  }

  const idxBouquet = outIng.findIndex((l) => /^1\s+petit\s+bouquet\s+de$/i.test(normSpaces(l)));
  if (idxBouquet >= 0 && notesText.includes('persil')) {
    outIng[idxBouquet] = '1 petit bouquet de persil';
  }

  return { ingredientLines: outIng, notesLines: outNotes };
}

function looksLikeSpoonMeasureIngredient(line) {
  const s = String(line || '').replace(/\u00A0/g, ' ').trim();

  // 3 c.a.s. de ...
  // 3 càs de ...
  // 3 cas de ...
  // 3 c.à.s. de ...
  if (/^\d+\s*(c\s*\.?\s*a\s*\.?\s*s\s*\.?|c\s*\.?\s*à\s*\.?\s*s\s*\.?|càs|cas)\b/i.test(s)) {
    // souvent un ingrédient contient "de" ou "d'"
    if (/\b(d['’]?|de)\b/i.test(s)) return true;
  }
  return false;
}

//ajoute le 30/03/26 a 13h38 - d'ici à
function isExplicitIngredientListHeader(line) {
  const t = normSpaces(line).toLowerCase();
  if (!t) return false;

  return (
    /^pour\s+r[ée]aliser\s+cette\s+recette\s+tu\s+auras\s+besoin\s+de\s*:?\s*$/i.test(t) ||
    /^pour\s+faire\s+cette\s+recette\s+tu\s+auras\s+besoin\s+de\s*:?\s*$/i.test(t) ||
    /^il\s+te\s+faut\s*:?\s*$/i.test(t) ||
    /^ingr[ée]dients?\s*:?\s*$/i.test(t)
  );
}

function isExplicitIngredientListStop(line) {
  const t = normSpaces(line);
  const low = t.toLowerCase();
  if (!t) return true;

  if (looksLikeNonIngredientGarbage(t)) return true;
  if (looksLikeSocialNoise(t)) return true;
  if (looksLikeEditorialNoise(t)) return true;
  if (looksLikeStatusBarNoise(t)) return true;
  if (looksLikeDateNoise(t)) return true;
  if (looksLikeCountersNoise(t)) return true;

  if (
    /\b(recette complète|lien dans ma bio|dans ma bio|bon app[ée]tit|livre de \d+ recettes)\b/i.test(low)
  ) return true;

  if (
    /^(pr[ée]chauffez|versez|ajoutez|incorporez|m[ée]langez|laissez|faites|cuire|enfournez|servez|d[ée]gustez)\b/i.test(low)
  ) return true;

  return false;
}

function looksLikeStepSubsectionHeader(line) {
  const t = normSpaces(line);
  if (!t) return false;

  return /^(?:[-•*]\s*)?(cuisson|préparation|preparation|montage|finition)\b.*:$/i.test(t);
}

//ajouter le 01/04/26
function looksLikeIngredientSubsectionLabel(line) {
  const t = normSpaces(line);
  if (!t) return false;

  return (
    /^(ou)$/i.test(t) ||
    /^(m[aá]vem)$/i.test(t) ||
    /^(assaisonnement|assaisonement|marinade|sauce)\b.*:$/i.test(t)
  );
}

//ajoute le 01/04/26
function looksLikeBulletIngredientLine(line) {
  const t = normSpaces(line);
  if (!t) return false;
  if (!looksLikeListBullet(t)) return false;

  const unbulleted = normSpaces(t.replace(/^[-•*]\s*/, ''));
  if (!unbulleted) return false;

  if (looksLikeIngredientSubsectionLabel(unbulleted)) return false;
  if (looksLikeStepSubsectionHeader(unbulleted)) return false;
  if (isStepsHeader(unbulleted)) return false;
  if (looksLikeStepLine(unbulleted)) return false;
  if (looksLikeStepVerbLine(unbulleted)) return false;
  if (looksLikeActionSentence(unbulleted)) return false;

  return (
    !!parseOcrIngredient(unbulleted) ||
    isStrictIngredientLine(unbulleted) ||
    looksLikeSpoonMeasureIngredient(unbulleted) ||
    looksLikeBareIngredientLine(unbulleted)
  );
}

function extractTrailingIngredientBlock({ ingredientLines, stepLines }) {
  if (!stepLines || stepLines.length < 3) return { ingredientLines, stepLines };

  const start = Math.max(0, stepLines.length - 25);
  const tail = stepLines.slice(start);

  let lastIngredientLikeIdx = -1;
  let ingredientLikeCount = 0;

  for (let i = 0; i < tail.length; i++) {
    const l = normSpaces(tail[i]);

    if (looksLikeStatusBarNoise(l) || looksLikeDateNoise(l) || looksLikeCountersNoise(l) || looksLikeSocialNoise(l))
      continue;
    if (isIngredientsHeader(l) || isPreparationHeader(l)) continue;

    const parsed = parseOcrIngredient(l);
    const like =
      !!parsed ||
      isIngredientFragmentLine(l) ||
      isUnitToken(l) ||
      /^\d{1,4}\s*(kg|g|mg|l|dl|cl|ml)\b/i.test(l);

    if (like) {
      ingredientLikeCount++;
      lastIngredientLikeIdx = i;
    }
  }

  if (ingredientLikeCount < 2 || lastIngredientLikeIdx < 0) return { ingredientLines, stepLines };

  let firstIdx = -1;
  for (let i = 0; i <= lastIngredientLikeIdx; i++) {
    const l = normSpaces(tail[i]);
    const parsed = parseOcrIngredient(l);
    const like =
      !!parsed ||
      isIngredientFragmentLine(l) ||
      isUnitToken(l) ||
      /^\d{1,4}\s*(kg|g|mg|l|dl|cl|ml)\b/i.test(l);
    if (like) {
      firstIdx = i;
      break;
    }
  }

  if (firstIdx < 0) return { ingredientLines, stepLines };

  const moveBlock = tail.slice(firstIdx).map(normSpaces).filter(Boolean);
  const joinedMoveBlock = joinWrappedLinesForIngredients(moveBlock);

  const newStepLines = stepLines.slice(0, start + firstIdx);
  const newIngredientLines = [...ingredientLines, ...joinedMoveBlock];

  return { ingredientLines: newIngredientLines, stepLines: newStepLines };
}

function looksLikeIngredientMetaName(name) {
  const t = normSpaces(name).toLowerCase();
  if (!t) return true;

  return (
    /^(?:-?\s*)?mati[èe]res?\s+grasses?$/i.test(t) ||
    /^(?:-?\s*)?calories?$/i.test(t) ||
    /^(?:-?\s*)?prot[ée]ines?$/i.test(t) ||
    /^(?:-?\s*)?glucides?$/i.test(t) ||
    /^(?:-?\s*)?lipides?$/i.test(t) ||
    /^(?:-?\s*)?temps$/i.test(t) ||
    /^(?:-?\s*)?pr[ée]paration$/i.test(t) ||
    /^(?:-?\s*)?cuisson$/i.test(t) ||
    /^information nutritionnelle$/i.test(t)
  );
}


function filterFinalIngredientLines(ingredientLines) {
  return ingredientLines.filter((l) => {
    const t = normSpaces(l);
    if (!t) return false;

    if (looksLikeNonIngredientGarbage(t)) return false;
    if (looksLikeUiDisplayNameNoise(t)) return false;

    if (/^\d{1,4}(?:[.,]\d+)?\s*[kK]\s*$/i.test(t)) return false;
    if (/^\d{1,4}\s+\d{1,4}(?:[.,]\d+)?\s*[kK]\s*$/i.test(t)) return false;

    if (
      looksLikeStepLine(t) ||
      looksLikeStepVerbLine(t) ||
      looksLikeActionSentence(t)
    ) {
      return false;
    }

    const parsed = parseOcrIngredient(t);

    if (parsed) {
      const name = normSpaces(parsed.name || '');
      if (!name) return false;

      const low = name.toLowerCase();

      if (/^(q|de|et|ou)$/i.test(low)) return false;
      if (/^\d+$/.test(name)) return false;
      if (looksLikeIngredientMetaName(name)) return false;

      return true;
    }

    // fallback très prudent : on ne garde les "noms nus" que s'ils ressemblent
    // à de vrais ingrédients, pas à du bruit d'UI / display name
    if (!looksLikeBareIngredientLine(t)) return false;

    // rejette les lignes capitalisées de type "Dennis Korn Soft Sun"
    if (/^(?:[A-Z][a-z]+(?:['’-][A-Z]?[a-z]+)?\s+){2,}[A-Z][a-z]+(?:['’-][A-Z]?[a-z]+)?$/.test(t)) {
      return false;
    }

    return true;
  });
}






module.exports = {
        beautifyIngredients,
        isStrictIngredientLine,
        splitCompoundIngredientLine,
        splitCompositeIngredientLine,
        expandCompoundIngredientLines,
        salvageIngredientFragmentsFromNotes,
        salvageBookColumnSnippets,
        looksLikeSpoonMeasureIngredient,
        isExplicitIngredientListHeader,
        isExplicitIngredientListStop,
        looksLikeStepSubsectionHeader,
        looksLikeIngredientSubsectionLabel,
        looksLikeBulletIngredientLine,
        extractTrailingIngredientBlock,
        looksLikeIngredientMetaName,
        filterFinalIngredientLines
};
