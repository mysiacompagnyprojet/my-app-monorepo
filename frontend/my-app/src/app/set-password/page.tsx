// frontend/my-app/src/app/set-password/page.tsx

'use client'

import Image from 'next/image'
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
   <main className="app-container authPage">
     <section className="authShell">
       <div className="authIntroCard">
         <p className="authEyebrow">Bienvenue sur</p>
         <h1 className="authIntroTitle">MySia</h1>

         <p className="authIntroText">
           Importez vos recettes et voyez leur vrai coût avant de faire les courses.
         </p>

         <ul className="authBenefits">
           <li><span className="authCheck">✓</span><span>Coût de la recette</span></li>
           <li><span className="authCheck">✓</span><span>Coût total des courses</span></li>
           <li><span className="authCheck">✓</span><span>Prix par personne</span></li>
         </ul>

         <div className="authPhoneWrap">
           <div className="authPhone">
             <div className="authPhoneImage">
               <Image
                 src="/landing-phone-shot.jpg"
                 alt="Aperçu MySia"
                 fill
                 className="authPhoneImageImg"
                 sizes="(max-width: 760px) 70vw, 270px"
                 priority
               />
             </div>
           </div>
         </div>
       </div>

       <section className="authFormCard">
         <h2 className="authTitle">Créer ton mot de passe</h2>

         <p className="authText">
           Ton accès est validé. Choisis maintenant un mot de passe pour tes prochaines connexions.
         </p>

         <form onSubmit={onSubmit} className="authForm">
           <label className="authLabel">
             Mot de passe
             <input
               className="authInput"
               type="password"
               value={password}
               onChange={(e) => setPassword(e.target.value)}
               required
             />
           </label>

           <label className="authLabel">
             Confirmer le mot de passe
             <input
               className="authInput"
               type="password"
               value={confirmPassword}
               onChange={(e) => setConfirmPassword(e.target.value)}
               required
             />
           </label>

           <button disabled={busy} type="submit" className="authPrimaryBtn">
             {busy ? 'Enregistrement…' : 'Créer ton mot de passe'}
           </button>
         </form>

         {error && (
           <div className="authAlertError">
             <strong>Erreur :</strong> {error}
           </div>
         )}

         {success && (
           <div className="authAlertSuccess">
             <strong>{success}</strong>
           </div>
         )}
       </section>
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
