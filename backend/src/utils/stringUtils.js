//backend/src/utils/stringUtils - pour function purement string (norm/strip/diacritics)

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

function cleanStepPrefix(s) {
      return String(s || '')
        .replace(/^[\s•·\u2022\-*]+/g, '')
        .replace(/^\d{1,3}\s*$/g, '')
        .replace(/^\d{1,3}\s+(?=[A-ZÀ-ÖØ-Þ])/g, '')
        .replace(/^\d{1,3}\s*[.)\-:]\s*/g, '')
        .trim();
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

function looksLikeStepNumberedLine(line) {
  const t = normSpaces(line);
  if (!t) return false;
  if (/^\s*(étape|step)\s*\d+/i.test(t)) return true;
  if (/^\s*\d{1,2}\s*[\)\.\-:]/.test(t)) return true;
  return false;
}

module.exports = {
    normSpaces,
    stripDiacritics,
    stripWeird,
    stripBulletPrefix,
    normalizeLoose,
    normalizeTitleCandidate,
    cleanStepPrefix,
    looksLikeTimeInfoLine,
    looksLikeStepNumberedLine
}