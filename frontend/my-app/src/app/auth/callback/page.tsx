'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const API = process.env.NEXT_PUBLIC_BACKEND_URL!;

export default function SupabaseCallbackPage() {
  const [msg, setMsg] = useState('Connexion en cours...');
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    (async () => {
      try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        // 1) Échange le code contre une session
        const code = searchParams.get('code');
        if (code) {
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
          if (data.session?.access_token) {
            localStorage.setItem('sb:token', data.session.access_token);
          }
        }

        // 2) Récupère la session
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        const token = session?.access_token;
        if (!token) throw new Error('Pas de session');

        // 3) Synchronise côté backend et pose les cookies pour le middleware
        const r = await fetch(`${API}/auth/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ ping: true }),
          credentials: 'include',
        });
        if (!r.ok) throw new Error(await r.text());
        const out = await r.json(); // { userId, subscriptionStatus, ... }

        // Cookies simples (non httpOnly) pour middleware Next
        document.cookie = `user_id=${out.userId}; Path=/; Max-Age=2592000; SameSite=Lax`;
        document.cookie = `subscription_status=${out.subscriptionStatus || 'trialing'}; Path=/; Max-Age=2592000; SameSite=Lax`;

        setMsg('Connexion réussie ✅ redirection...');
        router.replace('/');
      } catch (e: any) {
        console.error(e);
        setMsg(`Erreur: ${e.message || e}`);
      }
    })();
  }, []);

  return <main style={{ padding: 24 }}>{msg}</main>;
}

