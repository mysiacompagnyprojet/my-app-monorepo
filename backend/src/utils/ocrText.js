// backend/src/utils/ocrText.js
// LEVEL: UTIL (OCR text parsing)
// import autorisés : utils (stringUtils, units, heuristics, ingredientParser, ocrTitle)
// import interdits : routes, middleware, services (vision/supabase), prisma/lib, parsers sites
// importé par : routes import-ocr (ou services OCR), et autres utils
'use strict';


const { buildMergedTitleCandidate} = require('../utils/titleMerge');
const { parseOcrIngredient} = require('../utils/ingredientParser');
//stringUtils
const { normSpaces, stripWeird, looksLikeTimeInfoLine, stripEdgeEmojisAndPunct, cleanTitleCandidate, sanitizePickedTitle  } = require('../utils/stringUtils');
//textUtils'
const { normalizeForDedup} = require('../utils/textUtils');
//titleUtils'
const { isMetaInfoLineForTitle, isTitleNoiseLabel, looksLikePlausibleTitleLine, isGenericSiteTitle, isBadTitleCandidate, looksLikeLooseActionStep, looksTruncatedTitle, looksLikeIngredientFragmentTitleForTitle, isAllCapsTitleCandidate, isLikelyStandaloneTitleLine  } = require('../utils/titleUtils');
//ingredientUtils'
const { looksLikeDateNoise, looksLikeCountersNoise, looksLikeSocialNoise, isUnitToken, isIngredientFragmentLine, joinWrappedLinesForIngredients, looksLikeListBullet } = require('../utils/ingredientUtils');
//unit.js
const { extractServingsFromLine } = require('../utils/units');
const { isIngredientsHeader,  isPreparationHeader,  isStepsHeader } = require('../utils/sectionHeaders');

const { looksLikeStepContinuation,looksLikeStepLine, looksLikeActionSentence, looksLikeStepVerbLine } = require('../utils/heuristics');
const DEBUG_OCR = process.env.OCR_DEBUG !== 'production';
const dlog = (...args) => { if (DEBUG_OCR) console.log(...args); };

/* =========================
   TRASH / NOISE (iPhone + Social)
========================= */

function looksLikeBookRefNoise(line) {
  const t = normSpaces(line).toLowerCase();
  return /\bvoir\s+p\.?\s*\d+\b/.test(t);
}

// Exemple: "Préparation : 45 min ... 304"
function stripTrailingPageNumber(line) {
  let t = normSpaces(line);
  // retire un numéro final si le texte contient un marqueur de temps
  if (/\b(préparation|preparation|cuisson|min)\b/i.test(t)) {
    t = t.replace(/\s+\d{2,4}\s*$/g, '');
  }
  return normSpaces(t);
}

function looksLikeStatusBarNoise(line) {
  const t = normSpaces(line);
  if (/^\d{1,2}:\d{2}$/.test(t)) return true;
  if (/\b(4g|5g|lte|wifi|wi-fi)\b/i.test(t) && /\b\d{1,3}\b/.test(t)) return true;
  if (/^\d{1,3}%$/.test(t)) return true;
  return false;
}

