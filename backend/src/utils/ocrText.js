// backend/src/utils/ocrText.js
// LEVEL: UTIL (OCR text parsing)
// import autorisés : utils (stringUtils, units, heuristics, ingredientParser, ocrTitle)
// import interdits : routes, middleware, services (vision/supabase), prisma/lib, parsers sites
// importé par : routes import-ocr (ou services OCR), et autres utils
'use strict';


const { looksLikeStatusBarNoise, looksLikeNonIngredientGarbage, looksLikeBareIngredientLine, looksLikeCreditsLine, extractParenNote, dedupeLines, smartFilterWithTrashFromText } = require('../utils/ocrNoise');
const { buildMergedTitleCandidate} = require('../utils/titleMerge');
const { parseOcrIngredient} = require('../utils/ingredientParser');
//stringUtils
const { normSpaces, looksLikeTimeInfoLine, cleanTitleCandidate, sanitizePickedTitle  } = require('../utils/stringUtils');
//titleUtils'
const { isMetaInfoLineForTitle, isTitleNoiseLabel, isGenericSiteTitle, isBadTitleCandidate, looksLikeLooseActionStep, looksTruncatedTitle, looksLikeIngredientFragmentTitleForTitle, isAllCapsTitleCandidate, isLikelyStandaloneTitleLine  } = require('../utils/titleUtils');
//ingredientUtils'
const { looksLikeDateNoise, looksLikeCountersNoise, looksLikeSocialNoise, isUnitToken, isIngredientFragmentLine, joinWrappedLinesForIngredients, looksLikeListBullet } = require('../utils/ingredientUtils');
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

function isMostlyUppercaseTitle(line) { //utilisé qu'ici si utilisé ailleurs la mettre dans titleUtils puis l'importé
  const t = normSpaces(line);
  if (!t) return false;
  if (t.length < 6 || t.length > 80) return false;
  if (/\d/.test(t)) return false;

  const letters = (t.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g) || []).length;
  if (!letters) return false;

  const upp = (t.match(/[A-ZÀ-ÖØ-Þ]/g) || []).length;
  return upp / letters >= 0.7;
}

