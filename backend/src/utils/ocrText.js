// backend/src/utils/ocrText.js

// ─────────────────────────────────────────────────────────────
// 1) Scoring / filtrage de lignes OCR
// ─────────────────────────────────────────────────────────────

// Lignes clairement parasites (bannières, pubs, boutons, etc.)
const HARD_JUNK_PATTERNS = [
  // bannières cookies / privacy
  /we use cookies/i,
  /privacy policy/i,
  /cookies? policy/i,
  /if you continue to use this site/i,
  /we will assume that you are happy/i,

  // petits artefacts
  /^\d{1,2}:\d{2}\s*$/i, // ex: "12:47"
  /^\s*4g\s*$/i,

  // stores / app
  /app store/i,
  /google play/i,
  /android/i,
  /ios/i,

  // contenus hors recette / marque
  /recime/i,
  /signaler une erreur d'importation/i,
  /ouvrir dans/i,
  /ok\b.*privacy/i,

  // marques/pub fréquentes
  /monoprix/i,
  /black\s*friday/i,
  /canva/i,

  // GÉNÉRAL : pubs / marketing
  /\b(pub|publicit[ée]|annonce sponsoris[ée]e?|sponsorise[ée]?)\b/i,
  /\b(offre|promotion|promo|r[ée]duction|soldes?)\b/i,
  /\b(j'en profite|j en profite|profitez|profite-en|profite en)\b/i,
  /-\s*\d{1,3}\s*%/, // -30%
  /\b\d{1,3}\s*%\b/, // 30 %
];

// Métadonnées de sites de recettes (mrrecette & co, erreurs à éviter, etc.)
const META_LINE_PATTERNS = [
  /^r[ée]alis[ée] par\b/i,
  /^type de plat\b/i,
  /^niveau de difficult[ée]\b/i,
  /^cuisine d'origine\b/i,
  /^quantit[ée] obtenue\b/i,
  /^r[ée]gime alimentaire\b/i,
  /^liste des ingr[ée]dients\b/i,
  /^ingr[ée]dients?\s+principaux\b/i,
  /^sauce et assaisonnements\b/i,
  /^garnitures?\b/i,
  /^[ée]tapes? de pr[ée]paration\b/i,
  /^informations? utiles\b/i,
  /^erreurs?\s+à\s+éviter\b/i,
];

const URL_REGEX = /(https?:\/\/|www\.)/i;
const DOMAIN_REGEX = /[a-z0-9\-]+\.[a-z]{2,}(\/|$)/i;
const BUTTON_WORDS =
  /(ok|annuler|accepter|refuser|privacy|policy|conditions|mentions)/i;

// Verbes culinaires typiques (pour repérer les vraies étapes)
const COOKING_VERBS =
  /(faites|ajoutez|versez|m[ée]langez|cuire|cuisez|chauffez|pr[ée]chauffez|saisissez|nappez|servez|r[ée]servez|coupez|hachez|po[êe]lez|dorez|fouettez|incorporez|d[ée]posez|m[ée]langer|r[ée]chauffer|r[ée]cup[ée]rer|retirer|mettre|mettez|pressez|bouillir|faire bouillir|laisser|laissez|mariner|marine[rz]?|rincer|rincez|griller|grillez|[ée]goutter|[ée]gouttez|egoutter|egouttez)/i;

// Indices d’ingrédients (quantité + unité / aliment)
const ING_HINT =
  /(\d+\s*(g|kg|mg|ml|cl|l|cuill|cuill[èe]re|pinc[ée]e|tranche|tasses?|tasse|verres?|livres?|livre|lb|c\.?\s*à\s*soupe|c\.?\s*à\s*caf[ée]|pi[eè]ce|oeuf|œuf|noix|graines?|gousses?))/i;

// Mots utiles de structuration
const SECTION_HINTS =
  /(ingr[ée]dients?|instructions?|[ée]tape\s*\d+|astuces?|variantes?)/i;

function isMetaLine(s) {
  return META_LINE_PATTERNS.some((re) => re.test(s));
}

// Score une ligne : positif = intéressant, négatif = parasite
function scoreLine(line) {
  const txt = String(line || '').trim();
  const lower = txt.toLowerCase();

  if (!txt) return -10;

  let score = 0;

  // Lignes de métadonnées de site → on les évacue
  if (isMetaLine(txt)) score -= 6;

  // Parasites forts
  if (HARD_JUNK_PATTERNS.some((re) => re.test(txt))) score -= 8;
  if (URL_REGEX.test(txt) || DOMAIN_REGEX.test(txt)) score -= 5;
  if (BUTTON_WORDS.test(txt)) score -= 4;

  // Grosse bannière en MAJUSCULES + %
  const words = txt.split(/\s+/);
  const upperWords = words.filter(
    (w) =>
      w.length > 2 &&
      w === w.toUpperCase() &&
      /[A-ZÀÂÇÉÈÊËÎÏÔÛÙÜŸ]/.test(w),
  );
  if (upperWords.length >= 3 && /%/.test(txt)) {
    score -= 6;
  }

  // Texte très court ou très long = souvent bruit
  if (txt.length < 4) score -= 1;
  if (txt.length > 260) score -= 1;

  // Lignes “bizarres” (presque pas de voyelles) → poubelle
  const hasVowel = /[aeiouyàâäéèêëîïôöùûüœ]/i.test(txt);
  if (!hasVowel && !/\d/.test(txt) && txt.length <= 12) {
    score -= 5;
  }

  // Mots-clés importants
  if (SECTION_HINTS.test(txt)) score += 5;
  if (COOKING_VERBS.test(lower)) score += 4;
  if (ING_HINT.test(lower)) score += 4;

  // Puces / numérotation
  if (/^[\s•\-·\u2022]*\d+[\.\)]/.test(txt)) score += 1;
  if (/^[\s•\-·\u2022]+/.test(txt)) score += 1;

  // Phrase complète
  if (words.length >= 5) score += 1;

  return score;
}

