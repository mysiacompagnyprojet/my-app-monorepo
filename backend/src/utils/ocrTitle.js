// backend/src/utils/ocrTitle.js
// LEVEL: UTIL (title heuristics)
// import autorisés : utils bas niveau (stringUtils/titleUtils)
// import interdits : routes, middleware, services, prisma
// importé par : services/vision + utils/ocrText + parsers

'use strict';

const { normSpaces, cleanTitleCandidate, sanitizePickedTitle } = require('./stringUtils')
const { isValidRecipeTitleCandidate, looksLikeStepLine, looksLikeStepContinuation } = require('./heuristics')
const { isMetaInfoLineForTitle, isTitleNoiseLabel, isGenericSiteTitle, isBadTitleCandidate, looksLikeLooseActionStep, looksTruncatedTitle, looksLikeIngredientFragmentTitleForTitle, isAllCapsTitleCandidate, isLikelyStandaloneTitleLine  } = require('./titleUtils');
const { looksLikeDateNoise, looksLikeCountersNoise, looksLikeSocialNoise } = require('./ingredientUtils');
const  { looksLikeStatusBarNoise } = require('./ocrNoise');
const { isIngredientsHeader,  isPreparationHeader } = require('./sectionHeaders');
const { extractServingsFromLine } = require('./units');
const { parseOcrIngredient } = require('./ingredientParser');
const { buildMergedTitleCandidate } = require('./titleMerge');

const DEBUG_VERBOSE = process.env.OCR_VERBOSE === '1';
const dlog = (...args) => { if (DEBUG_VERBOSE) console.log(...args); };


// Nettoyage léger

// Score pour départager plusieurs titres valides
function scoreTitleCandidate(s) {
  const t = cleanTitleCandidate(s);
  if (!isValidRecipeTitleCandidate(t)) return -9999;

  let score = 0;

  // bonus si contient des mots “plats”
  if (/\b(gratin|croque|monsieur|ap[ée]ritif|nuggets?|cookies?|g[âa]teau|gateau|tarte|quiche|poulet|salade|soupe)\b/i.test(t)) score += 10;

  // bonus si majuscules ou style titre
  if (/^[A-ZÀ-ÖØ-Þ]/.test(t)) score += 3;

  // bonus si 2+ mots
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length >= 2) score += 4;
  if (words.length >= 4) score += 2;

  // longueur raisonnable
  score += Math.max(0, 90 - t.length) / 15;

  return score;
}

// Choix “meilleur titre” parmi une liste
function pickBestTitle(candidates) {
  const list = (candidates || [])
    .map((x) => cleanTitleCandidate(x))
    .filter(Boolean);

  let best = null;
  let bestScore = -9999;

  for (const t of list) {
    const sc = scoreTitleCandidate(t);
    if (sc > bestScore) {
      bestScore = sc;
      best = t;
    }
  }

  return bestScore > -1000 ? best : null;
}

// Cas Nuggets : recoller "Nuggets de pois" + "chiches"
function tryMergeSplitTitle(linesOrCandidates) {
  const arr = (linesOrCandidates || []).map(cleanTitleCandidate).filter(Boolean);

  for (let i = 0; i < arr.length - 1; i++) {
    const a = arr[i];
    const b = arr[i + 1];
    if (/^nuggets?\s+de\s+pois$/i.test(a) && /^chiches?$/i.test(b)) {
      return 'Nuggets de pois chiches';
    }
  }
  return null;
}

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

module.exports = {
  scoreTitleCandidate,
  pickBestTitle,
  tryMergeSplitTitle,
  guessTitleFromLines,
};


