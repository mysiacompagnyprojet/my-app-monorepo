// frontend/my-app/src/app/recipes/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const API = process.env.NEXT_PUBLIC_BACKEND_URL!

type Recipe = {
id: string
title: string
servings: number
imageUrl: string | null
createdAt: string

// ✅ backend = number
totalCostEur: number | null
}

function formatEur(v: unknown): string | null {
const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : NaN
if (!Number.isFinite(n)) return null
return n.toFixed(2).replace('.', ',')
}

export default function RecipesListPage() {
const [recipes, setRecipes] = useState<Recipe[]>([])
const [loading, setLoading] = useState(true)
const [err, setErr] = useState<string | null>(null)

useEffect(() => {
;(async () => {
try {
if (!API) throw new Error('NEXT_PUBLIC_BACKEND_URL manquante')

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const {
data: { session },
error,
} = await supabase.auth.getSession()
if (error) throw error

if (!session?.access_token) {
window.location.href = '/login?next=/recipes'
return
}
const token = session.access_token

const r = await fetch(`${API}/recipes`, {
headers: { Authorization: `Bearer ${token}` },
credentials: 'include',
})
if (!r.ok) {
const text = await r.text().catch(() => '')
throw new Error(`GET /recipes a échoué (${r.status}) ${text}`)
}

const json = await r.json()
setRecipes(json.recipes || [])
} catch (e: any) {
setErr(e?.message || String(e))
} finally {
setLoading(false)
}
})()
}, [])

return (
<main className="app-container" style={{ margin: '40px auto' }}>
<section className="app-card p-6">
<div className="flex flex-wrap items-center justify-between gap-3">
<div>
<h1 className="text-2xl font-extrabold app-title">📖 Mes recettes</h1>
<p className="mt-1 app-muted">Retrouve tes recettes dans un espace clair et organisé.</p>
</div>

<a
href="/recipes/new"
className="app-btn-primary"
style={{
borderRadius: 14,
paddingLeft: 16,
paddingRight: 16,
boxShadow: '0 8px 16px rgba(139, 106, 79, 0.12)',
}}
onMouseEnter={(e) => {
;(e.currentTarget as HTMLAnchorElement).style.filter = 'brightness(0.98)'
}}
onMouseLeave={(e) => {
;(e.currentTarget as HTMLAnchorElement).style.filter = 'none'
}}
>
➕ Nouvelle recette
</a>
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
</section>
)}

{!loading && !err && (
<section style={{ marginTop: 16 }}>
{recipes.length === 0 ? (
<div className="app-card p-6 text-center">
<h2 className="text-lg font-extrabold app-title">Aucune recette pour le moment</h2>
<p className="mt-2 app-muted">Commence par importer ou créer ta première recette.</p>
<div className="mt-5">
<a href="/recipes/import" className="app-btn-secondary">
Importer une recette
</a>
<span style={{ display: 'inline-block', width: 10 }} />
<a href="/recipes/new" className="app-btn-primary">
Créer une recette
</a>
</div>
</div>
) : (
<ul
style={{
display: 'grid',
gap: 16,
gridTemplateColumns: 'repeat(auto-fill, minmax(260px,1fr))',
listStyle: 'none',
padding: 0,
margin: 0,
}}
>
{recipes.map((r) => {
const costStr = formatEur(r.totalCostEur)

return (
<li key={r.id} className="app-card p-4" style={{ padding: 0 }}>
<Link
href={`/recipes/${r.id}`}
className="block recipe-card-link"
style={{
padding: 16,
textDecoration: 'none',
color: 'inherit',
cursor: 'pointer',
}}
>
{r.imageUrl ? (
<img
src={r.imageUrl}
alt={r.title}
style={{
width: '100%',
height: 160,
objectFit: 'cover',
borderRadius: 10,
marginBottom: 10,
border: '1px solid var(--border)',
}}
/>
) : (
<div
className="app-card"
style={{
height: 160,
borderRadius: 10,
boxShadow: 'none',
background: 'rgba(255,255,255,0.7)',
borderColor: 'var(--border)',
display: 'flex',
alignItems: 'center',
justifyContent: 'center',
marginBottom: 10,
}}
>
<span className="app-muted text-sm">Recette importée</span>
</div>
)}

<div
className="font-semibold"
style={{
color: 'var(--primary)',
marginBottom: 10,
lineHeight: 1.25,
}}
>
{r.title}
</div>

<div className="text-sm" style={{ marginTop: -6, marginBottom: 10 }}>
<span className="app-muted">Coût estimé : {costStr ? `~${costStr} €` : '—'}</span>
</div>

<div className="mt-1 text-sm app-muted">
<span className="app-badge">Portions : {r.servings}</span>
<span style={{ marginLeft: 8 }}>
{new Date(r.createdAt).toLocaleDateString('fr-FR')}
</span>
</div>
</Link>
</li>
)
})}
</ul>
)}
</section>
)}
</main>
)
}