/**
 * Nettoyage très basique du texte OCR :
 * - découpe en lignes
 * - scoring
 * - garde lignes intéressantes + voisines
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
    if (isMetaLine(line)) continue; // on jette les lignes méta
    filtered.push(line);
  }

  return filtered;
}

// ─────────────────────────────────────────────────────────────
// 2) Helpers parsing recette
// ─────────────────────────────────────────────────────────────

function extractServings(lines) {
  for (const l of lines) {
    const m = l.match(/portions?\s*:\s*(\d+)/i);
    if (m) return parseInt(m[1], 10) || 1;
  }
  for (const l of lines) {
    const m = l.match(/(\d+)\s*personnes?/i);
    if (m) return parseInt(m[1], 10) || 1;
  }
  for (const l of lines) {
    const m = l.match(/quantit[ée] obtenue\s*:\s*(\d+)/i);
    if (m) return parseInt(m[1], 10) || 1;
  }
  return 1;
}

// Nettoie une ligne brute (puces, labels 01 / 02, etc.)
function cleanRawTextLine(line) {
  let s = String(line || '').trim();
  if (!s) return '';

  // enlever puces et symboles type ►, ➡, etc.
  s = s.replace(/^[\-–—*•●▶➡➜\s]+/, '');

  // enlever les numéros visuels du site : [01], 01., 02), O2, 02 200 g etc.
  s = s.replace(/^[\[\(]?\s*[O0]?\s*\d{1,2}\s*[\]\).:-]?\s*/i, '');

  // enlever le préfixe OCR "A |", "O |", "I |", "Q "
  s = s.replace(/^[AOIQ]\s*\|\s*/, '');
  s = s.replace(/^[AOIQ]\s+/, '');

  return s.trim();
}

