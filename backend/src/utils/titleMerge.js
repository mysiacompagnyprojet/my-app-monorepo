//backend/src/utils/titleMerge

const { looksLikeIngredientFragmentTitleForTitle } = require('./ocrTitle');
const { parseOcrIngredient} = require('./ingredientParser');
const { normSpaces, normalizeTitleJoinPiece } = require('../utils/textUtils')
//'.titleUtils'
const { isMetaInfoLineForTitle, isTitleNoiseLabel, looksLikePlausibleTitleLine, canJoinTitleLines, isBadTitleCandidate } = require('.titleUtils');
const { parseOcrIngredient } = require('./ingredientParser')


function buildMergedTitleCandidate(scan, startIdx, maxLines = 3) {
  let out = normalizeTitleJoinPiece(scan[startIdx]);
  if (!out) return null;
  //Ce guard évite de démarrer un merge sur "en poudre", "de sel", etc. (même si ça n’a pas I).
  const firstRaw = scan[startIdx];
  if (looksLikeIngredientFragmentTitleForTitle(firstRaw)) return null;
  if (parseOcrIngredient(firstRaw)) return null;

  //si la premiére ligne est une ligne meta, on refuse de construire un titre fusionné
  if (isMetaInfoLineForTitle(out)) return null;
  if (isTitleNoiseLabel(out)) return null;

  let used = 1;

  for (let k = startIdx + 1; k < scan.length && used < maxLines; k++) {
    // ✅ saute labels genre "LEVURE", "FARINE"
    if (isTitleNoiseLabel(scan[k])) continue;

    //on normalise la ligne suivante (supprime espaces/bizarreries OCR, etc...)
    const next = normalizeTitleJoinPiece(scan[k]);

    if (/\sI\s/.test(scan[k]) || /\s\|\s/.test(scan[k])) return null;

    //ajoute le 20/01
    // 🚫 ne pas fusionner un sous-titre "tags" avec slash (ex: AIL/PAPRIKA/PARMESAN)
    const rawNext = String(scan[k] || '');
    
    if (/[A-ZÀ-ÖØ-Þ]{2,}\/[A-ZÀ-ÖØ-Þ]{2,}/.test(rawNext) && rawNext.length <= 35) break;
    //si aprs normalisation c'st vide -> on stoppe la fusion (plus rien d'utile)
    if (!next) break;

    // si la ligne suivante est une ligne meta (temps/cuisson/difficulté/portions/calories),
    // on la saute (continue = on passe à la ligne suivante de la boucle)
    if (isMetaInfoLineForTitle(next)) continue;

    // si la ligne suivante n'est pas plausible, stop
    if (!looksLikePlausibleTitleLine(next) && !canJoinTitleLines(out, next)) break;
    if (!canJoinTitleLines(out, next)) break;

    // ajoute le 20/01 - ✅ éviter les doublons : si next est déjà contenu dans out, on saute
    const outLow = out.toLowerCase();
    const nextLow = next.toLowerCase();
    if (outLow.includes(nextLow)) continue;


    out = normSpaces(`${out} ${next}`);
    used++;
  }
  // garde-fous
  if (out.length < 6 || out.length > 90) return null;
  if (/\d/.test(out)) return null;
  if (isBadTitleCandidate(out)) return null;
  if (isTitleNoiseLabel(out)) return null;
  // 🚫 listes compactes type "en poudre I pincée I c.à.s ..." LAISSER POUR SAUCE BIG MAC C'EST INDISPENSABLE
  if (/\sI\s/.test(out) || /\s\|\s/.test(out)) return null;

  return out;
}

module.exports = {
    buildMergedTitleCandidate,
}