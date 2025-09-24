'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
process.env.NEXT_PUBLIC_SUPABASE_URL!,
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function AuthCallbackPage() {
const router = useRouter();
const [msg, setMsg] = useState('Connexion en cours...');

useEffect(() => {
(async () => {
try {
const url = new URL(window.location.href);

// Lire erreurs / code en query ou dans le hash
const queryErr = url.searchParams.get('error');
const queryDesc = url.searchParams.get('error_description') ?? '';
const queryCode = url.searchParams.get('code');

const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
const hashErr = hash.get('error');
const hashDesc = hash.get('error_description') ?? '';
const hashCode = hash.get('code');

const err = queryErr || hashErr;
const desc = queryDesc || hashDesc;
if (err) throw new Error(`${err}${desc ? `: ${desc}` : ''}`);

// ⬇️ Échanger le code (ta version attend un STRING)
const code = queryCode || hashCode;
if (typeof code === 'string' && code.length > 0) {
const { error: exchError } = await supabase.auth.exchangeCodeForSession(code);
if (exchError) throw exchError;
}

// Lire la session
const { data: { session }, error: sessErr } = await supabase.auth.getSession();
if (sessErr || !session) throw new Error('Session introuvable.');

const accessToken = session.access_token;
const user = session.user!;
if (!user.id || !user.email) throw new Error('Utilisateur invalide.');

// Sync backend
const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/auth/sync`, {
method: 'POST',
headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
body: JSON.stringify({ email: user.email }),
});

if (!res.ok) {
const t = await res.text().catch(() => '');
throw new Error(`Sync échouée (${res.status}) ${t}`);
}

const payload = await res.json() as { userId: string; subscriptionStatus?: string };
const status = payload.subscriptionStatus ?? 'trialing';

// Cookies pour le middleware
document.cookie = `user_id=${encodeURIComponent(user.id)}; path=/; max-age=${60*60*24*7}`;
document.cookie = `subscription_status=${encodeURIComponent(status)}; path=/; max-age=${60*60*24*7}`;

setMsg('Connexion réussie, redirection...');
router.replace('/dashboard');
} catch (e: any) {
console.error(e);
setMsg(`Erreur: ${e?.message ?? e}`);
}
})();
}, [router]);

return (
<main style={{ maxWidth: 420, margin: '48px auto', padding: 16 }}>
<h1>{msg}</h1>
<p>Besoin ? Retourne à <a href="/login">/login</a> et redemande un lien.</p>
</main>
);
}