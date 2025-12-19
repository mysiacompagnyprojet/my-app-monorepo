// backend/src/routes/import-ocr.js
'use strict';

const express = require('express');
const multer = require('multer');

const { ocrFromBuffer, ocrFromBufferWithDebug } = require('../services/vision');
const {
  smartFilterWithTrashFromText,
  splitIngredientsAndSteps,
  joinWrappedLinesForSteps,
  parseOcrIngredient,
  beautifyIngredients,
  guessTitleFromLines,
  miniReflow,
} = require('../utils/ocrText');

let parseRawLine = null;
try {
  parseRawLine = require('../utils/ingredients')?.parseRawLine || null;
} catch (e) {
  parseRawLine = null;
}

function stripBulletPrefix(s) {
  return String(s || '')
    .trim()
    .replace(/^[•·⚫●○◦\-\*]+\s*/g, '')
    .trim();
}

function normalizeTitleCandidate(s) {
  return String(s || '')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function isBlacklistedUiTitle(s) {
  const t = normalizeTitleCandidate(s).toLowerCase();
  if (!t) return true;

  // ✅ Instagram / FB / UI générique
  if (t === 'toutes les publications' || t === 'toute les publications') return true;
  if (t === 'enregistré' || t === 'enregistree' || t === 'enregistrée') return true;

  // pages / noms de comptes souvent pris comme titre à tort
  if (t === 'recettes délice' || t === 'recettes delice') return true;
  if (t === 'recettes et délices' || t === 'recettes et delices') return true;

  // Facebook header
  if (t.startsWith('publication de')) return true;

  return false;
}

function isOcrZeroGramNoise(line) {
  const s = stripBulletPrefix(line)
    .replace(/\u00A0/g, ' ') // espaces insécables
    .replace(/\s+/g, ' ')
    .trim();

  // "Og", "0g", parfois "O g", ou "0 g"
  if (/^o\s*[gq]$/i.test(s)) return true;
  if (/^0\s*g$/i.test(s)) return true;

  return false;
}

/**
 * Split ligne "épices" si:
 * - pas de quantité au début
 * - contient des virgules
 * - et ressemble à une liste
 *
 * ✅ Retourne des objets { text, noQtyList } pour savoir si on doit FORCER quantity=0
 */
function splitCommaSeparatedNoQty(line) {
  const raw = stripBulletPrefix(line);
  if (!raw) return [{ text: line, noQtyList: false }];

  // si ça commence par une quantité => on ne split pas
  if (
    /^\s*(\d+([.,]\d+)?|\d+\s+\d+\/\d+|\d+\/\d+|½|⅓|⅔|¼|¾|⅛|⅜|⅝|⅞)\b/.test(raw)
  ) {
    return [{ text: line, noQtyList: false }];
  }

  // doit contenir une virgule
  if (!raw.includes(',')) return [{ text: line, noQtyList: false }];

  // évite de splitter des phrases longues (trop risqué)
  if (raw.length > 70) return [{ text: line, noQtyList: false }];

  // Split par virgule + " et " + "&"
  const parts = raw
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .flatMap((x) =>
      x
        .split(/\s+(?:et|&)\s+/i)
        .map((y) => y.trim())
        .filter(Boolean)
    )
    .map((x) => x.replace(/^\.+/, '').trim())
    .filter(Boolean);

  // si on obtient au moins 2 items, on split
  if (parts.length >= 2) return parts.map((p) => ({ text: p, noQtyList: true }));

  return [{ text: line, noQtyList: false }];
}

function looksLikeStepTitle(t) {
  const s = String(t || '').trim();
  if (!s) return false;
  return /^[-•*]?\s*(égoutter|egoutter|ajouter|mixer|mixez|cuire|faire|préchauffer|prechauffer|préparer|preparer|couper|laver|mettre|verser|chauffer|mélanger|melanger)\b/i.test(
    s
  );
}

function inferTitleFromContent(ingredientsRows, stepsArr) {
  const names = (ingredientsRows || [])
    .map((x) => String(x?.name || '').toLowerCase())
    .filter(Boolean)
    .join(' | ');

  const stepsText = (stepsArr || []).join(' ').toLowerCase();

  const hasNuggets = /\bnuggets?\b/.test(stepsText);
  const hasPoisChiches = /\bpois\s*chiches?\b/.test(names);

  if (hasNuggets && hasPoisChiches) return 'Nuggets de pois chiches';
  if (hasNuggets) return 'Nuggets maison';

  return null;
}

// ✅ Retire les headers FB qui parasitent les titres
function removeSocialHeaderLines(lines) {
  return (lines || []).filter((l) => !/^publication\s+de\b/i.test(String(l || '').trim()));
}

/**
 * ✅ Score pour choisir le meilleur titre parmi toutes les images
 * On favorise :
 * - pas "publication de"
 * - pas une phrase (pas de "." "!" "?")
 * - longueur raisonnable
 * - mots "recette-like"
 */
function scoreTitleCandidate(title) {
  const t = String(title || '').trim();
  if (!t) return -9999;

  const low = t.toLowerCase();

  // ❌ titres d'assaisonnement / fin d'étape
  if (low === 'sel & poivre') return -9999;
  if (low === 'sel et poivre') return -9999;
  if (low === 'salez et poivrez') return -9999;
  if (low === 'poivre et sel') return -9999;

  // blacklist obvious
  if (/^publication\s+de\b/i.test(t)) return -9999;
  if (/^ingr[ée]dients?\b/i.test(t)) return -9999;
  if (/^temps\s+de\s+(préparation|cuisson)\b/i.test(t)) return -9999;

  let score = 0;

  // longueur idéale
  if (t.length >= 6 && t.length <= 90) score += 10;
  if (t.length < 6) score -= 30;
  if (t.length > 90) score -= 10;

  // pénalise si ça ressemble à une phrase
  if (/[.!?…]$/.test(t)) score -= 15;
  if (/[.!?…]/.test(t)) score -= 8;

  // pénalise si chiffres
  if (/\d/.test(t)) score -= 10;

  // pénalise si ressemble à une étape
  if (looksLikeStepTitle(t)) score -= 20;

  // bonus mots typiques de titres
  if (
    /\b(croque|monsieur|ap[ée]ritif|g[âa]teau|gateau|tarte|quiche|salade|gratin|pâtes|pates|pizza|soupe|cookies?|brownie|nuggets?)\b/i.test(
      t
    )
  ) {
    score += 10;
  }

  // bonus si majuscule initiale
  if (/^[A-ZÀ-ÖØ-Þ]/.test(t)) score += 3;

  // bonus si 2+ mots
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length >= 2) score += 4;
  if (words.length >= 4) score += 2;

  return score;
}

