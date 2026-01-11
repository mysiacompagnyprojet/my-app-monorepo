// backend/src/services/vision.js
'use strict';

const vision = require('@google-cloud/vision');
const sharp = require('sharp');

const {
isValidRecipeTitleCandidate,
cleanTitleCandidate,
} = require('../utils/ocrTitle');

// ---------------------------------------------------------
// ✅ Google credentials (Render / Prod) - robuste
// Priorité :
// 1) GOOGLE_SERVICE_ACCOUNT_B64 (base64 du JSON service account) ✅ recommandé
// 2) GOOGLE_SERVICE_ACCOUNT_JSON (string JSON) ✅ supporté
// 3) GOOGLE_APPLICATION_CREDENTIALS (chemin vers fichier) ✅ supporté (fallback)
// ---------------------------------------------------------

let client = null;

function normSpaces(s) {
return String(s || '')
.replace(/\u00A0/g, ' ')
.replace(/[ \t]+/g, ' ')
.trim();
}

function normalizeServiceAccountObject(obj) {
if (!obj || typeof obj !== 'object') return obj;

// IMPORTANT : private_key peut arriver avec "\\n" -> remettre "\n"
if (typeof obj.private_key === 'string') {
obj.private_key = obj.private_key.replace(/\\n/g, '\n');
}
return obj;
}

function tryParseJsonLoose(raw) {
const s0 = String(raw || '');
const s = s0.trim();
if (!s) return null;

// Cas : JSON direct
if (s.startsWith('{') && s.endsWith('}')) {
try {
return JSON.parse(s);
} catch {
// fallback ci-dessous
}
}

// Cas : JSON entouré de quotes (souvent '...') ou ("...")
if (
(s.startsWith('"') && s.endsWith('"')) ||
(s.startsWith("'") && s.endsWith("'"))
) {
const unquoted = s.slice(1, -1);
try {
return JSON.parse(unquoted);
} catch {
// fallback
}
}

// Fallback : on retire les retours ligne (utile si l'éditeur a injecté des \n réels)
// Ça marche uniquement si le JSON reste valide (les chaînes doivent être bien quotées)
try {
const compact = s.replace(/\r?\n/g, '');
if (compact.startsWith('{') && compact.endsWith('}')) {
return JSON.parse(compact);
}
} catch {
// ignore
}

return null;
}

function decodeBase64ToString(b64) {
// Node >= 16 : Buffer OK
return Buffer.from(String(b64 || '').trim(), 'base64').toString('utf8');
}

function loadServiceAccountFromEnv() {
// 1) Base64 (le plus fiable sur Render)
const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_B64;
if (b64 && String(b64).trim()) {
try {
const jsonStr = decodeBase64ToString(b64);
const obj = JSON.parse(jsonStr);
return normalizeServiceAccountObject(obj);
} catch (e) {
console.error(
'[vision] GOOGLE_SERVICE_ACCOUNT_B64 présent mais invalide :',
e?.message || e
);
return null;
}
}

// 2) JSON string
const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
if (rawJson && String(rawJson).trim()) {
const obj = tryParseJsonLoose(rawJson);
if (!obj) {
console.error(
'[vision] GOOGLE_SERVICE_ACCOUNT_JSON présent mais non parseable (souvent quotes/retours ligne).'
);
return null;
}
return normalizeServiceAccountObject(obj);
}

return null;
}

function getClient() {
if (client) return client;

// ✅ Tentative 1/2 : credentials explicites (B64/JSON) => évite totalement ADC
const sa = loadServiceAccountFromEnv();
if (sa && sa.client_email && sa.private_key) {
client = new vision.ImageAnnotatorClient({
credentials: {
client_email: sa.client_email,
private_key: sa.private_key,
},
projectId: sa.project_id,
});
return client;
}

// ✅ Tentative 2/2 : fallback ADC (Google_APPLICATION_CREDENTIALS, metadata, etc.)
// => Si tu n'as pas fourni de creds via env, ça peut échouer sur Render.
client = new vision.ImageAnnotatorClient();
return client;
}

