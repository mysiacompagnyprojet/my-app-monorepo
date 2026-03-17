//frontend/src/app/login/page.tsx

'use client'

import Image from 'next/image'
import Link from 'next/link'
import { Suspense, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { API_URL } from '../../lib/api'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

function LoginInner() {
 const router = useRouter()
 const search = useSearchParams()

 const nextPath = (search.get('next') || '/').trim() || '/'

 const [email, setEmail] = useState('')
 const [password, setPassword] = useState('')
 const [busy, setBusy] = useState(false)
 const [error, setError] = useState<string | null>(null)

 const supabase = useMemo(() => {
   if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null
   return createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
 }, [])

 async function onSubmit(e: React.FormEvent) {
   e.preventDefault()
   setError(null)
   setBusy(true)

   try {
     if (!supabase) {
       throw new Error('Configuration Supabase manquante')
     }

     const { data, error } = await supabase.auth.signInWithPassword({
       email,
       password,
     })

     if (error) throw error
     if (!data.session?.access_token) {
       throw new Error('Session manquante après connexion')
     }

     localStorage.setItem('sb:token', data.session.access_token)

     const apiBase = API_URL || ''
     if (!apiBase) {
       throw new Error('API_URL manquante')
     }

     const syncUrl = `${apiBase.replace(/\/+$/, '')}/auth/sync`
     const r = await fetch(syncUrl, {
       method: 'POST',
       headers: {
         'Content-Type': 'application/json',
         Authorization: `Bearer ${data.session.access_token}`,
       },
       credentials: 'include',
       body: JSON.stringify({ from: 'password_login' }),
     })

     if (!r.ok) {
       const text = await r.text().catch(() => '')
       throw new Error(`Sync impossible (${r.status}) ${text}`)
     }

     router.push(nextPath)
   } catch (err: unknown) {
     setError(err instanceof Error ? err.message : typeof err === 'string' ? err : 'Erreur inconnue')
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

       <div className="authFormCard">
         <h2 className="authTitle">Connexion</h2>
         <p className="authText">Accédez à votre espace MySia en toute sécurité.</p>

         <form onSubmit={onSubmit} className="authForm">
           <label className="authLabel">
             Email
             <input
               className="authInput"
               type="email"
               value={email}
               onChange={(e) => setEmail(e.target.value)}
               required
             />
           </label>

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

           <button disabled={busy} type="submit" className="authPrimaryBtn">
             {busy ? 'Connexion…' : 'Se connecter'}
           </button>
         </form>

         {error && (
           <div className="authAlertError">
             <strong>Erreur :</strong> {error}
           </div>
         )}

         <p className="authFooterLink ">
           Première connexion ? <Link href="/create-account">Créer mon compte</Link>
         </p>
       </div>
     </section>
   </main>
 )
}

export default function LoginPage() {
 return (
   <Suspense fallback={<div style={{ padding: 24 }}>Chargement…</div>}>
     <LoginInner />
   </Suspense>
 )
}
