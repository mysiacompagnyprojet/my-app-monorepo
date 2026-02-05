// frontend/my-app/src/app/login/page.tsx
'use client'

import { Suspense, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { API_URL } from '../../lib/api'
import { createClient } from '@supabase/supabase-js'

// --- Lecture des variables d'environnement (côté client) ---
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

type LoginSuccess = { token: string }
type LoginError = { error: string }
type LoginResponse = LoginSuccess | LoginError | null

function hasToken(obj: unknown): obj is LoginSuccess {
return (
typeof obj === 'object' &&
obj !== null &&
'token' in obj &&
typeof (obj as Record<string, unknown>).token === 'string'
)
}
function hasError(obj: unknown): obj is LoginError {
return (
typeof obj === 'object' &&
obj !== null &&
'error' in obj &&
typeof (obj as Record<string, unknown>).error === 'string'
)
}

function LoginInner() {
const router = useRouter()
const search = useSearchParams()

// ✅ où on renvoie l’utilisateur après login (ex: /import/ocr)
const nextPath = (search.get('next') || '/').trim() || '/'

const [email, setEmail] = useState('')
const [password, setPassword] = useState('')
const [busy, setBusy] = useState(false)
const [error, setError] = useState<string | null>(null)
const [magicStatus, setMagicStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle')

// ✅ Client Supabase seulement si config OK
const supabase = useMemo(() => {
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null
return createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
}, [])

// === 1) Connexion backend classique ===
async function onSubmit(e: React.FormEvent) {
e.preventDefault()
setError(null)
setBusy(true)
try {
const res = await fetch(`${API_URL}/auth/login`, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ email, password }),
})

const json = (await res.json().catch(() => null)) as LoginResponse

if (!res.ok || !hasToken(json)) {
const message = hasError(json) ? json.error : `HTTP ${res.status}`
throw new Error(message)
}

localStorage.setItem('token', json.token)

// ✅ après login classique, on respecte next aussi
router.push(nextPath)
} catch (err: unknown) {
setError(err instanceof Error ? err.message : typeof err === 'string' ? err : 'Erreur inconnue')
} finally {
setBusy(false)
}
}

// === 2) Magic link Supabase ===
async function handleMagicLink() {
setMagicStatus('loading')
setError(null)
try {
if (!supabase) {
throw new Error(
'Configuration Supabase manquante : NEXT_PUBLIC_SUPABASE_URL ou NEXT_PUBLIC_SUPABASE_ANON_KEY'
)
}

const origin =
typeof window !== 'undefined' //&& window.location.origin.includes('localhost')
? window.location.origin
: 'https://my-app-monorepo.vercel.app'

// ✅ on passe next dans l’URL, comme ça /auth/callback peut rediriger ensuite
const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(nextPath)}`

const { error } = await supabase.auth.signInWithOtp({
email,
options: { emailRedirectTo: redirectTo },
})

if (error) throw error
setMagicStatus('sent')
} catch (err: any) {
setMagicStatus('error')
setError(err?.message ?? 'Erreur magic link.')
}
}

const supabaseConfigMissing = !SUPABASE_URL || !SUPABASE_ANON_KEY

return (
<main className="app-container" style={{ margin: '40px auto' }}>
<section className="app-card p-6">
<h1 className="text-2xl font-extrabold app-title">Connexion</h1>

<p className="mt-1 app-muted text-sm">Accès sécurisé à ton espace personnel</p>

<p className="mt-2 text-xs app-muted">API : {API_URL || '(non définie)'}</p>

{/* --- Login classique --- */}
<form onSubmit={onSubmit} className="mt-5 grid gap-4">
<label className="grid gap-1 text-sm font-semibold">
Email
<input
type="email"
value={email}
onChange={(e) => setEmail(e.target.value)}
required
style={{
background: 'white',
border: '1px solid var(--border)',
borderRadius: 10,
padding: 10,
}}
/>
</label>

<label className="grid gap-1 text-sm font-semibold">
Mot de passe
<input
type="password"
value={password}
onChange={(e) => setPassword(e.target.value)}
required
style={{
background: 'white',
border: '1px solid var(--border)',
borderRadius: 10,
padding: 10,
}}
/>
</label>

<button disabled={busy} type="submit" className="app-btn-primary mt-2">
{busy ? 'Connexion…' : 'Se connecter'}
</button>
</form>

{error && (
<div
className="mt-4 app-card p-3 text-sm"
style={{
boxShadow: 'none',
borderColor: 'rgba(176,0,32,0.25)',
background: 'rgba(176,0,32,0.06)',
}}
>
<strong style={{ color: '#b00020' }}>Erreur :</strong> {error}
</div>
)}

<hr style={{ margin: '28px 0', borderColor: 'var(--border)' }} />

{/* --- Magic link --- */}
<p className="app-muted text-sm" style={{ marginBottom: 10 }}>
Connexion recommandée (bêta) : tu reçois un lien par email.
</p>

<button
onClick={handleMagicLink}
disabled={magicStatus === 'loading' || !email || supabaseConfigMissing}
className="app-btn-secondary w-full"
title={supabaseConfigMissing ? 'Variables Supabase manquantes (voir Vercel env)' : undefined}
type="button"
>
{magicStatus === 'loading'
? 'Envoi du lien…'
: magicStatus === 'sent'
? 'Lien envoyé ✅'
: 'Se connecter par lien magique'}
</button>

{magicStatus === 'sent' && (
<p className="mt-3 app-muted text-sm">
Ouvre ton mail sur <strong>le même appareil</strong> et clique sur le lien.
</p>
)}

{supabaseConfigMissing && (
<div
className="mt-4 app-card p-3 text-sm"
style={{
boxShadow: 'none',
borderColor: 'rgba(176,0,32,0.25)',
background: 'rgba(176,0,32,0.06)',
}}
>
<strong style={{ color: '#b00020' }}>Configuration manquante :</strong>
<br />
Vérifie les variables Vercel : <code>NEXT_PUBLIC_SUPABASE_URL</code> et{' '}
<code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>.
</div>
)}
</section>
</main>
)
}

// ✅ IMPORTANT : wrapper Suspense (corrige l’erreur Vercel)
export default function LoginPage() {
return (
<Suspense fallback={<div style={{ padding: 24 }}>Chargement…</div>}>
<LoginInner />
</Suspense>
)
}