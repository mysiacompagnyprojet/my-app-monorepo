'use client';

import { supabase } from '../../lib/supabase';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LogoutPage() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      await supabase.auth.signOut();
      // Effacer nos cookies
      document.cookie = 'user_id=; path=/; max-age=0';
      document.cookie = 'subscription_status=; path=/; max-age=0';
      router.replace('/login');
    })();
  }, [router]);

  return (
    <main className="app-container" style={{ margin: '60px auto' }}>
      <section className="app-card p-6 text-center">
        <h1 className="text-xl font-extrabold app-title">Déconnexion</h1>

        <p className="mt-3 app-muted">
          Tu es en train d’être déconnectée en toute sécurité.
        </p>

        <div className="mt-4 text-sm app-muted">
          Redirection vers la page de connexion…
        </div>
      </section>
    </main>
  );
}
