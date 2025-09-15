'use client';

import { useEffect, useState } from 'react';

type HealthResponse = { ok: boolean } | { error: string };

export default function HealthCheckPage() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const api = process.env.NEXT_PUBLIC_API_URL;
    // Sécurise si la variable est absente
    if (!api) {
      setData({ error: 'NEXT_PUBLIC_API_URL manquante côté frontend' });
      setLoading(false);
      return;
    }

    fetch(`${api}/health`, { method: 'GET' })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(json?.error || `HTTP ${res.status}`);
        }
        setData(json || { error: 'Réponse vide' });
      })
      .catch((err: any) => {
        setData({ error: String(err?.message || err) });
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <main style={{ padding: 24 }}>
      <h1>Test API Render</h1>
      <p>
        <strong>Tester /health</strong>
      </p>

      {loading && <p>Chargement…</p>}

      {!loading && (
        <>
          <h2>Résultat</h2>
          <pre
            style={{
              background: '#f5f5f5',
              padding: 12,
              borderRadius: 8,
              overflowX: 'auto',
            }}
          >
            {JSON.stringify(data, null, 2)}
          </pre>
          <p style={{ marginTop: 8, color: '#666' }}>
            NEXT_PUBLIC_API_URL = {process.env.NEXT_PUBLIC_API_URL || '(non définie)'}
          </p>
        </>
      )}
    </main>
  );
}
