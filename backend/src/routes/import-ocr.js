// backend/src/routes/import-ocr.js

const express = require('express');
const multer = require('multer');
const { createWorker } = require('tesseract.js');
const { parseRawLine } = require('../utils/ingredients');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// ───────────────────── Auth (Supabase déjà branché globalement) ──────────

function needAuth(req, res, next) {
  if (!req.user?.userId) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ───────────────────── OCR worker partagé ─────────────────────

let workerPromise;
async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker('fra+eng');
      return worker;
    })();
  }
  return workerPromise;
}

// ───────────────────── “Mini IA locale” : scoring + filtrage des lignes ─────────

// Lignes clairement parasites (bannières, cookies, boutons, etc.)
const HARD_JUNK_PATTERNS = [
  /we use cookies/i,
  /privacy policy/i,
  /cookies? policy/i,
  /if you continue to use this site/i,
  /we will assume that you are happy/i,
  /^\d{1,2}:\d{2}\s*$/i, // ex: "12:47"
  /^\s*4g\s*$/i,
  /app store/i,
  /google play/i,
  /android/i,
  /ios/i,
  /recime/i,
  /signaler une erreur d'importation/i,
  /ouvrir dans/i,
  /ok\b.*privacy/i,
];

// Lignes peu probables pour une recette : URL, domaines, boutons, etc.
const URL_REGEX = /(https?:\/\/|www\.)/i;
const DOMAIN_REGEX = /[a-z0-9\-]+\.[a-z]{2,}(\/|$)/i;
const BUTTON_WORDS = /(ok|annuler|accepter|refuser|privacy|policy|conditions|mentions)/i;

// Verbes culinaires typiques (pour repérer les vraies étapes)
const COOKING_VERBS = /(faites|ajoutez|versez|mélangez|cuire|cuisez|chauffez|préchauffez|saisissez|nappez|servez|réservez|coupez|hachez|poêlez|dorez|fouettez|incorporez|déposez)/i;

// Indices d’ingrédients (quantité + unité / aliment)
const ING_HINT = /(\d+\s*(g|kg|mg|ml|cl|l|cuill|cuillère|pincée|tranche|pièce|oeuf|œuf))/i;

// Mots utiles de structuration
const SECTION_HINTS = /(ingr[ée]dients?|instructions?|étape\s*\d+|etape\s*\d+|astuces?|variantes?)/i;

// Score une ligne : positif = intéressant, négatif = parasite
function scoreLine(line) {
  const txt = String(line || '').trim();
  const lower = txt.toLowerCase();

  if (!txt) return -10;

  let score = 0;

  // Parasites forts
  if (HARD_JUNK_PATTERNS.some((re) => re.test(txt))) score -= 8;
  if (URL_REGEX.test(txt) || DOMAIN_REGEX.test(txt)) score -= 5;
  if (BUTTON_WORDS.test(txt)) score -= 4;

  // Texte très court ou très long = souvent bruit
  if (txt.length < 4) score -= 1;
  if (txt.length > 220) score -= 1;

  // Mots-clés importants
  if (SECTION_HINTS.test(txt)) score += 5;
  if (COOKING_VERBS.test(lower)) score += 4;
  if (ING_HINT.test(lower)) score += 4;

  // Puces / numérotation
  if (/^[\s•\-\u2022]*\d+[\.\)]/.test(txt)) score += 2;
  if (/^[\s•\-\u2022]+/.test(txt)) score += 1;

  // Phrase complète
  const words = txt.split(/\s+/);
  if (words.length >= 5) score += 1;

  return score;
}

/**
 * Nettoyage intelligent de base :
 * - découpe le texte brut en lignes
 * - calcule un score par ligne
 * - garde les lignes “intéressantes” + leurs voisines proches
 */
function smartFilterLinesFromText(rawText) {
  const rawLines = String(rawText || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!rawLines.length) return [];

  const scored = rawLines.map((line, idx) => ({
    line,
    idx,
    score: scoreLine(line),
  }));

  const keep = new Array(scored.length).fill(false);

  for (let i = 0; i < scored.length; i++) {
    const s = scored[i].score;

    // On garde toutes les lignes clairement intéressantes
    if (s >= 2) {
      keep[i] = true;
      // On garde aussi les voisines immédiates si elles ne sont pas franchement négatives
      if (i > 0 && scored[i - 1].score >= 0) keep[i - 1] = true;
      if (i < scored.length - 1 && scored[i + 1].score >= 0) keep[i + 1] = true;
    }
  }

  const filtered = [];
  for (let i = 0; i < scored.length; i++) {
    const { line, score } = scored[i];
    if (!keep[i]) continue;
    if (score <= -5) continue; // lignes vraiment toxiques
    filtered.push(line);
  }

  return filtered;
}

