// backend/src/utils/ocrText.js
// LEVEL: UTIL (OCR text parsing)
// import autorisés : utils (stringUtils, units, heuristics, ingredientParser, ocrTitle)
// import interdits : routes, middleware, services (vision/supabase), prisma/lib, parsers sites
// importé par : routes import-ocr (ou services OCR), et autres utils
'use strict';


const { looksLikeNonIngredientGarbage, looksLikeBareIngredientLine, looksLikeCreditsLine, extractParenNote, dedupeLines, smartFilterWithTrashFromText } = require('../utils/ocrNoise');
const { parseOcrIngredient} = require('../utils/ingredientParser');
//stringUtils
const { normSpaces, looksLikeTimeInfoLine } = require('../utils/stringUtils');

//ingredientUtils'
const { isIngredientFragmentLine, joinWrappedLinesForIngredients, looksLikeListBullet } = require('../utils/ingredientUtils');
//unit.js
const { extractServingsFromLine } = require('../utils/units');
const { isIngredientsHeader,  isPreparationHeader,  isStepsHeader } = require('../utils/sectionHeaders');

const { looksLikeStepContinuation,looksLikeStepLine, looksLikeActionSentence, looksLikeStepVerbLine } = require('../utils/heuristics');
const { isStrictIngredientLine,  expandCompoundIngredientLines, splitCompositeIngredientLine, salvageIngredientFragmentsFromNotes, salvageBookColumnSnippets, looksLikeSpoonMeasureIngredient, isExplicitIngredientListHeader, isExplicitIngredientListStop,looksLikeBulletIngredientLine, looksLikeStepSubsectionHeader, looksLikeIngredientSubsectionLabel, extractTrailingIngredientBlock, filterFinalIngredientLines } = require('../utils/ocrIngredients');
const { extractInlineIngredientFragmentsFromLines } = require('../utils/ocrInline');
const { joinWrappedLinesForSteps, splitStepsBySentences, splitLongSteps } = require('../utils/ocrSteps');


const DEBUG_OCR = process.env.OCR_DEBUG !== 'production';
const dlog = (...args) => { if (DEBUG_OCR) console.log(...args); };

/* =========================
   INGREDIENT PARSER (FR)
========================= */


/* =========================
   TITLE (avec fallback sur ingrédients)
========================= */


// (le reste de ton fichier title + split etc. est inchangé)
//function cleanTitleCandidate(t) {
//  let s = normSpaces(t);
//  s = s.replace(/^[·•\-\–—\*\.\,\;\:\s]+/g, '');
//  s = normSpaces(s);
//  s = s.replace(/[.!?…]+$/g, '');
//  return normSpaces(s);
//}



/* =========================
   (tout le reste splitIngredientsAndSteps / miniReflow est identique à ton fichier)
   Je le laisse inchangé pour éviter tout risque.
========================= */


function rebalanceMisplacedLines({ ingredientLines, stepLines, notesLines }) {
  const newIng = [];
  const newSteps = [...stepLines];
  const newNotes = [];

  function isLikelyStep(line) {
    const t = normSpaces(line);
    if (!t) return false;
    return looksLikeActionSentence(t) || looksLikeStepVerbLine(t) || looksLikeStepLine(t);
  }

  for (const l of ingredientLines) {
    const t = normSpaces(l);
    if (!t) continue;

    if (isLikelyStep(t)) newSteps.push(t);
    else newIng.push(t);
  }

  for (const l of notesLines) {
    const t = normSpaces(l);
    if (!t) continue;

    if (isLikelyStep(t)) newSteps.push(t);
    else newNotes.push(t);
  }

  return { ingredientLines: newIng, stepLines: newSteps, notesLines: newNotes };
}

/* =========================
   ✅ NEW: Variantes => Notes
========================= */

function moveVariantsBlockToNotes({ stepLines, notesLines }) {
  const steps = Array.isArray(stepLines) ? stepLines : [];
  const notes = Array.isArray(notesLines) ? notesLines : [];

  const idx = steps.findIndex((l) => /^variantes?\s*:/i.test(normSpaces(l)));
  if (idx < 0) return { stepLines: steps, notesLines: notes };

  const moved = steps.slice(idx);
  const kept = steps.slice(0, idx);

  return { stepLines: kept, notesLines: [...notes, ...moved] };
}


// ici



/* =========================
   SPLIT INGREDIENTS / STEPS / NOTES
========================= */


//ajout du 30/03/26
function debugWatchRecipeLines(label, arr) {
  const watch = /250\s*g|sucre vanill|beurre demi/i;
  const hit = (arr || []).filter(x => watch.test(String(x)));
  if (hit.length) dlog(`[WATCH SPLIT][${label}]`, hit);
}