function pickBestTitleFromCandidates(candidates) {
  const list = (candidates || [])
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter(Boolean);

  if (list.length === 0) return null;

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

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const MAX_FILES = 10;

router.post('/ocr', upload.array('files', MAX_FILES), async (req, res) => {
  try {
    const isDebug = req.query.debug === '1';

    if (!req.files?.length) {
      return res.status(400).json({ ok: false, error: 'NO_FILES', message: 'Ajoute au moins 1 image.' });
    }

    const texts = [];

    // ✅ Titres Vision sur TOUTES les images (si debug), sinon uniquement la 1ère
    const pickedTitles = [];
    const visionDebugByImage = [];
    let visionDebugFirst = null;

    for (let i = 0; i < req.files.length; i++) {
      const f = req.files[i];

      const shouldRunDebug = (isDebug && i === 0) || (!isDebug && i === 0) || (isDebug && i > 0); // debug sur toutes si isDebug, sinon seulement sur 1ère
      if (shouldRunDebug) {
        const out = await ocrFromBufferWithDebug(f.buffer, { lang: 'fr' });
        if (out?.text) texts.push(out.text);

        const pt = out?.debug?.pickedTitle ? String(out.debug.pickedTitle).trim() : '';
        if (pt) pickedTitles.push(pt);

        if (isDebug) {
          visionDebugByImage.push({
            index: i,
            pickedTitle: pt || null,
            topTextSample: out?.debug?.topTextSample || null,
            bandTextSample: out?.debug?.bandTextSample || null,
          });

          if (i === 0) visionDebugFirst = out?.debug || null;
        }
      } else {
        // 🚀 mode rapide (normal + images > 0)
        const t = await ocrFromBuffer(f.buffer, { lang: 'fr' });
        if (t) texts.push(t);
      }
    }

    const rawText = texts.join('\n\n');
    const filtered = smartFilterWithTrashFromText(rawText);

    // ✅ Anti "Publication de ..." pour le guess fallback
    const safeLinesForTitle = removeSocialHeaderLines(filtered.lines);

    // ✅ Choix titre final :
    // 1) meilleur parmi tous les pickedTitle des images (si on en a)
    // 2) sinon guessTitleFromLines
    // 3) sinon fallback
    const bestVisionTitle = pickBestTitleFromCandidates(pickedTitles);

    const visionPicked =
      bestVisionTitle && String(bestVisionTitle).trim() ? String(bestVisionTitle).trim() : null;

    let title =
      (!isBlacklistedUiTitle(visionPicked) ? visionPicked : null) ||
      guessTitleFromLines(safeLinesForTitle) ||
      'Recette importée';

    // Split
    let lines = removeSocialHeaderLines(filtered.lines);

    const split = splitIngredientsAndSteps(lines);
    lines = miniReflow(split);

    let servings = split.servings || 1;
    if (!Number.isFinite(servings) || servings < 1) servings = 1;

    // ---------- INGREDIENTS ----------
    const ingredients = beautifyIngredients(
      (split.ingredientLines || [])
        .flatMap((l) => splitCommaSeparatedNoQty(l))
        .map((obj) => {
          const l = String(obj?.text || '').trim();
          if (!l) return null;

          // ✅ supprime le bruit OCR "Og / 0g"
          if (isOcrZeroGramNoise(l)) return null;

          // ✅ si ça vient d'une liste "sans quantité" (épices, condiments), on force quantity=0
          if (obj.noQtyList) {
            const name = stripBulletPrefix(l);
            if (!name) return null;

            if (/^sel$/i.test(name)) return { name: 'sel', quantity: 0, unit: '' };
            if (/^poivre$/i.test(name)) return { name: 'poivre', quantity: 0, unit: '' };

            return { name, quantity: 0, unit: '' };
          }

          const parsed = parseOcrIngredient(l) || (parseRawLine ? parseRawLine(l) : null);

          if (!parsed) return { name: l, quantity: 0, unit: '' };

          const row = {
            name: parsed.name || l,
            quantity: Number(parsed.quantity || 0),
            unit: parsed.unit || '',
          };

          if (typeof parsed.quantityRaw === 'string' && parsed.quantityRaw.trim()) {
            row.quantityRaw = String(parsed.quantityRaw).trim();
          }

          return row;
        })
        .filter(Boolean)
    );

    // ---------- STEPS ----------
    const rawSteps = joinWrappedLinesForSteps(split.stepLines || []);

    const steps = rawSteps
      .flatMap((s) =>
        String(s || '')
          .split(/\.(?=\s+[A-ZÀ-ÖØ-Þ])/g) // split au "." suivi d'une majuscule
          .map((x) => x.trim())
      )
      .filter((s) => s && s !== '•' && s !== '.' && s !== '·');

    // ✅ PATCH: fallback si les étapes restent collées (sans casser les cas qui marchent)
    function splitStepsFallback(text) {
      const s = String(text || '')
        .replace(/\r/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .trim();

      if (!s) return [];

      // protège les décimales 1.5 -> 1<DEC>5
      const protectedDecimals = s.replace(/(\d)\.(\d)/g, '$1<DEC>$2');

      // split sur ponctuation + retours ligne
      const parts = protectedDecimals
        .split(/(?:[.!?…]+(?=\s)|[.!?…]+\n+|\n{2,})/g)
        .map((x) => x.replace(/<DEC>/g, '.').trim())
        .filter(Boolean);

      return parts;
    }

    const looksStuck = steps.length <= 1 && rawSteps.some((x) => String(x || '').length >= 180);

    if (looksStuck) {
      const fallbackSteps = rawSteps
        .flatMap((s) => splitStepsFallback(s))
        .map((s) => s.replace(/\s+/g, ' ').trim())
        .filter((s) => s && s !== '•' && s !== '.' && s !== '·');

      if (fallbackSteps.length > steps.length) {
        steps.splice(0, steps.length, ...fallbackSteps);
      }
    }

    // ---------- NOTES ----------
    const notes = (split.notesLines || [])
      .map((s) => String(s || '').trim())
      .filter(Boolean)
      .join('\n');

    if (looksLikeStepTitle(title)) {
      const inferred = inferTitleFromContent(ingredients, steps);
      if (inferred) title = inferred;
    }

    const draft = {
      title,
      servings,
      imageUrl: null,
      notes,
      ingredients,
      steps,
      trash: filtered.trash,
    };

    if (isDebug) {
      return res.json({
        ok: true,
        debug: {
          imagesCount: req.files.length,
          title,
          servings,

          vision: {
            pickedTitles,
            bestVisionTitle: bestVisionTitle || null,
            byImage: visionDebugByImage,
            firstImage: visionDebugFirst,
          },

          firstLines: safeLinesForTitle.slice(0, 60),

          split: {
            ingredientLinesCount: (split.ingredientLines || []).length,
            stepLinesCount: (split.stepLines || []).length,
            notesLinesCount: (split.notesLines || []).length,
          },
          trashSample: (filtered.trash || []).slice(0, 60),
          draftPreview: {
            ingredientsPreview: draft.ingredients.slice(0, 12),
            stepsPreview: draft.steps.slice(0, 12),
          },
        },
      });
    }

    return res.json({ ok: true, draft });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: 'OCR_FAILED', message: e?.message || 'Erreur OCR' });
  }
});

module.exports = router;

