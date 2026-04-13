// backend/src/routes/import-ocr/titlePipeline.js
// LEVEL: ROUTE-HELPER
// rôle : construire le meilleur titre OCR final sans dépendre de la route
// import autorisés : titleHelpers + utils OCR/titre/strings
// import interdits : routes, services, prisma, frontend

'use strict';

const { inferTitleFromContent, fabricateTitleFromIngredientsRows } = require('./titleHelpers');

const { isValidRecipeTitleCandidate } = require('../../utils/heuristics');
const { parseOcrIngredient } = require('../../utils/ingredientParser');
const { pickBestTitle, tryMergeSplitTitle, guessTitleFromLines } = require('../../utils/ocrTitle');
const {
  normSpaces,
  stripDiacritics,
  normalizeLoose,
  normalizeTitleCandidate,
  sanitizePickedTitle,
} = require('../../utils/stringUtils');
const { normalizeTitleJoinPiece } = require('../../utils/textUtils');
const { buildMergedTitleCandidate } = require('../../utils/titleMerge');
const {
  isBlacklistedUiTitle,
  looksLikeEmotionalHookTitle,
  looksLikeStepTitle,
  looksLikeIngredientOnlyTitle,
  looksLikeHookOrLongSentenceTitle,
  looksLikeMeasureLineTitle,
  looksTruncatedTitle,
  isBadTitleCandidate,
  visionLooksLikeSuffix,
  stripOcrTitleArtifacts,
  looksLikeIngredientFragmentTitleForTitle,
} = require('../../utils/titleUtils');

function isBadVisionNeedListTitle(title) {
  if (!title) return false;

  return (
    /^pour\s+r[ée]aliser\s+cette\s+recette\s+tu\s+auras\s+besoin\s+de\b/i.test(title) ||
    /^pour\s+faire\s+cette\s+recette\s+tu\s+auras\s+besoin\s+de\b/i.test(title)
  );
}

function computeBestVisionTitle(pickedTitles) {
  const cleanedPickedTitles = (pickedTitles || [])
    .map((t) => String(t || '').trim())
    .filter(Boolean)
    .filter((t) => isValidRecipeTitleCandidate(t))
    .filter((t) => !isBlacklistedUiTitle(t))
    .filter((t) => !looksLikeEmotionalHookTitle(t))
    .filter((t) => !looksLikeStepTitle(t));

  const mergedFromVision = tryMergeSplitTitle(cleanedPickedTitles);
  const bestVisionTitleRaw = mergedFromVision || pickBestTitle(cleanedPickedTitles);

  let bestVisionTitle =
    bestVisionTitleRaw &&
    isValidRecipeTitleCandidate(bestVisionTitleRaw) &&
    !isBlacklistedUiTitle(bestVisionTitleRaw) &&
    !looksLikeEmotionalHookTitle(bestVisionTitleRaw) &&
    !looksLikeStepTitle(bestVisionTitleRaw) &&
    !looksLikeIngredientFragmentTitleForTitle(bestVisionTitleRaw)
      ? String(bestVisionTitleRaw).trim()
      : null;

  if (bestVisionTitle && isBadVisionNeedListTitle(bestVisionTitle)) {
    bestVisionTitle = null;
  }

  return {
    cleanedPickedTitles,
    mergedFromVision: mergedFromVision || null,
    bestVisionTitleRaw: bestVisionTitleRaw || null,
    bestVisionTitle,
  };
}

