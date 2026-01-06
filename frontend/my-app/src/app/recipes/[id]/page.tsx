'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
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
  // si plus tard tu as ingredients/steps, tu les ajoutes ici
};

export default function RecipeDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = String(params?.id || '');

  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        if (!API) throw new Error('NEXT_PUBLIC_BACKEND_URL manquante');
        if (!id) throw new Error('ID recette manquant dans l’URL');

        const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) throw error;

        if (!session?.access_token) {
          window.location.href = `/login?next=/recipes/${encodeURIComponent(id)}`;
          return;
        }

        const token = session.access_token;

        // IMPORTANT : cette route doit exister côté backend:
        // GET /recipes/:id
        const r = await fetch(`${API}/recipes/${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'include',
        });

        if (!r.ok) {
          const text = await r.text().catch(() => '');
          throw new Error(`GET /recipes/${id} a échoué (${r.status}) ${text}`);
        }

        const json = await r.json();
        // on accepte { recipe: {...} } ou directement {...}
        const rec = (json?.recipe ?? json) as Recipe;
        if (!rec?.id) throw new Error('Réponse backend invalide (recipe manquante)');

        setRecipe(rec);
      } catch (e: any) {
        setErr(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [API, id]);

  return (
    <main className="app-container" style={{ margin: '40px auto' }}>
      <section className="app-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold app-title">📄 Détail recette</h1>
            <p className="mt-1 app-muted">ID : {id}</p>
          </div>

          <button
            className="app-btn-secondary"
            onClick={() => router.push('/recipes')}
            type="button"
          >
            ← Retour
          </button>
        </div>
      </section>

      {loading && (
        <section className="app-card p-5" style={{ marginTop: 16 }}>
          <p className="app-muted">Chargement…</p>
        </section>
      )}

      {err && (
        <section
          className="app-card p-5"
          style={{
            marginTop: 16,
            boxShadow: 'none',
            borderColor: 'rgba(176,0,32,0.25)',
            background: 'rgba(176,0,32,0.06)',
          }}
        >
          <p style={{ color: '#b00020', fontWeight: 800 }}>{err}</p>

          <p className="app-muted" style={{ marginTop: 10 }}>
            Si tu vois une erreur 404/405 ici : ça veut dire que ton backend n’a
            pas encore la route <b>GET /recipes/:id</b>.
          </p>
        </section>
      )}

      {!loading && !err && recipe && (
        <section className="app-card p-6" style={{ marginTop: 16 }}>
          {recipe.imageUrl ? (
            <img
              src={recipe.imageUrl}
              alt={recipe.title}
              style={{
                width: '100%',
                maxHeight: 360,
                objectFit: 'cover',
                borderRadius: 12,
                border: '1px solid var(--border)',
                marginBottom: 14,
              }}
            />
          ) : null}

          <h2 className="text-2xl font-extrabold" style={{ color: 'var(--text)' }}>
            {recipe.title}
          </h2>

          <div className="mt-2 text-sm app-muted">
            <span className="app-badge">Portions : {recipe.servings}</span>
            <span style={{ marginLeft: 10 }}>
              Créée le {new Date(recipe.createdAt).toLocaleDateString('fr-FR')}
            </span>
          </div>
        </section>
      )}
    </main>
  );
}
