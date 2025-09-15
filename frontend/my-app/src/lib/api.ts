// src/lib/api.ts

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val || val.trim() === '') {
    throw new Error(`Variable d'environnement manquante : ${name}`);
  }
  return val;
}

export const API_URL = requireEnv('NEXT_PUBLIC_API_URL');

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('token');
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();

  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  const data = (await res.json().catch(() => null)) as unknown;

  if (!res.ok) {
    // 🔧 Typage explicite de `message`
    const fromData = (data as { error?: unknown })?.error;
    const message: string =
      typeof fromData === 'string' ? fromData : `HTTP ${res.status}`;

    throw new globalThis.Error(message);
  }

  return data as T;
}

