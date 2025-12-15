// backend/src/utils/ocrText.js

const { tidyName } = require('./ingredients')

/* ─────────────────────────────────────────────────────────────
   0) Helpers texte
───────────────────────────────────────────────────────────── */

function cleanRawTextLine(s) {
  let t = String(s || '').replace(/\r/g, '').trim()
  if (!t) return ''

  t = t.replace(/[•·\u2022]/g, '•')
  t = t.replace(/[—–]/g, '-')
  t = t.replace(/[“”]/g, '"')
  t = t.replace(/[’]/g, "'")

  t = t.replace(/\s+/g, ' ').trim()
  return t
}

function splitToLines(rawText) {
  const t = String(rawText || '').replace(/\r/g, '\n')
  return t
    .split('\n')
    .map(cleanRawTextLine)
    .filter(Boolean)
}

function normalizeForCompare(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9à-öø-ÿ\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function hasTooManySymbols(line) {
  const t = String(line || '')
  const letters = (t.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g) || []).length
  const symbols = (t.match(/[^A-Za-zÀ-ÖØ-öø-ÿ0-9\s]/g) || []).length
  return letters > 0 ? symbols / letters > 1.2 : symbols >= 6
}

function looksLikeUrlOrHandle(line) {
  const t = String(line || '').trim()
  if (!t) return false
  if (/https?:\/\//i.test(t)) return true
  if (/\bwww\./i.test(t)) return true
  if (/\b(bit\.ly|t\.co|linktr\.ee)\b/i.test(t)) return true
  if (/^@\w+/i.test(t)) return true
  if (/\s@\w+/i.test(t)) return true
  if (/#[\w-]+/.test(t)) return true
  return false
}

function looksLikeMarketingStory(line) {
  const t = String(line || '').toLowerCase()
  return /(vos papilles|pur délice|pur delice|réconfortant|reconfortant|délicieux|delicieux|parfumée|parfumee|contre toute attente|vous allez|on adore|incroyable|gourmand|ultra|testez|à tomber)/i.test(
    t
  )
}

function looksLikeUiNoise(line) {
  const t = String(line || '').toLowerCase()
  if (!t) return true
  if (t.length <= 1) return true
  if (/^\d{1,3}%$/.test(t)) return true

  if (
    /\b(partager|envoyer|enregistrer|enregistré|commentaires?|j'aime|like|suivre|s'abonner|abonne|abonne-toi|follow|subscribe|voir plus|lire la suite|plus d'infos|publicit|sponsor|promoted|shop|acheter|buy now|add to cart)\b/i.test(
      t
    )
  ) {
    return true
  }

  if (/\b(pinterest|instagram|tiktok|facebook|youtube)\b/i.test(t)) return true
  if (/\b(recette de|par\s+@|by\s+@|créé par|creator|créatrice)\b/i.test(t)) return true

  // Option B: on considère les phrases "marketing/story" comme bruit (=> trash)
  if (looksLikeMarketingStory(t)) return true

  if (hasTooManySymbols(t)) return true
  if (looksLikeUrlOrHandle(t)) return true

  return false
}

/* ─────────────────────────────────────────────────────────────
   0b) Extraction lignes depuis Vision (géométrie + detectedBreak)
   => énorme upgrade contre les "pavés" collés
───────────────────────────────────────────────────────────── */

function extractLinesFromVisionAnnotation(fullTextAnnotation) {
  // On reconstruit des lignes "comme l'utilisateur les voit"
  // en utilisant detectedBreak (SPACE / LINE_BREAK / EOL_SURE_SPACE ...)
  const doc = fullTextAnnotation
  if (!doc || !Array.isArray(doc.pages)) return []

  const lines = []
  let cur = ''

  function flush() {
    const t = cleanRawTextLine(cur)
    if (t) lines.push(t)
    cur = ''
  }

  for (const page of doc.pages) {
    if (!page?.blocks) continue
    for (const block of page.blocks) {
      if (!block?.paragraphs) continue
      for (const para of block.paragraphs) {
        if (!para?.words) continue
        for (const word of para.words) {
          if (!word?.symbols) continue
          for (const sym of word.symbols) {
            const ch = sym?.text || ''
            cur += ch

            const br = sym?.property?.detectedBreak?.type || ''
            // Vision renvoie souvent: SPACE / SURE_SPACE / EOL_SURE_SPACE / LINE_BREAK
            if (br === 'SPACE' || br === 'SURE_SPACE') cur += ' '
            if (br === 'EOL_SURE_SPACE') {
              cur += ' '
              flush()
            }
            if (br === 'LINE_BREAK') {
              flush()
            }
          }
          // si le mot n’a pas mis d’espace via detectedBreak, on assure un espace minimal
          if (!/\s$/.test(cur)) cur += ' '
        }
        flush()
      }
      // séparation douce entre blocks
      flush()
    }
    // séparation douce entre pages
    flush()
  }

  // dédoublonne simple
  const seen = new Set()
  const out = []
  for (const l of lines) {
    const k = l.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(l)
  }
  return out
}

/* ─────────────────────────────────────────────────────────────
   1) Filtrage langue (hook Accept-Language)
───────────────────────────────────────────────────────────── */

function looksEnglish(line) {
  const t = String(line || '').toLowerCase()
  const hits = [
    'the ',
    ' and ',
    ' with ',
    ' minutes',
    ' cups',
    ' tbsp',
    ' tsp',
    ' oven',
    ' heat',
    ' stir',
    ' bake',
    ' preheat',
  ].reduce((acc, w) => (t.includes(w) ? acc + 1 : acc), 0)
  return hits >= 2
}

function looksFrench(line) {
  const t = String(line || '').toLowerCase()
  if (/[àâäçéèêëîïôöùûüœ]/i.test(t)) return true
  const hits = [
    'préparation',
    'cuisson',
    'ingrédients',
    'minutes',
    'four',
    'mélanger',
    'ajouter',
    'faire',
    'dans',
    'avec',
  ].reduce((acc, w) => (t.includes(w) ? acc + 1 : acc), 0)
  return hits >= 1
}

function filterByLanguage(line, lang) {
  if (!lang) return true
  if (lang === 'fr') return !(looksEnglish(line) && !looksFrench(line))
  if (lang === 'en') return !(looksFrench(line) && !looksEnglish(line))
  return true
}

/* ─────────────────────────────────────────────────────────────
   2) Filtrage intelligent + corbeille (trash)
───────────────────────────────────────────────────────────── */

function _smartFilterCore(inputLines, opts = {}) {
  const lang = opts.lang || 'fr'

  const kept = []
  const trash = []

  for (const l of inputLines || []) {
    const line = cleanRawTextLine(l)
    if (!line) continue

    if (!filterByLanguage(line, lang)) {
      trash.push(line)
      continue
    }

    if (looksLikeUiNoise(line)) {
      trash.push(line)
      continue
    }

    kept.push(line)
  }

  const seen = new Set()
  const uniq = []
  for (const l of kept) {
    const k = l.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    uniq.push(l)
  }

  return { lines: uniq, trash }
}

function smartFilterWithTrashFromLines(lines, opts = {}) {
  return _smartFilterCore(lines, opts)
}

function smartFilterWithTrashFromText(rawText, opts = {}) {
  const lines = splitToLines(rawText)
  return _smartFilterCore(lines, opts)
}

function smartFilterLinesFromText(rawText) {
  return smartFilterWithTrashFromText(rawText, { lang: 'fr' }).lines
}

/* ─────────────────────────────────────────────────────────────
   3) Détection sections / steps / ingrédients
───────────────────────────────────────────────────────────── */

function isMetaLine(line) {
  const t = String(line || '').toLowerCase()
  if (!t) return true
  if (/^\s*(\d+\s*(kcal|cal)|kcal)\b/.test(t)) return true
  if (/\b(difficulté|difficulty|coût|budget)\b/i.test(t)) return true
  return false
}

function isSectionHeader(line) {
  const t = String(line || '').trim()
  return /:\s*$/.test(t) && t.length <= 60
}

function stripLeadingNonLetters(s) {
  return String(s || '').replace(/^[^A-Za-zÀ-ÖØ-öø-ÿ]+/g, '').trim()
}

function looksLikeStep(line) {
  const t = String(line || '').trim()
  if (!t) return false
  if (/^\s*[•\-]\s+/.test(t)) return true
  if (/^\s*\d+\s*[\.\)\-]\s+/.test(t)) return true

  if (
    /\b(préchauffer|mélanger|ajouter|cuire|faire|verser|remuer|mettre|incorporer|chauffer|laisser|émincer|laver|râper|couper|saisir|dorer|dégla(c|ç)er)\b/i.test(
      t
    ) &&
    t.length > 18
  ) {
    return true
  }

  return false
}

function cleanIngredientLine(line) {
  let t = String(line || '').trim()
  if (!t) return ''
  t = t.replace(/^[\s•\-·\u2022]*\d+[\.\)\-]\s*/g, '')
  t = t.replace(/^[\s•\-·\u2022]+/g, '')
  return t.trim()
}

