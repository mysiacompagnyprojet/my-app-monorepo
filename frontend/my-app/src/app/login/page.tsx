'use client';

import { useState } from 'react';
import { API_URL } from '../../lib/api';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

// --- Client Supabase pour le magic link ---
const supabase = createClient(
process.env.NEXT_PUBLIC_SUPABASE_URL!,
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type LoginSuccess = { token: string };
type LoginError = { error: string };
type LoginResponse = LoginSuccess | LoginError | null;

function hasToken(obj: unknown): obj is LoginSuccess {
return (
typeof obj === 'object' &&
obj !== null &&
'token' in obj &&
typeof (obj as Record<string, unknown>).token === 'string'
);
}

function hasError(obj: unknown): obj is LoginError {
return (
typeof obj === 'object' &&
obj !== null &&
'error' in obj &&
typeof (obj as Record<string, unknown>).error === 'string'
);
}

export default function LoginPage() {
const router = useRouter();
const [email, setEmail] = useState('');
const [password, setPassword] = useState('');
const [busy, setBusy] = useState(false);
const [error, setError] = useState<string | null>(null);
const [magicStatus, setMagicStatus] = useState<'idle'|'loading'|'sent'|'error'>('idle');

// === 1) Connexion classique backend ===
async function onSubmit(e: React.FormEvent) {
e.preventDefault();
setError(null);
setBusy(true);
try {
const res = await fetch(`${API_URL}/auth/login`, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ email, password }),
});

const json = (await res.json().catch(() => null)) as LoginResponse;

if (!res.ok || !hasToken(json)) {
const message = hasError(json) ? json.error : `HTTP ${res.status}`;
throw new Error(message);
}

// ⚠️ Démo : stockage local. En prod: cookie httpOnly côté API.
localStorage.setItem('token', json.token);

router.push('/health-check');
} catch (err: unknown) {
setError(
err instanceof Error ? err.message : typeof err === 'string' ? err : 'Erreur inconnue'
);
} finally {
setBusy(false);
}
}

// === 2) Magic link Supabase ===
async function handleMagicLink() {
setMagicStatus('loading');
setError(null);
try {
const redirectTo = `${window.location.origin}/auth/callback`;
const { error } = await supabase.auth.signInWithOtp({
email,
options: { emailRedirectTo: redirectTo }
});

if (error) throw error;
setMagicStatus('sent');
} catch (err: any) {
setMagicStatus('error');
setError(err?.message ?? 'Erreur magic link.');
}
}

return (
<main style={{ padding: 24, maxWidth: 420 }}>
<h1>Connexion</h1>
<p style={{ color: '#666' }}>API: {API_URL || '(non définie)'}</p>

{/* --- Formulaire login classique --- */}
<form onSubmit={onSubmit} style={{ display: 'grid', gap: 12, marginTop: 16 }}>
<label style={{ display: 'grid', gap: 6 }}>
Email
<input
type="email"
value={email}
onChange={(e) => setEmail(e.target.value)}
required
style={{ width: '100%', padding: 8 }}
/>
</label>

<label style={{ display: 'grid', gap: 6 }}>
Mot de passe
<input
type="password"
value={password}
onChange={(e) => setPassword(e.target.value)}
required
style={{ width: '100%', padding: 8 }}
/>
</label>

<button disabled={busy} type="submit" style={{ padding: 10 }}>
{busy ? 'Connexion…' : 'Se connecter (API backend)'}
</button>
</form>

{error && <p style={{ color: 'crimson', marginTop: 8 }}>{error}</p>}

<hr style={{ margin: '24px 0' }} />

{/* --- Bouton magic link --- */}
<button
onClick={handleMagicLink}
disabled={magicStatus === 'loading' || !email}
style={{ padding: 10, width: '100%' }}
>
{magicStatus === 'loading'
? 'Envoi du lien...'
: magicStatus === 'sent'
? 'Lien envoyé ✅'
: 'Se connecter par Magic Link'}
</button>
</main>
);
}