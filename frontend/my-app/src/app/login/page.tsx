'use client';

import { useState } from 'react';
import { API_URL } from '@/lib/api';           // ← on garde ton alias existant
import { useRouter } from 'next/navigation';

type LoginSuccess = { token: string };
type LoginError = { error: string };
type LoginResponse = LoginSuccess | LoginError | null;

function hasToken(obj: unknown): obj is LoginSuccess {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'token' in obj &&
    typeof (obj as Record<string, unknown>).token === 'string'
  );
}

function hasError(obj: unknown): obj is LoginError {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'error' in obj &&
    typeof (obj as Record<string, unknown>).error === 'string'
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const json = (await res.json().catch(() => null)) as LoginResponse;

      if (!res.ok || !hasToken(json)) {
        const message = hasError(json) ? json.error : `HTTP ${res.status}`;
        throw new Error(message);
      }

      // Stockage du JWT (démo). En prod: préférer un cookie httpOnly coté API.
      localStorage.setItem('token', json.token);

      // Redirige vers une page de test (health-check) après connexion
      router.push('/health-check');
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : typeof err === 'string' ? err : 'Erreur inconnue'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ padding: 24, maxWidth: 420 }}>
      <h1>Connexion</h1>
      <p style={{ color: '#666' }}>API: {API_URL || '(non définie)'}</p>

      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12, marginTop: 16 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ width: '100%', padding: 8 }}
          />
        </label>

        <label style={{ display: 'grid', gap: 6 }}>
          Mot de passe
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ width: '100%', padding: 8 }}
          />
        </label>

        <button disabled={busy} type="submit" style={{ padding: 10 }}>
          {busy ? 'Connexion…' : 'Se connecter'}
        </button>

        {error && <p style={{ color: 'crimson', marginTop: 8 }}>{error}</p>}
      </form>
    </main>
  );
}