/* ─────────────────────────────────────────────────────────────
   3b) Détection durées / feu / intros
───────────────────────────────────────────────────────────── */

function isDurationOnly(line) {
  const t = String(line || '').trim().toLowerCase()
  if (/^\d+\s*(min|mins|minute|minutes)\b/.test(t)) return true
  if (/^\d+\s*(h|heure|heures)\b/.test(t)) return true
  if (/^\d+\s*h\s*\d+\b/.test(t)) return true
  if (/^\d+h\d+\b/.test(t)) return true
  return false
}

function isFireOnlyOrFireLine(line) {
  const t = String(line || '').trim().toLowerCase()
  return /\b(feu|feux)\b/.test(t) && /(doux|moyen|vif|fort|faible)/.test(t)
}

function isStoryIntro(line) {
  const t = String(line || '').trim().toLowerCase()
  if (!t) return false
  if (
    /(ça faisait|j'avais envie|vos papilles|un pur délice|pur delice|délicieux|delicieux|réconfortant|reconfortant|parfumée|parfumee|contre toute attente|vous allez|on adore)/i.test(
      t
    )
  ) {
    const hasCookVerb =
      /\b(préchauffer|mélanger|ajouter|cuire|verser|mettre|incorporer|chauffer|laisser|émincer|laver|râper|couper|saisir|dorer|dégla(c|ç)er)\b/i.test(
        t
      )
    if (!hasCookVerb) return true
  }
  return false
}

