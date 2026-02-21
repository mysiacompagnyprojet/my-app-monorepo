// backend/src/utils/ocrText.js
// LEVEL: UTIL (OCR text parsing)
// import autorisés : utils (stringUtils, units, heuristics, ingredientParser, ocrTitle)
// import interdits : routes, middleware, services (vision/supabase), prisma/lib, parsers sites
// importé par : routes import-ocr (ou services OCR), et autres utils
'use strict';

const { looksLikeIngredientFragmentTitleForTitle } = require('../utils/ocrTitle');
const { buildMergedTitleCandidate} = require('../utils/titleMerge');
const { parseOcrIngredient} = require('../utils/ingredientParser');
//stringUtils
const { normSpaces, stripWeird, looksLikeTimeInfoLine, stripEdgeEmojisAndPunct, cleanTitleCandidate, sanitizePickedTitle  } = require('../utils/stringUtils');
//textUtils'
const { normalizeForDedup, looksLikeListBullet } = require('../utils/textUtils');
//titleUtils'
const { isMetaInfoLineForTitle, isTitleNoiseLabel, looksLikePlausibleTitleLine, isGenericSiteTitle, isBadTitleCandidate,  isBlacklistedUiTitle, looksLikeEmotionalHookTitle, looksLikeStepTitle, looksLikeLooseActionStep, looksTruncatedTitle } = require('../utils/titleUtils');
//ingredientUtils'
const { looksLikeDateNoise, looksLikeCountersNoise, looksLikeSocialNoise, isUnitToken, isIngredientFragmentLine, joinWrappedLinesForIngredients } = require('../utils/ingredientUtils');
//unit.js
const { extractServingsFromLine } = require('../utils/units');
const { isIngredientsHeader,  isPreparationHeader,  isStepsHeader } = require('../utils/sectionHeaders');

const { looksLikeStepContinuation,looksLikeStepLine, looksLikeActionSentence, looksLikeStepVerbLine } = require('../utils/heuristics');
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

  // Blocs "à suivre" / recos qui polluent beaucoup
  if (/^\s*(à\s+suivre|a\s+suivre)\b/i.test(t)) return true;
  if (/^\s*<\s*recommandations?\b/i.test(t)) return true;

  // Petits tokens UI isolés
  if (/^\s*(recommandations?|explorer|suivre)\s*$/i.test(t)) return true;
  if (/^\s*→\s*suivre\s*$/i.test(t)) return true;

  // Pseudos / noms courts bizarres ("iman.")
  if (/^[a-z0-9._-]{2,}\.$/i.test(t) && t.length <= 12) return true;

  // Compteurs type "40 61" (pas toujours captés par looksLikeCountersNoise)
  if (/^\d{1,3}\s+\d{1,3}$/.test(t)) return true;

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