function looksLikeEditorialNoise(line) {
  const t = normSpaces(line).toLowerCase();
  if (!t) return true;

  // phrases marketing / éditoriales
  if (
    /\b(tiktok|instagram|facebook|bonne maman|marmiton|yumrecette)\b/i.test(t) ||
    (/\b(léger|riche|irrésistible|délicieux|savoureux)\b/i.test(t) &&
      !looksLikeStepLine(t) &&
      !parseOcrIngredient(t))
  ) {
    return true;
  }

  // mentions légales / sources
  if (/\b(source|droits d'auteur|copyright|©|tous droits réservés)\b/i.test(t)) {
    return true;
  }

  // Blocs "à suivre" / recos qui polluent beaucoup - enlever le 23/02 car deja gerer par looksLikeSocialNoise
  //if (/^\s*(à\s+suivre|a\s+suivre)\b/i.test(t)) return true;
  //if (/^\s*<\s*recommandations?\b/i.test(t)) return true;

  // Petits tokens UI isolés - enlever le 23/02 car deja gerer par looksLikeSocialNoise
  //if (/^\s*(recommandations?|explorer|suivre)\s*$/i.test(t)) return true;
  //if (/^\s*→\s*suivre\s*$/i.test(t)) return true;

  // Pseudos / noms courts bizarres ("iman.")
  if (
    /^[a-z0-9._-]{2,}\.$/i.test(t) && t.length <= 12 &&
    /[0-9_-]|[.]/.test(t.slice(0, -1))
  ) {
    return true;
  }

  // Compteurs type "40 61" (pas toujours captés par looksLikeCountersNoise)
  if (/^\d{1,3}\s+\d{1,3}$/.test(t)) return true;

  return false;
}

//ajouter le 30/03/26 - fonction poubelle
function looksLikeNonIngredientGarbage(line) {
  const t = normSpaces(line);
  if (!t) return true;

  const low = t.toLowerCase();

  if (/^(directions?|préparation|preparation|préparer la pâte|preparer la pate|cuisson et finition|astuce)\s*:?\s*$/i.test(t)) return true;

  if (/^(préchauffez|prechauffez|versez|ajoutez|incorporez|incorporez progressivement|mélangez|melangez|laissez|dégustez|degustez)\b/i.test(low)) return true;

  if (/^\d+\s+[a-z]$/i.test(low)) return true; // ex: 607 Q
  if (/^[a-z]$/i.test(low)) return true;       // ex: Q

  //if (/^\d+\s+[a-z]$/i.test(low)) return true;   // ex: 607 Q
  if (/^\d+\s*[a-z]?$/i.test(low)) return true;  // ex: 607, 607 Q
  //if (/^[a-z]\s*\d+$/i.test(low)) return true;   // cas inversé pourri

  //if (/^(q|g|kg|ml|cl|dl|l)$/i.test(low)) return true;

  if (/^environ\s+\d+(?:[.,]\d+)?\s*(kg|g|mg|l|dl|cl|ml)\b/i.test(low)) return true;
  if (/\b(directions?|préparation|preparation|astuce|quand)\b/i.test(low)) return true;
  if (/\b(préchauffez|prechauffez|versez|ajoutez|incorporez|mélangez|laissez|dégustez|degustez)\b/i.test(low)) return true;

  //ajoute le 30/03/26 a 13h56
  if (/^\d{1,4}(?:[.,]\d+)?\s*[kK]\s*$/i.test(low)) return true;      // ex: 10,5 K
  if (/^\d{1,4}\s+\d{1,4}(?:[.,]\d+)?\s*[kK]\s*$/i.test(low)) return true; // ex: 302 10,5 K
  if (/^\d{1,4}\s+[a-z]$/i.test(low)) return true; // ex: 607 Q

  return false;
}

function looksLikeBareIngredientLine(line) {
  const t = normSpaces(line);
  if (!t) return false;

  const low = t.toLowerCase();

  if (looksLikeNonIngredientGarbage(t)) return false;
  if (looksLikeStatusBarNoise(t)) return false;
  if (looksLikeDateNoise(t)) return false;
  if (looksLikeCountersNoise(t)) return false;
  if (looksLikeSocialNoise(t)) return false;

  // pas de phrases d'action / étapes
  if (looksLikeStepLine(t)) return false;
  if (looksLikeStepVerbLine(t)) return false;
  if (looksLikeActionSentence(t)) return false;

  // pas de hooks / textes sociaux
  if (/\b(vous pensez|tu auras besoin|bon app[ée]tit|lien dans ma bio|livre de|je l'ai s[ée]duite|amoureux de toi)\b/i.test(low)) {
    return false;
  }

  // pas de lignes très longues -> souvent phrase, pas ingrédient
  if (t.length > 70) return false;

  //ajoute le 02/04/26
  if (
    /^(commencez|prenez|versez|ajoutez|mélangez|melangez|frottez|beurrez|battez|badigeonnez|placez|laissez|coupez|étalez|etalez|tracez|croisez|préchauffez|prechauffez|incorporez|faites|servez|dégustez|degustez)\b/i.test(low)
  ) {
    return false;
  }

  if (/[.!?]/.test(t)) return false;

  if (
    t.length > 40 &&
    /\b(le|la|les|du|des|dans|avec|pour|sans|sur|au|aux)\b/i.test(low)
  ) {
    return false;
  }

  // pas de ligne quasi vide / bruit
  if (/^[^a-zà-öø-ÿœ]+$/i.test(t)) return false;
  if (/^\d+(?:[.,]\d+)?\s*[kK]\s*$/.test(t)) return false;
  if (/^\d+\s+\d+(?:[.,]\d+)?\s*[kK]\s*$/.test(t)) return false;

  // accepte slashs et "ou" pour variantes d'ingrédients
  // ex: "sel/poivre", "persil ou coriandre ou basilic"
  if (/[a-zà-öø-ÿœ]/i.test(t)) return true;

  return false;
}


function stripSocialHeaderPrefix(line) {
  let t = normSpaces(line);

  // "Publication de ..."
  t = t.replace(/^publication\s+de\s+/i, '').trim();

  // ✅ NEW: retire page name courant si collé devant le titre
  // ex "Recettes et Délices Mini Croque-Monsieur Apéritif"
  t = t.replace(/^recettes?\s*(?:et|&)\s*d[ée]lices?\b/i, '').trim();

  // ✅ NEW: nettoyage emojis/pictos au bord
  t = stripEdgeEmojisAndPunct(t);

  return normSpaces(t);
}

//ajouter le 30/03/26 pour extraire les ingredients d'une ligne texte
function stripInlineSocialHandles(line) {
  let t = normSpaces(line);
  if(!t) return '';

  //retirer les @mentions inline sans jeter le reste de la phrase
  t = t.replace(/@[A-Za-z0-9._-]+/g, ' ');
  t = t.replace(/\s+[.,;:!?]+/g, ' ');
  return normSpaces(t);
}

// ✅ Facebook: "Publication de <Page>" parfois collé au titre
//function stripSocialHeaderPrefix(line) {
//  let t = normSpaces(line);

  // Ex: "Publication de Recettes et Délices Mini Croque-Monsieur Apéritif"
  // Ex: "Publication de Recettes et Délices" (seul) -> on n'en fera rien
  // t = t.replace(/^publication\s+de\s+/i, '').trim();

  // Si ça commence encore par un nom de page "Recettes et Délices" + le titre derrière,
  // on ne peut pas connaître exactement où couper. On garde tout pour analyse,
  // mais on filtrera ensuite avec "looksLikePlausibleTitleLine".
  // return normSpaces(t);
//}

// ✅ bruit "page seule" (ex: "304")
function looksLikePageNumberOnly(line) {
  const t = normSpaces(line);
  return /^\d{2,4}$/.test(t);
}

function isMostlyNoise(line) {
  const t = normSpaces(line);
  if (!t) return true;

  // ✅ PATCH: ne pas jeter les unités seules ("g", "ml", etc.)
  if (isUnitToken(t)) return false;

  if (t.length <= 1) return true;

  const letters = (t.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g) || []).length;
  const digits = (t.match(/\d/g) || []).length;
  if (letters + digits === 0) return true;

  return false;
}

function looksLikeCreditsLine(line) {
  const t = normSpaces(line).toLowerCase();

  return (
    /^prise de vue\b/.test(t) ||
    /^montage\b/.test(t) ||
    /^r[ée]gie\b/.test(t) ||
    /^coordination\b/.test(t) ||
    /^suivi\b/.test(t) ||
    /^publication de\b/.test(t) ||
    /france inter\b/.test(t) ||
    /\b\d{1,2}\s+\w+\s+\d{4}\b/.test(t) 
  )
}

function extractParenNote(line) {
  const s = normSpaces(line);
  if (!s) return null;

  const notes = [];
  const cleaned = s.replace(/\(([^()]*)\)/g, (_, inside) => {
    const t = normSpaces(inside);
    if (t) notes.push(t);
    return ' ';
  });

  const outLine = normSpaces(cleaned).replace(/\s+[.,;:]\s*$/g, '');
  if (!notes.length) return null;

  if (!outLine) return null;

  return {line: outLine, note: notes.join(' . ') };
}

/* =========================
   DEDUP (cross-captures)
========================= */

function looksLikeCriticalOcrFragment(line) {
  const s = normSpaces(String(line || '')).toLowerCase();
  if (!s) return false;

  return (
    /^(?:i|1|\d+\/\d+|\d+(?:[.,]\d+)?)\s*c\.?\s*a\.?\s*c\.?\s*de$/i.test(s) ||
    /^(?:i|1|\d+\/\d+|\d+(?:[.,]\d+)?)\s*c\.?\s*a\.?\s*s\.?\s*de$/i.test(s) ||
    /^(?:i|1|\d+\/\d+|\d+(?:[.,]\d+)?)\s*(?:càc|càs)\s*de$/i.test(s) ||
    /^(?:i|1|\d+\/\d+|\d+(?:[.,]\d+)?)\s*(?:g|kg|mg|ml|cl|dl|l)\s*(?:de)?$/i.test(s) ||
    /^(?:de|du|des|d['’])\s+[a-zà-öø-ÿœ' -]{2,40}$/i.test(s) ||
    /^(jus|zeste|pulpe)\s+de$/i.test(s)
  );
}

function dedupeLines(lines) {
  const seen = new Set();
  const out = [];

  for (const l of lines) {
    const clean = normSpaces(String(l || ''));
    const key = normalizeForDedup(clean);
    if (!key) continue;

    // IMPORTANT :
    // on garde les doublons des fragments critiques,
    // sinon on casse les layouts fragmentés
    if (looksLikeCriticalOcrFragment(clean)) {
      out.push(clean);
      continue;
    }

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }

  return out;
}


/**
 * PATCH OCR (livres papier)
 * Recolle les mots coupés par un retour à la ligne avec tiret.
 */
function mergeHyphenWrappedLines(lines) {
  const out = [];
  for (const raw of lines) {
    const line = normSpaces(raw);
    if (!line) continue;

    const prev = out.length ? out[out.length - 1] : '';

    if (prev && /-$/.test(prev) && /^[a-zà-öø-ÿ]/i.test(line)) {
      //ajout des lignes ci-dessous pour titre recette 1 au 29/01
      const glued = prev.replace(/-s$/, 's');
      const shouldNoSpace = /[a-zà-öø-ÿ]$/i.test(glued) && /^[a-zà-öø-ÿ]/i.test(line);
      out[out.length - 1] = shouldNoSpace// ligne modifier : out[out.length - 1] = normSpaces(prev.replace(/-$/, '') + line);
      ? normSpaces(glued + line)
      : normSpaces(glued + ' ' + line);
      continue;
    }

    out.push(line);
  }
  return out;
}

/* =========================
   CLEAN + TRASH
========================= */

function smartFilterWithTrashFromText(rawText) {
  const cleaned = stripWeird(rawText);

  // ✅ rawLines DOIT être déclaré ici
  let rawLines = cleaned
    .split('\n')
    .map((s) => normSpaces(s))
    .filter(Boolean);
    dlog('[OCR] raw split lines:', cleaned.split('\n').slice(0, 20));
    
    
  rawLines = mergeHyphenWrappedLines(rawLines);
  dlog('[OCR] after mergeHyphenWrappedLines:', rawLines.slice(0, 20));
  

  const lines = [];
  const trash = [];

  for (let i = 0; i < rawLines.length; i++) {
    let l = rawLines[i];
    l = stripTrailingPageNumber(l);

    // ✅ PATCH: ne pas jeter une quantité seule si elle touche une unité
    if (looksLikePageNumberOnly(l)) {
      const prev = i > 0 ? rawLines[i - 1] : '';
      const next = i + 1 < rawLines.length ? rawLines[i + 1] : '';

      const prevIsUnit = isUnitToken(prev);
      const nextIsUnit = isUnitToken(next);

      if (prevIsUnit || nextIsUnit) {
        lines.push(l);
        continue;
      }

      trash.push(l);
      continue;
    }

    if (looksLikeStatusBarNoise(l)) {
      trash.push(l);
      continue;
    }

    if (looksLikeDateNoise(l)) {
      trash.push(l);
      continue;
    }

    if (looksLikeCountersNoise(l)) {
      trash.push(l);
      continue;
    }

    if (looksLikeSocialNoise(l)) {
      dlog('[SOCIAL BLOCK HIT', l);
      const inlineClean = stripInlineSocialHandles(l);
      dlog('[INLINE CLEAN]', {raw: l, clean: inlineClean});

      // ✅ si après retrait des @handles il reste une phrase utile de recette, on la garde
      const looksUsefulAfterHandleStrip =
        !!inlineClean &&
        (
          !!parseOcrIngredient(inlineClean) ||
          /\b\d+(?:[.,]\d+)?\s*(?:kg|g|mg|l|dl|cl|ml)\b/i.test(inlineClean) ||
          /\b(?:un|une|\d+)\s+(?:sachet|sachets|gousse|gousses|tranche|tranches|verre|verres|tasse|tasses|pincée|pincées|pincee|pincees)\b/i.test(inlineClean) ||
          looksLikeStepVerbLine(inlineClean) ||
          looksLikeActionSentence(inlineClean)
        );

      if (looksUsefulAfterHandleStrip) {
        dlog('[SOCIAL SALVAGED', inlineClean);
        lines.push(inlineClean);
        continue;
      }

      if (/^publication\s+de\s+/i.test(l)) {
        const salvaged = stripSocialHeaderPrefix(l);
        const plausible = looksLikePlausibleTitleLine(salvaged, {
          isIngredientLine: (s) => !!parseOcrIngredient(s),
        });
        if (plausible) {
          lines.push(salvaged);
          continue;
        }
      }
      dlog('[SOCIAL TRASHED', l, '=>', inlineClean);
      trash.push(l);
      continue;
    }


    //ajouter le 19/02
    const creditsMarker = /(r[ée]gie culinaire\s*:|coordination [eé]ditoriale\s*:|prise de vue|montage\s*:)/i;
    if (creditsMarker.test(l)) {
      const parts = l.split(creditsMarker);
      const before = normSpaces(parts[0] || '');
      const after = normSpaces(l.slice(before.length) || '');

      if (before && !looksLikeSocialNoise(before)) lines.push(before);
      if (after) trash.push(after);
      continue;
    }

    if (looksLikeBookRefNoise(l)) {
      const m = l.match(/(\(.*?\bvoir\s+p\.?\s*\d+.*?\))|\bvoir\s+p\.?\s*\d+\b/i);
      if (m && m[0]) trash.push(normSpaces(m[0]));
      const cleanedLine = normSpaces(
        l
          .replace(/\(.*?\bvoir\s+p\.?\s*\d+.*?\)/gi, '')
          .replace(/\bvoir\s+p\.?\s*\d+\b/gi, '')
      );
      if (cleanedLine && !isMostlyNoise(cleanedLine)) lines.push(cleanedLine);
      continue;
    }

    if (looksLikeEditorialNoise(l)) {
      trash.push(l);
      continue;
    }

    lines.push(l);
  }
  const tHit = trash.filter(x => /passoire|pomme|pommes de terre/i.test(String(x)));
  if (tHit.length) dlog('[DEBUG] trash hit:', tHit);

  const lHit = lines.filter(x => /passoire|pomme|pommes de terre/i.test(String(x)));
  if (lHit.length) dlog('[DEBUG] lines hit:', lHit);

  //ajout temporaire du 30/03/26 - a supprimer si plus utile - d'ici à
  const watch = /vahine|paysanbreton|sucre vanill|beurre demi|250\s*g\s* de farine|150\s*g/i;
  const watchedLines = lines.filter(x => watch.test(String(x)));
  const watchedTrash = trash.filter(x => watch.test(String(x)));
  if (watchedLines.length) dlog('[WATCH][lines]', watchedLines);
  if (watchedTrash.length) dlog('[WATCH][trash]', watchedTrash);

  return {
    rawText: cleaned,
    lines: dedupeLines(lines),
    trash: dedupeLines(trash),
  };
}

/* =========================
   STEP JOIN WRAPS
========================= */

function joinWrappedLinesForSteps(stepLines) {
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

/* =========================
   INGREDIENT PARSER (FR)
========================= */

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

//ajoute le 01/04/26
function isMatchStartingInsideFraction(line, start) {
  if (start <= 0) return false;

  const prev = line[start - 1] || '';
  if (prev === '/') return true;

  const left = line.slice(Math.max(0, start - 4), start);
  return /\d\s*\/\s*$/.test(left);
}

function extractInlineIngredientFragmentsFromLines(lines) {
  const out = [];

   //remplacé le 30/03/26
  const pushIfParsable = (frag) => {
    const t = normalizeInlineIngredientFragment(frag);
    if (!t) return;

    if (looksLikeNonIngredientGarbage(t)) return;

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
// ici



/* =========================
   SPLIT INGREDIENTS / STEPS / NOTES
========================= */
function isStrictIngredientLine(line) {
 const p = parseOcrIngredient(line);
 if (!p) return false;

 // adapte aux champs réels de ton parser
 const qty = p.quantity ?? null;
 const qtyRaw = p.quantityRaw ?? null;

 return (qty != null && qty !== 0) || (typeof qtyRaw === 'string' && qtyRaw.trim() !== '');
}

//ajout du 30/03/26
function debugWatchRecipeLines(label, arr) {
  const watch = /250\s*g|sucre vanill|beurre demi/i;
  const hit = (arr || []).filter(x => watch.test(String(x)));
  if (hit.length) dlog(`[WATCH SPLIT][${label}]`, hit);
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

function looksLikeStepSubsectionHeader(line) {
  const t = normSpaces(line);
  if (!t) return false;

  return /^(?:[-•*]\s*)?(cuisson|préparation|preparation|montage|finition)\b.*:$/i.test(t);
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
  dlog('[debug ingredienLines after join]', ingredientLines);

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

  stepLines = joinWrappedLinesForSteps(stepLines);

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

  ingredientLines = ingredientLines.filter((l) => {
    const t = normSpaces(l);
    if (!t) return false;
    if (looksLikeNonIngredientGarbage(t)) return false;

    // ajouter le 30/03/26 à 13h58
    if (/^\d{1,4}(?:[.,]\d+)?\s*[kK]\s*$/i.test(t)) return false; // ex: 10,5 K
    if (/^\d{1,4}\s+\d{1,4}(?:[.,]\d+)?\s*[kK]\s*$/i.test(t)) return false; // ex: 302 10,5 K

    const parsed = parseOcrIngredient(t);

    if (parsed) {
      const name = normSpaces(parsed.name || '');
      if (!name || name.length < 2) return false;

      const low = name.toLowerCase();
      if (/^(q|de|et|ou)$/i.test(low)) return false;
      if (/^[a-z]$/i.test(name)) return false;
      if (/^\d+$/.test(name)) return false;
      if (/^[a-z]\d+$|^\d+[a-z]$/i.test(name)) return false;
      if (looksLikeNonIngredientGarbage(name)) return false;

      return true;
    }

    //ajoute le 31/03/26 - accepte les ingredients sans quantites
    if (looksLikeBareIngredientLine(t)) {
      return true
    }

    return looksLikeBareIngredientLine(t);
  });
  
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
  beautifyIngredients,
  guessTitleFromLines,
  miniReflow,
  looksLikeBareIngredientLine,
  looksLikeNonIngredientGarbage,
};

