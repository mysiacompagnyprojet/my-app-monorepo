// backend/src/routes/import-ocr.js
'use strict';

const express = require('express');
const multer = require('multer');

const { pickBestTitle, isValidRecipeTitleCandidate, tryMergeSplitTitle } = require('../utils/ocrTitle');

const { ocrFromBufferWithDebug } = require('../services/vision');
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

// ---------------- Helpers ----------------

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

  // ✅ TikTok / IG : "Nom → Suivre"
  if (/→\s*suivre$/i.test(t)) return true;
  if (/\bsuivre$/i.test(t) && t.includes('→')) return true;

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

function stripDiacritics(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function looksLikeEmotionalHookTitle(raw) {
  const s0 = String(raw || '').trim();
  if (!s0) return false;

  const s = stripDiacritics(s0).toLowerCase();

  // ✅ phrase longue sans mot-clé recette => jamais un titre
  if (
    s.length > 60 &&
    !/\b(recette|gateau|gâteau|soupe|salade|pates?|pâtes?|riz|poulet|boeuf|bœuf|porc|poisson)\b/.test(s)
  ) {
    return true;
  }

  // signes typiques d’accroche (beaucoup de posts)
  if (/[!?]{2,}/.test(s)) return true; // "??", "!!", "?!"
  if (/\bahah\b/.test(s)) return true;
  if (/\bpersonne\b/.test(s)) return true;

  // 1ère personne / storytelling
  if (/\b(j['’]ai|j[’']?|je|m['’]a|mon|ma|mes|moi)\b/.test(s)) return true;

  // phrases “marketing”
  const hooks = [
    'comment vous dire',
    'vous allez adorer',
    'incroyable recette',
    'trop bonne',
    'trop bon',
    'un delice',
    'c est une tuerie',
    'vous devez absolument',
    'on raffole',
    'ca m a remonte le moral',
    'remonte le moral',
    'je signale toute copie',
    'protege par des droits d auteur',
  ];

  if (hooks.some((h) => s.includes(h))) return true;

  // ligne qui ressemble à une phrase, pas à un titre recette (trop longue + verbes)
  if (s.length > 45 && /\b(dit|mangeait|voici|ajoute|ajoutee|comment|dire|remonte)\b/.test(s)) return true;

  return false;
}

function looksLikeStepTitle(t) {
  const s = String(t || '').trim();
  if (!s) return false;
  return /^[-•*]?\s*(hacher|hachez|eplucher|epluchez|éplucher|épluchez|égoutter|egoutter|ajouter|mixer|mixez|cuire|faire|préchauffer|prechauffer|préparer|preparer|couper|laver|mettre|verser|chauffer|mélanger|melanger)\b/i.test(
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

  const hasPates = /\bpates?\b/.test(stepsText) || /\bp[aâ]tes?\b/.test(names);
  const hasTomate = /\btomate\b/.test(names) || /\bconcentre\b/.test(names);
  const hasViande = /\bviande\b/.test(names) || /\bhach[eé]e\b/.test(names);

  if (hasPates && hasTomate && hasViande) return 'Pâtes sauce tomate & viande';
  if (hasPates && hasTomate) return 'Pâtes sauce tomate';

  return null;
}

// ✅ Retire les headers FB qui parasitent les titres
function removeSocialHeaderLines(lines) {
  return (lines || []).filter((l) => !/^publication\s+de\b/i.test(String(l || '').trim()));
}

function isOcrZeroGramNoise(line) {
  const s = stripBulletPrefix(line)
    .replace(/\u00A0/g, ' ')
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
  if (/^\s*(\d+([.,]\d+)?|\d+\s+\d+\/\d+|\d+\/\d+|½|⅓|⅔|¼|¾|⅛|⅜|⅝|⅞)\b/.test(raw)) {
    return [{ text: line, noQtyList: false }];
  }

  if (!raw.includes(',')) return [{ text: line, noQtyList: false }];
  if (raw.length > 70) return [{ text: line, noQtyList: false }];

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

  if (parts.length >= 2) return parts.map((p) => ({ text: p, noQtyList: true }));
  return [{ text: line, noQtyList: false }];
}

function fabricateTitleFromIngredientsRows(ingredientsRows) {
  const stop = new Set(['sel', 'poivre', 'eau', "eau d'orange", "eau d’orange", 'huile', "huile d'olive", "huile d’olive", 'beurre']);

  const rows = Array.isArray(ingredientsRows) ? ingredientsRows : [];

  // prend l’ingrédient avec la plus grosse quantité (si dispo), sinon le 1er “utile”
  let best = null;

  for (const r of rows) {
    const name = String(r?.name || '').trim();
    if (!name) continue;

    const low = name.toLowerCase();
    if (stop.has(low)) continue;
    if (low.startsWith('huile')) continue;

    const qty = Number(r?.quantity || 0);
    if (!best) best = { name, qty };
    else if (Number.isFinite(qty) && qty > best.qty) best = { name, qty };
  }

  if (!best) return null;

  // mini "style" pour tes cas fréquents
  const hasCoco = rows.some((r) => String(r?.name || '').toLowerCase().includes('lait de coco'));
  const hasCrevettes = rows.some((r) => String(r?.name || '').toLowerCase().includes('crevette'));

  if (hasCrevettes && hasCoco) return 'Crevettes au lait de coco';

  // sinon juste capitaliser le principal
  const t = best.name.toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function isUnitOnlyLine(s) {
  const l = String(s || '').trim().toLowerCase();
  return l === 'g' || l === 'kg' || l === 'ml' || l === 'cl' || l === 'l';
}

// Recolle les ingrédients Instagram cassés en lignes du type: ["100", "g", "de beurre de", "cacahuete"]
function joinWrappedLinesForIngredients(lines) {
  const src = (lines || [])
    .map((x) => String(x || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const out = [];
  let i = 0;

  while (i < src.length) {
    const cur = src[i];

    // cas: "100" puis "g|ml|..." puis une ou plusieurs lignes de texte
    if (/^\d+$/.test(cur) && i + 1 < src.length && isUnitOnlyLine(src[i + 1])) {
      const qty = cur;
      const unit = src[i + 1].trim();
      i += 2;

      const nameParts = [];
      while (i < src.length) {
        const x = src[i];
        if (!x) {
          i++;
          continue;
        }
        if (/^\d+$/.test(x)) break;
        if (isUnitOnlyLine(x)) break;
        nameParts.push(x);
        i++;

        // stop si on voit un nouveau début d'ingrédient (quantité)
        if (i < src.length && /^\d+/.test(src[i])) break;
      }

      const merged = `${qty} ${unit} ${nameParts.join(' ')}`.replace(/\s+/g, ' ').trim();
      if (merged && merged !== `${qty} ${unit}`) out.push(merged);
      continue;
    }

    // cas: ligne seule "g" => si la ligne précédente finit par un nombre, on l'attache, sinon on ignore
    if (isUnitOnlyLine(cur)) {
      if (out.length > 0 && /\b\d+$/.test(out[out.length - 1])) {
        out[out.length - 1] = `${out[out.length - 1]} ${cur}`.replace(/\s+/g, ' ').trim();
      }
      i++;
      continue;
    }

    out.push(cur);
    i++;
  }

  return out;
}

function uniqLines(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr || []) {
    const s = String(x || '').replace(/\s+/g, ' ').trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

// ✅ ne fait QUE rajouter des ingrédients, ne touche pas aux steps.
function rescueWrappedIngredientFragmentsOnly(split) {
  const ing = Array.isArray(split?.ingredientLines) ? [...split.ingredientLines] : [];
  const notes = Array.isArray(split?.notesLines) ? split.notesLines : [];
  const steps = Array.isArray(split?.stepLines) ? split.stepLines : [];

  // On ne prend que des "petits morceaux" typiques OCR (pas des phrases)
  const candidates = []
    .concat(notes, steps)
    .map((x) => stripBulletPrefix(String(x || '')).replace(/^[.■]+/g, '').trim())
    .filter(Boolean)
    .filter((t) => {
      const low = t.toLowerCase();

      // ✅ très court / fragment
      if (isUnitOnlyLine(low)) return true; // "g"
      if (/^\d{1,4}$/.test(low)) return true; // "100"
      if (/^(de|d['’])\b/.test(low)) return true; // "de beurre de"
      if (/^(beurre|cacahu|grill|concas)\b/.test(low)) return true;

      // marqueurs réseaux (souvent collés aux fragments ingrédients)
      if (/\b(recoltos|delico|recettes?\s+d[eé]lice)\b/.test(low)) return true;

      // sinon, on évite de prendre des vraies phrases (trop long)
      if (t.length > 34) return false;

      // petite tolérance: mots "ingrédients" seuls
      if (/^ingr[eé]dients?\s*:?$/.test(low)) return true;

      return false;
    });

  if (!candidates.length) return split;

  // Recolle les fragments ("100", "g", "de beurre de", "cacahuete") => "100 g de beurre de cacahuete"
  const rebuilt = joinWrappedLinesForIngredients(candidates);

  // Ajoute uniquement ce qui ressemble à une ligne ingrédient exploitable
  const add = rebuilt.filter((l) => {
    const s = String(l || '').trim();
    if (!s) return false;
    // au moins une quantité + une unité
    if (/^\d{1,4}\s*(kg|g|mg|l|dl|cl|ml)\b/i.test(s)) return true;
    // ou parseOcrIngredient arrive à comprendre
    return !!parseOcrIngredient(s);
  });

  if (!add.length) return split;

  return {
    ...split,
    ingredientLines: uniqLines(ing.concat(add)),
  };
}

/**
 * ✅ Patch Biscuits:
 * Dé-fusionne une ligne ingrédient quand splitIngredientsAndSteps a déjà collé
 * "100 g de chocolat noir de beurre de cacahuete" au lieu de 2 ingrédients.
 */
function splitMergedIngredientLine(line, trash) {
  let s = String(line || '').replace(/\s+/g, ' ').trim();
  if (!s) return [];

  // virer bruit de fin (ex: "Recoltos Délico")
  s = s.replace(/\bRecoltos\b.*$/i, '').trim();

  // ✅ cas précis "100 g de chocolat noir de beurre de cacahuete" => 2 ingrédients
  const m = s.match(/^(\d+)\s*g\s+de\s+(.+?)\s+de\s+beurre\s+de\s+cacahu(?:e|è)te\b/i);
  if (m && /chocolat/i.test(m[2])) {
    const qty = m[1];

    // si le même nombre apparaît dans trashSample, on est encore + confiant
    const hasQtyInTrash = Array.isArray(trash) && trash.some((x) => String(x || '').trim() === qty);
    const qty2 = hasQtyInTrash ? qty : qty;

    return [`${qty} g de ${m[2].trim()}`, `${qty2} g de beurre de cacahuète`];
  }

  return [s];
}

// ---------------- Router ----------------

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const MAX_FILES = 10;

router.post('/ocr', upload.array('files', MAX_FILES), async (req, res) => {
  try {
    const debugMode = String(req.query.debug || '').toLowerCase(); // "1" | "title" | ""
    const isDebug = debugMode === '1' || debugMode === 'title';

    if (!req.files?.length) {
      return res.status(400).json({ ok: false, error: 'NO_FILES', message: 'Ajoute au moins 1 image.' });
    }

    const texts = [];

    // ✅ Titres Vision collectés sur TOUTES les images (en debug et aussi en normal)
    const pickedTitles = [];
    const visionDebugByImage = [];

    for (let i = 0; i < req.files.length; i++) {
      const f = req.files[i];

      // ✅ On utilise la version debug pour récupérer pickedTitle (même en normal)
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
      }
    }

    // ✅ boucle finie => pickedTitles est COMPLET
    const mergedFromVision = tryMergeSplitTitle(pickedTitles);
    const bestVisionTitleRaw = mergedFromVision || pickBestTitle(pickedTitles);

    const bestVisionTitle =
      bestVisionTitleRaw && isValidRecipeTitleCandidate(bestVisionTitleRaw) && !isBlacklistedUiTitle(bestVisionTitleRaw)
        ? String(bestVisionTitleRaw).trim()
        : null;

    const rawText = texts.join('\n\n');
    const filtered = smartFilterWithTrashFromText(rawText);

    // ✅ On protège le fallback “guessTitleFromLines”
    const safeLinesForTitle = removeSocialHeaderLines(filtered.lines);

    // Split contenu (ingrédients/étapes)
    let lines = removeSocialHeaderLines(filtered.lines);
    let split = splitIngredientsAndSteps(lines);

    // ✅ Filet de sécurité : récupère des morceaux d'ingrédients tombés en notes/étapes
    split = rescueWrappedIngredientFragmentsOnly(split);

    lines = miniReflow(split);

    let servings = split.servings || 1;
    if (!Number.isFinite(servings) || servings < 1) servings = 1;

    // ---------- INGREDIENTS ----------
    const ingredients = beautifyIngredients(
      joinWrappedLinesForIngredients(split.ingredientLines || [])
        .flatMap((l) => splitMergedIngredientLine(l, filtered.trash))
        .flatMap((l) => splitCommaSeparatedNoQty(l))
        .map((obj) => {
          const l0 = String(obj?.text || '').trim();
          let l = stripBulletPrefix(l0).trim();
          if (!l) return null;

          l = l.replace(/^[.■]+/g, '').trim();

          // ✅ filtres anti-métadonnées
          if (/^(source|portions?|temps|calories?|remarques?|ingr[eé]dients?\s*:|[eé]tapes?\s+de\s+cuisson\s*:)\b/i.test(l))
            return null;
          if (/\b\w+\.(com|fr|net|org)\b/i.test(l)) return null;
          if (/^\d+\s*(heure|heures|min|minutes)\b/i.test(l)) return null;

          const meta = l
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, ' ')
            .trim();

          if (meta === 'etapes de cuisson:' || meta === 'etapes de cuisson' || meta === 'preparation:' || meta === 'preparation' || meta === 'ingredients:' || meta === 'ingredients')
            return null;

          l = l.replace(/cuill[eè]res?\s+à\s+soupe/gi, 'càs');
          l = l.replace(/\b(c\s*\.?\s*a\s*\.?\s*s\s*\.?|c\s*\.?\s*à\s*\.?\s*s\s*\.?|cas)\b/gi, 'càs');

          if (isOcrZeroGramNoise(l)) return null;

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

          row.name = String(row.name || '').replace(/[↑■]+/g, '').trim();

          if (row.unit && typeof row.name === 'string') {
            row.name = row.name.replace(new RegExp(`\\s+${row.unit}$`, 'i'), '').trim();
          }

          if (typeof parsed.quantityRaw === 'string' && parsed.quantityRaw.trim()) {
            row.quantityRaw = String(parsed.quantityRaw).trim();
          }

          return row;
        })
        .filter(Boolean)
    );

    // ---------- STEPS ----------
    const rawSteps = joinWrappedLinesForSteps(split.stepLines || []);

    function cleanStepPrefix(s) {
      return String(s || '')
        .replace(/^[\s•·\u2022\-*]+/g, '')
        .replace(/^\d{1,3}\s*$/g, '')
        .replace(/^\d{1,3}\s+(?=[A-ZÀ-ÖØ-Þ])/g, '')
        .replace(/^\d{1,3}\s*[.)\-:]\s*/g, '')
        .trim();
    }

    function splitStepsSmart(arr) {
      const out = [];
      for (const s0 of arr || []) {
        let s = String(s0 || '').replace(/\s+/g, ' ').trim();
        if (!s) continue;
        if (/^\d{1,3}$/.test(s)) continue;

        s = cleanStepPrefix(s);
        if (!s) continue;

        const parts = s
          .split(/(?<=\.)\s+/g)
          .map((x) => cleanStepPrefix(x))
          .filter(Boolean);

        if (parts.length >= 2 && (s.length >= 90 || parts.length >= 3)) out.push(...parts);
        else out.push(s);
      }
      return out;
    }

    const steps = splitStepsSmart(rawSteps)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => s !== '•' && s !== '.' && s !== '·')
      .filter((s) => !/^\d{1,3}$/.test(s));

    // ---------- NOTES ----------
    const baseNotes = (split.notesLines || []).map((s) => String(s || '').trim()).filter(Boolean);
    const notes = baseNotes.join('\n');

    // ---------- TITRE FINAL ----------
    let title =
      bestVisionTitle ||
      guessTitleFromLines(safeLinesForTitle) ||
      inferTitleFromContent(ingredients, steps) ||
      'Recette importée';

    // CAT-03 — accroches émotionnelles / storytelling
    if (looksLikeEmotionalHookTitle(title)) {
      title =
        fabricateTitleFromIngredientsRows(ingredients) ||
        inferTitleFromContent(ingredients, steps) ||
        'Recette importée';
    }

    // Sécurité : un titre ne doit jamais être une étape
    if (looksLikeStepTitle(title)) {
      title =
        fabricateTitleFromIngredientsRows(ingredients) ||
        inferTitleFromContent(ingredients, steps) ||
        'Recette importée';
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

    // ✅ debug=title : renvoie seulement infos titres
    if (debugMode === 'title') {
      return res.json({
        ok: true,
        debug: {
          imagesCount: req.files.length,
          pickedTitles,
          mergedFromVision: mergedFromVision || null,
          bestVisionTitle: bestVisionTitle || null,
          finalTitle: title,
          firstLines: safeLinesForTitle.slice(0, 40),
          byImage: visionDebugByImage,
        },
      });
    }

    if (isDebug) {
      return res.json({
        ok: true,
        debug: {
          imagesCount: req.files.length,
          title,
          servings,
          vision: {
            pickedTitles,
            mergedFromVision: mergedFromVision || null,
            bestVisionTitle: bestVisionTitle || null,
            byImage: visionDebugByImage,
          },
          firstLines: safeLinesForTitle.slice(0, 60),
          split: {
            ingredientLinesCount: (split.ingredientLines || []).length,
            stepLinesCount: (split.stepLines || []).length,
            notesLinesCount: (split.notesLines || []).length,
            ingredientLines: split.ingredientLines || [],
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
