//backend/src/utils/stringUtils - pour function purement string (norm/strip/diacritics)
// LEVEL: UTIL (core string helpers)
// import autorisés : AUCUN
// import interdits : routes, middleware, services, prisma, autres utils métier
// importé par : tous les utils et services

function normSpaces(s) {
  return String(s || '')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// Normalise pour règles "gratuit" (eau / sel / poivre)
function normalizeKey(s = '') {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // enlève accents
    .replace(/[^a-z0-9\s&]/g, ' ')   // garde lettres/chiffres/espace/&
    .replace(/\s+/g, ' ')
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
  let t = normSpaces(String(s || ''));// ajouter la 29/01
    t = t.replace(/\bpotimarro+on\b/gi, 'POTIMARRON');
    
    // ancienne ligne : return String(s || '')
    //t = t.replace(/\u00A0/g, ' ');
    t = t.replace(/\s*-\n+\s*/g, '-');
    //t = t.replace(/[ \t]+/g, ' ');
    //t = t.trim();
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

function stripEdgeEmojisAndPunct(s) { 
  let t = normSpaces(s);

  // retire emojis/pictos au début/fin (sans toucher au texte au centre)
  // (range large emojis + symboles fréquemment OCR)
  t = t
  .replace(/^[\s·•\-\–—\*\.\,\;\:\(\)\[\]{}"“”'’]+/g, '')
  .replace(/[\s·•\-\–—\*\.\,\;\:\(\)\[\]{}"“”'’]+$/g, '')
  .replace(/^[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]+/gu, '')
  .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]+$/gu, '');

  t = t
  .replace(/^[\s·•\-\–—\*\.\,\;\:\(\)\[\]{}"“”'’]+/g, '')
  .replace(/[\s·•\-\–—\*\.\,\;\:\(\)\[\]{}"“”'’]+$/g, '');
  return normSpaces(t);
}

function cleanTitleCandidate(input) {
  let s = normSpaces(input);

  // 1) nettoyage "bord" large (ponctuation/bullets/quotes)
  s = s
    .replace(/^[\s·•\-\–—\*\.,;:(){}\[\]"“”'’]+/g, '')
    .replace(/[\s·•\-\–—\*\.,;:(){}\[\]"“”'’]+$/g, '');

  // 2) enlève emojis/pictos en bordure (plus agressif mais safe)
  s = stripEdgeEmojisAndPunct(s);

  // 3) retire ponctuation de fin type "!!!", "…", "??"
  s = s.replace(/[.!?…]+$/g, '');

  // 4) re-nettoyage bord (au cas où)
  //s = stripEdgeEmojisAndPunct(s);

  s = normalizeTitleCandidate(s);

  return normSpaces(s);
}

function sanitizePickedTitle(title) {
  let t = normSpaces(title);
  if (!t) return '';

  t = t.replace(/\s*(?:\.\.\.|…)?\s*afficher la suite.*$/i, '');
  t = t.replace(/\s*(?:\.\.\.|…)\s*$/g, '');
  t = t.replace(/\b(temps|portions?|calories)\b\s*$/i, '').trim();//ajoute le 20/01

  return normSpaces(t);
}

module.exports = {
    normSpaces,
    normalizeKey,
    stripDiacritics,
    stripWeird,
    stripBulletPrefix,
    normalizeLoose,
    normalizeTitleCandidate,
    cleanStepPrefix,
    looksLikeTimeInfoLine,
    looksLikeStepNumberedLine,
    stripEdgeEmojisAndPunct,
    cleanTitleCandidate,
    sanitizePickedTitle
}