// ───────────────────── Helpers parsing recette ─────────────────────

// ligne de portions : "Portions : 4 personnes"
function extractServings(lines) {
  for (const l of lines) {
    const m = l.match(/portions?\s*:\s*(\d+)/i);
    if (m) return parseInt(m[1], 10) || 1;
  }
  return 1;
}

// regroupe des lignes en phrases/paragraphes
function mergeLinesToParagraphs(lines = []) {
  const out = [];
  let current = '';

  for (const line of lines) {
    const l = line.trim();
    if (!l) continue;

    if (!current) {
      current = l;
    } else {
      current += ' ' + l;
    }

    if (/[.!?…]$/.test(l)) {
      out.push(current.trim());
      current = '';
    }
  }

  if (current.trim()) out.push(current.trim());
  return out;
}

// renumérote les étapes : 1., 2., 3. … en continu
function normalizeStepNumbers(stepParagraphs = []) {
  let n = 1;
  return stepParagraphs.map((txt) => {
    let t = String(txt || '').trim();
    t = t.replace(/^[\s•\-·\u2022]*\d+[\.\)\-]\s*/, '');
    return `${n++}. ${t}`;
  });
}

// dédoublonnage C2 : on garde la version la plus longue si 2 étapes sont quasi identiques
function dedupeSteps(stepList = []) {
  const out = [];

  for (const step of stepList) {
    const body = String(step).replace(/^\d+\.\s*/, '').trim();
    const bodyLower = body.toLowerCase();

    let merged = false;

    for (let i = 0; i < out.length; i++) {
      const other = out[i];
      const otherBody = other.replace(/^\d+\.\s*/, '').trim().toLowerCase();

      const minLen = Math.min(otherBody.length, bodyLower.length);
      if (minLen < 20) continue;

      const prefixLen = Math.min(40, minLen);
      const a = bodyLower.slice(0, prefixLen);
      const b = otherBody.slice(0, prefixLen);

      if (a === b) {
        // mêmes débuts → on garde la plus longue
        if (bodyLower.length > otherBody.length + 5) {
          out[i] = step; // on remplace l'ancienne par la plus complète
        }
        merged = true;
        break;
      }
    }

    if (!merged) {
      out.push(step);
    }
  }

  return out;
}

// nettoie une ligne d'ingrédient (puces, "E ", "(facultatif)", etc.)
function cleanIngredientLine(line) {
  let l = String(line || '').trim();

  // retirer puces classiques
  l = l.replace(/^[•\-·\u2022]+\s*/, '').trim();

  // beaucoup de captures OCR transforment le • en "E "
  // ex: "E 500g de steak..." -> "500g de steak..."
  // on enlève tout "E " ou "e " au début
  l = l.replace(/^[Ee]\s+/, '');

  // enlever "(facultatif)" dans la ligne si jamais ça reste
  l = l.replace(/\(facultatif\)/gi, '').trim();

  return l.trim();
}

// Parsing spécifique OCR pour extraire quantité + unité + nom
function parseOcrIngredient(line) {
  let original = String(line || '').trim();
  if (!original) return null;

  let txt = cleanIngredientLine(original);

  // enlever les deux-points en fin de "Parmesan :"
  if (/:\s*$/.test(txt) && !ING_HINT.test(txt)) {
    return null; // titre de section, pas un ingrédient
  }

  // 500g / 20 cl / 60 g ...
  let m = txt.match(/^(\d+(?:[.,]\d+)?)\s*(g|kg|mg|ml|cl|l)\b(.+)?$/i);
  if (m) {
    const quantity = parseFloat(m[1].replace(',', '.')) || 0;
    const unit = m[2].toLowerCase();
    const name = (m[3] || '').replace(/^de\s+/i, '').trim() || original;
    return { quantity, unit, name };
  }

  // 3 cuillères à soupe / 1 cuillère à soupe / 2 cuillères à café ...
  m = txt.match(
    /^(\d+(?:[.,]\d+)?)\s*(cuill(?:ère|er)?s?(?:\s+à\s+soupe|\s+a\s+soupe|\s+à\s+caf[ée]|\s+a\s+caf[ée])?)\b(.+)?$/i
  );
  if (m) {
    const quantity = parseFloat(m[1].replace(',', '.')) || 0;
    const unitRaw = m[2].toLowerCase();
    let unit = 'piece';
    if (unitRaw.includes('soupe')) unit = 'cas'; // cuillère à soupe
    else if (unitRaw.includes('caf')) unit = 'cac'; // cuillère à café

    const name = (m[3] || '').replace(/^de\s+/i, '').trim() || original;
    return { quantity, unit, name };
  }

  // 1 pincée de ...
  m = txt.match(/^(\d+(?:[.,]\d+)?)\s*(pinc[ée]e?s?)\b(.+)?$/i);
  if (m) {
    const quantity = parseFloat(m[1].replace(',', '.')) || 0;
    const unit = 'pincee';
    const name = (m[3] || '').replace(/^de\s+/i, '').trim() || original;
    return { quantity, unit, name };
  }

  // 3 oeufs / 2 œufs / 3 gousses d'ail ...
  m = txt.match(
    /^(\d+(?:[.,]\d+)?)\s*(oeufs?|œufs?|gousses?|tranches?|bouch[ée]es?|steaks?)\b(.+)?$/i
  );
  if (m) {
    const quantity = parseFloat(m[1].replace(',', '.')) || 0;
    const unit = 'piece';
    const nameRest = (m[3] || '').trim();
    const name =
      nameRest ||
      txt.replace(/^\d+(?:[.,]\d+)?\s*/, '').trim() ||
      original;
    return { quantity, unit, name };
  }

  return null;
}

