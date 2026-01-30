//backend/src/utils/titleMerge

const { looksLikeIngredientFragmentTitleForTitle } = require('../utils/ocrTitle');
const { parseOcrIngredient} = require('../utils/ingredientParser');
const { normalizeTitleJoinPiece } = require('../utils/textUtils');
//stringUtils
const { normSpaces } = require('../utils/stringUtils');
//titleUtils
const { isMetaInfoLineForTitle, isTitleNoiseLabel, looksLikePlausibleTitleLine, canJoinTitleLines, isBadTitleCandidate } = require('../utils/titleUtils');



function buildMergedTitleCandidate(scan, startIdx, maxLines = 3) {
  // On démarre avec la ligne de départ normalisée
  let out = normalizeTitleJoinPiece(scan[startIdx]);
  if (!out) return null;

  // Ligne brute d'origine (avant normalisation)
  const firstRaw = scan[startIdx];

  // ❌ Ne jamais démarrer un titre sur un fragment d’ingrédient
  if (looksLikeIngredientFragmentTitleForTitle(firstRaw)) return null;

  // ❌ Ne jamais démarrer un titre sur une ligne reconnue comme ingrédient
  if (parseOcrIngredient(firstRaw)) return null;

  // ❌ Ne jamais démarrer sur une ligne meta (temps, portions, etc.)
  if (isMetaInfoLineForTitle(out)) return null;

  // ❌ Ne jamais démarrer sur un label bruité ("FARINE", "SUCRE", etc.)
  if (isTitleNoiseLabel(out)) return null;

  // Compte le nombre de lignes fusionnées
  let used = 1;

  // Callback injecté pour éviter une dépendance directe titleUtils -> ingredientParser
  // Ici : une ligne est un ingrédient si parseOcrIngredient retourne quelque chose
  const isIngredientLine = (s) => !!parseOcrIngredient(s);

  // ✅ PATCH: autoriser certains "préfixes plats" comme début de titre
  // ex: "Tarte rustique" + "Chèvre-miel et noix" => titre complet
  function isGenericDishPrefix(s) {
    const t = normSpaces(String(s || '')).toLowerCase();
    return /^(tarte|tarte rustique|quiche|gratin|soupe|salade|pates|pâtes|cake|muffins?|cookies?|gateau|gâteau)\b/.test(
      t
    );
  }

  // Parcours des lignes suivantes pour tenter une fusion
  for (let k = startIdx + 1; k < scan.length && used < maxLines; k++) {
    const rawLine = scan[k];

    // ✅ On saute les labels décoratifs isolés
    if (isTitleNoiseLabel(rawLine)) continue;

    // ❌ Séparateurs type OCR (" I " ou " | ") → jamais un titre
    if (/\sI\s/.test(rawLine) || /\s\|\s/.test(rawLine)) return null;

    // ❌ Tags du type "AIL/PAPRIKA/PARMESAN"
    const rawNext = String(rawLine || '');
    if (/[A-ZÀ-ÖØ-Þ]{2,}\/[A-ZÀ-ÖØ-Þ]{2,}/.test(rawNext) && rawNext.length <= 35) {
      break;
    }

    // Normalisation de la ligne suivante
    const next = normalizeTitleJoinPiece(rawLine);

    // Plus rien d’utile à fusionner
    if (!next) break;

    // ❌ On ignore les lignes meta (temps, cuisson, portions…)
    if (isMetaInfoLineForTitle(next)) continue;

    // ✅ Vérifie si la ligne ressemble à un vrai titre possible
    const plausible = looksLikePlausibleTitleLine(next, { isIngredientLine });

    // ✅ PATCH: règle join améliorée
    // - on garde ta logique existante
    // - + on autorise un join si "out" est un préfixe plat ET que "next" est plausible
    const canJoin =
      canJoinTitleLines(out, next, { isIngredientLine }) || (isGenericDishPrefix(out) && plausible);
      //console log a supprimer
      console.log ('[TITLE][MERGE CHECK]', {
        out,
        next,
        canJoin,
        outLength: out.length,
        nextLength: next.length,
        hasDashNext: /-/.test(next),
        hasEtNext: /\bet\b/i.test(next),
      });

    // ❌ Si on ne peut pas coller → stop
    if (!canJoin) break;

    // ✅ Évite les doublons ("Sauce Big Mac Sauce Big Mac")
    const outLow = out.toLowerCase();
    const nextLow = next.toLowerCase();
    if (outLow.includes(nextLow)) continue;

    // ✅ Fusion effective
    out = normSpaces(`${out} ${next}`);
    used++;
  }

  // ---------- Garde-fous finaux ----------

  // Longueur réaliste pour un titre
  if (out.length < 6 || out.length > 90) return null;

  // Pas de chiffres dans un titre
  if (/\d/.test(out)) return null;

  // Rejet final des titres clairement mauvais
  if (isBadTitleCandidate(out)) return null;

  // Rejet des labels déguisés
  if (isTitleNoiseLabel(out)) return null;

  // ❌ Listes compactes OCR ("en poudre I pincée I c.à.s")
  if (/\sI\s/.test(out) || /\s\|\s/.test(out)) return null;

  // ✅ Titre fusionné valide
  return out;
}



module.exports = {
    buildMergedTitleCandidate,
}