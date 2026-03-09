// frontend/my-app/src/app/set-password/page.tsx

'use client'

import { Suspense, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

function SetPasswordInner() {
 const router = useRouter()
 const search = useSearchParams()

 const nextPath = (search.get('next') || '/').trim()
 const safeNext = nextPath.startsWith('/') ? nextPath : '/'

 const [password, setPassword] = useState('')
 const [confirmPassword, setConfirmPassword] = useState('')
 const [busy, setBusy] = useState(false)
 const [error, setError] = useState<string | null>(null)
 const [success, setSuccess] = useState<string | null>(null)

 const supabase = useMemo(() => {
   if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null
   return createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
 }, [])

 async function onSubmit(e: React.FormEvent) {
   e.preventDefault()
   setError(null)
   setSuccess(null)
   setBusy(true)

   try {
     if (!supabase) throw new Error('Configuration Supabase manquante')

     if (password.length < 8) {
       throw new Error('Le mot de passe doit contenir au moins 8 caractères.')
     }

     if (password !== confirmPassword) {
       throw new Error('Les mots de passe ne correspondent pas.')
     }

     const { error } = await supabase.auth.updateUser({ password })
     if (error) throw error

     setSuccess('Mot de passe enregistré ✅ Redirection…')

     setTimeout(() => {
       router.replace(safeNext)
     }, 900)
   } catch (e: any) {
     setError(e?.message || 'Erreur inconnue')
   } finally {
     setBusy(false)
   }
 }

 return (
   <main className="app-container" style={{ margin: '40px auto' }}>
     <section className="app-card p-6">
       <h1 className="text-2xl font-extrabold app-title">Créer ton mot de passe</h1>

       <p className="mt-2 app-muted">
         Ton accès est validé. Choisis maintenant un mot de passe pour tes prochaines connexions.
       </p>

       <form onSubmit={onSubmit} className="mt-5 grid gap-4">
         <label className="grid gap-1 text-sm font-semibold">
           Mot de passe
           <input
             type="password"
             value={password}
             onChange={(e) => setPassword(e.target.value)}
             required
             style={{
               background: 'white',
               border: '1px solid var(--border)',
               borderRadius: 10,
               padding: 10,
             }}
           />
         </label>

         <label className="grid gap-1 text-sm font-semibold">
           Confirmer le mot de passe
           <input
             type="password"
             value={confirmPassword}
             onChange={(e) => setConfirmPassword(e.target.value)}
             required
             style={{
               background: 'white',
               border: '1px solid var(--border)',
               borderRadius: 10,
               padding: 10,
             }}
           />
         </label>

         <button disabled={busy} type="submit" className="app-btn-primary mt-2">
           {busy ? 'Enregistrement…' : 'Créer mon mot de passe'}
         </button>
       </form>

       {error && (
         <div
           className="mt-4 app-card p-3 text-sm"
           style={{
             boxShadow: 'none',
             borderColor: 'rgba(176,0,32,0.25)',
             background: 'rgba(176,0,32,0.06)',
           }}
           >
           <strong style={{ color: '#b00020' }}>Erreur :</strong> {error}
         </div>
       )}

       {success && (
         <div
           className="mt-4 app-card p-3 text-sm"
           style={{
             boxShadow: 'none',
             borderColor: 'rgba(168,184,161,0.7)',
             background: 'rgba(168,184,161,0.15)',
           }}
           >
           <strong>{success}</strong>
         </div>
       )}
     </section>
   </main>
 )
}

export default function SetPasswordPage() {
 return (
   <Suspense fallback={<div style={{ padding: 24 }}>Chargement…</div>}>
     <SetPasswordInner />
   </Suspense>
 )
}