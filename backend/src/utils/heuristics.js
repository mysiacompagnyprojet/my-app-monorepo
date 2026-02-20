//backend/src/utils/heuristics
// LEVEL: UTIL
// import autorisés : stringUtils-units - constantes neutres
// import interdits : routes-services-middlewares-parsers-utils ocr-supabase-prisma
// importé par textUtils, ingredientUtils, titleUtils, ocrTitle,ocrText,vision

const { normSpaces, looksLikeStepNumberedLine, cleanTitleCandidate } = require('../utils/stringUtils');

function looksLikeStepVerbLine(line) {
 const t = normSpaces(line);
 if (!t) return false;

 return /\b(d[eé]roule|deroule|coupez|couper|lavez|laver|plongez|plonger|égouttez|egouttez|faites|faire|ajoutez|ajouter|mélangez|melangez|versez|verser|remuez|remuer|salez|saler|poivrez|poivrer|assaisonnez|assaisonner|étalez|etalez|étaler|etaler|enfournez|enfourner|retournez|retourner|laissez|laisser|poursuivez|poursuivre|servez|servir|cuisez|cuire|chauffez|chauffer|préchauffez|prechauffez|préparez|preparez|préparer|preparer|montez|monter|disposez|disposer)\b/i.test(t);
}

// ✅ phrases d'action “sans numérotation”
function looksLikeActionSentence(line) {
  const t = normSpaces(line).toLowerCase();
  return /\b(bien\s+mélanger|couvrir|cuire|laisser|retirer|poursuivre|réchauffer|servir|préchauffer|étaler|étalez|etalez|détailler|dorer|déposer|fendre|farci[er]|passer|préparer|preparez|préparez|employer|utiliser|assaisonner)\b/i.test(
    t
  );
}

function looksLikeStepLine(line) {
  return looksLikeStepVerbLine(line) || looksLikeStepNumberedLine(line);
}

function looksLikeStepContinuation(prevLine, line) {
 const prev = normSpaces(prevLine);
 const cur = normSpaces(line);
 if (!prev || !cur) return false;

 const prevT = prev.toLowerCase();
 const curT = cur.toLowerCase();

 // si la ligne d'avant ressemble à une étape, on autorise des continuations
 const prevLooksStep =
   looksLikeStepLine(prev) || looksLikeStepVerbLine(prev) || looksLikeActionSentence(prev);

 if (!prevLooksStep) return false;

 // cas spécifique "de façon ..." -> la suite (ex: "homogène") doit être collée
 if (/\bde\s+façon\b/i.test(prevT)) return true;

 // connecteurs / continuations fréquentes
 if (/^(et|puis|ensuite|afin|pour|de\s+façon|de\s+manière|jusqu['’]à)\b/i.test(curT)) return true;

 // mots qui doivent coller à l'étape précédente
 if (/^homog[èe]ne\b/i.test(curT)) return true;
 if (/^(et\s+)?enfourner\b/i.test(curT)) return true;
 if (/^retourner\b/i.test(curT)) return true;

  // ✅ continuation classique
  if (/^(le|la|les|l['’]|un|une|des|du|de|d['’]|au|aux|et|puis|ensuite|à|a)\b/i.test(cur)) return true;

  // ✅ Facebook: "recouverte..." / "immédiatement." après une étape numérotée
  if (/^[a-zà-öø-ÿ]/.test(cur)) return true;

  return false;
}

// Faux titres UI / réseaux
function isUiTitleBlacklisted(s) {
  const t = cleanTitleCandidate(s).toLowerCase();
  if (!t) return true;

  if (/^toutes?\s+les\s+publications?$/i.test(t)) return true;
  if (/^enregistr[ée]$/i.test(t)) return true;

  if (/^recettes?\s+d[ée]lice$/i.test(t)) return true;
  if (/^recettes?\s+et\s+d[ée]lices?$/i.test(t)) return true;

  if (/^publication\s+de\b/i.test(t)) return true;

  return false;
}

// Très important : rejeter les “sel & poivre”, “un peu de sel”, etc.
function isAssaisonnementOnly(s) {
  const t = cleanTitleCandidate(s).toLowerCase();
  if (!t) return true;

  if (t === 'sel & poivre' || t === 'sel et poivre') return true;
  if (t === 'salez et poivrez') return true;
  if (t === 'un peu de sel') return true;

  return false;
}

// Ressemble à une étape (verbe d’action au début)
function looksLikeStepSentence(s) {
  const t = cleanTitleCandidate(s);
  if (!t) return false;
  return /^[-•*]?\s*(égoutter|egoutter|ajouter|mixer|mixez|cuire|faire|préchauffer|prechauffer|préparer|preparer|couper|laver|mettre|verser|chauffer|mélanger|melanger|assaisonner|assaisonnez|enfourner|étaler|etaler)\b/i.test(
    t
  );
}

// Candidat acceptable ?
function isValidRecipeTitleCandidate(s) {
  const t = cleanTitleCandidate(s);
  if (!t) return false;

  // refuse les fragments d'ingrédients qui commencent par "de / d'"
  if (/^(de|d['’])\s+/i.test(t)) return false;

  // refuse les titres coupés : "gratin de", "tarte aux", etc.
  if (/\b(de|d['’]|du|des|à|a|au|aux)\s*$/i.test(t)) return false;

  // longueur réaliste
  if (t.length < 4 || t.length > 90) return false;

  // blacklist UI + assaisonnement + étapes
  if (isUiTitleBlacklisted(t)) return false;
  if (isAssaisonnementOnly(t)) return false;
  if (looksLikeStepSentence(t)) return false;

  // évite les phrases (ponctuation de phrase)
  if (/[.!?…]/.test(t)) return false;

  // évite “Ingrédients”, “Préparation”, etc.
  if (/^ingr[ée]dients?\b/i.test(t)) return false;
  if (/^pr[ée]paration\b/i.test(t)) return false;
  if (/^temps\s+de\s+(préparation|cuisson)\b/i.test(t)) return false;

  // ✅ assouplissement :
  // - 2+ mots : OK
  // - 1 mot : OK seulement si c'est "title-like" (commence par une majuscule et assez long)
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return true;

  if (words.length === 1) {
    // ex: "Crevettes", "Tiramisu"
    if (t.length < 6) return false;
    if (!/^[A-ZÀ-ÖØ-Þ]/.test(t)) return false;
    return true;
  }

  return false;
}

module.exports = {
    looksLikeStepVerbLine,
    looksLikeActionSentence,
    looksLikeStepLine,
    looksLikeStepContinuation,
    isValidRecipeTitleCandidate
}    
