// frontend/my-app/src/lib/api.ts
// Fusion des 2 versions : URL robuste + token Supabase frais + fallback stockage.

import { supabase } from './supabase' // ton client existant (côté front) :contentReference[oaicite:1]{index=1}

/** ————— Base URL (conserve ta logique actuelle) ————— */
export const API_URL =
  (process.env.NEXT_PUBLIC_BACKEND_URL ||
    process.env.NEXT_PUBLIC_API_BASE ||
    process.env.NEXT_PUBLIC_API_URL ||
    '').replace(/\/+$/, '')

if (!API_URL) {
  throw new Error(
    "Variable d'environnement manquante : NEXT_PUBLIC_BACKEND_URL (ou NEXT_PUBLIC_API_BASE / NEXT_PUBLIC_API_URL)"
  )
}

/** ————— Tokens de secours (stockage) —————
 * On garde la signature existante pour compatibilité.
 * NOTE: apiFetch() essaiera d'abord un token Supabase « frais ».
 */
export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  const customToken = localStorage.getItem('token') // ton JWT maison éventuel
  const supabaseToken =
    localStorage.getItem('sb:token') || sessionStorage.getItem('sb:token')
  return customToken || supabaseToken || null
}

/** ————— Token Supabase « frais » (interne) ————— */
async function getLiveSupabaseToken(): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token || null
  } catch {
    return null
  }
}

/** ————— Utilitaire: détecter FormData sans casser SSR ————— */
function isFormData(body: unknown): body is FormData {
  return typeof FormData !== 'undefined' && body instanceof FormData
}

/** ————— apiFetch générique —————
 * - Fetch `${API_URL}${path}`
 * - Ajoute Authorization: Bearer <token> (Supabase frais > stockage)
 * - Ne force pas Content-Type si FormData
 * - Retourne JSON si présent, sinon texte (ou void pour 204)
 */
export async function apiFetch<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  // 1) Token: Supabase « frais », puis fallback stockage
  const live = await getLiveSupabaseToken()
  const fallback = getToken()
  const token = live || fallback || ''

  // 2) Entêtes
  const headers = new Headers(options.headers || {})
  const bodyIsForm = isFormData(options.body)

  if (!headers.has('Content-Type') && !bodyIsForm) {
    headers.set('Content-Type', 'application/json')
  }
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  // 3) Requête
  const url = `${API_URL}${path.startsWith('/') ? path : `/${path}`}`
  const res = await fetch(url, { ...options, headers })

  // 4) Gestion erreurs: on essaye de lire une erreur lisible
  if (!res.ok) {
    // tente JSON d’erreur
    const maybeJson = await res.clone().json().catch(() => null)
    if (maybeJson && (maybeJson as any).error) {
      throw new Error((maybeJson as any).error)
    }
    // sinon, texte brut
    const txt = await res.text().catch(() => '')
    throw new Error(txt || `HTTP ${res.status}`)
  }

  // 5) Succès: JSON si content-type JSON, 204 => void, sinon texte
  if (res.status === 204) return undefined as unknown as T
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) {
    return (await res.json()) as T
  }
  const text = await res.text()
  // arobasets-expect-error — l’appelant peut typer <string> si besoin
  return text as T
}
