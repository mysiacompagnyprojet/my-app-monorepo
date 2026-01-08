'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { apiFetch } from 'src/lib/api'

type VerifyResp =
| { ok: true }
| { ok: false; error: string; message?: string }

function getOrCreateDeviceId(): string {
const KEY = 'beta_device_id'
try {
const existing = localStorage.getItem(KEY)
if (existing) return existing
const id = crypto.randomUUID()
localStorage.setItem(KEY, id)
return id
} catch {
// fallback si localStorage bloqué (rare)
return crypto.randomUUID()
}
}

export default function BetaInvitePage() {
const router = useRouter()
const search = useSearchParams()

const tokenInUrl = useMemo(() => (search.get('token') || '').trim(), [search])
const [token, setToken] = useState('')
const [status, setStatus] = useState('')
const [isLoading, setIsLoading] = useState(false)

useEffect(() => {
if (tokenInUrl) setToken(tokenInUrl)
}, [tokenInUrl])

async function verify() {
const t = token.trim()
if (!t) {
setStatus('❌ Mets ton code bêta (token).')
return
}

try {
setIsLoading(true)
setStatus('⏳ Vérification…')

const deviceId = getOrCreateDeviceId()

const json = await apiFetch<VerifyResp>('/beta/verify', {
method: 'POST',
body: JSON.stringify({ token: t, deviceId }),
})

if (!json || (json as any).ok !== true) {
const msg = (json as any)?.message || (json as any)?.error || 'Code invalide'
setStatus('❌ ' + msg)
return
}

// on “mémorise” l’accès sur cet appareil
localStorage.setItem('beta_ok', '1')
localStorage.setItem('beta_token', t)

setStatus('✅ Accès bêta activé')
router.push('/import/ocr')
} catch (e: any) {
setStatus('❌ ' + (e?.message || 'Erreur'))
} finally {
setIsLoading(false)
}
}

return (
<main className="app-container" style={{ margin: '40px auto' }}>
<section className="app-card p-6">
<h1 className="text-2xl font-extrabold app-title">Accès bêta</h1>
<p className="mt-2 app-muted">
Colle ton code bêta pour activer l’accès sur cet appareil.
</p>

<div className="mt-6 grid gap-3" style={{ maxWidth: 520 }}>
<label className="grid gap-1 text-sm font-semibold">
Code bêta (token)
<input
value={token}
onChange={(e) => setToken(e.target.value)}
placeholder="Ex: 8f2c…"
style={{
background: 'white',
border: '1px solid var(--border)',
borderRadius: 12,
padding: 12,
}}
/>
</label>

<button
onClick={verify}
disabled={isLoading}
className="app-btn-primary"
type="button"
style={{ width: 220, opacity: isLoading ? 0.7 : 1 }}
>
{isLoading ? 'Vérification…' : 'Activer'}
</button>

{status && (
<div className="app-muted" style={{ fontWeight: 800 }}>
{status}
</div>
)}
</div>
</section>
</main>
)
}