// nettoie une ligne d'ingrédient (puces, "(facultatif)", etc.)
function cleanIngredientLine(line) {
  let l = cleanRawTextLine(line);

  // beaucoup de captures OCR transforment le • en "E ", "O ", "I "
  l = l.replace(/^[EOI]\s+/, '');

  // enlever "(facultatif)"
  l = l.replace(/\(facultatif\)/gi, '').trim();

  // enlever les ":" finaux
  l = l.replace(/:\s*$/, '');

  // enlever "de", "d'", "du", "des" au début
  l = l.replace(/^(de|d’|d'|du|des)\s+/i, '');

  return l.trim();
}

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

function splitLongStepLine(text) {
  const sentences = text.split(/(?<=\.)\s+/g);
  return sentences.filter((s) => s.trim().length > 3);
}

function normalizeStepNumbers(stepParagraphs = []) {
  let n = 1;
  return stepParagraphs.map((txt) => {
    let t = String(txt || '').trim();
    t = t.replace(/^[\s•\-·\u2022]*[ÉE]TAPE\s*n?[°º]?\s*\d+\s*:?\s*/i, '');
    t = t.replace(/^[\s•\-·\u2022]*\d+[\.\)]\s*/, '');
    return `Étape ${n++} ${t.trim()}`;
  });
}

function dedupeSteps(stepList = []) {
  const out = [];

  for (const step of stepList) {
    const body = String(step).replace(/^Étape\s*\d+\s*/i, '').trim();
    const bodyLower = body.toLowerCase();

    let merged = false;

    for (let i = 0; i < out.length; i++) {
      const other = out[i];
      const otherBody = other
        .replace(/^Étape\s*\d+\s*/i, '')
        .trim()
        .toLowerCase();

      const minLen = Math.min(otherBody.length, bodyLower.length);
      if (minLen < 20) continue;

      const prefixLen = Math.min(40, minLen);
      const a = bodyLower.slice(0, prefixLen);
      const b = otherBody.slice(0, prefixLen);

      if (a === b) {
        if (bodyLower.length > otherBody.length + 5) {
          out[i] = step;
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

// Parsing spécifique OCR pour extraire quantité + unité + nom
function parseOcrIngredient(line) {
  let original = String(line || '').trim();
  if (!original) return null;

  let txt = cleanIngredientLine(original);

  // titres / sections -> pas un ingrédient
  if (/^pour la\b/i.test(txt)) return null;
  if (/^(garnitures?|ingr[ée]dients? principaux?)\b/i.test(txt)) return null;

  // si on a un ":" avec une partie gauche qui ressemble à un ingrédient,
  // on coupe après le ":" (cas Pinterest : description après les deux-points)
  if (txt.includes(':')) {
    const parts = txt.split(':');
    if (ING_HINT.test(parts[0])) {
      txt = parts[0].trim();
    }
  }

  // "Parmesan :" etc. -> plutôt titre de section
  if (/:$/.test(txt) && !ING_HINT.test(txt)) {
    return null;
  }

  // 200 g ... / 20 cl ... / 1 L ...
  let m = txt.match(/^(\d+(?:[.,]\d+)?)\s*(g|kg|mg|ml|cl|l)\b\s*(.+)?$/i);
  if (m) {
    const quantity = parseFloat(m[1].replace(',', '.')) || 0;
    const unit = m[2].toLowerCase();
    let name = (m[3] || '').replace(/^de\s+/i, '').trim() || original;
    return { quantity, unit, name };
  }

  // 2 c. à soupe / 1 c. à café ...
  m = txt.match(
    /^(\d+(?:[.,]\d+)?)\s*c\.?\s*à\s*(soupe|caf[ée])\b\s*(.+)?$/i,
  );
  if (m) {
    const quantity = parseFloat(m[1].replace(',', '.')) || 0;
    const unit = m[2].toLowerCase().startsWith('soupe') ? 'cas' : 'cac';
    const name = (m[3] || '').replace(/^de\s+/i, '').trim() || original;
    return { quantity, unit, name };
  }

  // 3 cuillères à soupe / 1 cuillère à café ...
  m = txt.match(
    /^(\d+(?:[.,]\d+)?)\s*(cuill(?:[èe]re)?s?(?:\s+à\s+soupe|\s+a\s+soupe|\s+à\s+caf[ée]|\s+a\s+caf[ée])?)\b\s*(.+)?$/i,
  );
  if (m) {
    const quantity = parseFloat(m[1].replace(',', '.')) || 0;
    const unitRaw = m[2].toLowerCase();
    let unit = 'piece';
    if (unitRaw.includes('soupe')) unit = 'cas';
    else if (unitRaw.includes('caf')) unit = 'cac';

    const name = (m[3] || '').replace(/^de\s+/i, '').trim() || original;
    return { quantity, unit, name };
  }

  // 1 pincée de ...
  m = txt.match(/^(\d+(?:[.,]\d+)?)\s*(pinc[ée]e?s?)\b\s*(.+)?$/i);
  if (m) {
    const quantity = parseFloat(m[1].replace(',', '.')) || 0;
    const unit = 'pincee';
    const name = (m[3] || '').replace(/^de\s+/i, '').trim() || original;
    return { quantity, unit, name };
  }

  // 3 gousses d'ail / 2 œufs / 4 tranches ...
  m = txt.match(
    /^(\d+(?:[.,]\d+)?)\s*(gousses?|oeufs?|œufs?|tranches?|bouch[ée]es?|steaks?)\b\s*(.+)?$/i,
  );
  if (m) {
    const quantity = parseFloat(m[1].replace(',', '.')) || 0;
    const unit = 'piece';
    const nameRest = (m[3] || '').trim();
    const name =
      nameRest || txt.replace(/^\d+(?:[.,]\d+)?\s*/, '').trim() || original;
    return { quantity, unit, name };
  }

  // 2 tasses / 1 tasse / 2 verres ...
  m = txt.match(
    /^(\d+(?:[.,]\d+)?)\s*(tasses?|tasse|verres?)\b\s*(.+)?$/i,
  );
  if (m) {
    const quantity = parseFloat(m[1].replace(',', '.')) || 0;
    const unit = 'tasse';
    const name = (m[3] || '').replace(/^de\s+/i, '').trim() || original;
    return { quantity, unit, name };
  }

  // 1 livre de porc ...
  m = txt.match(/^(\d+(?:[.,]\d+)?)\s*(livres?|lb)\b\s*(.+)?$/i);
  if (m) {
    const quantity = parseFloat(m[1].replace(',', '.')) || 0;
    const unit = 'livre';
    const name = (m[3] || '').replace(/^de\s+/i, '').trim() || original;
    return { quantity, unit, name };
  }

  // Exemple : "12 graines de sésame"
  m = txt.match(/^(\d+(?:[.,]\d+)?)\s*(graines?)\b\s*(.+)?$/i);
  if (m) {
    const quantity = parseFloat(m[1].replace(',', '.')) || 0;
    const unit = 'piece';
    const name = `${m[2]} ${m[3] || ''}`.trim();
    return { quantity, unit, name };
  }

  return null;
}

// Beautifier + dédoublonnage des ingrédients
function beautifyIngredients(list = []) {
  const cleaned = list.map((ing) => {
    let name = String(ing.name || '').trim();
    let unit = ing.unit || '';

    // enlever prépositions en début : de / d' / d’ / du / des
    name = name.replace(/^(de|d’|d'|du|des)\s+/i, '');

    // Cas spécifique : d'ail + piece -> Gousses d'ail hachées
    if (/^d[’']ail/i.test(name) && unit === 'piece' && (ing.quantity || 0) >= 1) {
      name = "Gousses d'ail hachées";
    }

    // enlever les "Cuillères à soupe de ..." dans le nom (s'il en reste)
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
      unit: unit || 'g',
    };
  });

  // Dé-doublonner : même nom + même unité → on garde la meilleure ligne
  const byKey = new Map();
  for (const ing of cleaned) {
    const key = `${ing.name.toLowerCase()}|${ing.unit}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, ing);
    } else if ((ing.quantity || 0) > (existing.quantity || 0)) {
      byKey.set(key, ing);
    }
  }

  return Array.from(byKey.values());
}

/**
 * Découpe un texte OCR déjà filtré en :
 * - servings
 * - ingredientLines
 * - stepLines (numérotées)
 * - notesLines (infos + astuces)
 */
function splitIngredientsAndSteps(filteredLines) {
  const lines = filteredLines.map(cleanRawTextLine).filter(Boolean);

  const servings = extractServings(lines);
  const metaLines = [];

  let ingredientLines = [];
  let stepLinesRaw = [];
  let tipsLines = [];

  // indices sections "Ingrédients" et "Instructions/Préparation"
  const idxIngr = lines.findIndex((l) => /^ingr[ée]dients?/i.test(l));
  const idxInstr = lines.findIndex(
    (l, idx) =>
      idx > (idxIngr >= 0 ? idxIngr : -1) &&
      (
        /(instructions?|[ée]tapes? de pr[ée]paration)/i.test(l) ||
        /^[\s•\-·\u2022]*[ÉE]TAPE\s*1\b/i.test(l) ||
        /^[\s•\-·\u2022]*\d+[\.\)]\s+/.test(l)
      ),
  );

  // Helper méta (temps, etc.)
  function isMetaLike(line) {
    return (
      isMetaLine(line) ||
      /^pr[ée]paration\s*:/i.test(line) ||
      /^cuisson\s*:/i.test(line) ||
      /^temps\s*total\s*:/i.test(line) ||
      /^temps total\s*:/i.test(line) ||
      /^portions?\s*:/i.test(line) ||
      /^erreurs?\s+à\s+éviter\b/i.test(line)
    );
  }

  // ── 1) Cas “classique” avec section Ingrédients ──
  if (idxIngr >= 0) {
    const end = idxInstr >= 0 ? idxInstr : lines.length;
    for (let i = idxIngr + 1; i < end; i++) {
      let line = lines[i];
      if (!line) continue;

      if (isMetaLike(line)) {
        metaLines.push(line);
        continue;
      }

      // "(facultatif)" → mergé ou ignoré
      if (/\(facultatif\)/i.test(line)) continue;

      // ligne avec "personnes" → meta
      if (/personnes?/i.test(line)) {
        metaLines.push(line);
        continue;
      }

      line = cleanIngredientLine(line);
      if (!line) continue;

      const hasQty = ING_HINT.test(line);
      const hasVerb = COOKING_VERBS.test(line.toLowerCase());

      // lignes type "Mariner quelques minutes." -> plutôt étape
      if (hasVerb && !hasQty) {
        stepLinesRaw.push(line);
        continue;
      }

      const prevIdx = ingredientLines.length - 1;

      if (!hasQty) {
        if (prevIdx >= 0 && ingredientLines[prevIdx].length < 120) {
          ingredientLines[prevIdx] = `${ingredientLines[prevIdx]} ${line}`.trim();
        }
        continue;
      }

      ingredientLines.push(line);
    }

    // Étapes
    if (idxInstr >= 0) {
      let inTips = false;

      for (let i = idxInstr + 1; i < lines.length; i++) {
        let line = lines[i];
        if (!line) continue;

        if (isMetaLike(line)) {
          metaLines.push(line);
          continue;
        }

        const norm = line
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .trim();

        if (/(astuces?|variantes?|conseils?)/i.test(line)) {
          inTips = true;
          tipsLines.push(line);
          continue;
        }
        if (inTips) {
          if (/^etape\s*\d+/.test(norm) || /^ingredients?/.test(norm)) {
            inTips = false;
          } else {
            tipsLines.push(line);
            continue;
          }
        }

        // "Étape n°01" seul → on saute
        if (/^[ée]tape\s*n?[°º]?\s*\d+/i.test(line) && !COOKING_VERBS.test(line)) {
          continue;
        }

        line = line.replace(/^[\s•\-·\u2022]*\d+[\.\)]\s*/, '');
        line = line.replace(/^[\s•\-·\u2022]*[ÉE]TAPE\s*n?[°º]?\s*\d+\s*:?\s*/i, '');
        line = line.trim();
        if (!line) continue;

        stepLinesRaw.push(line);
      }
    }
  }

  // ── 2) FALLBACK : pas de section "Ingrédients" ou aucun ingrédient trouvé ──
  if (!ingredientLines.length) {
    ingredientLines = [];
    stepLinesRaw = [];
    tipsLines = tipsLines || [];
    let inTips = false;

    for (const rawLine of lines) {
      let line = rawLine.trim();
      if (!line) continue;

      if (isMetaLike(line)) {
        metaLines.push(line);
        continue;
      }

      const norm = line
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();

      if (/(astuces?|variantes?|conseils?)/i.test(line)) {
        inTips = true;
        tipsLines.push(line);
        continue;
      }
      if (inTips) {
        if (/^etape\s*\d+/.test(norm) || /^ingredients?/.test(norm)) {
          inTips = false;
        } else {
          tipsLines.push(line);
          continue;
        }
      }

      const hasQty = ING_HINT.test(line);
      const hasVerb =
        COOKING_VERBS.test(line) || /^etape\s*\d+/.test(norm);

      if (/personnes?/i.test(line)) {
        metaLines.push(line);
        continue;
      }

      if (hasQty && !hasVerb) {
        line = cleanIngredientLine(line);
        if (!line) continue;

        const prevIdx = ingredientLines.length - 1;
        if (
          !ING_HINT.test(line) &&
          prevIdx >= 0 &&
          ingredientLines[prevIdx].length < 120
        ) {
          ingredientLines[prevIdx] = `${ingredientLines[prevIdx]} ${line}`.trim();
        } else {
          ingredientLines.push(line);
        }
      } else if (hasVerb || /^etape\s*\d+/.test(norm)) {
        line = line.replace(
          /^[\s•\-·\u2022]*[ÉE]TAPE\s*n?[°º]?\s*\d+\s*:?\s*/i,
          '',
        );
        if (line.trim()) stepLinesRaw.push(line.trim());
      } else {
        stepLinesRaw.push(line);
      }
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

  // Fusion / découpe des étapes
  const mergedSteps = mergeLinesToParagraphs(effectiveStepsRaw);

  const exploded = [];
  for (const step of mergedSteps) {
    if (step.length > 260) {
      const parts = splitLongStepLine(step);
      if (parts.length) exploded.push(...parts);
      else exploded.push(step);
    } else {
      exploded.push(step);
    }
  }

  const normalizedSteps = normalizeStepNumbers(exploded);
  const dedupedSteps = dedupeSteps(normalizedSteps);

  const notesLines = [...metaLines, ...tipsLines];

  return {
    servings,
    ingredientLines: effectiveIngredients,
    stepLines: dedupedSteps,
    notesLines,
  };
}

// ─────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────

module.exports = {
  smartFilterLinesFromText,
  splitIngredientsAndSteps,
  parseOcrIngredient,
  beautifyIngredients,
};





