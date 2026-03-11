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
    <section className="seo-block">
 <div className="hero-layout">
   <div className="hero-copy">
     <p className="hero-kicker">
       Calculer le prix réel des recettes des réseaux sociaux
     </p>

     <h1>Importez une recette. Voyez son prix. Décidez.</h1>

     <p className="hero-description">
       MySia permet d'importer des recettes depuis Instagram, TikTok ou Pinterest
       et de voir immédiatement combien elles vont coûter avant de faire les courses.
     </p>

     <div className="value-box">
       <h2>Décidez avant de faire les courses</h2>
       <p>
         Visualisez le coût total de la recette et le coût total des courses
         pour éviter les mauvaises surprises en caisse.
       </p>
     </div>
   </div>

   <div className="hero-visual">
     <div className="hero-image-placeholder">
       Capture MySia à venir
     </div>
   </div>
 </div>

 <div className="features-section">
  <div className="features-grid">

   <div className="feature-card">
    <div className="feature-head">
 <div className="feature-icon">📷</div>
 <h3>Importer</h3>
 </div>
 <p>Importez une recette depuis une photo.</p>
</div>

<div className="feature-card">
  <div className="feature-head">
 <div className="feature-icon">🧮</div>
 <h3>Calculer</h3>
 </div>
 <p>Visualisez immédiatement le coût total de la recette.</p>
</div>

<div className="feature-card">
  <div className="feature-head">
 <div className="feature-icon">🧾</div>
 <h3>Détailler</h3>
 </div>
 <p>Consultez le prix des ingrédients.</p>
</div>

<div className="feature-card">
   <div className="feature-head">
 <div className="feature-icon">🔖</div>
 <h3>Enregistrer</h3>
 </div>
 <p>Gardez vos recettes au même endroit.</p>
</div>
  
 </div>

 <div className="audience-section">
   <h2>Pour qui</h2>

   <p>
     MySia s’adresse aux <strong>parents</strong>, <strong>aux familles</strong> et à toute personne souhaitant
     cuisiner en maîtrisant son budget courses.
   </p>

   <p className="availability">Disponible en version web.</p>
   </div>
 </div>
</section>

  </main>
)}