// Beautifier final des ingrédients pour un format “propre”
function beautifyIngredients(list = []) {
  return list.map((ing) => {
    let name = String(ing.name || '').trim();
    let unit = ing.unit || '';

    // enlever prépositions en début : de / d' / d’ / du / des
    name = name.replace(/^(de|d’|d'|du|des)\s+/i, '');

    // Cas spécifique : d'ail hachées avec unité "piece" → Gousses d'ail hachées
    if (/^d[’']ail/i.test(name) && unit === 'piece' && (ing.quantity || 0) >= 1) {
      name = "Gousses d'ail hachées";
    }

    // enlever les préfixes "Cuillères à soupe de ..." dans name (au cas où ça reste)
    name = name.replace(/^Cuill[eè]res?\s+à\s+soupe\s+de\s+/i, '');
    name = name.replace(/^Cuill[eè]re\s+à\s+soupe\s+de\s+/i, '');
    name = name.replace(/^Cuill[eè]res?\s+à\s+caf[ée]\s+de\s+/i, '');
    name = name.replace(/^Cuill[eè]re\s+à\s+caf[ée]\s+de\s+/i, '');

    // enlever les ":" en fin
    name = name.replace(/:\s*$/, '');

    // Capitaliser première lettre
    if (name) {
      name = name.charAt(0).toUpperCase() + name.slice(1);
    }

    return {
      ...ing,
      name,
      unit,
    };
  });
}

/**
 * Découpe un texte OCR déjà filtré en :
 * - servings
 * - ingredientLines
 * - stepLines (numérotées 1., 2., 3.)
 * - notesLines (infos + astuces)
 */
function splitIngredientsAndSteps(filteredLines) {
  const lines = filteredLines.slice();

  const servings = extractServings(lines);

  const metaLines = [];
  for (const l of lines) {
    if (
      /^pr[ée]paration\s*:/i.test(l) ||
      /^cuisson\s*:/i.test(l) ||
      /^temps\s*total\s*:/i.test(l) ||
      /^portions?\s*:/i.test(l)
    ) {
      metaLines.push(l);
    }
  }

  const idxIngr = lines.findIndex((l) => /^ingr[ée]dients?/i.test(l));
  const idxInstr = lines.findIndex(
    (l, idx) =>
      idx > (idxIngr >= 0 ? idxIngr : -1) &&
      /(instructions?|étape\s*1|etape\s*1)/i.test(l)
  );

  const ingredientLines = [];
  const stepLinesRaw = [];
  const tipsLines = [];

  // ── Ingrédients ──
  if (idxIngr >= 0) {
    const end = idxInstr >= 0 ? idxInstr : lines.length;
    for (let i = idxIngr + 1; i < end; i++) {
      let line = lines[i];
      if (!line) continue;

      if (/^pr[ée]paration\b/i.test(line)) continue;
      if (/^cuisson\b/i.test(line)) continue;
      if (/^temps total\b/i.test(line)) continue;
      if (/^portions?\b/i.test(line)) continue;

      if (/^pour la sauce\b/i.test(line)) continue;

      // "(facultatif)" -> on ignore complètement
      if (/\(facultatif\)/i.test(line)) {
        continue;
      }

      // "Parmesan :" etc. -> plutôt note
      if (/^[A-Z].*:\s*$/.test(line) && !ING_HINT.test(line)) {
        metaLines.push(line);
        continue;
      }

      line = cleanIngredientLine(line);
      if (!line) continue;

      const prevIdx = ingredientLines.length - 1;
      const hasQty = ING_HINT.test(line);

      // si la ligne actuelle ne ressemble pas à un ingrédient mais suit un ingrédient
      // → on la fusionne dans la précédente (C2 modéré)
      if (!hasQty && prevIdx >= 0) {
        const prev = ingredientLines[prevIdx];
        if (!/[.!?…]$/.test(prev) && line.length < 80) {
          ingredientLines[prevIdx] = `${prev} ${line}`.trim();
          continue;
        }
      }

      ingredientLines.push(line);
    }
  }

  // ── Étapes + Astuces ──
  if (idxInstr >= 0) {
    let inTips = false;

    for (let i = idxInstr + 1; i < lines.length; i++) {
      let line = lines[i];
      if (!line) continue;

      const norm = line
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();

      if (/^etape\s*\d+\s*:/.test(norm)) {
        inTips = false;
        stepLinesRaw.push(line);
        continue;
      }

      if (/(astuces?|variantes?|conseils?)/i.test(line)) {
        inTips = true;
        tipsLines.push(line);
        continue;
      }

      if (inTips) {
        if (
          /^ingr[ée]dients?$/i.test(line) ||
          /^instructions?$/i.test(line) ||
          /^etape\s*\d+\s*:/i.test(norm)
        ) {
          inTips = false;
          i--;
          continue;
        }
        tipsLines.push(line);
        continue;
      }

      line = line.replace(/^[•\-·\u2022]+\s*/, '');
      line = line.replace(/^\d+[\.\)]\s*/, '');
      line = line.trim();
      if (!line) continue;

      stepLinesRaw.push(line);
    }
  }

  const effectiveIngredients = ingredientLines.length ? ingredientLines : [];
  let effectiveStepsRaw;

  if (stepLinesRaw.length) {
    effectiveStepsRaw = stepLinesRaw;
  } else if (!effectiveIngredients.length) {
    effectiveStepsRaw = lines;
  } else {
    effectiveStepsRaw = [];
  }

  const mergedSteps = mergeLinesToParagraphs(effectiveStepsRaw);
  const normalizedSteps = normalizeStepNumbers(mergedSteps);
  const dedupedSteps = dedupeSteps(normalizedSteps);

  const notesLines = [...metaLines, ...tipsLines];

  return {
    servings,
    ingredientLines: effectiveIngredients,
    stepLines: dedupedSteps,
    notesLines,
  };
}

// ───────────────────── Route POST /import/ocr ─────────────────────

router.post('/ocr', needAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'Aucun fichier reçu' });
    }

    const worker = await getWorker();
    const { data } = await worker.recognize(req.file.buffer);

    const rawText = String(data.text || '').trim();
    if (!rawText) {
      return res.status(400).json({ ok: false, error: 'Texte OCR vide' });
    }

    const filteredLines = smartFilterLinesFromText(rawText);
    if (!filteredLines.length) {
      return res
        .status(400)
        .json({ ok: false, error: 'Impossible de détecter une recette dans cette image' });
    }

    const { servings, ingredientLines, stepLines, notesLines } =
      splitIngredientsAndSteps(filteredLines);

    // 3) Parse des lignes d'ingrédients -> { name, quantity, unit }
    const ingredientsRaw = ingredientLines.map((line) => {
      // 3.1 parseur OCR spécifique
      const parsedOcr = parseOcrIngredient(line);
      if (parsedOcr) {
        return {
          name: parsedOcr.name,
          quantity: parsedOcr.quantity,
          unit: parsedOcr.unit || 'g',
        };
      }

      // 3.2 fallback : parseRawLine (utilitaire global)
      const parsed = parseRawLine(cleanIngredientLine(line));
      if (parsed) {
        return {
          name: parsed.nameCanon || parsed.name || line,
          quantity: parsed.quantityNum ?? parsed.quantity ?? 0,
          unit: parsed.unit || 'g',
        };
      }

      // 3.3 ultime fallback : tout dans name
      return {
        name: cleanIngredientLine(line),
        quantity: 0,
        unit: 'g',
      };
    });

    // 4) Beautifier final : format propre pour l'affichage
    const ingredients = beautifyIngredients(ingredientsRaw);

    const draft = {
      title: 'Recette importée',
      servings,
      imageUrl: null,
      notes: notesLines.length ? notesLines.join('\n') : '',
      steps: stepLines,
      ingredients,
    };

    return res.json({ ok: true, draft });
  } catch (e) {
    console.error('POST /import/ocr error:', e);
    return res.status(500).json({ ok: false, error: e.message || 'ocr_error' });
  }
});

module.exports = router;



