// api.ts

export const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_BASE ||
  process.env.NEXT_PUBLIC_API_URL;

if (!API_URL) {
  throw new Error(
    "Variable d'environnement manquante : NEXT_PUBLIC_BACKEND_URL (ou NEXT_PUBLIC_API_BASE / NEXT_PUBLIC_API_URL)"
  );
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;

  const customToken = localStorage.getItem("token");
  const supabaseToken =
    localStorage.getItem("sb:token") || sessionStorage.getItem("sb:token");

  return customToken || supabaseToken || null;
}

// Fonction générique pour appeler l’API avec typage
export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();

  const headers = new Headers(options.headers || {});
  const isFormData =
    typeof FormData !== "undefined" && options.body instanceof FormData;

  if (!headers.has("Content-Type") && !isFormData) {
    headers.set("Content-Type", "application/json");
  }
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const msg = (data as any)?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return data as T;
}
