//backend/src/utils/textUtils

const { normalizeTitleCandidate } = require("./titleUtils");

function normSpaces(s) {
  return String(s || '')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function stripDiacritics(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function stripWeird(s) {
  return String(s || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r/g, '');
}

function stripBulletPrefix(s) {
  return String(s || '')
    .trim()
    .replace(/^[•·⚫●○◦\-\*]+\s*/g, '')
    .trim();
}

function normalizeForDedup(line) {
  return normSpaces(line)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

//ajout du 19/01/26 14h25 =  pour recette 6
function normalizeLoose(s) {
  return String(s || '')
  .replace(/[’]/g, "'")
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim();
}

function normalizeTitleCandidate(s) {
  return String(s || '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function normalizeTitleJoinPiece(s) {
  // Nettoyage léger spécifique "titre"
  let t = cleanTitleCandidate(s);
  t = sanitizePickedTitle(t);

  // remplace les "+" OCR qui servent souvent de séparateur
  t = t.replace(/\s*\+\s*/g, ' ');

  // retire les étoiles/bullets décoratifs en fin (ex: "Cannelle⭑")
  t = t.replace(/[⭑★☆✦✧✨]+$/g, '');

  return normSpaces(t);
}

function cleanStepPrefix(s) {
      return String(s || '')
        .replace(/^[\s•·\u2022\-*]+/g, '')
        .replace(/^\d{1,3}\s*$/g, '')
        .replace(/^\d{1,3}\s+(?=[A-ZÀ-ÖØ-Þ])/g, '')
        .replace(/^\d{1,3}\s*[.)\-:]\s*/g, '')
        .trim();
}

// pour import ocr
function splitStepsFromLines(arr) {
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

// Découpage intelligent d'un gros paragraphe en étapes - pour generic.js
function splitStepsFromText(text) {
  if (!text) return [];

  // Séparer par ". " mais en gardant les phrases complètes
  const rawParts = text
    .split(/(?<=[.!?])\s+(?=[A-ZÉÈÊÎÏÔÛÀÂÇ])/)
    .map((t) => t.trim())
    .filter(Boolean);

  const verbs = [
    'mettre', 'ajouter', 'préchauffer', 'melanger', 'mélanger',
    'verser', 'hacher', 'couper', 'faire revenir', 'faire cuire',
    'cuire', 'assaisonner', 'répartir', 'mixer', 'transvaser',
    'râper', 'déglacer', 'enfourner', 'réserver'
  ];

  const steps = [];

  for (let part of rawParts) {
    const lower = part.toLowerCase();

    // Si la phrase commence clairement par un verbe → nouvelle étape
    const isStepStart = verbs.some((v) => lower.startsWith(v));

    if (isStepStart || steps.length === 0) {
      steps.push(part);
    } else {
      // sinon on fusionne dans l'étape précédente
      steps[steps.length - 1] += ' ' + part;
    }
  }

  return steps;
}


function extractServingsFromLine(line) {
  const t = normSpaces(line).toLowerCase();

  let m = t.match(/ingr[ée]dients?\s+pour\s+(\d+)\s*(personnes|parts|portions)\b/i);
  if (m) return parseInt(m[1], 10);

  m = t.match(/\bpour\s+(\d+)\s*(personnes|parts|portions)\b/i);
  if (m) return parseInt(m[1], 10);

  m = t.match(/\bpour\s+(\d+)\s*(?:-|à|a)\s*(\d+)\s*(personnes|parts|portions)\b/i);
  if (m) return Math.max(parseInt(m[1], 10), parseInt(m[2], 10));

  m = t.match(/\bpour\s+(\d+)\s*personnes?\b.*\bil\b.*\bfaut\b/i);
  if (m) return parseInt(m[1], 10);

  // ✅ Facebook: "Portions : Environ 16 mini croques"
  m = t.match(/\bportions?\s*[:\-–—]?\s*(?:environ\s*)?(\d+)\b/i);
  if (m) return parseInt(m[1], 10);

  return null;
}

function looksLikeTimeInfoLine(line) {
  const t = normSpaces(line).toLowerCase();
  if (!t) return false;

  // Exemples acceptés :
  // "Préparation : 45 min" / "preparation 45 min"
  // "Cuisson : 20 minutes"
  // "Temps de préparation 15 minutes"
  const hasKeyword = /\b(préparation|preparation|cuisson|temps\s+de\s+préparation|temps\s+de\s+cuisson)\b/i.test(t);
  if (!hasKeyword) return false;

  // ✅ PATCH: accepte "minute(s)" en plus de "min"
  const hasDuration = /\b\d+\s*(min|mn|mns|minute|minutes|h|heure|heures)\b/i.test(t);

  return hasDuration;
}

function looksLikeListBullet(line) {
  const t = normSpaces(line);
  return /^[-•*]\s+/.test(t);
}

function looksLikeStepNumberedLine(line) {
  const t = normSpaces(line);
  if (!t) return false;
  if (/^\s*(étape|step)\s*\d+/i.test(t)) return true;
  if (/^\s*\d{1,2}\s*[\)\.\-:]/.test(t)) return true;
  return false;
}

function looksLikeStepContinuation(prevLine, line) {
  const prev = normSpaces(prevLine);
  const cur = normSpaces(line);
  if (!prev || !cur) return false;

  if (!looksLikeStepNumberedLine(prev)) return false;

  // ✅ continuation classique
  if (/^(le|la|les|l['’]|un|une|des|du|de|d['’]|au|aux|et|puis|ensuite|à|a)\b/i.test(cur)) return true;

  // ✅ Facebook: "recouverte..." / "immédiatement." après une étape numérotée
  if (/^[a-zà-öø-ÿ]/.test(cur)) return true;

  return false;
}



module.exports = {
    normSpaces,
    stripDiacritics,
    stripWeird,
    stripBulletPrefix,
    normalizeForDedup,
    normalizeLoose,
    normalizeTitleCandidate,
    normalizeTitleJoinPiece,
    cleanStepPrefix,
    splitStepsFromLines,
    splitStepsFromText,
    extractServingsFromLine,
    looksLikeTimeInfoLine,
    looksLikeListBullet,
    looksLikeStepNumberedLine,
    looksLikeStepContinuation,
}