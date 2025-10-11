'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const API = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || '';

if (process.env.NODE_ENV === 'production' && !API) {
  throw new Error('NEXT_PUBLIC_BACKEND_URL manquante en production');
}

export default function SupabaseCallbackPage() {
  const [msg, setMsg] = useState('Connexion en cours...');
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    (async () => {
      try {
        // 0) erreur supabase dans le hash ?
        if (typeof window !== 'undefined' && window.location.hash.includes('error=')) {
          const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
          const err = hash.get('error');
          const code = hash.get('error_code');
          throw new Error(`Supabase a renvoyé une erreur: ${err} (${code}). Renvoie-toi un lien magique et ouvre-le dans le même navigateur.`);
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        // 1) échange code -> session
        const code = searchParams.get('code');
        if (code) {
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
          if (data.session?.access_token) {
            localStorage.setItem('sb:token', data.session.access_token);
          }
        }

        // 2) récup session
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!session?.access_token) throw new Error('Aucune session active. Le lien a peut-être expiré.');
        const token = session.access_token;

        // 3) sync backend
        if (!API) {
          console.warn('NEXT_PUBLIC_BACKEND_URL est vide; saut de la synchronisation backend.');
        } else {
          const r = await fetch(`${API}/auth/sync`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({ ping: true }),
            credentials: 'include',
          });

          if (!r.ok) {
            let text = '';
            try { text = await r.text(); } catch {}
            throw new Error(`Appel /auth/sync a échoué (${r.status}). ${text || 'Aucun corps de réponse'}`);
          }

          // 👇 tu avais supprimé cette ligne par inadvertance
          const out: { userId?: string; subscriptionStatus?: string } = await r.json();

          if (!out?.userId) {
            throw new Error('Réponse /auth/sync invalide: userId manquant');
          }

          // Cookies lisibles par le middleware Next (dev / non httpOnly)
          const oneMonth = 60 * 60 * 24 * 30;
          const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
          const secureAttr = isHttps ? '; Secure' : '';
          const domainAttr = ''; // ex: '; Domain=mondomaine.com' en prod sur domaine

          document.cookie = `user_id=${out.userId}; Path=/; Max-Age=${oneMonth}; SameSite=Lax${secureAttr}${domainAttr}`;
          document.cookie = `subscription_status=${out.subscriptionStatus || 'trialing'}; Path=/; Max-Age=${oneMonth}; SameSite=Lax${secureAttr}${domainAttr}`;
        }

        setMsg('Connexion réussie ✅ redirection...');
        router.replace('/');
      } catch (e: any) {
        console.error(e);
        setMsg(`Erreur: ${e?.message ?? String(e)}`);
      }
    })();
  }, [searchParams, router]);

  return <main style={{ padding: 24 }}>{msg}</main>;
}
