'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';

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
// 1) Récupérer la session
const { data: { session }, error } = await supabase.auth.getSession();
if (error || !session) throw new Error('Session introuvable.');

const accessToken = session.access_token;
const user = session.user;
if (!user?.id || !user?.email) throw new Error('Utilisateur invalide.');

// 2) Appeler ton backend /auth/sync
// Attendu côté backend: vérif du token, upsert du User, retour JSON {userId, subscriptionStatus}
const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/auth/sync`, {
method: 'POST',
headers: {
'Content-Type': 'application/json',
'Authorization': `Bearer ${accessToken}`, // très important
},
body: JSON.stringify({ userId: user.id, email: user.email })
});

if (!res.ok) {
const t = await res.text();
throw new Error(`Sync échouée: ${res.status} ${t}`);
}

const payload = await res.json() as { userId: string; subscriptionStatus?: string };
const status = payload.subscriptionStatus ?? 'trialing';

// 3) Stocker en cookies (lisibles par le middleware)
// expires=7j ; path=/ pour tout le site
document.cookie = `user_id=${encodeURIComponent(user.id)}; path=/; max-age=${60*60*24*7}`;
document.cookie = `subscription_status=${encodeURIComponent(status)}; path=/; max-age=${60*60*24*7}`;

setMsg('Connexion réussie, redirection...');
// 4) Rediriger
router.replace('/dashboard'); // adapte vers ta page d’accueil connectée
} catch (e: any) {
console.error(e);
setMsg(`Erreur: ${e.message ?? e}`);
}
})();
}, [router]);

return <main style={{maxWidth:420, margin:'48px auto', padding:16}}>
<h1>{msg}</h1>
<p>Tu peux fermer cet onglet si rien ne se passe.</p>
</main>;
}