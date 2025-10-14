'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const API = process.env.NEXT_PUBLIC_BACKEND_URL!;
type Recipe = {
  id: string;
  title: string;
  servings: number;
  imageUrl: string | null;
  createdAt: string;
};

export default function RecipesListPage() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
    //ici
  useEffect(() => {
  (async () => {
    try {
      if (!API) throw new Error('NEXT_PUBLIC_BACKEND_URL manquante');

      // ✅ client Supabase (gère refresh auto en background)
      const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

      // 1) Récupère la session courante (token à jour si encore valide)
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error) throw error;

      // 2) Si pas de session → redirige vers /login
      if (!session?.access_token) {
        window.location.href = '/login?next=/recipes';
        return;
      }
      const token = session.access_token;

      // 3) Appelle l’API avec le token SUPABASE frais
      const r = await fetch(`${API}/recipes`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new Error(`GET /recipes a échoué (${r.status}) ${text}`);
      }

      const json = await r.json();
      setRecipes(json.recipes || []);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  })();
}, []);
  // a ici
  return (
    <main style={{ padding: 24 }}>
      <h1>📖 Mes recettes</h1>
      {loading && <p>Chargement…</p>}
      {err && <p style={{ color: 'crimson' }}>{err}</p>}

      {!loading && !err && (
        <ul
          style={{
            display: 'grid',
            gap: 16,
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px,1fr))',
          }}
        >
          {recipes.map((r) => (
            <li
              key={r.id}
              style={{
                border: '1px solid #eee',
                borderRadius: 12,
                padding: 12,
                background: '#fafafa',
              }}
            >
              {r.imageUrl ? (
                <img
                  src={r.imageUrl}
                  alt={r.title}
                  style={{
                    width: '100%',
                    height: 140,
                    objectFit: 'cover',
                    borderRadius: 8,
                    marginBottom: 8,
                  }}
                />
              ) : null}
              <div style={{ fontWeight: 600 }}>{r.title}</div>
              <div style={{ color: '#666', fontSize: 14 }}>
                Portions: {r.servings} •{' '}
                {new Date(r.createdAt).toLocaleDateString('fr-FR')}
              </div>
            </li>
          ))}
          {recipes.length === 0 && <p>Aucune recette pour le moment.</p>}
        </ul>
      )}
    </main>
  );
}