/* ─────────────────────────────────────────────────────────────
   4) Split ingrédients / étapes / notes
───────────────────────────────────────────────────────────── */

function extractServingsFromLines(lines) {
  for (const l of lines) {
    const t = String(l || '').toLowerCase()
    let m = t.match(/\b(\d+)\s*(personnes|parts|portions?)\b/i)
    if (m) return parseInt(m[1], 10)
    m = t.match(/\bpour\s*(\d+)\s*(?:a|à|\-)\s*(\d+)\b/i)
    if (m) return Math.max(parseInt(m[1], 10), parseInt(m[2], 10))
  }
  return null
}

function splitIngredientsAndSteps(filteredLines) {
  const cleanedLines = filteredLines.map(cleanRawTextLine).filter(Boolean)

  const servings =
    extractServingsFromLines(filteredLines) ||
    extractServingsFromLines(cleanedLines) ||
    1

  const ingredientLines = []
  const stepLines = []
  const notesLines = []

  let section = null

  for (const line of cleanedLines) {
    const lower = line.toLowerCase()
    const headerProbe = stripLeadingNonLetters(line).toLowerCase()

    if (isMetaLine(line)) continue

    // headers (avec emoji possible)
    if (/^ingr[ée]dients?\b/.test(headerProbe) || /^ingredients\b/.test(headerProbe)) {
      section = 'ingredients'
      continue
    }
    if (
      /^(pr[ée]paration|preparation)\b/.test(headerProbe) ||
      /^instructions?\b/.test(headerProbe) ||
      /^méthode\b/.test(headerProbe)
    ) {
      section = 'steps'
      continue
    }

    // dans STEPS : durée seule / feu = continuation → stepLines
    if (section === 'steps') {
      const s = String(line || '').trim()
      if (!s) continue
      if (isStoryIntro(s)) {
        continue
      }
      if (isDurationOnly(s) || isFireOnlyOrFireLine(s)) {
        stepLines.push(s)
        continue
      }
      stepLines.push(s)
      continue
    }

    // durées / feu hors steps → notes (temps total)
    if (isDurationOnly(line) || isFireOnlyOrFireLine(line)) {
      notesLines.push(line)
      continue
    }

    // notes typiques (conservation/astuces/temps/etc.)
    if (/\b(temps|cuisson|préparation|preparation|repos|conservation|astuces?|conseils?)\b/i.test(lower)) {
      section = 'notes'
      notesLines.push(line)
      continue
    }

    if (isSectionHeader(line)) {
      notesLines.push(line)
      continue
    }

    if (section === 'ingredients') {
      // meta personnes → ignore (servings déjà extrait)
      if (/\b(personnes|parts|portions?)\b/i.test(line)) continue

      const ing = cleanIngredientLine(line)
      if (ing) ingredientLines.push(ing)
      continue
    }

    if (section === 'notes') {
      if (
        /(\d|\bg\b|\bkg\b|\bml\b|\bcl\b|\bdl\b|\bl\b|cuill|càs|càc|pincée|tranches?|sachet|poignée|verre|gousse|cm|portions?)/i.test(
          line
        ) &&
        !isDurationOnly(line) &&
        !/\b(personnes|parts)\b/i.test(line)
      ) {
        ingredientLines.push(cleanIngredientLine(line))
      } else if (/\b(temps|cuisson|préparation|preparation|repos|conservation|astuces?|conseils?)\b/i.test(lower) || isDurationOnly(line)) {
        notesLines.push(line)
      } else {
        // on jette le reste (intro / blabla)
      }
      continue
    }

    // hors section : heuristiques
    if (isStoryIntro(line)) {
      continue
    }

    if (looksLikeStep(line)) {
      stepLines.push(line)
      continue
    }

    if (
      /(\d|\bg\b|\bkg\b|\bml\b|\bcl\b|\bdl\b|\bl\b|cuill|càs|càc|pincée|tranches?|sachet|poignée|verre|gousse|cm|portions?)/i.test(
        line
      ) &&
      !/\b(personnes|parts)\b/i.test(line) &&
      !isDurationOnly(line)
    ) {
      ingredientLines.push(cleanIngredientLine(line))
      continue
    }

    // sinon : on ignore (Option B)
  }

  return { servings, ingredientLines, stepLines, notesLines }
}