// fonction trouver le titre explicite dans les premières lignes, elle n'est utilisé qu'ici si ailleurs la mettre dans titleUtils et l'importé
function findExplicitTitleInFirstLines(lines, maxScan = 60) {
  // On prend les maxScan premières lignes, on normalise les espaces, on enlève les lignes vides
  const scan = lines.slice(0, maxScan).map(normSpaces).filter(Boolean);

  // Liste des titres candidats qu'on va scorer puis trier
  const candidates = [];

  // Sert à savoir si on a déjà vu un candidat de titre plausible
  // (utile pour certaines logiques de "stop soft" si tu les gardes)
  let sawTitleCandidate = false;

  // On parcourt les premières lignes OCR
  for (let i = 0; i < scan.length; i++) {
    const raw = scan[i];
    if (!raw) continue;

    // Version minuscule/normalisée pour faire des tests simples
    const lowRaw = normSpaces(raw).toLowerCase();

    if (isMetaInfoLineForTitle(lowRaw)) continue;

    if (isTitleNoiseLabel(raw)) continue;

    // Ignore "Recette" / "Recettes"
    if (/^recettes?$/i.test(lowRaw)) continue;

    // Ignore auteur : "de Wendy", "de Marine", etc.
    if (/^de\s+[a-zà-öø-ÿ'-]{2,}$/i.test(lowRaw)) continue;

    //ajoute le 30/03/26 à 13h45
    if (/^pour\s+r[ée]aliser\s+cette\s+recette\s+tu\s+auras\s+besoin\s+de\b/i.test(lowRaw)) continue;
    if (/^pour\s+faire\s+cette\s+recette\s+tu\s+auras\s+besoin\s+de\b/i.test(lowRaw)) continue;

    // Stop "fort" : dès qu'on arrive aux vraies sections (étapes/ingrédients/préparation)
    // -> IMPORTANT : on met des "||"
    if (
      /^étape\b/.test(lowRaw) ||
      /^etape\b/.test(lowRaw) ||
      /^ingr[ée]dients?\b/.test(lowRaw) ||
      /^préparation\b/.test(lowRaw) ||
      /^preparation\b/.test(lowRaw)
    ) {
      break;
    }

    // Stop "soft" : sur Temps/Cuisson/etc. SEULEMENT si on a déjà un titre plausible
    // ⚠️ Ici, tu avais des tests sans "||" -> corrigé
    // ⚠️ MAIS : comme on "continue" déjà sur meta au-dessus, ce bloc ne déclenchera presque jamais.
    // Je le laisse quand même (sans casser), au cas où tu changes plus tard l'ordre des filtres.
    if (sawTitleCandidate && isMetaInfoLineForTitle(lowRaw)) {
      break;
    }

    // Nettoyage de la ligne (ponctuation, espaces, etc.)
    const t0 = cleanTitleCandidate(raw);

    // Nettoyage complémentaire (retire “afficher la suite”, etc.)
    const t = sanitizePickedTitle(t0);
    // Si vide après le nettoyage -> on passe à la ligne suivante
    if (!t) continue;

    // ❌ Conseils / alternatives (pas un titre) ajouter le 30/01
    // Ex: "Pas de pâte de curry ? Mélange simplement curry..."
    if (/\?/.test(t) && /\b(pas de|tu peux|vous pouvez|mélange|melange|ajoute|ajouter|remplace|remplacer|astuce)\b/i.test(t)) {
    continue;
    }

    // ❌ Lignes typiques de conseil même sans "?" ajoute le 30/01
    if (/^\s*(pas de|tu peux|vous pouvez)\b/i.test(t)) continue;


    if (looksLikeIngredientFragmentTitleForTitle(t)) continue;

    if (looksLikeLooseActionStep(t) || looksLikeLooseActionStep(raw)) continue;

    // ❌ Évite les titres qui commencent par "de " (souvent auteur collé)
    // ex: "de Wendy Pizzas fleurettes"
    if (/^de\s+/i.test(t)) continue;

    if (isTitleNoiseLabel(t)) continue;

    // Filtres existants (bruit / titres génériques / réseaux sociaux / etc.)
    if (isGenericSiteTitle(t)) continue;

    if (looksLikeStatusBarNoise(t)) continue;
    if (looksLikeDateNoise(t)) continue;
    if (looksLikeCountersNoise(t)) continue;
    if (looksLikeSocialNoise(t)) continue;

    if (isIngredientsHeader(t)) continue;
    if (isPreparationHeader(t)) continue;
    if (extractServingsFromLine(t)) continue;

    if (parseOcrIngredient(t)) continue;
    if (looksLikeStepLine(t)) continue;
    if (i > 0 && looksLikeStepContinuation(scan[i - 1], t)) continue;

    if (/^(sel|poivre|sel\s*&\s*poivre)\b/i.test(t)) continue;
    if (/^(temps|notes?)\b/i.test(t)) continue;

    // Longueur raisonnable
    if (t.length < 6 || t.length > 80) continue;

    // Pas de chiffres dans le titre (sinon ça prend des temps / calories / etc.)
    if (/\d/.test(t)) continue;

    // Bonus si le titre contient des majuscules (souvent vrai pour un titre)
    const hasUpper = /[A-ZÀ-ÖØ-Þ]/.test(t);

    // Bonus si c'est "presque tout en majuscule" (souvent titre de livre/recette)
    const capsBonus = isMostlyUppercaseTitle(t) ? 80 : 0;

    // Pénalité si ça ressemble à un titre tronqué (ex: finit par "à", "de", etc.)
    const isTrunc = looksTruncatedTitle(t);
    const truncPenalty = isTrunc ? -25 : 0;

    // ✅ candidat simple (1 ligne)
    candidates.push({
      t,
      score: capsBonus + (hasUpper ? 10 : 0) + (maxScan - i) + truncPenalty,
    });
    sawTitleCandidate = true;

    // ✅ candidats fusionnés (2-3 lignes)
    const merged = buildMergedTitleCandidate(scan, i, 3, {
      isIngredientLine: (s) => !!parseOcrIngredient(s),
    });

    //console log a effecer
    dlog('[TITLE] simple candidate', { i, t, score: candidates[candidates.length-1].score });
    // Sécurité : si merged existe et est différent, on l’ajoute aussi
    if (merged && merged !== t) {
      //console log a supprimer
      dlog('[TITLE] merged candidate:', { i, merged });
      //securite: refuse un titre fusionné qui fint being meta/label
      if (isMetaInfoLineForTitle(merged) || isTitleNoiseLabel(merged)) {
      } else {
        // (Optionnel mais sûr) : si la fusion commence par une meta, on refuse
        const mergedUpper = /[A-ZÀ-ÖØ-Þ]/.test(merged);
        const mergedCapsBonus = isMostlyUppercaseTitle(merged) ? 80 : 0;

        candidates.push({
          t: merged,
          score: mergedCapsBonus + (mergedUpper ? 10 : 0) + (maxScan - i) + 12,
        });
        sawTitleCandidate = true;
      }
    }
  }

  // Si aucun candidat -> pas de titre explicite trouvé
  if (candidates.length === 0) return null;

  // On trie par score décroissant
  candidates.sort((a, b) => b.score - a.score);

  //console log a effacer
  dlog('[TITLE] candidates ranked:', candidates
    .slice()
    .sort((a,b)=>b.score-a.score)
    .slice(0, 8)
  );

  // On renvoie le meilleur candidat
  return candidates[0].t;
}

function extractTitleFromStepHeader(lines) { // si utilisé ailleurs la mettre dns titleUtils et l'importé
  const scan = (lines || []).slice(0, 80).map(normSpaces).filter(Boolean);

  for (const l of scan) {
    // ex: "4 Montez les mini Croque-Monsieur : Coupez ..."
    const m = l.match(
      /\b(montez|monter|préparez|preparez|préparer|preparer|réalisez|realisez|assemblez|assembler)\b\s+(?:le|la|les|l['’])\s+(.+?)\s*[:\-–—]/i
    );
    if (!m) continue;

    let candidate = cleanTitleCandidate(m[2]);
    candidate = sanitizePickedTitle(candidate);

    // évite trop long
    if (candidate && candidate.length >= 6 && candidate.length <= 80 && !/\d/.test(candidate)) {
      // capitalise juste la première lettre, sans tout casser
      return candidate.charAt(0).toUpperCase() + candidate.slice(1);
    }
  }
  return null;
}
//const default title - enlever
function findTitleJustBeforeIngredientsHeader(lines, maxScan = 40, lookBack = 6) { // si utilisé ailleurs la mettre dns titleUtils et l'importé
  const scan = (lines || []).slice(0, maxScan).map(normSpaces).filter(Boolean);

  const idx = scan.findIndex((l) => isIngredientsHeader(l) || /^ingredients?\b/i.test(l));
  if (idx <= 0) return null;

  // On remonte avant "INGREDIENTS"
  for (let j = idx - 1; j >= Math.max(0, idx - lookBack); j--) {
    let t = cleanTitleCandidate(scan[j]);
    t = sanitizePickedTitle(t);
    if (!t) continue;

    // skip labels fréquents (DINER / PREPARATION / DIFFICULTÉ / etc.)
    const low = t.toLowerCase();
    if (
      low === 'diner' ||
      low === 'dîner' ||
      low === 'preparation' ||
      low === 'déroulé' ||
      low === 'deroule'||
      low === 'préparation' ||
      low === 'temps cuisson' ||
      low === 'temps de cuisson' ||
      low === 'temps preparation' ||
      low === 'temps de préparation' ||
      low === 'difficulté' ||
      low === 'difficulte' ||
      low === 'portions' ||
      low === 'directions'
    )
      continue;

    // mêmes filtres que findExplicitTitleInFirstLines
    if (isGenericSiteTitle(t)) continue;
    if (looksLikeStatusBarNoise(t)) continue;
    if (looksLikeDateNoise(t)) continue;
    if (looksLikeCountersNoise(t)) continue;
    if (looksLikeSocialNoise(t)) continue;

    if (isIngredientsHeader(t)) continue;
    if (isPreparationHeader(t)) continue;
    if (extractServingsFromLine(t)) continue;

    if (parseOcrIngredient(t)) continue;
    if (looksLikeStepLine(t)) continue;

    if (t.length < 6 || t.length > 90) continue;
    if (/\d/.test(t)) continue;

    if (!isBadTitleCandidate(t)) return t;
  }

  return null;
}

const DEFAULT_TITLE = 'Recette importée';
function guessTitleFromLines(lines) { //utilisé ici et importé dans import ocr
  const head = lines.slice(0, 16).map(normSpaces).filter(Boolean);
  const isIngredientLine = (s) => !!parseOcrIngredient(s);

  // 1) "Title: ..." ou variantes explicites
  const explicit = findExplicitTitleInFirstLines(lines, 60);
  if (explicit) {
    const cleaned = sanitizePickedTitle(explicit);
    if (cleaned && !isBadTitleCandidate(cleaned)) return cleaned;
  }

  // 2) Titre récupéré depuis un en-tête d'étapes
  const fromStepHeader = extractTitleFromStepHeader(lines);
  if (fromStepHeader && !isBadTitleCandidate(fromStepHeader)) return fromStepHeader;

 // ✅ Priorité: si on trouve un “gros titre” en majuscules dans le head, on le prend
 for (let i = 0; i < Math.min(head.length, 8); i++) {
  if (isAllCapsTitleCandidate(head[i], isIngredientLine)) {
    return sanitizePickedTitle(cleanTitleCandidate(head[i]));
  }
 }

  // ✅ Si le head contient une ligne "titre" au milieu d'une liste, on la prend
 for (let i = 0; i < Math.min(head.length, 10); i++) {
  const raw = head[i];
  if (/^[-•*·]\s*/.test(raw)) continue;

  if (isLikelyStandaloneTitleLine(raw, isIngredientLine)) {
    return sanitizePickedTitle(cleanTitleCandidate(raw));
  }
 } // a ici le 20/01


  // 3) Si on voit rapidement "Ingrédients" / portions, on tente le titre juste avant
  if (head.some((l) => extractServingsFromLine(l) || isIngredientsHeader(l))) {
    const beforeIng = findTitleJustBeforeIngredientsHeader(lines, 40, 6);

    // ✅ Ne jamais accepter un "titre" qui ressemble à un ingrédient
    if (beforeIng &&
      !parseOcrIngredient(beforeIng) && //ajout le 20/01 pour recette
      !looksLikeIngredientFragmentTitleForTitle(beforeIng) && //ajout le 20/01
      !isBadTitleCandidate(beforeIng) // ajout le 20/01
    ) {
       return beforeIng;
    // fait le 20/01 - ne pas return ici, on laisse le scoring essayer - return DEFAULT_TITLE;
      }
    }    

  // 4) Détecte si les premières lignes ressemblent à une liste d'ingrédients
  const ingredientLikeCount = head
    .filter((l) => {
      const t = normSpaces(l);
      if (/^[-•*·]\s+/.test(t)) return true;
      if (/^(un peu de|selon goût|au goût)\b/i.test(t)) return true;
      return !!parseOcrIngredient(t);
    })
    .length;

  // On n'abandonne pas tout de suite : certaines recettes commencent par "- ..." puis ont un vrai titre
  const hasIngredientListAtTop = ingredientLikeCount >= 3;

  // 5) Scoring simple sur les premières lignes (avec protections anti-bruit)
  let prev = '';
  for (let i = 0; i < head.length; i++) {
    const raw0 = normSpaces(head[i] || '');
    if (!raw0) continue;

    // "13:18 Sauce Big Mac" -> "Sauce Big Mac"
    let raw = raw0.replace(/^\d{1,2}:\d{2}\s+/g, '');

    // "- Butter Chicken Express" -> "Butter Chicken Express" - ancien code pour recette 4 - enlever le 30/01
    //raw = raw.replace(/^[-•*·]\s+/g, '');

    let t = cleanTitleCandidate(raw);
    t = sanitizePickedTitle(t);
    if (!t) {
      prev = raw0;
      continue;
    }

    if (isGenericSiteTitle(t)) {
      prev = raw0;
      continue;
    }
    if (looksLikeStatusBarNoise(t)) {
      prev = raw0;
      continue;
    }
    if (looksLikeDateNoise(t)) {
      prev = raw0;
      continue;
    }
    if (looksLikeCountersNoise(t)) {
      prev = raw0;
      continue;
    }
    if (looksLikeSocialNoise(t)) {
      prev = raw0;
      continue;
    }
    if (isIngredientsHeader(t)) {
      prev = raw0;
      continue;
    }
    if (isPreparationHeader(t)) {
      prev = raw0;
      continue;
    }
    if (extractServingsFromLine(t)) {
      prev = raw0;
      continue;
    }
    if (looksLikeStepContinuation(prev, t)) {
      prev = raw0;
      continue;
    }
    if (/^(un peu de|selon goût|au goût)\b/i.test(t)) {
      prev = raw0;
      continue;
    }
    if (parseOcrIngredient(t)) {
      prev = raw0;
      continue;
    }
    if (/^(sel|poivre|sel\s*&\s*poivre)\b/i.test(t)) {
      prev = raw0;
      continue;
    }
    if (looksLikeStepLine(t)) {
      prev = raw0;
      continue;
    }
    if (/^(temps|notes?)\b/i.test(t)) {
      prev = raw0;
      continue;
    }
    if (looksLikeIngredientFragmentTitleForTitle(t)) {
      prev = raw0;
      continue;
    }
    if (/\btu\b/i.test(t) || /\bpeux\b/i.test(t) || /\bajouter\b/i.test(t)) { 
      prev = raw0; 
      continue; 
    }//ajouter le 20/01 - rejeter les phrases “conseil” avant de les considérer comme titre.
    if (/\bgo[uû]t\b/i.test(t) && /\bproche\b/i.test(t)) { 
      prev = raw0; 
      continue; 
    }//ajouter la 20/01 - rejeter les phrases “conseil” avant de les considérer comme titre.
    
    // ❌ conseils / alternatives (ex: "Pas de pâte de curry ? Mélange...")
    if (/\bpas de\b/i.test(t) && /\?/.test(t)) { 
      prev = raw0; 
      continue; 
    }//ajouter la 20/01
    if (/\bm[eé]lange\b/i.test(t)) { 
      prev = raw0; 
      continue; 
    }//ajouter la 20/01
    if (/\bsimplement\b/i.test(t)) { 
      prev = raw0; 
      continue; 
    }//ajouter la 20/01


    // candidat titre
    if (t.length >= 6 && t.length <= 80 && !/\d/.test(t)) {
      const cleaned = sanitizePickedTitle(t);
      if (cleaned && !isBadTitleCandidate(cleaned)) {
        // Join d’un suffixe court (ex: "à l'ancienne", "express", etc.)
        const next0 = normSpaces(head[i + 1] || '');
        const next = sanitizePickedTitle(
          cleanTitleCandidate(next0.replace(/^\d{1,2}:\d{2}\s+/g, '').replace(/^[-•*·]\s+/g, ''))
        );

        const nextLow = (next || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

        const isTitleSuffix =
          !!next &&
          next.length <= 22 &&
          (/^a\s+l['’]/i.test(nextLow) ||
            /^a\s+la\b/i.test(nextLow) ||
            /^a\s+aux\b/i.test(nextLow) ||
            /^express\b/i.test(nextLow) ||
            /^maison\b/i.test(nextLow) ||
            /^facile\b/i.test(nextLow) ||
            /^rapide\b/i.test(nextLow)) &&
          !parseOcrIngredient(next) &&
          !looksLikeStepLine(next) &&
          !looksLikeIngredientFragmentTitleForTitle(next);

        if (isTitleSuffix) {
          const merged = normSpaces(`${cleaned} ${next}`);
          if (merged.length <= 90 && !isBadTitleCandidate(merged)) return merged;
        }

        return cleaned;
      }
    }

    prev = raw0;
  }
    if (hasIngredientListAtTop) return DEFAULT_TITLE;

  return DEFAULT_TITLE;
}

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
  guessTitleFromLines,
  miniReflow,
  looksLikeBareIngredientLine,
  looksLikeNonIngredientGarbage,
};

