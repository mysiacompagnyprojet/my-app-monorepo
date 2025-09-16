// src/lib/api.ts

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val || val.trim() === "") {
    throw new Error(`Variable d'environnement manquante : ${name}`);
  }
  return val;
}

export const API_URL = requireEnv("NEXT_PUBLIC_API_URL");

// Récupère le token depuis localStorage (client only)
export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();

  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data as any)?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return data as T;
}