function expandBestVisionTitle(bestVisionTitle, safeLinesForTitle) {
  if (!bestVisionTitle) return null;

  let out = normalizeTitleJoinPiece(bestVisionTitle);

  const truncEnd = looksTruncatedTitle(out);
  const truncStart = /^(à|a|de|d['’]|du|des)\b/i.test(out);
  const firstLines = (safeLinesForTitle || []).slice(0, 60);

  if (out && truncStart) {
    const idx = firstLines.findIndex(
      (l) =>
        normalizeTitleJoinPiece(l).toLowerCase() ===
        normalizeTitleJoinPiece(out).toLowerCase()
    );

    if (idx > 0) {
      const prev = sanitizePickedTitle(firstLines[idx - 1]);
      const merged = [prev, out].join(' ').trim();

      if (
        isValidRecipeTitleCandidate(merged) &&
        !looksLikeIngredientFragmentTitleForTitle(merged)
      ) {
        out = merged;
      }
    }
  }

  if (truncEnd || truncStart) {
    const scan = (safeLinesForTitle || []).map(normSpaces).filter(Boolean);

    const target = normalizeTitleJoinPiece(out);
    let idx = scan.findIndex((l) => normalizeTitleJoinPiece(l) === target);

    if (idx < 0) {
      const targetLow = target.toLowerCase();
      idx = scan.findIndex((l) =>
        normalizeTitleJoinPiece(l).toLowerCase().includes(targetLow)
      );
    }

    if (idx < 0) idx = 0;

    const idxStart = truncStart ? Math.max(0, idx - 1) : idx;

    const merged = buildMergedTitleCandidate(scan, idxStart, 4, {
      isIngredientLine: (s) => !!parseOcrIngredient(s),
    });

    if (merged && merged.length > out.length && !isBadTitleCandidate(merged)) {
      out = merged;
    }

    out = normalizeTitleJoinPiece(out);
  }

  return out;
}

function buildFinalOcrTitle({
  pickedTitles,
  safeLinesForTitle,
  ingredients,
  steps,
  dlog = () => {},
}) {
  const {
    cleanedPickedTitles,
    mergedFromVision,
    bestVisionTitle: rawBestVisionTitle,
  } = computeBestVisionTitle(pickedTitles);

  const bestVisionTitle = expandBestVisionTitle(rawBestVisionTitle, safeLinesForTitle);

  const guessedFromLines = guessTitleCandidateFromLines(safeLinesForTitle);

  dlog('[BUTTER_DEBUG] guessedFromLines=', guessedFromLines);

  let title =
    bestVisionTitle ||
    guessedFromLines ||
    inferTitleFromContent(ingredients, steps) ||
    'Recette importée';

  title = normalizeTitleCandidate(title);
  title = title.replace(/^zauce\b/i, 'sauce');

  dlog('[TITLE][AFTER PICK]', { bestVisionTitle, guessedFromLines, title });

  if (bestVisionTitle && guessedFromLines) {
    const v = normalizeLoose(bestVisionTitle);
    const g = normalizeLoose(guessedFromLines);

    if (visionLooksLikeSuffix(v) && g.length >= v.length + 6 && g.includes(v)) {
      title = normalizeTitleCandidate(guessedFromLines);
    }

    const vWords = v.split(' ').filter(Boolean).length;
    const gWords = g.split(' ').filter(Boolean).length;

    const visionIncludedInGuessed = g.includes(v);
    const guessedClearlyRicher = g.length >= v.length + 10 && gWords >= vWords + 1;

    if (visionIncludedInGuessed && guessedClearlyRicher) {
      title = normalizeTitleCandidate(guessedFromLines);
    }
  }

  dlog('[TITLE][CHECK HOOK/MEASURE]', {
    title,
    hook: looksLikeHookOrLongSentenceTitle(title),
    measure: looksLikeMeasureLineTitle(title),
  });

  const titleLow = stripDiacritics(normalizeTitleCandidate(title)).toLowerCase();
  const looksLikeSauceTitle =
    /^(z?auce|vinaigrette|dressing|marinade)\b/.test(titleLow) &&
    titleLow.split(/\s+/).filter(Boolean).length >= 3 &&
    titleLow.split(/\s+/).filter(Boolean).length <= 10 &&
    !/\b(tu\s+peux|pas\s+de|m[eé]lange|ajoute|astuce)\b/.test(titleLow);

  if (looksLikeSauceTitle) {
    dlog('[TITLE][ALT BYPASS: sauce-title]', { title });
  } else if (
    looksLikeHookOrLongSentenceTitle(title) ||
    looksLikeMeasureLineTitle(title)
  ) {
    dlog('[TITLE][AFTER ALT]', { title });

    const alt =
      inferTitleFromContent(ingredients, steps) ||
      fabricateTitleFromIngredientsRows(ingredients) ||
      '';

    const altNorm = normalizeTitleCandidate(alt);
    const altLow = stripDiacritics(altNorm).toLowerCase().trim();

    if (
      altNorm &&
      !/^(ml|cl|dl|l|g|gr|kg)$/.test(altLow) &&
      !looksLikeIngredientOnlyTitle(altNorm) &&
      !looksLikeIngredientFragmentTitleForTitle(altNorm) &&
      !parseOcrIngredient(altNorm)
    ) {
      const cur = normalizeTitleCandidate(title);
      const curWords = cur.split(' ').filter(Boolean).length;

      const altWords = altNorm.split(' ').filter(Boolean).length;
      const altTooWeak = altWords <= 1 || altNorm.length < 10;
      const curRich = curWords >= 3 && cur.length >= 18;

      dlog('[TITLE][ALT CHECK]', {
        previousTitle: title,
        cur,
        altNorm,
        curWords,
        altWords,
        curRich,
        altTooWeak,
      });

      const altIsLikelyIngredientName =
        altWords <= 2 &&
        (ingredients || []).some((row) => {
          const name = normalizeLoose(row?.name || '');
          const altL = normalizeLoose(altNorm);
          if (!name || !altL) return false;
          return name.includes(altL) || altL.includes(name);
        });

      if (altIsLikelyIngredientName) {
        dlog('[TITLE][ALT SKIP: ingredient-like]', { kept: cur, rejectedAlt: altNorm });
      } else if (curRich && altTooWeak) {
        dlog('[TITLE][ALT SKIP]', { kept: cur, rejectedAlt: altNorm });
      } else {
        dlog('[TITLE][ALT APPLY]', { previousTitle: cur, altNorm });
        title = altNorm;
      }

      const shouldApplyAlt = !altIsLikelyIngredientName && !(curRich && altTooWeak);

      if (shouldApplyAlt) {
        dlog('[TITLE][ALT APPLY]', { previousTitle: cur, altNorm });
        title = altNorm;
      }
    }
  }

  if (looksLikeEmotionalHookTitle(title)) {
    title =
      inferTitleFromContent(ingredients, steps) ||
      fabricateTitleFromIngredientsRows(ingredients) ||
      title;
  }

  if (looksLikeStepTitle(title)) {
    title =
      inferTitleFromContent(ingredients, steps) ||
      fabricateTitleFromIngredientsRows(ingredients) ||
      title;
  }

  title = normalizeTitleCandidate(title);
  title = stripOcrTitleArtifacts(title);

  return {
    title,
    guessedFromLines,
    cleanedPickedTitles,
    mergedFromVision,
    bestVisionTitle,
  };
}

function guessTitleCandidateFromLines(safeLinesForTitle) {
  return guessTitleFromLines(safeLinesForTitle);
}

module.exports = {
  buildFinalOcrTitle,
};