'use client';

import { useEffect, useState } from 'react';

export default function SuccessPage() {
  const [msg, setMsg] = useState('Validation en cours…');

  useEffect(() => {
    (async () => {
      try {
        const API = process.env.NEXT_PUBLIC_BACKEND_URL!;
        const token = localStorage.getItem('sb:token');

        if (!API || !token) {
          setMsg('Paiement validé ✅ (synchronisation automatique non nécessaire)');
          return;
        }

        const r = await fetch(`${API}/auth/sync`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ from: 'stripe_success' }),
          credentials: 'include',
        });

        if (!r.ok) throw new Error(await r.text());
        const out = await r.json();

        document.cookie = `user_id=${out.userId}; Path=/; Max-Age=2592000; SameSite=Lax`;
        document.cookie = `subscription_status=${out.subscriptionStatus || 'trialing'}; Path=/; Max-Age=2592000; SameSite=Lax`;

        setMsg('Paiement validé ✅ Ton abonnement est maintenant actif.');
      } catch (e: any) {
        console.error(e);
        setMsg(`Paiement validé ✔️ mais synchronisation incomplète : ${e?.message ?? String(e)}`);
      }
    })();
  }, []);

  return (
    <main className="app-container" style={{ margin: '40px auto' }}>
      <section className="app-card p-6 text-center">
        <h1 className="text-2xl font-extrabold app-title">
          Merci 🙌
        </h1>

        <p className="mt-4 text-base">
          {msg}
        </p>

        <p className="mt-3 app-muted">
          Tu peux maintenant profiter de toutes les fonctionnalités premium.
        </p>

        <div className="mt-6">
          <a href="/dashboard" className="app-btn-primary">
            Aller au tableau de bord
          </a>
        </div>
      </section>
    </main>
  );
}

