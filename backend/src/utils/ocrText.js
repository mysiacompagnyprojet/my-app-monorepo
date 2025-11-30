// backend/src/utils/ocrText.js

// Nettoie une ligne brute issue de l’OCR
function cleanOcrLine(raw) {
  if (!raw) return '';
  let s = String(raw);

  // Normalisation basique
  s = s.replace(/[“”]/g, '"').replace(/[’]/g, "'");
  // Supprimer les puces / emojis / tirets en début de ligne
  s = s.replace(/^[•●▶➡➜\-–—*\s]+/u, '');
  // Remplacer les espaces multiples
  s = s.replace(/\s+/g, ' ');
  return s.trim();
}

// Est-ce que cette ligne ressemble à un ingrédient ?
function isProbablyIngredient(line) {
  if (!line) return false;
  if (line.length < 3) return false;

  const txt = line.toLowerCase();

  // Lignes clairement "texte de description" → on les laisse pour les étapes/notes
  const ignoreStarts = [
    'un flan',
    'vous pouvez',
    'le lait peut',
    'faites chauffer',
    'quand le lait est chaud',
    'laissez cuire',
    'laissez le mélange',
  ];
  if (ignoreStarts.some((p) => txt.startsWith(p))) return false;

  const hasNumber = /\d/.test(line);
  const hasUnit = /\b(g|gr|gramme|grammes|kg|ml|cl|l|litre|litres|cs|càs|cuillère|cc|càc|oeuf|œuf|oeufs|œufs|sachet|sachets|pincée|pincées)\b/i
    .test(line);

  // On considère "ingrédient" si chiffre + unité
  return hasNumber && hasUnit;
}

// Sépare toutes les lignes OCR en 2 listes : ingrédients / reste (étapes + notes)
function splitOcrLines(rawLines) {
  const ingredientsLines = [];
  const stepsLines = [];

  for (const raw of rawLines) {
    const line = cleanOcrLine(raw);
    if (!line) continue;

    if (isProbablyIngredient(line)) {
      ingredientsLines.push(line);
    } else {
      stepsLines.push(line);
    }
  }

  return { ingredientsLines, stepsLines };
}

module.exports = {
  cleanOcrLine,
  isProbablyIngredient,
  splitOcrLines,
};