function splitIngredientsAndSteps(lines, opts = {}) {
  opts = opts || {};
  const disableInlineExtraction = !!opts.disableInlineExtraction;
  const L = lines.map(normSpaces).filter(Boolean);
  debugWatchRecipeLines('L', L);
  let servings = null;
  for (const l of L.slice(0, 50)) {
    const s = extractServingsFromLine(l);
    if (s) {
      servings = s;
      break;
    }
  }

  const idxIng = L.findIndex((l) => /^ingr[ée]dients?\b/i.test(l) || isIngredientsHeader(l));
  const idxPrep = L.findIndex((l) => /^préparation\b/i.test(l) || /^preparation\b/i.test(l) || isPreparationHeader(l));

  let ingredientLines = [];
  let stepLines = [];
  let notesLines = [];

  if (idxIng >= 0 && idxPrep >= 0 && idxPrep > idxIng) {
    ingredientLines = L.slice(idxIng + 1, idxPrep);
    stepLines = L.slice(idxPrep, L.length);
  } else if (idxIng >= 0) {
    // ✅ Tout ce qui est AVANT "Ingrédients" => meta (notes + servings potentiels)
    const head = L.slice(0, idxIng).map(normSpaces).filter(Boolean);
    for (const h of head) {
      const s = extractServingsFromLine(h);
      if (s && !servings) servings = s;

      //ajoute le 29/03/26
      const parsed = parseOcrIngredient(h);
      if (parsed) {
        ingredientLines.push(h);
        continue;
      }

      if (looksLikeTimeInfoLine(h)) {
        notesLines.push(h);
        continue;
      }

      // garde d'autres lignes utiles (ex: "Variantes :" parfois)
      if (/^variantes?\b/i.test(h)) {
        notesLines.push(h);
        continue;
      }
    }

    const tail = L.slice(idxIng + 1);
    let inSteps = false;
    let prev = '';

    for (const l of tail) {
      if (!l) continue;

      if (!inSteps && ingredientLines.length > 0) {
        const last = ingredientLines[ingredientLines.length - 1];
        const lastHasOpenParen = /\([^)]*$/.test(last);
        const curClosesParen = /[^()]*\)/.test(l);

        if (lastHasOpenParen && curClosesParen) {
          ingredientLines[ingredientLines.length - 1] = normSpaces(`${last} ${l}`);
          prev = l;
          continue;
        }
      }

      if (isIngredientsHeader(l) || extractServingsFromLine(l)) {
        const s = extractServingsFromLine(l);
        if (s && !servings) servings = s;
        prev = l;
        continue;
      }

      // header de sous-section d'étapes -> bascule immédiate
      if (!inSteps && (isStepsHeader(l) || looksLikeStepSubsectionHeader(l))) {
        inSteps = true;
        prev = l;
        continue;
      }

      // labels internes du bloc ingrédients -> notes, pas ingrédients
      if (!inSteps && looksLikeIngredientSubsectionLabel(l)) {
        notesLines.push(l);
        prev = l;
        continue;
      }

      //ajout le 01/04/26
      if (!inSteps && looksLikeBulletIngredientLine(l)) {
        const ex = extractParenNote(l);
        if (ex) {
          ingredientLines.push(ex.line);
          notesLines.push(ex.note);
        } else {
          ingredientLines.push(l);
        }
          prev = l;
          continue;
        }


      if (!inSteps && looksLikeSpoonMeasureIngredient(l)) {
        ingredientLines.push(l);
        prev = l;
        continue;
      }

      const parsedCurrentIngredient = parseOcrIngredient(l);
      const prevLooksStep =
      looksLikeStepLine(prev) || looksLikeStepVerbLine(prev) || looksLikeActionSentence(prev);

      const curLooksIngredient =
      !!parsedCurrentIngredient ||
      isStrictIngredientLine(l) ||
      looksLikeSpoonMeasureIngredient(l) ||
      looksLikeBulletIngredientLine(l);

      const curLooksBulletOnly =
      looksLikeListBullet(l) &&
      !looksLikeBulletIngredientLine(l) &&
      !curLooksIngredient;

      const curLooksNotIngredient = !curLooksIngredient;

      if (
        !inSteps &&
        (
          looksLikeStepLine(l) ||
          looksLikeStepVerbLine(l) ||
          looksLikeStepContinuation(prev, l) ||
          (prevLooksStep && curLooksNotIngredient)
        )
      ) {
        inSteps = true;
      }

      if (inSteps) {
        stepLines.push(l);
      } else {
        const ex = extractParenNote(l);
        if (ex) {
          ingredientLines.push(ex.line);
          notesLines.push(ex.note);
        } else {
          ingredientLines.push(l);
        }
      }

      prev = l;
    }

    } else {
    let afterServingsHeader = false;
    let inIngredientBullets = false;
    let inSteps = false;
    let inExplicitIngredientList = false;//ajouter le 30/03/26 a 13h42
    let prev = '';

    for (const l0 of L) {
      const l = normSpaces(l0);
      if (!l) continue;

      // ✅ Temps préparation/cuisson => Notes (pas ingrédients, pas étapes)
      if (looksLikeTimeInfoLine(l)) {
        notesLines.push(l);
        prev = l;
        continue;
      }

      if (isIngredientsHeader(l)) {
        afterServingsHeader = true;
        inIngredientBullets = true;
        prev = l;
        continue;
      }

      if (extractServingsFromLine(l)) {
        afterServingsHeader = true;
        prev = l;
        continue;
      }

      //ajoute le 30/03/26 a 13h44 - d'ici à

       if (isExplicitIngredientListHeader(l)) {
        inExplicitIngredientList = true;
        prev = l;
        continue;
      }

      if (inExplicitIngredientList) {
        if (isExplicitIngredientListStop(l)) {
          inExplicitIngredientList = false;
          prev = l;
          continue;
        }

        if (looksLikeBareIngredientLine(l)) {
          const ex = extractParenNote(l);
          if (ex) {
            ingredientLines.push(ex.line);
            notesLines.push(ex.note);
          } else {
            ingredientLines.push(l);
          }
          prev = l;
          continue;
        }
      }
      //ici

      if (!inSteps) {
        //const parsed = parseOcrIngredient(l);
        const parsedStrict = isStrictIngredientLine(l);
        const isBullet = looksLikeListBullet(l);

        if ((afterServingsHeader && (isBullet || parsedStrict)) && !looksLikeStepLine(l)) {
          inIngredientBullets = true;
          const ex = extractParenNote(l);
          if (ex) {
            ingredientLines.push(ex.line);
            notesLines.push(ex.note);
          } else {
            ingredientLines.push(l);
          }
          prev = l;
          continue;
        }
        if (looksLikeSpoonMeasureIngredient(l)) {
          const ex = extractParenNote(l);
          if (ex) {
            ingredientLines.push(ex.line);
            notesLines.push(ex.note);
          } else {
            ingredientLines.push(l);
          }
          continue;
        }

        if (!inSteps && isStepsHeader(l)) {
          inSteps = true;
          prev = l;
          continue;
        }

        if (looksLikeStepLine(l) || looksLikeStepVerbLine(l) || looksLikeStepContinuation(prev, l)) {
          inSteps = true;
          stepLines.push(l);
          prev = l;
          continue;
        }

        if (inIngredientBullets) {
          // ✅ Garde les ingrédients sans quantité (ex: "Thym", "Huile d'olive") dans la liste
          const low = l.toLowerCase();

          const looksLikeNoQtyIngredient =
          isIngredientFragmentLine(l) ||
          /^(thym|basilic|persil|ciboulette|origan|romarin|menthe)\b/i.test(low) ||
          /^huile\b/i.test(low) ||
          /^(sel|poivre)\b/i.test(low);

          if (looksLikeNoQtyIngredient) ingredientLines.push(l);
          else notesLines.push(l);

          prev = l;
          continue;
        }

        if (parsedStrict) {
          const ex = extractParenNote(l);
          if(ex) {
            ingredientLines.push(ex.line);
            notesLines.push(ex.note);
          } else {
            ingredientLines.push(l);
          }
        } else {
          notesLines.push(l);
        }

        prev = l;
      } else {
        stepLines.push(l);
        prev = l;
      }
    }
  }

  debugWatchRecipeLines('ingredientLines-before-filter', ingredientLines);
  debugWatchRecipeLines('stepLines-before-filter', stepLines);
  debugWatchRecipeLines('notesLines-before-filter', notesLines);


  ingredientLines = ingredientLines.filter((l) => !isIngredientsHeader(l) && !extractServingsFromLine(l));
  notesLines = notesLines.filter((l) => !isIngredientsHeader(l) && !extractServingsFromLine(l));

  debugWatchRecipeLines('ingredientLines-after-filter', ingredientLines);
  debugWatchRecipeLines('stepLines-after-filter', stepLines);
  debugWatchRecipeLines('notesLines-after-filter', notesLines);

  // ✅ CAT-02: si on a un header "Ingrédients", on ne doit pas déplacer la fin des steps vers ingrédients.
  // Ce filet de sécurité sert surtout quand le document n'a pas de structure claire.
  if (idxIng < 0) {
    const moved = extractTrailingIngredientBlock({ ingredientLines, stepLines });
    ingredientLines = moved.ingredientLines;
    stepLines = moved.stepLines;
  }

  const ingredientLinesBeforeJoin = [...ingredientLines];

  const bareIngredientCount = ingredientLines.filter((l) => looksLikeBareIngredientLine(l)).length;
  const strictIngredientCount = ingredientLines.filter((l) => isStrictIngredientLine(l)).length;

  // si on a surtout une liste d'ingrédients nus, ne pas les fusionner entre eux
  const shouldSkipIngredientJoin = bareIngredientCount >= 3 && strictIngredientCount <= 2;

