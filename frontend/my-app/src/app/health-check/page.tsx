'use client';

import { useEffect, useState } from 'react';

type HealthOk = { status: 'ok' };
type HealthErr = { error: string };
type HealthResponse = HealthOk | HealthErr;

export default function Page() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkHealth() {
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_BACKEND_URL}/health`
        );
        const json: HealthResponse = await res.json();
        setData(json);
      } catch (err) {
        setData({ error: 'Connexion impossible au backend' });
      } finally {
        setLoading(false);
      }
    }
    checkHealth();
  }, []);

  if (loading) {
    return (
      <main className="app-container" style={{ margin: '60px auto' }}>
        <section className="app-card p-6 text-center">
          <p>⏳ Vérification du backend…</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-container" style={{ margin: '60px auto' }}>
      <section className="app-card p-6 text-center">
        {data && 'status' in data && data.status === 'ok' ? (
          <>
            <h1 className="text-xl font-extrabold app-title">État du système</h1>
            <p className="mt-3">✅ Backend opérationnel</p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-extrabold app-title">État du système</h1>
            <p className="mt-3" style={{ color: '#b00020', fontWeight: 700 }}>
              ❌ Backend indisponible
            </p>
            <p className="mt-2 app-muted text-sm">
              {(data as HealthErr)?.error}
            </p>
          </>
        )}
      </section>
    </main>
  );
}
