// frontend/my-app/src/app/recipes/page.tsx
'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import Price from '@/components/Price'
import PricingPaywallNotice from '@/components/PricingPaywallNotice'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const API = process.env.NEXT_PUBLIC_BACKEND_URL!

type Recipe = {
 id: string
 title: string
 servings: number
 imageUrl: string | null
 createdAt: string
 totalCostEur: number | null
 totalCoursesEur?: number | null
}

type Limits = {
  blurPrices: boolean
  used: number
  limit: number
  remaining: number
}

// ✅ 1) wrapper Suspense obligatoire
export default function RecipesPage() {
 return (
   <Suspense fallback={null}>
     <RecipesInner />
   </Suspense>
 )
}

// ✅ 2) ici seulement on lit useSearchParams
function RecipesInner() {
 const searchParams = useSearchParams()
 const cat = searchParams.get('cat') || ''

 const [recipes, setRecipes] = useState<Recipe[]>([])
 const [loading, setLoading] = useState(true)
 const [err, setErr] = useState<string | null>(null)
 const [limits, setLimits] = useState<Limits | null>(null)

 const filterLabel = useMemo(() => {
   if (!cat) return null
   return cat // (plus tard: label de catégorie)
 }, [cat])

 function getCostPerServing(recipe: Recipe) {
    const total = typeof recipe.totalCostEur === 'number' ? recipe.totalCostEur : null
    const servings = Number(recipe.servings || 0)

    if (total == null || !Number.isFinite(total) || servings <= 0) return null
      return total / servings
    }

    function getBudgetLabel(costPerServing: number | null) {
      if (costPerServing == null) return null
      if (costPerServing <= 2.5) return 'Budget léger'
      if (costPerServing <= 4.5) return 'Budget moyen'
    return 'Budget élevé'
  }

 useEffect(() => {
   let cancelled = false

   ;(async () => {
     try {
       setLoading(true)
       setErr(null)

       if (!API) throw new Error('NEXT_PUBLIC_BACKEND_URL manquante')

       const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
       const {
         data: { session },
         error,
       } = await supabase.auth.getSession()
       if (error) throw error

       if (!session?.access_token) {
         window.location.href = '/login?next=/recipes'
         return
       }

       const token = session.access_token
       const url = new URL(`${API}/recipes`)
       if (cat) url.searchParams.set('cat', cat)

       const r = await fetch(url.toString(), {
         headers: { Authorization: `Bearer ${token}` },
         credentials: 'include',
       })
       if (!r.ok) {
         const text = await r.text().catch(() => '')
         throw new Error(`GET /recipes a échoué (${r.status}) ${text}`)
       }

       const json = await r.json()
       console.log('RECIPES API', json.recipes)
       if (cancelled) return
       setRecipes(json.recipes || [])
       setLimits(json.limits || null)
     } catch (e: any) {
       if (cancelled) return
       setErr(e?.message || String(e))
     } finally {
       if (cancelled) return
       setLoading(false)
     }
   })()

   return () => {
     cancelled = true
   }
 }, [cat])

 return (
   <main style={{ marginTop: 24 }}>
     {cat && (
       <section
         className="app-card p-4"
         style={{
           marginTop: 12,
           boxShadow: 'none',
           background: 'rgba(139,106,79,0.06)',
           borderColor: 'rgba(139,106,79,0.18)',
           display: 'flex',
           alignItems: 'center',
           justifyContent: 'space-between',
           gap: 12,
         }}
         >
         <div className="app-muted" style={{ fontWeight: 800 }}>
           Filtre actif : <span style={{ color: 'var(--primary)' }}>{filterLabel}</span>
         </div>
         <a href="/recipes" className="app-btn app-btn-utility">
           Retirer
         </a>
       </section>
     )}

     {loading && (
       <section className="app-card p-5" style={{ marginTop: 16 }}>
         <p className="app-muted">Chargement…</p>
       </section>
     )}

     {err && (
       <section
         className="app-card p-5"
         style={{
           marginTop: 16,
           boxShadow: 'none',
           borderColor: 'rgba(176,0,32,0.25)',
           background: 'rgba(176,0,32,0.06)',
         }}
         >
         <p style={{ color: '#b00020', fontWeight: 800 }}>{err}</p>
       </section>
     )}

     {!loading && !err && limits?.blurPrices && (
      <PricingPaywallNotice remaining={limits.remaining} context="recipes" />
     )}

     {!loading && !err && (
       <section style={{ marginTop: 16 }}>
         {recipes.length === 0 ? (
           <div className="app-card p-6 text-center">
             <h2 className="text-lg font-extrabold app-title">Aucune recette pour le moment</h2>
             <p className="mt-2 app-muted">Commence par importer ou créer ta première recette.</p>
             <div className="mt-5">
               <a href="/import/ocr" className="app-btn-secondary">
                 Importer une recette
               </a>
               <span style={{ display: 'inline-block', width: 10 }} />
               <a href="/recipes/new" className="app-btn-primary">
                 Créer une recette
               </a>
             </div>
           </div>
         ) : (



           <ul className="recipes-grid">
  {recipes.map((r) => {
    const costPerServing = getCostPerServing(r)
    const budgetLabel = getBudgetLabel(costPerServing)

    return (
      <li key={r.id} className="recipes-card">
        <Link href={`/recipes/${r.id}`} className="recipes-card-link">
          {r.imageUrl ? (
            <img
              src={r.imageUrl}
              alt={r.title}
              className="recipes-card-image"
            />
          ) : (
            <div className="recipes-card-image recipes-card-image--placeholder">
              <span className="recipes-card-placeholder-text">Recette importée</span>
            </div>
          )}

          <div className="recipes-card-body">
            <h3 className="recipes-card-title">{r.title}</h3>

            {budgetLabel && (
              <div className="recipes-card-budget">
                <span 
                  className={`recipes-card-budget-badge ${
                    budgetLabel === 'Budget léger'
                    ? 'is-light'
                    : budgetLabel === 'Budget moyen'
                    ? 'is-medium'
                    : 'is-high'
                  }`}
                >
                  {budgetLabel}  
                </span>
              </div>
            )}

            <div className="recipes-card-price-main">
              <Price value={costPerServing} blur={limits?.blurPrices} />/pers
            </div>

            <div className="recipes-card-costs">
              <div>
                Coût recette : <Price value={r.totalCostEur} blur={limits?.blurPrices} />
              </div>
              <div>
                Coût courses : <Price value={r.totalCoursesEur} blur={limits?.blurPrices} />
              </div>
            </div>

            <div className="recipes-card-footer">
              <span className="recipes-card-servings">
                {r.servings} portion{r.servings > 1 ? 's' : ''}
              </span>

              <span className="recipes-card-date">
                {new Date(r.createdAt).toLocaleDateString('fr-FR')}
              </span>
            </div>
          </div>
        </Link>
      </li>
    )
  })}
</ul>






         )}
       </section>
     )}
   </main>
 )
}