ingredientLines = shouldSkipIngredientJoin
  ? ingredientLines.map(normSpaces).filter(Boolean)
  : joinWrappedLinesForIngredients(ingredientLines, parseOcrIngredient);

  dlog('[debug ingredientLines before join]', ingredientLinesBeforeJoin);
  dlog('[debug ingredientLines after join]', ingredientLines);

  ingredientLines = expandCompoundIngredientLines(ingredientLines);

  {
    const newIng = [];
    for (const l of ingredientLines) {
      const ex = extractParenNote(l);
      if (ex) {
        newIng.push(ex.line);
        notesLines.push(ex.note);
      } else {
        newIng.push(l);
      }
    }
    ingredientLines = newIng;
  }

  const salvaged = salvageIngredientFragmentsFromNotes({ ingredientLines, notesLines });
  ingredientLines = salvaged.ingredientLines;
  notesLines = salvaged.notesLines;

  const fixedSnips = salvageBookColumnSnippets({ ingredientLines, notesLines });
  ingredientLines = fixedSnips.ingredientLines;
  notesLines = fixedSnips.notesLines;


  const rebalanced = rebalanceMisplacedLines({ ingredientLines, stepLines, notesLines });
  ingredientLines = rebalanced.ingredientLines;
  stepLines = rebalanced.stepLines;
  notesLines = rebalanced.notesLines;

  debugWatchRecipeLines('ingredientLines-after-rebalance', ingredientLines);
  debugWatchRecipeLines('stepLines-after-rebalance', stepLines);
  debugWatchRecipeLines('notesLines-after-rebalance', notesLines);

  // ✅ NEW: si "Variantes :" est dans les steps => on bascule le bloc dans notes
  const movedVar = moveVariantsBlockToNotes({ stepLines, notesLines });
  stepLines = movedVar.stepLines;
  notesLines = movedVar.notesLines;

  const cutIdx = stepLines.findIndex(l => looksLikeCreditsLine(l));
  if (cutIdx >= 0) {
    stepLines = stepLines.slice(0, cutIdx);
  }
  // a enlever jusqua console.log
  function debugWhere(arr, label) {
    const hit = (arr || []).filter(x => /passoire|pomme|pommes de terre/i.test(String(x)));
    if (hit.length) dlog(`[DEBUG] ${label}:`, hit);
  }

  debugWhere(ingredientLines, 'ingredientLines');
  debugWhere(stepLines, 'stepLines'); 
  debugWhere(notesLines, 'notesLines');
  dlog(stepLines.slice(0,30))

  stepLines = joinWrappedLinesForSteps(stepLines, {
    looksLikeSpoonMeasureIngredient,
  });

  dlog('[INLINE SOURCE][L]', L.slice(0, 80));
  dlog('[INLINE SOURCE][notes]', notesLines.slice(0, 30));
  dlog('[INLINE SOURCE][steps]', stepLines.slice(0, 30));

  //ajoute le 03/04/26
  if (!disableInlineExtraction) {
    const inlineSource = dedupeLines([
      ...L, //si je l'enleve une des recettes revient juste avec jaune d'oeuf - il faut donc le garder
      ...notesLines,
      ...stepLines,
    ]);

    const inlineExtracted = extractInlineIngredientFragmentsFromLines(inlineSource);

    dlog('[INLINE EXTRACTED]', inlineExtracted);

    ingredientLines = dedupeLines([...ingredientLines, ...inlineExtracted]);
  } else {
    dlog('[INLINE EXTRACTED][SKIPPED]', { reason: 'fragmented_layout' });
  }  

  ingredientLines = filterFinalIngredientLines(ingredientLines);
 
  
  // split ingrédients composites (sel/poivre etc)
  ingredientLines = ingredientLines.flatMap(l =>
    splitCompositeIngredientLine(l)
  );

  ingredientLines = dedupeLines(ingredientLines);

  dlog('[INGREDIENT LINES AFTER INLINE]', ingredientLines);



  // ✅ NEW: découpe en phrases si une ligne est longue et contient plusieurs phrases
  stepLines = splitStepsBySentences(stepLines);

  stepLines = splitLongSteps(stepLines);

  return { ingredientLines, stepLines, notesLines, servings };
}

function miniReflow({ ingredientLines, stepLines, notesLines }) {
  return [...ingredientLines, ...stepLines, ...notesLines];
}

module.exports = {
  smartFilterWithTrashFromText,
  splitIngredientsAndSteps,
  joinWrappedLinesForSteps,
  splitLongSteps,
  miniReflow,
  looksLikeBareIngredientLine,
  looksLikeNonIngredientGarbage,
};

