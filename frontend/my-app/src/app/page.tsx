// frontend/my-app/src/app/page.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
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
    <main className="app-container landing-page">
      <section className="landing-hero app-card">
        <div className="landing-hero__grid">
          <div className="landing-hero__copy">
            <h1 className="landing-hero__title">
              Calculez le vrai prix des recettes des réseaux sociaux
            </h1>

            <p className="landing-hero__text">
              Importez une recette depuis Instagram, TikTok ou Pinterest et voyez son coût
              avant de faire les courses.
            </p>
          </div>

          <div className="landing-hero__visual">
            <div className="landing-phone-card">
              <div className="landing-phone-card__top">
                <span className="landing-phone-card__brand">MySia</span>
                <span className="landing-phone-card__menu">☰</span>
              </div>

              <div className="landing-phone-card__stats">
                <div>
                  <span className="landing-phone-card__label">Coût recette</span>
                  <strong>9,07 €</strong>
                </div>
                <div>
                  <span className="landing-phone-card__label">Coût courses</span>
                  <strong>29,25 €</strong>
                </div>
              </div>

              <div className="landing-phone-card__image">
                <Image
                  src="/imagehome copie.png"
                  alt="Aperçu MySia"
                  fill
                  className="landing-phone-card__img"
                  sizes="(max-width: 760px) 80vw, 320px"
                  priority
                />
              </div>

              <div className="landing-phone-card__bottom">
                <div>
                  <strong>1,81 €/pers</strong>
                  <span>5 portions</span>
                </div>
                <div>
                  <strong>1,34 €</strong>
                  <span>économie possible</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-how app-card">
        <h2 className="landing-section-title">Comment ça marche</h2>

        <div className="landing-how__grid">
          <article className="landing-step">
            <div className="landing-step__number">1</div>
            <div>
              <h3>Import rapide</h3>
              <p>Photo ou capture Instagram, TikTok ou Pinterest.</p>
            </div>
          </article>

          <article className="landing-step">
            <div className="landing-step__number">2</div>
            <div>
              <h3>Calculer</h3>
              <p>Coût par personne + économies possibles.</p>
            </div>
          </article>

          <article className="landing-step">
            <div className="landing-step__number">3</div>
            <div>
              <h3>Budget plus malin</h3>
              <p>Repérez les ingrédients les plus coûteux.</p>
            </div>
          </article>
        </div>
      </section>

      <section className="landing-cta app-card">
        <h2>
          Essayez MySia <span>gratuitement</span>
        </h2>

        <p>
          Transformez dès maintenant une recette en calculant son coût en 10 secondes.
        </p>

        <div className="landing-cta__actions">
          <Link href="/create-account" className="app-btn landing-btn-primary">
            Créer mon compte
          </Link>
        </div>
      </section>

      <section className="landing-mobile-extra app-card">
        <div className="landing-mobile-extra__actions">
          <Link href="/login" className="app-btn landing-btn-primary">
            Connexion
          </Link>
        </div>

        <div className="landing-mobile-benefits">
          <article>
            <h3>Import rapide</h3>
            <p>Coût des recettes. Photos, captures écran Instagram ou TikTok.</p>
          </article>

          <article>
            <h3>Prix immédiat</h3>
            <p>Coût recette + coût courses + prix/personne.</p>
          </article>

          <article>
            <h3>Budget plus malin</h3>
            <p>Repérez les ingrédients qui pèsent le plus dans la recette.</p>
          </article>
        </div>

        <div className="landing-mobile-extra__bottom">
          <Link href="/create-account" className="app-btn landing-btn-primary">
            Créer mon compte
          </Link>
        </div>
      </section>
    </main>
  )
}