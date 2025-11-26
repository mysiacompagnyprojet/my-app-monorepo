// backend/src/parsers/schaer.js

// Pour Schär, on réutilise le parser générique
// car le JSON-LD est déjà partiellement exploitable.
// On ajuste juste l'image si c'est le logo du site.

const parseGeneric = require('./generic');

module.exports = async function parseSchaer($, url) {
  // Utilise la logique générique (JSON-LD + fallback HTML)
  const draft = await parseGeneric($, url);

  // Si l'image est visiblement un logo, on essaye og:image
  if (draft.imageUrl && /logo\.svg/i.test(draft.imageUrl)) {
    const ogImage = $('meta[property="og:image"]').attr('content')?.trim();
    if (ogImage) {
      draft.imageUrl = ogImage;
    }
  }

  return draft;
};