// Retire emojis/pictos au début/fin + ponctuation “bordure”
function stripEdgeEmojisAndPunct(s) {
let t = normSpaces(s);

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

function cleanTitleLine(s) {
let t = stripEdgeEmojisAndPunct(s);
t = t.replace(/[.!?…]+$/g, '');
return stripEdgeEmojisAndPunct(t);
}

function isUiNoise(l) {
const t = normSpaces(l);
if (!t) return true;

if (/^\s*cuisineactuelle\b/i.test(t)) return true;
if (/^\d{1,2}:\d{2}$/.test(t)) return true;
if (/\b(4g|5g|lte|wifi|wi-fi)\b/i.test(t) && /\b\d{1,3}\b/.test(t))
return true;
if (/^\d{1,3}%$/.test(t)) return true;

// Facebook header
if (/^publication\s+de\b/i.test(t)) return true;

// Instagram / réseaux sociaux : faux "titres" UI
if (/^toutes?\s+les\s+publications?$/i.test(t)) return true;
if (/^enregistr[ée]$/i.test(t)) return true;
if (/^recettes?\s+d[ée]lice$/i.test(t)) return true;
if (/^recettes?\s+et\s+d[ée]lices?$/i.test(t)) return true;

return false;
}

function looksLikeIngredientLine(l) {
const t = normSpaces(l).toLowerCase();
if (!t) return false;

if (
/^\s*(\d+([.,]\d+)?|\d+\s+\d+\/\d+|\d+\/\d+|½|⅓|⅔|¼|¾|⅛|⅜|⅝|⅞)\b/.test(t)
)
return true;
if (/\b\d+\s*(g|kg|mg|ml|cl|dl|l)\b/i.test(t)) return true;

if (/^ingr[ée]dients?\b/i.test(t)) return true;
if (/^temps\s+de\s+(préparation|cuisson)\b/i.test(t)) return true;
if (/^portions?\b/i.test(t)) return true;

return false;
}

function looksLikeStepAction(l) {
const t = normSpaces(l).toLowerCase();
if (!t) return false;
return /\b(ajouter|mixer|égoutter|egoutter|cuire|pr[ée]chauffer|faire|mettre|verser|chauffer|m[ée]langer|melanger|couper|laver|assaisonner|assaisonnez|enfourner|étaler|etaler)\b/i.test(
t
);
}

function tryMergeTwoLineTitle(lines) {
const L = (lines || [])
.map((s) => cleanTitleLine(s))
.filter(Boolean);

for (let i = 0; i < L.length - 1; i++) {
const a = cleanTitleLine(L[i]);
const b = cleanTitleLine(L[i + 1]);
if (!a || !b) continue;

// si la 1ère ligne finit par un connecteur => très souvent titre coupé
if (!/\b(de|d['’]|du|des|à|a|au|aux)\s*$/i.test(a)) continue;

const merged = cleanTitleLine(`${a} ${b}`);

// garde-fous : on refuse si c’est du bruit ou si ça ressemble à une étape/ingrédient
if (merged.length < 6 || merged.length > 90) continue;
if (isUiNoise(merged)) continue;
if (looksLikeStepAction(merged)) continue;
if (looksLikeIngredientLine(merged)) continue;
if (/\d/.test(merged)) continue;

// On exige au moins 3 mots
const w = merged.split(/\s+/).filter(Boolean);
if (w.length < 3) continue;

return merged;
}

return null;
}

function pickLikelyTitleFromText(text) {
const normalizeTitleOut = (s) =>
normSpaces(String(s || '').replace(/\s*\n+\s*/g, ' ')).trim();

const rawLines = String(text || '')
.split('\n')
.map((s) => cleanTitleLine(s))
.filter(Boolean);

// ✅ Titre sur 2 lignes
const merged2 = tryMergeTwoLineTitle(rawLines);
if (merged2) return merged2;

const isMarketing = (s) => {
const t = normSpaces(s).toLowerCase();
return (
t.includes('on raffole') ||
t.includes('vous devez absolument') ||
t.includes('absolument la tester') ||
t.includes('testez') ||
(t.includes('recette de ') &&
(t.includes('on raffole') || t.includes('vous devez')))
);
};

const isShortContinuation = (s) => {
const t = normSpaces(s);
if (!t) return false;
if (t.length > 22) return false;
if (/\d/.test(t)) return false;
const words = t.split(/\s+/).filter(Boolean);
return words.length >= 1 && words.length <= 6;
};

// 0) Pattern “Nouvelle recette : X”
for (let i = 0; i < rawLines.length; i++) {
const l = rawLines[i];
const m = l.match(
/(?:\[\s*)?nouvelle\s+recette(?:\s*\])?\s*[:\-–—]?\s*(.+)$/i
);
if (m && m[1]) {
let cand = cleanTitleLine(m[1]);

const nxt = rawLines[i + 1] || '';
if (nxt && isShortContinuation(nxt) && cand.length + 1 + nxt.length <= 90) {
cand = `${cand} ${nxt}`.trim();
}

if (
cand.length >= 4 &&
cand.length <= 90 &&
!isUiNoise(cand) &&
!looksLikeStepAction(cand) &&
!looksLikeIngredientLine(cand) &&
!isMarketing(cand)
) {
return normalizeTitleOut(cand);
}
}
}

// 1) Pattern “... recette de <X>”
for (let i = 0; i < rawLines.length; i++) {
const l = rawLines[i];
const low = normSpaces(l).toLowerCase();
const idx = low.lastIndexOf('recette de ');
if (idx >= 0) {
let after = normSpaces(l.slice(idx + 'recette de '.length));

const nxt = rawLines[i + 1] || '';
if (nxt && isShortContinuation(nxt) && after.length + 1 + nxt.length <= 90) {
after = `${after} ${nxt}`.trim();
}

after = cleanTitleLine(after);

if (isMarketing(l) || isMarketing(after)) continue;
if (
/\bcuisineactuelle\b/i.test(l) ||
/\bcuisineactuelle\b/i.test(after)
)
continue;

if (
after.length >= 6 &&
after.length <= 90 &&
!isUiNoise(after) &&
!looksLikeStepAction(after) &&
!looksLikeIngredientLine(after)
) {
return normalizeTitleOut(after);
}
}
}

// 1bis) Heuristique "avant ingrédients"
const markerIdx = rawLines.findIndex((x) => {
const t = normSpaces(x).toLowerCase();
return (
/^pour\s+\d+\s+personnes?/.test(t) ||
/^ingr[ée]dients?\b/.test(t) ||
/^in[ée]gr[ée]dients?\b/.test(t)
);
});

if (markerIdx > 0) {
for (let j = markerIdx - 1; j >= 0 && j >= markerIdx - 6; j--) {
const cand = cleanTitleLine(rawLines[j]);
if (!cand) continue;

if (
cand.length >= 6 &&
cand.length <= 90 &&
!isUiNoise(cand) &&
!isMarketing(cand) &&
!looksLikeStepAction(cand) &&
!looksLikeIngredientLine(cand)
) {
return normalizeTitleOut(cand);
}
}
}

// 2) Scoring
let best = null;
let bestScore = -1;

for (let i = 0; i < rawLines.length; i++) {
const base = rawLines[i];
if (!base) continue;
if (isUiNoise(base)) continue;
if (isMarketing(base)) continue;

const candidates = [base];

const nxt = rawLines[i + 1] || '';
if (nxt && isShortContinuation(nxt) && base.length + 1 + nxt.length <= 90) {
candidates.push(`${base} ${nxt}`.trim());
}

for (const raw of candidates) {
const l = cleanTitleLine(raw);
if (!l) continue;

if (l.length < 4 || l.length > 90) continue;
if (/[.!?…]$/.test(l)) continue;
if (looksLikeStepAction(l)) continue;
if (looksLikeIngredientLine(l)) continue;
if (/\d/.test(l)) continue;

const words = l.split(/\s+/).filter(Boolean);
if (words.length < 2) continue;

let score = 0;

if (
/\b(croque|monsieur|ap[ée]ritif|nuggets?|galettes?|cookies?|g[âa]teau|gateau|salade|poulet|tarte|quiche|gratin)\b/i.test(
l
)
)
score += 8;

if (/^[A-ZÀ-ÖØ-Þ]/.test(l)) score += 2;
if (/\bde\b/i.test(l)) score += 1;

score += Math.max(0, 90 - l.length) / 15;

if (score > bestScore) {
bestScore = score;
best = l;
}
}
}

return normalizeTitleOut(best);
}

async function cropTop(buf, ratio = 0.32) {
const img = sharp(buf).rotate();
const meta = await img.metadata();
const w = meta.width || 0;
const h = meta.height || 0;
if (!w || !h) return buf;

const topH = Math.max(1, Math.round(h * ratio));
return await img.extract({ left: 0, top: 0, width: w, height: topH }).toBuffer();
}

async function cropBand(buf, topRatio = 0.30, heightRatio = 0.45) {
const img = sharp(buf).rotate();
const meta = await img.metadata();
const w = meta.width || 0;
const h = meta.height || 0;
if (!w || !h) return buf;

const top = Math.max(0, Math.round(h * topRatio));
const height = Math.max(1, Math.round(h * heightRatio));
const safeHeight = Math.min(height, Math.max(1, h - top));

return await img
.extract({ left: 0, top, width: w, height: safeHeight })
.toBuffer();
}

async function visionDetectTextFromBuffer(buf, lang = 'fr') {
const c = getClient();
const langHints = lang && String(lang).toLowerCase() === 'en' ? ['en'] : ['fr'];

const request = {
image: { content: buf },
imageContext: { languageHints: langHints },
};

const [result] = await c.documentTextDetection(request);

const text =
result?.fullTextAnnotation?.text ||
result?.textAnnotations?.[0]?.description ||
'';

return normSpaces(text);
}

async function ocrFromBuffer(buf, opts = {}) {
const lang = (opts.lang || 'fr').toLowerCase();
return await visionDetectTextFromBuffer(buf, lang);
}

async function ocrFromBufferWithDebug(buf, opts = {}) {
const lang = (opts.lang || 'fr').toLowerCase();

const fullText = await visionDetectTextFromBuffer(buf, lang);

let topText = '';
try {
const topBuf = await cropTop(buf, 0.32);
topText = await visionDetectTextFromBuffer(topBuf, lang);
} catch {
topText = '';
}

let bandText = '';
try {
const bandBuf = await cropBand(buf, 0.30, 0.45);
bandText = await visionDetectTextFromBuffer(bandBuf, lang);
} catch {
bandText = '';
}

const pickedTitleRaw = pickLikelyTitleFromText(`${topText}\n${bandText}`);
const safePicked = pickedTitleRaw ? cleanTitleCandidate(pickedTitleRaw) : null;
const finalPicked =
safePicked && isValidRecipeTitleCandidate(safePicked) ? safePicked : null;

let combined = fullText;
if (finalPicked) {
const already = combined
.toLowerCase()
.includes(String(finalPicked).toLowerCase());
if (!already) combined = `${finalPicked}\n${combined}`;
}

return {
text: combined,
debug: {
pickedTitle: finalPicked || null,
topTextSample: topText ? String(topText).slice(0, 500) : null,
bandTextSample: bandText ? String(bandText).slice(0, 500) : null,
fullTextSample: fullText ? String(fullText).slice(0, 300) : null,
},
};
}

module.exports = {
ocrFromBuffer,
ocrFromBufferWithDebug,
};
