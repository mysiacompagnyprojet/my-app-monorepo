//backend/src/utils/textUtils
const { cleanTitleCandidate, sanitizePickedTitle } = require('../utils/titleUtils');
const { normSpaces, cleanStepPrefix } = require('../utils/stringUtils');

function normalizeForDedup(line) {
  return normSpaces(line)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
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

function looksLikeListBullet(line) {
  const t = normSpaces(line);
  return /^[-•*]\s+/.test(t);
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



module.exports = {
    normalizeForDedup,
    normalizeTitleJoinPiece,
    splitStepsFromLines,
    splitStepsFromText,
    looksLikeListBullet,
    looksLikeStepContinuation,
    looksLikeStepVerbLine,
    looksLikeActionSentence,
    looksLikeStepLine,
}