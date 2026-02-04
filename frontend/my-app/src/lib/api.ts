// frontend/my-app/src/lib/api.ts
// Fusion des 2 versions : URL robuste + token Supabase frais + fallback stockage.

import { supabase } from './supabase'

/** ————— Base URL ————— */
export const API_URL = (
process.env.NEXT_PUBLIC_BACKEND_URL ||
//process.env.NEXT_PUBLIC_API_BASE ||
//process.env.NEXT_PUBLIC_API_URL ||
''
).replace(/\/+$/, '')

if (!API_URL) {
throw new Error(
"Variable d'environnement manquante : NEXT_PUBLIC_BACKEND_URL (ou NEXT_PUBLIC_API_BASE / NEXT_PUBLIC_API_URL)"
)
}

/** ————— Tokens de secours (stockage) ————— */
export function getToken(): string | null {
if (typeof window === 'undefined') return null

const customToken = localStorage.getItem('token') // JWT maison éventuel
const supabaseToken = localStorage.getItem('sb:token') || sessionStorage.getItem('sb:token')

return customToken || supabaseToken || null
}

/** ————— Token Supabase « frais » ————— */
async function getLiveSupabaseToken(): Promise<string | null> {
try {
const {
data: { session },
} = await supabase.auth.getSession()
return session?.access_token || null
} catch {
return null
}
}

/** ————— Utilitaire: détecter FormData sans casser SSR ————— */
function isFormData(body: unknown): body is FormData {
return typeof FormData !== 'undefined' && body instanceof FormData
}

/** ————— apiFetch ————— */
export async function apiFetch<T = any>(path: string, options: RequestInit = {}): Promise<T> {
// 1) Token: Supabase « frais », puis fallback stockage
const live = await getLiveSupabaseToken()
const fallback = getToken()
const token = live || fallback || ''

// 2) Headers
const headers = new Headers(options.headers || {})
const bodyIsForm = isFormData(options.body)

if (!headers.has('Content-Type') && !bodyIsForm) {
headers.set('Content-Type', 'application/json')
}
if (token && !headers.has('Authorization')) {
headers.set('Authorization', `Bearer ${token}`)
}

// 3) Request
const url = `${API_URL}${path.startsWith('/') ? path : `/${path}`}`

const res = await fetch(url, {
...options,
headers,
// ✅ si ton backend utilise cookies / sessions, garde include.
// Sinon tu peux enlever sans casser.
credentials: options.credentials ?? 'include',
})

// 4) Errors
if (!res.ok) {
const maybeJson = await res.clone().json().catch(() => null)
if (maybeJson && (maybeJson as any).error) {
throw new Error((maybeJson as any).error)
}
const txt = await res.text().catch(() => '')
throw new Error(txt || `HTTP ${res.status}`)
}

// 5) Success
if (res.status === 204) return undefined as unknown as T

const ct = res.headers.get('content-type') || ''
if (ct.includes('application/json')) {
return (await res.json()) as T
}
return (await res.text()) as unknown as T
}