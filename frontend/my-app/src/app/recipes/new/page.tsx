// frontend/my-app/src/app/recipes/new/page.tsx
// frontend/my-app/src/app/recipes/new/page.tsx
'use client'

import type React from 'react'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { apiFetch } from 'src/lib/api'
import type { OcrDraft } from 'src/types/recipe'
import { RecipeImagePreview } from '@/components/RecipeImagePreview'
import { IngredientPicker } from '@/components/IngredientPicker'

type Line = {
name: string
quantity: number
unit: string
quantityRaw?: string

price?: { eurPer: number; perUnit: string } | null
costEur?: number | null
unitPriceBuy?: number | null
priceMatched?: boolean
id?: string | null

buyPriceEur?: number | null
buyLabel?: string | null
buyRefQty?: number | null
buyRefUnit?: string | null

// ✅ pour afficher "⚠️ ingrédient non trouvé" / autres infos backend
note?: string
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

buyPriceEur?: number | null
buyLabel?: string | null
buyRefQty?: number | null
buyRefUnit?: string | null
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

const mix = s.match(/^\s*(\d+)\s+(\d+)\s*\/\s*(\d+)\s*$/)
if (mix) {
const a = Number(mix[1])
const b = Number(mix[2])
const c = Number(mix[3])
if (Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && c !== 0) return a + b / c
}

const frac = s.match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/)
if (frac) {
const a = Number(frac[1])
const b = Number(frac[2])
if (Number.isFinite(a) && Number.isFinite(b) && b !== 0) return a / b
}

const n = Number(s.replace(',', '.'))
return Number.isFinite(n) ? n : 0
}

function formatQtyForInput(n: number, quantityRaw?: string): string {
if (typeof quantityRaw === 'string' && quantityRaw.trim()) return quantityRaw.trim()
if (!Number.isFinite(n)) return ''
if (n === 0) return ''
return String(n)
}

function fmtEur(v: any): string {
const n = typeof v === 'string' ? Number(String(v).replace(',', '.')) : Number(v)
if (!Number.isFinite(n)) return '—'
return `${n.toFixed(2)} €`
}

// ✅ décide si on doit afficher "⚠️ ingrédient non trouvé"
function isNotFoundLine(ing: Line): boolean {
const nameOk = String(ing?.name || '').trim().length > 0
if (!nameOk) return false

if (ing.priceMatched === false) return true
if (!ing.id) return true

const note = String(ing.note || '').toLowerCase()
if (note.includes('non trouvé') || note.includes('introuvable')) return true

return false
}

function NewRecipeInner() {
const router = useRouter()
const search = useSearchParams()

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

const totalCost = useMemo(() => {
return ingredients.reduce((acc, i) => acc + (typeof i.costEur === 'number' ? i.costEur : 0), 0)
}, [ingredients])

const totalProducts = useMemo(() => {
return ingredients.reduce((acc, i) => acc + (typeof i.buyPriceEur === 'number' ? i.buyPriceEur : 0), 0)
}, [ingredients])

// ─────────────────────────────────────────────────────────────
// 1) Pré-remplissage depuis OCR
// ─────────────────────────────────────────────────────────────
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
unitPriceBuy: typeof row.unitPriceBuy === 'number' ? row.unitPriceBuy : row.unitPriceBuy ?? null,
priceMatched: typeof row.priceMatched === 'boolean' ? row.priceMatched : undefined,
id: row.id ?? null,

buyPriceEur: typeof row.buyPriceEur === 'number' ? row.buyPriceEur : row.buyPriceEur ?? null,
buyLabel: typeof row.buyLabel === 'string' ? row.buyLabel : row.buyLabel ?? null,
buyRefQty: typeof row.buyRefQty === 'number' ? row.buyRefQty : row.buyRefQty ?? null,
buyRefUnit: typeof row.buyRefUnit === 'string' ? row.buyRefUnit : row.buyRefUnit ?? null,

note: typeof row.note === 'string' ? row.note : row.note ?? undefined,
}
})
.filter((x): x is Line => x !== null)

const finalIngredients = normalized.length ? normalized : [{ name: '', quantity: 0, unit: '' }]
setIngredients(finalIngredients)
setQtyInputs(finalIngredients.map((r) => formatQtyForInput(r.quantity, r.quantityRaw)))

const tr = Array.isArray((d as any).trash)
? (d as any).trash.map((x: any) => String(x || '').trim()).filter(Boolean)
: []
setTrash(tr.join('\n'))
} catch (e) {
console.error('ocrDraft parse error', e)
}

try {
sessionStorage.removeItem('recipeDraft')
} catch {}
}, [fromOcr])

// ─────────────────────────────────────────────────────────────
// 2) Pré-remplissage générique (prefill=1)
// ─────────────────────────────────────────────────────────────
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
if ((row as any).raw) return { name: String((row as any).raw), quantity: 0, unit: '' }

