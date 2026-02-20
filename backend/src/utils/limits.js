// backend/src/utils/limits.js
// LEVEL: UTIL
// import autorisés : NON
// import interdits : NON



/** Mappe 'breakfast'|'lunch'|'snack'|'dinner' -> clé de table */
function resolveField(kind) {
  const k = String(kind || '').toLowerCase();
  if (k === 'breakfast') return 'breakfasts';
  if (k === 'lunch')     return 'lunches';
  if (k === 'snack')     return 'snacks';
  if (k === 'dinner')    return 'dinners';
  // fallback sûr : on ne casse rien et on compte comme un dîner
  return 'dinners';
}

/**
 * Vérifie le quota et incrémente si autorisé.
 * @param {string} userId
 * @param {'breakfast'|'lunch'|'snack'|'dinner'} kind
 * @returns {Promise<{ allowed: boolean, reason?: string, current?: number, cap?: number }>}
 */


/**
 * (Optionnel) Middleware prêt à l'emploi :
 * app.post('/import/url', supabaseAuth, limitGate('dinner'), handler)
 */


