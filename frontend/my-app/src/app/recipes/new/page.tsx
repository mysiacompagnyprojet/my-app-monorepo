'use client'
import { useState } from 'react'
import { apiFetch } from 'src/lib/api'

type Line = { name: string; quantity: number; unit: string }

export default function NewRecipePage() {
const [title, setTitle] = useState('')
const [servings, setServings] = useState(1)
const [imageUrl, setImageUrl] = useState('')
const [notes, setNotes] = useState('')
const [steps, setSteps] = useState<string[]>([''])
const [ingredients, setIngredients] = useState<Line[]>([{ name: '', quantity: 0, unit: 'g' }])
const [status, setStatus] = useState<string>('')

function updateStep(i: number, v: string) {
setSteps(s => s.map((x, idx) => (idx === i ? v : x)))
}
function addStep() { setSteps(s => [...s, '']) }
function delStep(i: number) { setSteps(s => s.filter((_, idx) => idx !== i)) }

function updateIng(i: number, field: keyof Line, v: string) {
setIngredients(arr => arr.map((x, idx) => idx === i ? { ...x, [field]: field === 'quantity' ? Number(v) : v } : x))
}
function addIng() { setIngredients(arr => [...arr, { name: '', quantity: 0, unit: 'g' }]) }
function delIng(i: number) { setIngredients(arr => arr.filter((_, idx) => idx !== i)) }

async function onSubmit(e: React.FormEvent) {
e.preventDefault()
setStatus('Enregistrement...')
try {
const payload = { title, servings, imageUrl, notes, steps: steps.filter(s => s.trim()), ingredients }
await apiFetch('/recipes', { method: 'POST', body: JSON.stringify(payload) })
setStatus('✅ Recette enregistrée')
// Option: redirect
// router.push('/recipes')
} catch (e: any) {
setStatus('❌ ' + e.message)
}
}

return (
<div style={{ maxWidth: 720, margin: '2rem auto', padding: '1rem' }}>
<h1>Nouvelle recette</h1>
<form onSubmit={onSubmit}>
<label>Titre</label>
<input value={title} onChange={e => setTitle(e.target.value)} required />

<label>Portions</label>
<input type="number" min={1} value={servings} onChange={e => setServings(Number(e.target.value))} />

<label>Image URL</label>
<input value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="https://..." />

<label>Notes</label>
<textarea value={notes} onChange={e => setNotes(e.target.value)} />

<h3>Ingrédients</h3>
{ingredients.map((l, i) => (
<div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
<input placeholder="nom" value={l.name} onChange={e => updateIng(i, 'name', e.target.value)} required/>
<input type="number" placeholder="qté" value={l.quantity} onChange={e => updateIng(i, 'quantity', e.target.value)} />
<input placeholder="unité (g, ml, pièce...)" value={l.unit} onChange={e => updateIng(i, 'unit', e.target.value)} />
<button type="button" onClick={() => delIng(i)}>−</button>
</div>
))}
<button type="button" onClick={addIng}>+ Ajouter un ingrédient</button>

<h3>Étapes</h3>
{steps.map((s, i) => (
<div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
<input placeholder={`Étape ${i + 1}`} value={s} onChange={e => updateStep(i, e.target.value)} />
<button type="button" onClick={() => delStep(i)}>−</button>
</div>
))}
<button type="button" onClick={addStep}>+ Ajouter une étape</button>

<div style={{ marginTop: 16 }}>
<button type="submit">Enregistrer</button>
</div>
</form>
<p>{status}</p>
</div>
)
}