return {
name: String(row.name || '').trim(),
quantity: Number(row.quantity || 0) || 0,
unit: String(row.unit || ''),
quantityRaw: typeof row.quantityRaw === 'string' ? String(row.quantityRaw).trim() : undefined,

price: row.price ?? null,
costEur: typeof row.costEur === 'number' ? row.costEur : null,
unitPriceBuy: typeof row.unitPriceBuy === 'number' ? row.unitPriceBuy : row.unitPriceBuy ?? null,
priceMatched: row.priceMatched ?? false,
id: row.id ?? null,

buyPriceEur: typeof row.buyPriceEur === 'number' ? row.buyPriceEur : row.buyPriceEur ?? null,
buyLabel: typeof row.buyLabel === 'string' ? row.buyLabel : row.buyLabel ?? null,
buyRefQty: typeof row.buyRefQty === 'number' ? row.buyRefQty : row.buyRefQty ?? null,
buyRefUnit: typeof row.buyRefUnit === 'string' ? row.buyRefUnit : row.buyRefUnit ?? null,

note: typeof row.note === 'string' ? row.note : row.note ?? undefined,
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

setIngredient(idx, { quantity: parseQtyInput(raw), quantityRaw: undefined })
}

function removeIngredient(idx: number) {
setIngredients((prev) => {
const copy = prev.filter((_, i) => i !== idx)
return copy.length ? copy : [{ name: '', quantity: 0, unit: '' }]
})

setQtyInputs((prev) => {
const copy = prev.filter((_, i) => i !== idx)
return copy.length ? copy : ['']
})
}

function removeStep(idx: number) {
setSteps((prev) => {
const copy = prev.filter((_, i) => i !== idx)
return copy.length ? copy : ['']
})
}

function applyEnriched(enriched: EnrichIngredientOut[], idxs: number[]) {
setIngredients((prev) => {
const copy = [...prev]

for (let k = 0; k < enriched.length; k++) {
const idx = idxs[k]
const old = copy[idx]
const e = enriched[k] as any

const cost = typeof e.costEur === 'number' ? e.costEur : typeof e.costRecipe === 'number' ? e.costRecipe : null

copy[idx] = {
...old,
quantityRaw: old?.quantityRaw,
costEur: typeof cost === 'number' ? cost : null,
unitPriceBuy: typeof e.unitPriceBuy === 'number' ? e.unitPriceBuy : null,
priceMatched: typeof e.priceMatched === 'boolean' ? e.priceMatched : Boolean(e.id),
id: e.id ?? null,
price: e.price ?? old?.price ?? null,

buyPriceEur: typeof e.buyPriceEur === 'number' ? e.buyPriceEur : null,
buyLabel: typeof e.buyLabel === 'string' ? e.buyLabel : null,
buyRefQty: typeof e.buyRefQty === 'number' ? e.buyRefQty : null,
buyRefUnit: typeof e.buyRefUnit === 'string' ? e.buyRefUnit : null,

note: typeof e.note === 'string' ? e.note : undefined,
}
}

return copy
})
}

async function recalcPrices(opts?: { silent?: boolean }) {
const silent = Boolean(opts?.silent)

try {
setIsRepricing(true)
if (!silent) setStatus('⏳ Recalcul des prix…')

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
if (!silent) setStatus('❌ Ajoute au moins un ingrédient avant de recalculer.')
return
}

const payload = { ingredients: list }

const json = await apiFetch<EnrichResponse>('/recipes/enrich-ingredients', {
method: 'POST',
body: JSON.stringify(payload),
})

if (!json || (json as any).ok !== true) {
const msg = (json as any)?.message || (json as any)?.error || 'Erreur inconnue'
if (!silent) setStatus('❌ Recalcul impossible: ' + msg)
return
}

const enriched = Array.isArray((json as any).ingredients) ? (json as any).ingredients : []
if (!enriched.length) {
if (!silent) setStatus('❌ Recalcul impossible: réponse vide.')
return
}

applyEnriched(enriched, idxs)

if (!silent) setStatus('✅ Prix recalculés')
} catch (e: any) {
if (!silent) setStatus('❌ ' + (e?.message || 'Erreur'))
} finally {
setIsRepricing(false)
}
}

const repricingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
const lastSigRef = useRef<string>('')

const ingredientsSig = useMemo(() => {
return ingredients
.map((i) => `${String(i.name || '').trim()}|${Number(i.quantity || 0) || 0}|${String(i.unit || '').trim()}`)
.join('||')
}, [ingredients])

