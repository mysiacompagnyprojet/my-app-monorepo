// Type "ligne d'ingrédient" V1
// { name: string; quantity: number; unit: string }
export function mergeIngredients(lines) {
const map = new Map()
for (const l of lines) {
const key = `${l.name.trim().toLowerCase()}|${l.unit}`
const prev = map.get(key)
map.set(key, { name: l.name.trim(), unit: l.unit, quantity: (prev?.quantity || 0) + (l.quantity || 0) })
}
return Array.from(map.values())
}

// Parseur **très simple** V1 d'une ligne brute en {name, quantity, unit}
// Exemples: "300 g spaghetti" → {name: 'spaghetti', quantity: 300, unit: 'g'}
export function parseRawLine(raw) {
if (!raw) return null
const txt = raw.replace(/\s+/g, ' ').trim()
const m = txt.match(/^(\d+([.,]\d+)?)\s*(g|kg|ml|l|pi[eè]ce|pce|cs|cc)?\s*(.*)$/i)
if (m) {
const quantity = parseFloat(m[1].replace(',', '.'))
const unit = (m[3] || '').toLowerCase() || 'piece'
const name = (m[4] || '').trim() || 'ingrédient'
return { name, quantity, unit }
}
// fallback: pas de quantité détectée
return { name: txt, quantity: 1, unit: 'piece' }
}