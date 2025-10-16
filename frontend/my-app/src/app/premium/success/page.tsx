'use client';

import { useEffect, useState } from 'react';

export default function SuccessPage() {
  const [msg, setMsg] = useState('Validation en cours…');

  useEffect(() => {
    (async () => {
      try {
        // Après paiement, on rafraîchit l’état côté backend et pose les cookies
        const API = process.env.NEXT_PUBLIC_BACKEND_URL!;
        const token = localStorage.getItem('sb:token'); // posé au login/callback
        if (!API || !token) {
          setMsg('Paiement validé ✅ (pas de sync: token/API manquants)');
          return;
        }

        const r = await fetch(`${API}/auth/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ from: 'stripe_success' }),
          credentials: 'include',
        });

        if (!r.ok) throw new Error(await r.text());
        const out = await r.json(); // { userId, subscriptionStatus, ... }

        // Cookies simples pour le middleware Next (non httpOnly)
        document.cookie = `user_id=${out.userId}; Path=/; Max-Age=2592000; SameSite=Lax`;
        document.cookie = `subscription_status=${out.subscriptionStatus || 'trialing'}; Path=/; Max-Age=2592000; SameSite=Lax`;

        setMsg('Paiement validé ✅ Votre abonnement est actif.');
      } catch (e: any) {
        console.error(e);
        setMsg(`Paiement validé ✔️ mais sync KO : ${e?.message ?? String(e)}`);
      }
    })();
  }, []);

  return (
    <main style={{ padding: 24 }}>
      <h1>Merci 🙌</h1>
      <p>{msg}</p>
      <p style={{ marginTop: 12 }}>
        <a href="/dashboard">Aller au tableau de bord</a>
      </p>
    </main>
  );
}
