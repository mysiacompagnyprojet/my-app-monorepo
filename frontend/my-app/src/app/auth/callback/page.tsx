// frontend/my-app/src/app/auth/callback/page.tsx
'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || ''

if (process.env.NODE_ENV === 'production' && !API_BASE) {
throw new Error('NEXT_PUBLIC_BACKEND_URL manquante en production')
}

type SyncResponse = {
ok?: boolean
userId?: string
email?: string
subscriptionStatus?: string | null
}

function SupabaseCallbackInner() {
const [msg, setMsg] = useState('Connexion en cours…')
const searchParams = useSearchParams()
const router = useRouter()

useEffect(() => {
;(async () => {
try {
if (typeof window !== 'undefined' && window.location.hash.includes('error=')) {
const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
const err = hash.get('error')
const code = hash.get('error_code')
throw new Error(
`Supabase a renvoyé une erreur: ${err} (${code}). Renvoie-toi un lien magique et ouvre-le dans le même navigateur.`
)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
const code = searchParams.get('code')
if (code) {
const { data, error } = await supabase.auth.exchangeCodeForSession(code)
if (error) throw error
if (data.session?.access_token) {
localStorage.setItem('sb:token', data.session.access_token)
}
}

const {
data: { session },
error: sessionError,
} = await supabase.auth.getSession()
if (sessionError) throw sessionError
if (!session?.access_token) {
throw new Error('Aucune session active. Le lien a peut-être expiré.')
}
const token = session.access_token

let subscriptionStatus: string | null = null
if (API_BASE) {
const url = `${API_BASE.replace(/\/+$/, '')}/auth/sync`
const r = await fetch(url, {
method: 'POST',
headers: {
'Content-Type': 'application/json',
Authorization: `Bearer ${token}`,
},
credentials: 'include',
body: JSON.stringify({ ping: true }),
})

if (!r.ok) {
let text = ''
try {
text = await r.text()
} catch {}
throw new Error(
`Appel /auth/sync a échoué (${r.status}). ${text || 'Aucun corps de réponse'}`
)
}

const out = (await r.json()) as SyncResponse
if (!out?.userId) {
throw new Error('Réponse /auth/sync invalide: userId manquant')
}

subscriptionStatus = out.subscriptionStatus ?? 'trialing'

const oneMonth = 60 * 60 * 24 * 30
const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:'
const secureAttr = isHttps ? '; Secure' : ''

document.cookie = `user_id=${out.userId}; Path=/; Max-Age=${oneMonth}; SameSite=Lax${secureAttr}`
document.cookie = `subscription_status=${subscriptionStatus}; Path=/; Max-Age=${oneMonth}; SameSite=Lax${secureAttr}`
}

// ✅ NOUVEAU : redirection prioritaire vers ?next=...
const next = (searchParams.get('next') || '').trim()
const safeNext = next.startsWith('/') ? next : ''

const dest =
safeNext ||
(subscriptionStatus && !['active', 'trialing'].includes(subscriptionStatus)
? '/premium'
: '/')

setMsg('Connexion réussie ✅ Redirection…')
router.replace(dest)
} catch (e: any) {
console.error(e)
setMsg(`Erreur : ${e?.message ?? String(e)}`)
}
})()
}, [searchParams, router])

return (
<main className="app-container" style={{ margin: '60px auto' }}>
<section className="app-card p-6 text-center">
<h1 className="text-xl font-extrabold app-title">Connexion</h1>

<p className="mt-4 text-base">{msg}</p>

<p className="mt-3 app-muted text-sm">Cette opération peut prendre quelques secondes.</p>
</section>
</main>
)
}

export const dynamic = 'force-dynamic'

export default function SupabaseCallbackPage() {
return (
<Suspense
fallback={
<main className="app-container" style={{ margin: '60px auto' }}>
<section className="app-card p-6 text-center">
<p>Connexion en cours…</p>
</section>
</main>
}
>
<SupabaseCallbackInner />
</Suspense>
)
}