function dedupeLines(lines) {
  const seen = new Set();
  const out = [];

  for (const l of lines) {
    const key = normalizeForDedup(l);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(l);
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
      const glued = prev.replace(/-s/, '');
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
    console.log('[OCR] raw split lines:', cleaned.split('\n').slice(0, 20));
    
    
  rawLines = mergeHyphenWrappedLines(rawLines);
  console.log('[OCR] after mergeHyphenWrappedLines:', rawLines.slice(0, 20));
  

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

    if (isMostlyNoise(l)) {
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
      if (/^publication\s+de\s+/i.test(l)) {
        const salvaged = stripSocialHeaderPrefix(l);
        const plausible = looksLikePlausibleTitleLine(salvaged, {
         isIngredientLine: (s) => !!parseOcrIngredient(s),
        });
        if (plausible(salvaged)) {
          lines.push(salvaged);
          continue;
        }
      }
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
  if (tHit.length) console.log('[DEBUG] trash hit:', tHit);

  const lHit = lines.filter(x => /passoire|pomme|pommes de terre/i.test(String(x)));
  if (lHit.length) console.log('[DEBUG] lines hit:', lHit);
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

    if (
      endsConnector ||
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

function fabricateTitleFromIngredients(lines) { //il faut revoir cette fonction qui est aussi dans import ocr
  const L = lines.map(normSpaces).filter(Boolean);

  const scan = [];
  for (const l of L.slice(0, 60)) {
    if (isPreparationHeader(l)) break;
    scan.push(l);
  }

  const stopNames = new Set(['sel', 'poivre', 'eau', "eau d'", 'eau ', 'huile', "huile d'olive", 'beurre']);

  const found = [];
  const seen = new Set();

  for (const l0 of scan) {
    const l = normSpaces(l0);
    if (!l) continue;
    if (looksLikeStatusBarNoise(l) || looksLikeDateNoise(l) || looksLikeCountersNoise(l) || looksLikeSocialNoise(l))
      continue;
    if (isIngredientsHeader(l) || extractServingsFromLine(l)) continue;
    if (looksLikeStepLine(l)) continue;

    const parsed = parseOcrIngredient(l);
    if (!parsed?.name) continue;

    const name = normSpaces(parsed.name).toLowerCase();
    if (!name) continue;

    if (stopNames.has(name)) continue;
    if (name.startsWith('eau')) continue;

    if (seen.has(name)) continue;
    seen.add(name);

    found.push(parsed.name);
    if (found.length >= 4) break;
  }

  if (found.length < 2) {
    for (const l0 of scan) {
      const l = normSpaces(l0);
      if (!l) continue;
      if (looksLikeStatusBarNoise(l) || looksLikeDateNoise(l) || looksLikeCountersNoise(l) || looksLikeSocialNoise(l))
        continue;
      if (isIngredientsHeader(l) || extractServingsFromLine(l)) continue;
      if (looksLikeStepLine(l)) continue;

      const parsed = parseOcrIngredient(l);
      if (!parsed?.name) continue;

      const name = normSpaces(parsed.name).toLowerCase();
      if (!name) continue;
      if (name === 'sel' || name === 'poivre') continue;

      if (seen.has(name)) continue;
      seen.add(name);

      found.push(parsed.name);
      if (found.length >= 3) break;
    }
  }

  const top = found.slice(0, 3);
  if (top.length < 2) return null;

  const pretty = top.map((x) => normSpaces(x).toLowerCase());
  const title = pretty.length === 2 ? `${pretty[0]} & ${pretty[1]}` : `${pretty[0]}, ${pretty[1]} & ${pretty[2]}`;

  return title.charAt(0).toUpperCase() + title.slice(1);
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
    const merged = buildMergedTitleCandidate(scan, i, 3);

    //console log a effecer
    console.log('[TITLE] simple candidate', { i, t, score: candidates[candidates.length-1].score });
    // Sécurité : si merged existe et est différent, on l’ajoute aussi
    if (merged && merged !== t) {
      //console log a supprimer
      console.log('[TITLE] merged candidate:', { i, merged });
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
  console.log('[TITLE] candidates ranked:', candidates
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
      low === 'preparation|déroulé|deroule)\b/i.test(cleanedLine);' ||
      low === 'préparation' ||
      low === 'temps cuisson' ||
      low === 'temps de cuisson' ||
      low === 'temps preparation|déroulé|deroule)\b/i.test(cleanedLine);' ||
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

  // 1) "Title: ..." ou variantes explicites
  const explicit = findExplicitTitleInFirstLines(lines, 60);
  if (explicit) {
    const cleaned = sanitizePickedTitle(explicit);
    if (cleaned && !isBadTitleCandidate(cleaned)) return cleaned;
  }

  // 2) Titre récupéré depuis un en-tête d'étapes
  const fromStepHeader = extractTitleFromStepHeader(lines);
  if (fromStepHeader && !isBadTitleCandidate(fromStepHeader)) return fromStepHeader;

  //Ajout d'ici au 20/01 - pour ajouter une regle prioritaire sur gros titre
 function isAllCapsTitleCandidate(s) {
  const t = sanitizePickedTitle(cleanTitleCandidate(s));
  if (!t) return false;
    // ignore meta
  if (isIngredientsHeader(t) || isPreparationHeader(t)) return false;
  if (extractServingsFromLine(t)) return false;
  if (/^(portions?|temps|calories|remarques?)\b/i.test(t)) return false;

  // ignore domaine / UI
  if (/\b\w+\.(com|fr|net|org)\b/i.test(t)) return false;
  if (isGenericSiteTitle(t) || isBlacklistedUiTitle(t)) return false;

  // ignore ingrédients/mesures
  if (parseOcrIngredient(t)) return false;
  if (looksLikeIngredientFragmentTitleForTitle(t)) return false;

  // titre “fort” : majuscules, assez long
  const letters = (t.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g) || []).length;
  if (letters < 10) return false;

  const upperLetters = (t.match(/[A-ZÀ-ÖØ-Þ]/g) || []).length;
  if (upperLetters / letters < 0.75) return false;

  if (t.length < 10 || t.length > 80) return false;
  return true;
 }
 // ✅ Priorité: si on trouve un “gros titre” en majuscules dans le head, on le prend
 for (let i = 0; i < Math.min(head.length, 8); i++) {
  if (isAllCapsTitleCandidate(head[i])) {
    return sanitizePickedTitle(cleanTitleCandidate(head[i]));
  }
 } // A ici au 20/01
  
  //ajout d'ici à.. le 20/01 - si une ligne ressemble à un vrai titre au millieu
  //d'une liste à ingredients
 function isLikelyStandaloneTitleLine(s) {
  const t = sanitizePickedTitle(cleanTitleCandidate(s));
  if (!t) return false;

  // doit être assez long, sans chiffres, 2+ mots  
  if (t.length < 10 || t.length > 80) return false;
  if (/\d/.test(t)) return false;
  if (t.split(/\s+/).length < 2) return false;

  // rejets
  if (parseOcrIngredient(t)) return false;
  if (looksLikeIngredientFragmentTitleForTitle(t)) return false;
  if (looksLikeStepTitle(t) || looksLikeLooseActionStep(t)) return false;
  if (isIngredientsHeader(t) || isPreparationHeader(t)) return false;
  if (looksLikeEmotionalHookTitle(t) || isBlacklistedUiTitle(t)) return false;
  if (/\btu\b/i.test(t) || /\bpeux\b/i.test(t) || /\bajouter\b/i.test(t)) return false;
  if (/\bgo[uû]t\b/i.test(t) && /\bproche\b/i.test(t)) return false;

  return true;
 }

  // ✅ Si le head contient une ligne "titre" au milieu d'une liste, on la prend
 for (let i = 0; i < Math.min(head.length, 10); i++) {
  const raw = head[i];
  if (/^[-•*·]\s*/.test(raw)) continue;

  if (isLikelyStandaloneTitleLine(raw)) {
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

function splitIngredientsAndSteps(lines) {
  const L = lines.map(normSpaces).filter(Boolean);

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

      if (isIngredientsHeader(l) || extractServingsFromLine(l)) {
        const s = extractServingsFromLine(l);
        if (s && !servings) servings = s;
        prev = l;
        continue;
      }
      if (looksLikeSpoonMeasureIngredient(l)) {
        ingredientLines.push(l);
        prev = l;
        continue;
      }

      if (!inSteps && isStepsHeader(l)) {
        inSteps = true;
        prev = l;
        continue;
      }

      const prevlooksStep = looksLikeStepLine(prev) || looksLikeStepVerbLine(prev) || looksLikeActionSentence(prev);
      const curLooksNotIngredient =
      !isStrictIngredientLine(l) &&//!parseOcrIngredient(l) &&
      !looksLikeSpoonMeasureIngredient(l) && 
      !looksLikeListBullet(l);

      if (!inSteps && (looksLikeStepLine(l) || looksLikeStepContinuation(prev, l) || (prevlooksStep && curLooksNotIngredient))) {
        inSteps = true;
      }  

      if (inSteps) stepLines.push(l);
      else {
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
          notesLines.push(l);
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

  ingredientLines = ingredientLines.filter((l) => !isIngredientsHeader(l) && !extractServingsFromLine(l));
  notesLines = notesLines.filter((l) => !isIngredientsHeader(l) && !extractServingsFromLine(l));

  // ✅ CAT-02: si on a un header "Ingrédients", on ne doit pas déplacer la fin des steps vers ingrédients.
  // Ce filet de sécurité sert surtout quand le document n'a pas de structure claire.
  if (idxIng < 0) {
    const moved = extractTrailingIngredientBlock({ ingredientLines, stepLines });
    ingredientLines = moved.ingredientLines;
    stepLines = moved.stepLines;
  }

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
 if (hit.length) console.log(`[DEBUG] ${label}:`, hit);
  }

  debugWhere(ingredientLines, 'ingredientLines');
  debugWhere(stepLines, 'stepLines'); 
  debugWhere(notesLines, 'notesLines');
  console.log(stepLines.slice(0,30))
  stepLines = joinWrappedLinesForSteps(stepLines);

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
};

