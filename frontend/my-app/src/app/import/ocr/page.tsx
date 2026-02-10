// frontend/my-app/src/app/import/ocr/page.tsx
'use client'

import { Suspense, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { apiFetch } from 'src/lib/api'
import type { OcrDraft } from 'src/types/recipe'

type ImportOcrResponse =
| { ok: true; draft: OcrDraft }
| { ok: true; debug: any }
| { ok: false; error: string; message?: string }

const MAX_FILES = 10

function OcrPageInner() {
const router = useRouter()
const search = useSearchParams()
const isDebug = search.get('debug') === '1'

const [files, setFiles] = useState<File[]>([])
const [status, setStatus] = useState('')
const [isRunning, setIsRunning] = useState(false)
const [debugOut, setDebugOut] = useState<any>(null)
const [draft, setDraft] = useState<OcrDraft | null>(null)

const canRun = useMemo(
() => files.length >= 1 && files.length <= MAX_FILES && !isRunning,
[files, isRunning]
)

async function run() {
try {
setDebugOut(null)
setDraft(null)
setStatus('')

if (!files.length) {
setStatus('❌ Ajoute au moins 1 image.')
return
}

if (files.length > MAX_FILES) {
setStatus(`❌ Trop d'images : ${MAX_FILES} maximum.`)
return
}

setIsRunning(true)
setStatus('OCR en cours…')

const form = new FormData()
for (const f of files) form.append('files', f)

const qs = isDebug ? '?debug=1' : ''

const data = await apiFetch<ImportOcrResponse>(`/import/ocr${qs}`, {
method: 'POST',
headers: { 'Accept-Language': navigator.language || 'fr-FR' },
body: form,
})

// Erreur API
if ((data as any)?.ok === false) {
setStatus(
'❌ ' +
((data as any)?.message ||
(data as any)?.error ||
'Erreur OCR')
)
return
}

// Mode debug (pas de redirection)
if ('debug' in data) {
setDebugOut((data as any).debug)
setStatus('✅ Debug reçu (aucune redirection)')
return
}

// Draft OK
if ('draft' in data) {
setDraft(data.draft)
sessionStorage.setItem('recipeDraft', JSON.stringify(data.draft))
router.push('/recipes/new?from=ocr')
return
}

setStatus('❌ Réponse inattendue du serveur.')
} catch (e: any) {
setStatus('❌ ' + (e?.message || 'Erreur inconnue'))
} finally {
setIsRunning(false)
}
}

const statusKind = status.startsWith('✅')
? 'success'
: status.startsWith('❌')
? 'error'
: 'info'

return (
<main className="app-container" style={{ margin: '20px auto 40px' }}>
<section className="app-card p-5">
<h1 className="text-2xl font-extrabold app-title">
Importer une recette depuis une ou des images
</h1>

<p className="mt-2 app-muted">
Pinterest, Instagram, Facebook, photo de livre, capture d’écran…
</p>

{/* Instructions */}
<div
className="mt-4 app-card"
style={{
borderColor: 'var(--border)',
boxShadow: 'none',
background: 'rgba(255,255,255,0.7)',
paddingTop: 16,
paddingBottom: 16,
paddingLeft: 16,
paddingRight: 16,
}}
>
<div className="text-sm font-bold" style={{ color: 'var(--primary)' }}>
Comment faire
</div>

<div className="mt-3" style={{ fontSize: 13, lineHeight: 1.75 }}>
<div style={{ marginTop: 6 }}>📸 Prends une ou plusieurs captures</div>
<div style={{ marginTop: 6 }}>🖼️ Sélectionne toutes les images</div>
<div style={{ marginTop: 6 }}>✨ On fusionne tout en une recette</div>
</div>
</div>

{/* Upload */}
<div className="mt-5">
<label className="text-sm font-semibold" htmlFor="ocrFiles">
Images de la recette
</label>

<input
id="ocrFiles"
type="file"
accept="image/*"
multiple
onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
className="mt-2 w-full"
style={{
background: 'white',
border: '1px solid var(--border)',
borderRadius: 12,
padding: 12,
}}
/>

<p className="mt-2 text-sm app-muted">
Tu peux sélectionner plusieurs images en même temps.
</p>

{files.length > 0 && (
<div className="mt-3 flex flex-wrap items-center gap-2">
<span className="app-badge">
{files.length} image(s) sélectionnée(s)
</span>

<span className="text-sm app-muted">
max {MAX_FILES}
{files.length > MAX_FILES ? ' — ❌ trop d’images' : ''}
</span>
</div>
)}

{/* CTA */}
<div className="mt-4 flex items-center gap-3">
<button
onClick={run}
disabled={!canRun}
className="app-btn-primary"
style={{
width: '100%',
maxWidth: 420,
paddingTop: 12,
paddingBottom: 12,
borderRadius: 12,
boxShadow: '0 8px 18px rgba(139, 106, 79, 0.18)',
border: '1px solid rgba(139, 106, 79, 0.22)',
}}
>
{isRunning ? 'Traitement en cours…' : 'Lancer l’OCR'}
</button>

{isDebug && (
<span
className="app-badge"
style={{ background: 'rgba(168,184,161,0.35)' }}
>
Debug actif
</span>
)}
</div>

{/* Aperçu (utile surtout en debug, car sinon redirection immédiate) */}
{draft && (
<div
className="mt-4 app-card p-4"
style={{
boxShadow: 'none',
borderColor: 'var(--border)',
background: 'rgba(255,255,255,0.7)',
}}
>
<h3 className="text-lg font-extrabold app-title">
Aperçu ingrédients + prix
</h3>

<div className="mt-3 grid gap-3">
{draft.ingredients?.map((ing, idx) => (
<div
key={idx}
style={{
padding: '8px 0',
borderBottom: '1px solid var(--border)',
}}
>
<div
style={{
display: 'flex',
justifyContent: 'space-between',
gap: 12,
}}
>
<div>
<strong>{ing.name}</strong>{' '}
<span style={{ opacity: 0.8 }}>
{ing.quantity ? `${ing.quantity}` : ''} {ing.unit || ''}
</span>
</div>

<div style={{ minWidth: 90, textAlign: 'right' }}>
{typeof ing.costEur === 'number'
? `${ing.costEur.toFixed(2)} €`
: '0.00 €'}
</div>
</div>

{ing.priceMatched === false && (
<div
style={{ fontSize: 12, opacity: 0.85, color: '#ffb020' }}
>
Prix non trouvé dans Airtable (0 appliqué)
</div>
)}
</div>
))}

<div className="cost-summary">
<div className="cost-pill">
<div className="cost-pill-row">
<div className="cost-pill-label">Coût recette ≈</div>
<div className="cost-pill-value">
<span className="amount">
{typeof draft.totalCostEur === 'number'
? `${draft.totalCostEur.toFixed(2)} €`
: '0.00 €'}
</span>
</div>
</div>
</div>
</div>
</div>
</div>
)}

{/* Status */}
{status && (
<div
className="mt-4 app-card p-3 text-sm"
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
}}
>
<span
style={{
fontWeight: 700,
color:
statusKind === 'success'
? 'rgba(43,43,43,0.95)'
: statusKind === 'error'
? '#b00020'
: 'rgba(43,43,43,0.9)',
}}
>
{status}
</span>
</div>
)}

{isDebug && (
<p className="mt-3 text-sm app-muted">
Mode debug actif : l’API renvoie un objet debug, sans redirection.
</p>
)}
</div>
</section>

{/* Debug output */}
{debugOut && (
<section className="app-card p-5" style={{ marginTop: 16 }}>
<h2 className="text-lg font-extrabold app-title">Debug</h2>

<pre
className="mt-3 app-card p-3 text-sm overflow-auto"
style={{
borderColor: 'var(--border)',
boxShadow: 'none',
background: 'rgba(255,255,255,0.7)',
maxHeight: 420,
}}
>
{JSON.stringify(debugOut, null, 2)}
</pre>
</section>
)}
</main>
)
}

export default function Page() {
return (
<Suspense
fallback={
<div className="app-container" style={{ padding: 24 }}>
Chargement…
</div>
}
>
<OcrPageInner />
</Suspense>
)
}