'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export default function SupabaseCallbackPage() {
  const [msg, setMsg] = useState('Connexion en cours...');
  const searchParams = useSearchParams();

  useEffect(() => {
    (async () => {
      try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        // --- récupère le code dans l’URL ---
        const code = searchParams.get('code');

        if (code) {
          const { data, error } = await supabase.auth.exchangeCodeForSession(code); // ✅ ici on passe juste "code"
            if (error) throw error;
        // Exemple : tu peux stocker la session
            localStorage.setItem('sb:token', data.session?.access_token ?? '');
        }

        // --- vérifie la session ---
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        if (!session?.access_token) {
          throw new Error('Pas de token de session trouvé.');
        }

        // Tu peux stocker le token si tu veux :
        localStorage.setItem('sb:token', session.access_token);

        setMsg('Connexion réussie ✅ redirection...');
        window.location.replace('/');
      } catch (err: any) {
        setMsg(`Erreur: ${err.message}`);
      }
    })();
  }, [searchParams]);

  return (
    <main style={{ padding: 24 }}>
      <p>{msg}</p>
    </main>
  );
}
