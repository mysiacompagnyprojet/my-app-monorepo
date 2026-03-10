// frontend/my-app/src/app/page.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

export default function Home() {
 const router = useRouter()
 const [checking, setChecking] = useState(true)

 const supabase = useMemo(() => {
   if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null
   return createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
 }, [])

 useEffect(() => {
   let mounted = true

   async function run() {
     if (!supabase) {
       if (mounted) setChecking(false)
       return
     }

     const { data } = await supabase.auth.getSession()

     // si déjà connectée, on peut envoyer vers les recettes
     if (data.session) {
       router.replace('/recipes')
       return
     }

     if (mounted) setChecking(false)
   }

   run()

   return () => {
     mounted = false
   }
 }, [supabase, router])

 if (checking) return null

 return (
 <main className="app-container" style={{ margin: '20px auto 40px' }}>
   <section className="app-card p-5 home-login-card">
     <h2 className="text-lg font-extrabold app-title">Connexion</h2>

     <p className="mt-1 app-muted text-sm">
       Connecte-toi pour accéder à MySia, enregistrer tes recettes et retrouver tes imports.
     </p>

     <div className="mt-4">
       <Link
         href="/login"
         className="app-btn app-btn-secondary"
         style={{ width: '100%', textAlign: 'center' }}
        >
         Se connecter
       </Link>
     </div>
   </section>
 </main>
)
}