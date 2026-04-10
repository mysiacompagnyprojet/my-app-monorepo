// backend/src/routes/import-ocr/titleHelpers.js
// LEVEL: ROUTE
// import autorisés : 
// import interdits : 
// importé uniquement par 

'use strict';

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

function fabricateTitleFromIngredientsRows(ingredientsRows) {
  const stop = new Set(['sel', 'poivre', 'eau', "eau d'orange", "eau d’orange", 'huile', "huile d'olive", "huile d’olive", 'beurre']);

  const rows = Array.isArray(ingredientsRows) ? ingredientsRows : [];

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

  const hasCoco = rows.some((r) => String(r?.name || '').toLowerCase().includes('lait de coco'));
  const hasCrevettes = rows.some((r) => String(r?.name || '').toLowerCase().includes('crevette'));

  if (hasCrevettes && hasCoco) return 'Crevettes au lait de coco';

  const t = best.name.toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}











module.exports = {
   inferTitleFromContent,
   fabricateTitleFromIngredientsRows,
  
};