/* ─────────────────────────────────────────────────────────────
   5) Ingrédients OCR (quantités FR + unités)
───────────────────────────────────────────────────────────── */

function parseQuantity(q) {
  if (q == null) return undefined
  if (typeof q === 'number') return Number.isFinite(q) ? q : undefined

  let str = String(q).trim().replace(',', '.')

  const mix = str.match(/^(\d+)\s+(\d+)\/(\d+)$/)
  if (mix) return parseInt(mix[1], 10) + parseInt(mix[2], 10) / parseInt(mix[3], 10)

  const frac = str.match(/^(\d+)\/(\d+)$/)
  if (frac) return parseInt(frac[1], 10) / parseInt(frac[2], 10)

  const num = Number(str)
  return Number.isFinite(num) ? num : undefined
}

function normalizeUnit(uRaw) {
  const u = String(uRaw || '').toLowerCase().trim()
  if (!u) return ''

  const t = u
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .replace(/à/g, 'a')
    .replace(/é|è|ê/g, 'e')
    .trim()

  if (['g', 'gr', 'gramme', 'grammes'].includes(t)) return 'g'
  if (['kg', 'kilo', 'kilos'].includes(t)) return 'kg'
  if (['ml'].includes(t)) return 'ml'
  if (['cl'].includes(t)) return 'cl'
  if (['dl'].includes(t)) return 'dl'
  if (['l', 'litre', 'litres'].includes(t)) return 'l'

  // On évite l'unité "Unité" qui pollue l'affichage
  if (['unite', 'unites', 'unité', 'unités', 'piece', 'pieces', 'pièce', 'pièces'].includes(t)) return ''

  if (['gousse', 'gousses', 'cm', 'portion', 'portions'].includes(t)) return t

  if (['cas', 'cs', 'c a s', 'càs', 'cuillere a soupe', 'cuillere a soupes'].includes(t)) return 'càs'
  if (['cac', 'cc', 'c a c', 'càc', 'cuillere a cafe', 'cuillere a café'].includes(t)) return 'càc'

  return uRaw
}

