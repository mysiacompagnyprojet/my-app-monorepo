'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { apiFetch } from 'src/lib/api'

type Recipe = {
id: string
title: string
servings: number
imageUrl: string | null
createdAt: string
notes?: string | null
steps?: string[] | null
ingredients?: Array<{
name: string
quantity: number
unit: string
costRecipe?: number | null
}>
}

export default function RecipeDetailPage() {
const router = useRouter()
const params = useParams()
const id = String((params as any)?.id || '')

const [recipe, setRecipe] = useState<Recipe | null>(null)
const [loading, setLoading] = useState(true)
const [err, setErr] = useState<string | null>(null)

useEffect(() => {
if (!id) return

;(async () => {
try {
setLoading(true)
setErr(null)

// ✅ apiFetch gère déjà Authorization: Bearer <token> (Supabase frais)
const json = await apiFetch<{ ok?: boolean; recipe?: Recipe }>(`/recipes/${encodeURIComponent(id)}`, {
method: 'GET',
})

const rec = (json as any)?.recipe ?? (json as any)
if (!rec?.id) throw new Error('Réponse backend invalide (recipe manquante)')

setRecipe(rec)
} catch (e: any) {
setErr(e?.message || String(e))
} finally {
setLoading(false)
}
})()
}, [id])

return (
<main className="app-container" style={{ margin: '40px auto' }}>
<section className="app-card p-6">
<div className="flex flex-wrap items-center justify-between gap-3">
<div>
<h1 className="text-2xl font-extrabold app-title">📄 Détail recette</h1>
<p className="mt-1 app-muted">ID : {id}</p>
</div>

<button className="app-btn-secondary" onClick={() => router.push('/recipes')} type="button">
← Retour
</button>
</div>
</section>

{loading && (
<section className="app-card p-5" style={{ marginTop: 16 }}>
<p className="app-muted">Chargement…</p>
</section>
)}

{err && (
<section
className="app-card p-5"
style={{
marginTop: 16,
boxShadow: 'none',
borderColor: 'rgba(176,0,32,0.25)',
background: 'rgba(176,0,32,0.06)',
}}
>
<p style={{ color: '#b00020', fontWeight: 800 }}>{err}</p>

<p className="app-muted" style={{ marginTop: 10 }}>
Si tu vois une erreur 401 : c’est que tu n’es pas connectée (token manquant/expiré). <br />
Si tu vois une erreur 404 : la recette n’existe pas (ou pas à toi).
</p>
</section>
)}

{!loading && !err && recipe && (
<section className="app-card p-6" style={{ marginTop: 16 }}>
{recipe.imageUrl ? (
<img
src={recipe.imageUrl}
alt={recipe.title}
style={{
width: '100%',
maxHeight: 360,
objectFit: 'cover',
borderRadius: 12,
border: '1px solid var(--border)',
marginBottom: 14,
}}
/>
) : null}

<h2 className="text-2xl font-extrabold" style={{ color: 'var(--text)' }}>
{recipe.title}
</h2>

<div className="mt-2 text-sm app-muted">
<span className="app-badge">Portions : {recipe.servings}</span>
<span style={{ marginLeft: 10 }}>Créée le {new Date(recipe.createdAt).toLocaleDateString('fr-FR')}</span>
</div>
</section>
)}
</main>
)
}