useEffect(() => {
if (!ingredients.length) return
const hasRealIngredient = ingredients.some((i) => String(i.name || '').trim())
if (!hasRealIngredient) return

if (ingredientsSig === lastSigRef.current) return
lastSigRef.current = ingredientsSig

if (repricingTimerRef.current) clearTimeout(repricingTimerRef.current)

repricingTimerRef.current = setTimeout(() => {
recalcPrices({ silent: true })
}, 500)

return () => {
if (repricingTimerRef.current) clearTimeout(repricingTimerRef.current)
}
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [ingredientsSig])

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

const smallXBtnStyle: React.CSSProperties = {
width: 30,
height: 30,
padding: 0,
display: 'grid',
placeItems: 'center',
fontSize: 14,
lineHeight: '14px',
borderRadius: 10,
}

const sectionTitleStyle: React.CSSProperties = {
fontSize: '1.13rem', // ✅ ~ +13% vs text-lg (1.125rem ≈ +13% vs 1rem)
fontWeight: 800, // ✅ légèrement plus gras
color: 'var(--primary)', // ✅ même couleur que titres recettes
}

const inputStyle: React.CSSProperties = {
background: 'white',
border: '1px solid var(--border)',
borderRadius: 12,
padding: 14, // ✅ padding augmenté
}

return (
<main className="app-container" style={{ margin: '40px auto' }}>
{/* ✅ header sans fond blanc */}
<section style={{ marginBottom: 16 }}>
<h1 className="text-2xl font-extrabold app-title">Nouvelle recette</h1>
<p className="mt-2 app-muted">Remplis l’essentiel. Tu peux toujours ajuster plus tard.</p>
</section>

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

<section className="app-card p-6" style={{ marginTop: 16 }}>
<h2 style={sectionTitleStyle}>Informations</h2>

<div className="mt-4 grid gap-4">
<label className="grid gap-1 text-sm font-semibold">
Titre
<input value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} />
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
...inputStyle,
}}
/>
</label>

<span className="app-badge">Lisible en un coup d’œil</span>
</div>

<label className="grid gap-1 text-sm font-semibold">
Image URL
<input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} style={inputStyle} />
<RecipeImagePreview imageUrl={imageUrl}/>
</label>

<label className="grid gap-1 text-sm font-semibold">
Notes
<textarea
value={notes}
onChange={(e) => setNotes(e.target.value)}
rows={7} // ✅ hauteur augmentée
style={{
...inputStyle,
minHeight: 140,
}}
/>
</label>
</div>
</section>

<section className="app-card p-6" style={{ marginTop: 16 }}>
<div className="flex flex-wrap items-center justify-between gap-12">
<div>
<h2 style={sectionTitleStyle}>Ingrédients</h2>
<p className="mt-2 text-sm app-muted">Un ingrédient par ligne : nom, quantité, unité, prix.</p>
</div>

<button
onClick={() => recalcPrices({ silent: false })}
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
    gridTemplateColumns: '1fr 140px 120px 220px 44px',
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
    padding: 11,
    }}
/>

   
    <IngredientPicker 
    querySeed={ing.name} 
    onPick={(item) => { 
        setIngredient(idx, { 
            name: item.nom, 
            id: item.id }) //ingredientBaseId
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
padding: 11,
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
padding: 11,
}}
/>

<div
style={{
minWidth: 220,
display: 'flex',
justifyContent: 'space-between',
alignItems: 'center',
fontSize: 13,
fontWeight: 800,
}}
>
<span>{fmtEur(typeof ing.costEur === 'number' ? ing.costEur : null)}</span>
<span>{fmtEur(typeof ing.buyPriceEur === 'number' ? ing.buyPriceEur : null)}</span>
</div>

<button
type="button"
onClick={() => removeIngredient(idx)}
className="app-btn-secondary"
style={smallXBtnStyle}
title="Supprimer cette ligne"
>
✕
</button>
</div>

{isNotFoundLine(ing) && (
<div
style={{
marginTop: 6,
fontSize: 12,
fontWeight: 600,
color: 'rgba(90, 70, 50, 0.85)',
background: 'rgba(255, 193, 7, 0.06)',
border: '1px solid rgba(255, 193, 7, 0.25)',
borderRadius: 10,
padding: '6px 10px',
}}
>
⚠️ Ingrédient non trouvé — prix mis à 0,00 € (tu peux quand même enregistrer).
</div>
)}
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

<div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end', gap: 28 }}>
<div style={{ fontWeight: 900 }}>Total recette : {totalCost.toFixed(2)} €</div>
<div style={{ fontWeight: 900 }}>Total produits : {totalProducts.toFixed(2)} €</div>
</div>
</div>
</section>

<section className="app-card p-6" style={{ marginTop: 16 }}>
<h2 style={sectionTitleStyle}>Étapes</h2>
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
<div className="flex items-center justify-between gap-2 mb-2">
<span 
    style={{
        fontSize: 11,
        fontWeight: 700,
        color: 'rgba(60,60,60,0.85)',
        background: 'rgba(120, 120, 120, 0.12)',
        borderRadius: 8,
        padding: '4px 8px',
    }}
>
    Étape {idx + 1}
</span>

<button
type="button"
onClick={() => removeStep(idx)}
className="app-btn-secondary"
style={smallXBtnStyle}
title="Supprimer cette étape"
>
✕
</button>
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
rows={3} // ✅ hauteur augmentée
style={{
width: '100%',
background: 'white',
border: '1px solid var(--border)',
borderRadius: 12,
padding: 14, // ✅ padding augmenté
minHeight: 90,
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

<section className="app-card p-6" style={{ marginTop: 16 }}>
<div className="flex flex-wrap gap-3 items-center">
<button
onClick={save}
className="app-btn-primary"
style={{ borderRadius: 14 }} // ✅ plus arrondi
type="button"
>
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