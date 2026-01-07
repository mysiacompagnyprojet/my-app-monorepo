// frontend/my-app/src/app/recipes/new/page.tsx
'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { apiFetch } from 'src/lib/api'
import type { OcrDraft } from 'src/types/recipe'

type Line = {
name: string
quantity: number
unit: string
quantityRaw?: string

// pricing (vient du backend OCR OU du recalcul)
price?: { eurPer: number; perUnit: string } | null
costEur?: number | null
priceMatched?: boolean
airtableId?: string | null
}

type Draft = {
title?: string
servings?: number
imageUrl?: string | null
notes?: string | null
steps?: string[]
ingredients?: Array<Line | { raw: string } | string>
trash?: string[]
totalCostEur?: number
}

type EnrichIngredientOut = {
name: string
quantity: number
unit: string
costEur?: number
costRecipe?: number
unitPriceBuy?: number | null
airtableId?: string | null
priceMatched?: boolean
note?: string
price?: { eurPer: number; perUnit: string } | null
}

type EnrichResponse =
| { ok: true; ingredients: EnrichIngredientOut[] }
| { ok: false; error: string; message?: string }

/* ──────────────────────────────────────────────────────────────
Helpers quantité : accepte 1/4, 1 1/2, 1,2
────────────────────────────────────────────────────────────── */

function parseQtyInput(raw: string): number {
const s = String(raw || '').trim()
if (!s) return 0

// mix "1 1/2"
const mix = s.match(/^\s*(\d+)\s+(\d+)\s*\/\s*(\d+)\s*$/)
if (mix) {
const a = Number(mix[1])
const b = Number(mix[2])
const c = Number(mix[3])
if (Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && c !== 0) return a + b / c
}

// fraction "1/4"
const frac = s.match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/)
if (frac) {
const a = Number(frac[1])
const b = Number(frac[2])
if (Number.isFinite(a) && Number.isFinite(b) && b !== 0) return a / b
}

// décimal FR "1,2"
const n = Number(s.replace(',', '.'))
return Number.isFinite(n) ? n : 0
}

function formatQtyForInput(n: number, quantityRaw?: string): string {
if (typeof quantityRaw === 'string' && quantityRaw.trim()) return quantityRaw.trim()
if (!Number.isFinite(n)) return ''
if (n === 0) return ''
return String(n)
}

