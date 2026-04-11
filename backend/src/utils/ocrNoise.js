// backend/src/utils/ocrNoise.js
// LEVEL: UTIL (OCR text parsing)
// import autorisés : 
// import interdits : 
// importé par : 

'use strict';

const { parseOcrIngredient } = require('./ingredientParser');
const { normSpaces, stripWeird, looksLikeTimeInfoLine, stripEdgeEmojisAndPunct } = require('./stringUtils');
const { normalizeForDedup } = require('./textUtils');
const { looksLikePlausibleTitleLine } = require('./titleUtils');
const { looksLikeDateNoise, looksLikeCountersNoise, looksLikeSocialNoise, isUnitToken } = require('./ingredientUtils');
const { looksLikeStepLine, looksLikeActionSentence, looksLikeStepVerbLine } = require('./heuristics');

const DEBUG_OCR = process.env.OCR_DEBUG !== 'production';
const dlog = (...args) => { if (DEBUG_OCR) console.log(...args); };

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





module.exports = {
  looksLikeBookRefNoise,
  stripTrailingPageNumber,
  looksLikeStatusBarNoise,
  looksLikeEditorialNoise,
  looksLikeNonIngredientGarbage,
  looksLikeBareIngredientLine,
  stripSocialHeaderPrefix,
  stripInlineSocialHandles,
  looksLikePageNumberOnly,
  isMostlyNoise,
  looksLikeCreditsLine,
  extractParenNote,
  looksLikeCriticalOcrFragment,
  dedupeLines,
  mergeHyphenWrappedLines,
  smartFilterWithTrashFromText,
};