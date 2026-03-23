//frontend/my-app/src/app/create-account/page.tsx

'use client'

import Image from 'next/image'
import Link from 'next/link'
import { Suspense, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

function CreateAccountInner() {
 const search = useSearchParams()
 const nextPath = (search.get('next') || '/').trim() || '/'

 const [email, setEmail] = useState('')
 const [error, setError] = useState<string | null>(null)
 const [magicStatus, setMagicStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle')

 const supabase = useMemo(() => {
   if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null
   return createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
 }, [])

 async function handleMagicLink() {
   setMagicStatus('loading')
   setError(null)

   try {
     if (!supabase) {
       throw new Error(
         'Configuration Supabase manquante : NEXT_PUBLIC_SUPABASE_URL ou NEXT_PUBLIC_SUPABASE_ANON_KEY'
       )
     }

     const origin =
       typeof window !== 'undefined'
         ? window.location.origin
         : 'https://my-app-monorepo.vercel.app'

     const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(nextPath)}&setup=1`

     const { error } = await supabase.auth.signInWithOtp({
       email,
       options: { emailRedirectTo: redirectTo },
     })

     if (error) throw error
     setMagicStatus('sent')
   } catch (err: any) {
     setMagicStatus('error')
     setError(err?.message ?? 'Erreur magic link.')
   }
 }

 const supabaseConfigMissing = !SUPABASE_URL || !SUPABASE_ANON_KEY

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

         <div className="authPhoneWrap ">
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
         <h2 className="authTitle">Première connexion</h2>
         <p className="authText">
           Recevez un lien d’accès par email, puis créez votre mot de passe.
         </p>

         <div className="authSubCard">
           <h3 className="authSubTitle">Créer mon compte</h3>
           <p className="authHint">
             Entrez votre email pour recevoir votre lien d’accès sécurisé.
           </p>

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

           <button
             onClick={handleMagicLink}
             disabled={magicStatus === 'loading' || !email || supabaseConfigMissing}
             className="authPrimaryBtn"
             title={supabaseConfigMissing ? 'Variables Supabase manquantes' : undefined}
             type="button"
            >
             {magicStatus === 'loading'
               ? 'Envoi du lien…'
               : magicStatus === 'sent'
               ? 'Lien envoyé ✅'
               : 'Recevoir mon lien d’accès'}
           </button>
         </div>

         {magicStatus === 'sent' && (
           <div className="authAlertSuccess">
             Ouvre ton mail sur <strong>le même appareil</strong> et clique sur le lien.
           </div>
         )}

         {error && (
           <div className="authAlertError">
             <strong>Erreur :</strong> {error}
           </div>
         )}

         {supabaseConfigMissing && (
           <div className="authAlertError">
             <strong>Configuration manquante :</strong><br />
             Vérifie les variables Vercel : <code>NEXT_PUBLIC_SUPABASE_URL</code> et <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>.
           </div>
         )}

         <p className="authFooterLink">
           Déjà un compte ? <Link href="/login">Se connecter</Link>
         </p>
       </div>
     </section>
   </main>
 )
}

export default function CreateAccountPage() {
 return (
   <Suspense fallback={<div style={{ padding: 24 }}>Chargement…</div>}>
     <CreateAccountInner />
   </Suspense>
 )
}