function isLikelyIngredientNoun(word) {
  const t = String(word || '').toLowerCase().trim()
  return ['oignons', 'tomates', 'carottes', 'citrons', 'citron'].includes(t)
}

function isAdjectiveOnly(word) {
  const t = String(word || '').toLowerCase().trim()
  return ['nouveau', 'nouveaux', 'nouvelle', 'nouvelles', 'frais', 'fraiche', 'fraîche', 'fraîches', 'fraiches'].includes(t)
}

function normalizeWeirdAdjUnit(name, unit) {
  const n = String(name || '').trim()
  const u = String(unit || '').trim()
  if (!n || !u) return { name: n, unit: u }
  if (isAdjectiveOnly(n) && isLikelyIngredientNoun(u)) return { name: `${u} ${n}`.trim(), unit: '' }
  return { name: n, unit: u }
}

function parseOcrIngredient(line) {
  const raw = String(line || '').trim()
  if (!raw) return null

  const t0 = cleanIngredientLine(raw)

  let m = t0.match(/^(\d+)\s*(kg|g|l|ml|cl|dl)\s*(\d+)\s+(.+)$/i)
  if (m) {
    const q = parseQuantity(`${m[1]}.${m[3]}`)
    return { name: tidyName(m[4]), quantity: Number.isFinite(q) ? q : 0, unit: normalizeUnit(m[2]) }
  }

  m = t0.match(/^((?:\d+\s+\d+\/\d+)|(?:\d+\/\d+)|(?:\d+(?:[.,]\d+)?))\s*(?:([a-zA-Zéèêàâîïôöùûüœ.\s]+?)\s+)?(.+)$/)
  if (!m) return { name: tidyName(t0), quantity: 0, unit: '' }

  const qtyRaw = m[1]
  let unitRaw = (m[2] || '').trim()
  let nameRaw = (m[3] || '').trim()

  if (/^(de|d')\b/i.test(unitRaw)) {
    nameRaw = `${unitRaw} ${nameRaw}`.trim()
    unitRaw = ''
  }

  unitRaw = unitRaw
    .replace(/\b(cuillere|cuillère)s?\s*a\s*soupe\b/i, 'càs')
    .replace(/\b(cuillere|cuillère)s?\s*a\s*cafe\b/i, 'càc')
    .replace(/\bcuill?\.?\s*à\s*soupe\b/i, 'càs')
    .replace(/\bcuill?\.?\s*à\s*caf[eé]\b/i, 'càc')
    .trim()

  const q = parseQuantity(qtyRaw)
  const unit = normalizeUnit(unitRaw)
  let name = tidyName(nameRaw)

  const fixed = normalizeWeirdAdjUnit(name, unit)
  name = fixed.name

  return {
    name: name || tidyName(t0.replace(qtyRaw, '').replace(unitRaw, '').trim()),
    quantity: Number.isFinite(q) ? q : 0,
    unit: fixed.unit || '',
  }
}

function beautifyIngredients(list = []) {
  const out = []
  const seen = new Map()

  for (const item of list) {
    if (!item) continue
    const name = tidyName(item.name || '')
    if (!name) continue

    const unit = String(item.unit || '').trim()
    const qty = Number(item.quantity || 0)
    const key = `${name.toLowerCase()}|${unit.toLowerCase()}`

    if (seen.has(key)) {
      const idx = seen.get(key)
      if (qty > 0 && Number.isFinite(qty)) out[idx].quantity = Number(out[idx].quantity || 0) + qty
      continue
    }

    out.push({ name, quantity: Number.isFinite(qty) ? qty : 0, unit })
    seen.set(key, out.length - 1)
  }

  return out
}

/* ─────────────────────────────────────────────────────────────
   6) Title / Notes / Steps
───────────────────────────────────────────────────────────── */

function cleanTitleCandidate(line) {
  let t = String(line || '').trim()
  if (!t) return ''

  t = t.replace(/^\s*@[\w.-]+\s*/g, '').trim()
  t = t.replace(/\s*#[\w-]+/g, '').trim()
  t = t.replace(/[\u{1F300}-\u{1FAFF}]+/gu, '').trim()

  // retire pseudo collé en 1er mot minuscule: "jemangequoicesoir TITRE..."
  const m = t.match(/^([a-z0-9_]{3,})\s+(.+)$/)
  if (m) {
    const first = m[1]
    const rest = m[2]
    const firstLooksHandle = /^[a-z0-9_]+$/.test(first) && first.length >= 6
    const restLooksTitle = rest.length >= 6 && (/[A-ZÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ]/.test(rest) || /[àâäçéèêëîïôöùûüœ]/i.test(rest))
    if (firstLooksHandle && restLooksTitle) t = rest.trim()
  }

  return t
}

function isTitleContinuation(line) {
  const t = cleanTitleCandidate(line)
  if (!t) return false
  const lower = stripLeadingNonLetters(t).toLowerCase()

  if (/^(ingr[ée]dients?|ingredients|pr[ée]paration|preparation|instructions?)\b/.test(lower)) return false
  if (looksLikeStep(t)) return false
  if (/(^\d|(\bg\b|\bkg\b|\bml\b|\bcl\b|cuill|càs|càc))/.test(lower)) return false
  if (t.length < 3 || t.length > 80) return false

  const letters = (t.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g) || []).length
  const uppers = (t.match(/[A-ZÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ]/g) || []).length
  if (letters >= 6 && uppers / Math.max(letters, 1) >= 0.55) return true

  return false
}

function guessTitleFromLines(lines = []) {
  const max = Math.min(lines.length, 40)

  for (let i = 0; i < max; i++) {
    let t = String(lines[i] || '').trim()
    if (!t) continue

    const probe = stripLeadingNonLetters(t).toLowerCase()
    if (/^(ingr[ée]dients?|ingredients|pr[ée]paration|preparation|instructions?)\b/.test(probe)) continue
    if (looksLikeStep(t)) continue
    if (/(^\d|(\bg\b|\bkg\b|\bml\b|\bcl\b|cuill|càs|càc))/.test(probe)) continue
    if (t.length < 5 || t.length > 120) continue

    t = cleanTitleCandidate(t)
    if (t.length < 5 || t.length > 120) continue
    if (isStoryIntro(t)) continue

    const parts = [t]
    if (i + 1 < max && isTitleContinuation(lines[i + 1])) parts.push(cleanTitleCandidate(lines[i + 1]))
    if (i + 2 < max && parts.length === 2 && isTitleContinuation(lines[i + 2])) parts.push(cleanTitleCandidate(lines[i + 2]))

    const joined = parts.join(' ').replace(/\s+/g, ' ').trim()
    if (joined.length >= 5 && joined.length <= 140) return joined

    return t
  }

  return ''
}

function extractNotesFromLines(lines = [], opts = {}) {
  const title = String(opts.title || '').trim()
  const nt = normalizeForCompare(title)

  const cleaned = lines
    .map(cleanRawTextLine)
    .filter(Boolean)
    .filter((l) => !looksLikeUiNoise(l))
    .map(cleanTitleCandidate)
    .filter(Boolean)

  const out = []
  const seen = new Set()

  for (const l of cleaned) {
    const low = l.toLowerCase()

    if (/\b(\d+)\s*(personnes|parts|portions?)\b/i.test(l)) continue

    if (nt) {
      const nl = normalizeForCompare(l)
      if (nl === nt) continue
      if (nl.includes(nt) && nt.length >= 10) continue
    }

    const isAllowed =
      isDurationOnly(l) ||
      /\b(temps|cuisson|préparation|preparation|repos|conservation|astuces?|conseils?)\b/i.test(low)

    if (!isAllowed) continue

    const k = normalizeForCompare(l)
    if (!k) continue
    if (seen.has(k)) continue
    seen.add(k)

    out.push(l)
  }

  return out.join('\n').trim()
}

function splitStepLineAggressive(line) {
  let t = String(line || '').trim()
  if (!t) return []

  t = t.replace(/^[\s•\-·\u2022]+/g, '')

  // ⚠️ upgrade : on force des coupures sur numérotation "1 -", "2)", "3."
  t = t.replace(/(\b\d+\s*[\)\.\-]\s+)/g, '\n$1')

  // ⚠️ upgrade : si pavé, on coupe après ponctuation
  t = t.replace(/([.!?…])\s+(?=[A-ZÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ])/g, '$1\n')

  const parts = t
    .split(/\s*(?:\n|\r|\t)\s*/g)
    .flatMap((x) => x.split(/\s*•\s*/g))
    .flatMap((x) => x.split(/\s*(?:;\s+)\s*/g))

  return parts.map((p) => p.trim()).filter(Boolean)
}