function NewRecipeInner() {
const router = useRouter()
const search = useSearchParams()

// draft OCR (juste pour pré-remplir)
const [draft, setDraft] = useState<OcrDraft | null>(null)

const [title, setTitle] = useState('')
const [servings, setServings] = useState(1)
const [imageUrl, setImageUrl] = useState('')
const [notes, setNotes] = useState('')
const [steps, setSteps] = useState<string[]>([''])
const [ingredients, setIngredients] = useState<Line[]>([{ name: '', quantity: 0, unit: '' }])
const [qtyInputs, setQtyInputs] = useState<string[]>([''])
const [trash, setTrash] = useState<string>('')
const [status, setStatus] = useState<string>('')

const [isRepricing, setIsRepricing] = useState(false)

const prefill = useMemo(() => search.get('prefill') === '1', [search])
const fromOcr = useMemo(() => search.get('from') === 'ocr', [search])

// ✅ total = calculé depuis les ingrédients affichés (pas depuis draft)
const totalCost = useMemo(() => {
return ingredients.reduce((acc, i) => acc + (typeof i.costEur === 'number' ? i.costEur : 0), 0)
}, [ingredients])

useEffect(() => {
if (!fromOcr) return

const raw = sessionStorage.getItem('recipeDraft')
if (!raw) return

try {
const d = JSON.parse(raw) as OcrDraft
setDraft(d)

setTitle(String(d.title || ''))
setServings(Number(d.servings || 1) || 1)
setImageUrl(String(d.imageUrl || ''))
setNotes(String(d.notes || ''))

const s = Array.isArray(d.steps) ? d.steps.map((x) => String(x || '').trim()).filter(Boolean) : []
setSteps(s.length ? s : [''])

const ing = Array.isArray(d.ingredients) ? d.ingredients : []
const normalized = ing
.map((row: any): Line | null => {
if (!row) return null
if (typeof row === 'string') return { name: row, quantity: 0, unit: '' }
if (row.raw) return { name: String(row.raw), quantity: 0, unit: '' }

return {
name: String(row.name || '').trim(),
quantity: Number(row.quantity || 0) || 0,
unit: String(row.unit || ''),
quantityRaw: typeof row.quantityRaw === 'string' ? String(row.quantityRaw).trim() : undefined,

price: row.price ?? null,
costEur: typeof row.costEur === 'number' ? row.costEur : row.costEur ?? null,
priceMatched: typeof row.priceMatched === 'boolean' ? row.priceMatched : undefined,
airtableId: row.airtableId ?? null,
}
})
.filter((x): x is Line => x !== null)

const finalIngredients = normalized.length ? normalized : [{ name: '', quantity: 0, unit: '' }]
setIngredients(finalIngredients)
setQtyInputs(finalIngredients.map((r) => formatQtyForInput(r.quantity, r.quantityRaw)))

const tr = Array.isArray(d.trash) ? d.trash.map((x) => String(x || '').trim()).filter(Boolean) : []
setTrash(tr.join('\n'))
} catch (e) {
console.error('ocrDraft parse error', e)
}

// Important : on nettoie pour éviter de ré-appliquer au refresh
try {
sessionStorage.removeItem('recipeDraft')
} catch {}
}, [fromOcr])

// ✅ ton prefill existant : inchangé
useEffect(() => {
if (!prefill) return

try {
const raw = sessionStorage.getItem('recipeDraft')
if (!raw) return

const d: Draft = JSON.parse(raw)

setTitle(String(d.title || ''))
setServings(Number(d.servings || 1) || 1)
setImageUrl(String(d.imageUrl || ''))
setNotes(String(d.notes || ''))

const s = Array.isArray(d.steps) ? d.steps.map((x) => String(x || '').trim()).filter(Boolean) : []
setSteps(s.length ? s : [''])

const ing = Array.isArray(d.ingredients) ? d.ingredients : []
const normalized = ing
.map((row: any): Line | null => {
if (!row) return null
if (typeof row === 'string') return { name: row, quantity: 0, unit: '' }
if (row.raw) return { name: String(row.raw), quantity: 0, unit: '' }

return {
name: String(row.name || '').trim(),
quantity: Number(row.quantity || 0) || 0,
unit: String(row.unit || ''),
quantityRaw: typeof row.quantityRaw === 'string' ? String(row.quantityRaw).trim() : undefined,

price: row.price ?? null,
costEur: typeof row.costEur === 'number' ? row.costEur : null,
priceMatched: row.priceMatched ?? false,
airtableId: row.airtableId ?? null,
}
})
.filter((x): x is Line => x !== null)

const finalIngredients = normalized.length ? normalized : [{ name: '', quantity: 0, unit: '' }]
setIngredients(finalIngredients)
setQtyInputs(finalIngredients.map((r) => formatQtyForInput(r.quantity, r.quantityRaw)))

const tr = Array.isArray(d.trash) ? d.trash.map((x) => String(x || '').trim()).filter(Boolean) : []
setTrash(tr.join('\n'))
} catch (e) {
console.error('prefill parse error', e)
}
}, [prefill])

function setIngredient(idx: number, patch: Partial<Line>) {
setIngredients((prev) => {
const copy = [...prev]
copy[idx] = { ...copy[idx], ...patch }
return copy
})
}

function setQtyInput(idx: number, raw: string) {
setQtyInputs((prev) => {
const copy = [...prev]
copy[idx] = raw
return copy
})

// on modifie quantité mais on NE recalcul pas automatiquement les prix
setIngredient(idx, { quantity: parseQtyInput(raw), quantityRaw: undefined })
}

async function recalcPrices() {
try {
setIsRepricing(true)
setStatus('⏳ Recalcul des prix…')

// On envoie uniquement les lignes non vides, mais on garde un mapping d’index
const idxs: number[] = []
const list = ingredients
.map((i, idx) => {
const name = String(i.name || '').trim()
if (!name) return null
idxs.push(idx)
return {
name,
quantity: Number(i.quantity || 0) || 0,
unit: String(i.unit || '').trim(),
}
})
.filter(Boolean) as Array<{ name: string; quantity: number; unit: string }>

if (!list.length) {
setStatus('❌ Ajoute au moins un ingrédient avant de recalculer.')
return
}

const payload = { ingredients: list }

// ✅ IMPORTANT: apiFetch renvoie déjà le JSON (ou throw si erreur)
const json = await apiFetch<EnrichResponse>('/recipes/enrich-ingredients', {
method: 'POST',
body: JSON.stringify(payload),
})

if (!json || (json as any).ok !== true) {
const msg = (json as any)?.message || (json as any)?.error || 'Erreur inconnue'
setStatus('❌ Recalcul impossible: ' + msg)
return
}

const enriched = Array.isArray((json as any).ingredients) ? (json as any).ingredients : []
if (!enriched.length) {
setStatus('❌ Recalcul impossible: réponse vide.')
return
}

// Réinjecte dans les bons index, sans perdre les lignes vides
setIngredients((prev) => {
const copy = [...prev]

for (let k = 0; k < enriched.length; k++) {
const idx = idxs[k]
const old = copy[idx]

const e = enriched[k] as any
const cost =
typeof e.costEur === 'number'
? e.costEur
: typeof e.costRecipe === 'number'
? e.costRecipe
: null

copy[idx] = {
...old,
name: String(e.name ?? old?.name ?? ''),
quantity: Number(e.quantity ?? old?.quantity ?? 0) || 0,
unit: String(e.unit ?? old?.unit ?? ''),
// on conserve l’affichage saisi par l’utilisateur (fraction, etc.)
quantityRaw: old?.quantityRaw,
costEur: typeof cost === 'number' ? cost : null,
priceMatched: typeof e.priceMatched === 'boolean' ? e.priceMatched : Boolean(e.airtableId),
airtableId: e.airtableId ?? null,
price: e.price ?? old?.price ?? null,
}
}

return copy
})

setStatus('✅ Prix recalculés')
} catch (e: any) {
setStatus('❌ ' + (e?.message || 'Erreur'))
} finally {
setIsRepricing(false)
}
}

// 🔁 Recalcul automatique après import OCR (après que setIngredients() ait vraiment rempli l'écran)
useEffect(() => {
if (!fromOcr) return
if (isRepricing) return

const hasRealIngredient = ingredients.some((i) => String(i.name || '').trim())
if (!hasRealIngredient) return

// évite un double recalcul en cas de rerender
if (status.startsWith('✅ Prix recalculés')) return

recalcPrices()
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [fromOcr, ingredients])

async function save() {
try {
setStatus('⏳ Enregistrement…')

const payload = {
title: title.trim() || 'Recette',
servings: Number(servings || 1) || 1,
imageUrl: imageUrl.trim() || null,
notes: (notes || '').trim(),
steps: steps.map((s) => String(s || '').trim()).filter(Boolean),
ingredients: ingredients
.map((i) => ({
name: String(i.name || '').trim(),
quantity: Number(i.quantity || 0) || 0,
unit: String(i.unit || '').trim(),
}))
.filter((i) => i.name),
}

// ✅ apiFetch throw si erreur. Sinon on est OK.
await apiFetch('/recipes', {
method: 'POST',
body: JSON.stringify(payload),
})

setStatus('✅ Recette enregistrée')
try {
sessionStorage.removeItem('recipeDraft')
} catch {}
router.push('/recipes')
} catch (e: any) {
setStatus('❌ ' + (e?.message || 'Erreur'))
}
}

const statusKind =
status.startsWith('✅') ? 'success' : status.startsWith('❌') ? 'error' : status ? 'info' : null

return (
<main className="app-container" style={{ margin: '40px auto' }}>
{/* Header */}
<section className="app-card p-6">
<h1 className="text-2xl font-extrabold app-title">Nouvelle recette</h1>
<p className="mt-2 app-muted">Remplis l’essentiel. Tu peux toujours ajuster plus tard.</p>
</section>

{/* Corbeille */}
{trash.trim() && (
<section className="app-card p-5" style={{ marginTop: 16 }}>
<details>
<summary style={{ cursor: 'pointer', fontWeight: 800, color: 'var(--primary)' }}>
🗑️ Corbeille (texte non-recette détecté)
</summary>
<p className="mt-2 text-sm app-muted">
Rien n’est envoyé en base ici : c’est juste pour voir ce qui a été filtré.
</p>
<textarea
value={trash}
onChange={(e) => setTrash(e.target.value)}
rows={6}
className="mt-3 w-full"
style={{
background: 'white',
border: '1px solid var(--border)',
borderRadius: 12,
padding: 12,
}}
/>
</details>
</section>
)}

{/* Infos recette */}
<section className="app-card p-6" style={{ marginTop: 16 }}>
<h2 className="text-lg font-extrabold app-title">Informations</h2>

<div className="mt-4 grid gap-4">
<label className="grid gap-1 text-sm font-semibold">
Titre
<input
value={title}
onChange={(e) => setTitle(e.target.value)}
style={{
background: 'white',
border: '1px solid var(--border)',
borderRadius: 12,
padding: 12,
}}
/>
</label>

<div className="flex flex-wrap items-end gap-4">
<label className="grid gap-1 text-sm font-semibold">
Portions
<input
type="number"
min={1}
value={servings}
onChange={(e) => setServings(Number(e.target.value || 1))}
style={{
width: 140,
background: 'white',
border: '1px solid var(--border)',
borderRadius: 12,
padding: 12,
}}
/>
</label>

<span className="app-badge">Lisible en un coup d’œil</span>
</div>

<label className="grid gap-1 text-sm font-semibold">
Image URL
<input
value={imageUrl}
onChange={(e) => setImageUrl(e.target.value)}
style={{
background: 'white',
border: '1px solid var(--border)',
borderRadius: 12,
padding: 12,
}}
/>
</label>

<label className="grid gap-1 text-sm font-semibold">
Notes
<textarea
value={notes}
onChange={(e) => setNotes(e.target.value)}
rows={5}
style={{
background: 'white',
border: '1px solid var(--border)',
borderRadius: 12,
padding: 12,
}}
/>
</label>
</div>
</section>

{/* Ingrédients */}
<section className="app-card p-6" style={{ marginTop: 16 }}>
<div className="flex flex-wrap items-center justify-between gap-12">
<div>
<h2 className="text-lg font-extrabold app-title">Ingrédients</h2>
<p className="mt-2 text-sm app-muted">Un ingrédient par ligne : nom, quantité, unité, prix.</p>
</div>

<button
onClick={recalcPrices}
disabled={isRepricing}
className="app-btn-secondary"
style={{ minWidth: 240, opacity: isRepricing ? 0.7 : 1 }}
type="button"
>
🔁 {isRepricing ? 'Recalcul…' : 'Recalculer les prix'}
</button>
</div>

<div className="mt-4 grid gap-3">
{ingredients.map((ing, idx) => (
<div
key={idx}
className="app-card p-3"
style={{
boxShadow: 'none',
background: 'rgba(255,255,255,0.7)',
borderColor: 'var(--border)',
}}
>
<div
style={{
display: 'grid',
gridTemplateColumns: '1fr 140px 120px 110px',
gap: 10,
alignItems: 'center',
}}
>
<input
placeholder="Ingrédient"
value={ing.name}
onChange={(e) => setIngredient(idx, { name: e.target.value })}
style={{
background: 'white',
border: '1px solid var(--border)',
borderRadius: 12,
padding: 10,
}}
/>

<input
placeholder="Quantité"
value={qtyInputs[idx] ?? ''}
onChange={(e) => setQtyInput(idx, e.target.value)}
style={{
background: 'white',
border: '1px solid var(--border)',
borderRadius: 12,
padding: 10,
}}
/>

<input
placeholder="Unité"
value={ing.unit}
onChange={(e) => setIngredient(idx, { unit: e.target.value })}
style={{
background: 'white',
border: '1px solid var(--border)',
borderRadius: 12,
padding: 10,
}}
/>

<div style={{ minWidth: 110, textAlign: 'right', fontSize: 13, opacity: 0.9 }}>
<span>{typeof ing.costEur === 'number' ? `${ing.costEur.toFixed(2)} €` : '0.00 €'}</span>

{ing.priceMatched === false && (
<div style={{ fontSize: 11, color: '#ffb020' }}>Airtable: non trouvé</div>
)}
</div>
</div>
</div>
))}

<button
onClick={() => {
setIngredients((p) => [...p, { name: '', quantity: 0, unit: '' }])
setQtyInputs((p) => [...p, ''])
}}
className="app-btn-secondary"
style={{ width: 260 }}
type="button"
>
+ Ajouter un ingrédient
</button>

<div style={{ marginTop: 8, fontWeight: 800, textAlign: 'right' }}>Total : {totalCost.toFixed(2)} €</div>
</div>
</section>

{/* Étapes */}
<section className="app-card p-6" style={{ marginTop: 16 }}>
<h2 className="text-lg font-extrabold app-title">Étapes</h2>
<p className="mt-2 text-sm app-muted">1 étape = 1 bloc. Garde les phrases courtes.</p>

<div className="mt-4 grid gap-3">
{steps.map((s, idx) => (
<div
key={idx}
className="app-card p-3"
style={{
boxShadow: 'none',
background: 'rgba(255,255,255,0.7)',
borderColor: 'var(--border)',
}}
>
<div className="flex items-center gap-2 mb-2">
<span className="app-badge">Étape {idx + 1}</span>
</div>

<textarea
value={s}
onChange={(e) =>
setSteps((prev) => {
const copy = [...prev]
copy[idx] = e.target.value
return copy
})
}
rows={2}
style={{
width: '100%',
background: 'white',
border: '1px solid var(--border)',
borderRadius: 12,
padding: 12,
}}
/>
</div>
))}

<button
onClick={() => setSteps((p) => [...p, ''])}
className="app-btn-secondary"
style={{ width: 220 }}
type="button"
>
+ Ajouter une étape
</button>
</div>
</section>

{/* Actions */}
<section className="app-card p-6" style={{ marginTop: 16 }}>
<div className="flex flex-wrap gap-3 items-center">
<button onClick={save} className="app-btn-primary" type="button">
Enregistrer
</button>

{status && (
<span
className="app-card px-3 py-2 text-sm"
style={{
boxShadow: 'none',
borderColor:
statusKind === 'success'
? 'rgba(168,184,161,0.7)'
: statusKind === 'error'
? 'rgba(176,0,32,0.25)'
: 'var(--border)',
background:
statusKind === 'success'
? 'rgba(168,184,161,0.15)'
: statusKind === 'error'
? 'rgba(176,0,32,0.06)'
: 'rgba(255,255,255,0.7)',
color: statusKind === 'error' ? '#b00020' : 'rgba(43,43,43,0.95)',
fontWeight: 800,
}}
>
{status}
</span>
)}
</div>
</section>
</main>
)
}

export default function Page() {
return (
<Suspense fallback={<div className="app-container" style={{ padding: 24 }}>Chargement…</div>}>
<NewRecipeInner />
</Suspense>
)
}