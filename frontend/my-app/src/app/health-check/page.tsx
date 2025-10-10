'use client';

import { useEffect, useState } from 'react';

// On définit le type de réponse possible
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

  if (loading) return <main style={{ padding: 24 }}>⏳ Vérification...</main>;

  return (
    <main style={{ padding: 24, fontFamily: 'sans-serif' }}>
      {data && 'status' in data && data.status === 'ok' ? (
        <div>✅ Backend OK</div>
      ) : (
        <div style={{ color: 'red' }}>❌ Backend KO : {(data as HealthErr)?.error}</div>
      )}
    </main>
  );
}