function isContinuationStep(s) {
  const t = String(s || '').trim()
  const lower = t.toLowerCase()
  if (!t) return false

  if (/^(à|au|aux|puis|et|afin|pour|avec|sans)\b/i.test(lower)) return true

  if (t.length <= 28) {
    if (isDurationOnly(t)) return true
    if (isFireOnlyOrFireLine(t)) return true
    if (/^(à l'aide|a l'aide|à l’|a l’)/i.test(t)) return true
  }

  if (/^[a-zàâäçéèêëîïôöùûüœ]/.test(t)) return true
  if (isDurationOnly(t)) return true
  if (isFireOnlyOrFireLine(t)) return true

  return false
}

function normalizeStepsFromLines(stepLines = []) {
  const rawSteps = []

  for (const raw of stepLines) {
    const line = cleanRawTextLine(raw)
    if (!line) continue

    const parts = splitStepLineAggressive(line)

    for (let p of parts) {
      p = p.replace(/^[\s•\-·\u2022]*\d+[\.\)\-]\s*/g, '').trim()
      p = p.replace(/^[\s•\-·\u2022]+/g, '').trim()
      if (!p) continue
      if (p.length < 3) continue
      if (isStoryIntro(p)) continue
      rawSteps.push(p)
    }
  }

  const merged = []
  for (const s of rawSteps) {
    const cur = s.trim()
    if (!cur) continue

    if (!merged.length) {
      merged.push(cur)
      continue
    }

    if (isContinuationStep(cur)) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${cur}`.replace(/\s+/g, ' ').trim()
    } else {
      merged.push(cur)
    }
  }

  const seen = new Set()
  const uniq = []
  for (const s of merged) {
    const k = s.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    uniq.push(s)
  }

  return uniq
}

/* ─────────────────────────────────────────────────────────────
   Exports
───────────────────────────────────────────────────────────── */

module.exports = {
  smartFilterWithTrashFromText,
  smartFilterWithTrashFromLines,
  smartFilterLinesFromText,
  splitIngredientsAndSteps,
  parseOcrIngredient,
  beautifyIngredients,
  guessTitleFromLines,
  looksLikeStep,
  normalizeStepsFromLines,
  extractNotesFromLines,
  extractLinesFromVisionAnnotation,
}





