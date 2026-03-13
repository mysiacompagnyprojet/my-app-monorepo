// frontend/my-app/src/app/recipes/[id]/page.tsx
'use client'

import { useEffect, useState, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { apiFetch } from 'src/lib/api'
import { Inter, Playfair_Display } from 'next/font/google'
import { RecipeImagePreview } from '@/components/RecipeImagePreview'
import Price from '@/components/Price'
import PricingPaywallNotice from '@/components/PricingPaywallNotice'

// ✅ Police UI / structure
const inter = Inter({
 subsets: ['latin'],
 weight: ['400', '500', '600', '700'],
})

// ✅ Police titres recettes uniquement
const playfair = Playfair_Display({
 subsets: ['latin'],
 weight: ['400', '600', '700'],
})

type Recipe = {
 id: string
 title: string
 servings: number
 imageUrl: string | null
 createdAt: string
 notes?: string | null
 steps?: string[] | null
 totalCostEur?: number | null
 totalCoursesEur?: number | null
 ingredients?: Array<{
   name: string
   quantity: number
   unit: string
   costRecipe?: number | null
   // ⚠️ peut ne pas exister selon ce que renvoie le backend
   buyPriceEur?: number | null
 }>
}

type Limits = {
  blurPrices: boolean
  used: number
  limit: number
  remaining: number
}

export default function RecipeDetailPage() {
 const router = useRouter()
 const params = useParams()
 const id = String((params as any)?.id || '')

 const [recipe, setRecipe] = useState<Recipe | null>(null)
 const [loading, setLoading] = useState(true)
 const [err, setErr] = useState<string | null>(null)

 const [limits, setLimits] = useState<Limits | null>(null)

 // ─────────────────────────────────────────────
 // FETCH RECETTE
 // ─────────────────────────────────────────────
 useEffect(() => {
   if (!id) return

   ;(async () => {
     try {
       setLoading(true)
       setErr(null)

       const json = await apiFetch<{ ok?: boolean; recipe?: Recipe; limits?: Limits }>(
         `/recipes/${encodeURIComponent(id)}`,
         { method: 'GET' }
       )
       const rec = (json as any)?.recipe ?? json
       if (!rec?.id) throw new Error('Réponse backend invalide (recipe manquante)')

       setRecipe(rec)
       setLimits((json as any)?.limits ?? null)
     } catch (e: any) {
       setErr(e?.message || String(e))
     } finally {
       setLoading(false)
     }
   })()
 }, [id])

 const blurPrices = Boolean(limits?.blurPrices)

 const ingredients = recipe?.ingredients ?? []

  const formatQty = (q: number) => {
  const s = Number.isFinite(q) ? String(q) : ''
    return s.replace('.', ',')
  }

  const isNum = (v: any): v is number => typeof v === 'number' && Number.isFinite(v)

  const totalRecipeCost = useMemo(() => {
    return ingredients.reduce((sum, ing: any) => sum + (isNum(ing.costRecipe) ? ing.costRecipe : 0), 0)
  }, [ingredients])

  //const totalProductsCost = useMemo(() => {
    //return ingredients.reduce((sum, ing: any) => sum + (isNum(ing.buyPriceEur) ? ing.buyPriceEur : 0), 0)
  //}, [ingredients])
  const totalProductsCost = recipe?.totalCoursesEur ?? 0
  const missingBuyCount = ingredients.filter((ing: any) => !isNum(ing.buyPriceEur)).length

 // ─────────────────────────────────────────────
 // ÉTATS BLOQUANTS
 // ─────────────────────────────────────────────
 if (loading) {
   return (
     <main className={`${inter.className} app-container`} style={{ margin: '40px auto' }}>
       <section className="app-card p-5">
         <p className="app-muted">Chargement…</p>
       </section>
     </main>
   )
 }

 if (err) {
   return (
     <main className={`${inter.className} app-container`} style={{ margin: '40px auto' }}>
       <section
         className="app-card p-5"
         style={{
           borderColor: 'rgba(176,0,32,0.25)',
           background: 'rgba(176,0,32,0.06)',
         }}
         >
         <p style={{ color: '#b00020', fontWeight: 800 }}>{err}</p>

         <p className="app-muted" style={{ marginTop: 10 }}>
           Erreur 401 : non connectée (token manquant / expiré)
           <br />
           Erreur 404 : recette inexistante ou pas à toi
         </p>

         <button
           className="app-btn-secondary"
           style={{ marginTop: 12 }}
           onClick={() => router.push('/recipes')}
         >
           ← Retour
         </button>
       </section>
     </main>
   )
 }

 if (!recipe) {
   return (
     <main className={`${inter.className} app-container`} style={{ margin: '40px auto' }}>
       <section className="app-card p-5">
         <p className="app-muted">Aucune recette trouvée</p>
       </section>
     </main>
   )
 }

 // ─────────────────────────────────────────────
 // AFFICHAGE NORMAL
 // ─────────────────────────────────────────────
 return (
   <main className={`${inter.className} app-container`} style={{ margin: '40px auto' }}>
     {/* Header */}
     <section className="app-card p-6">
       <div className="flex flex-wrap items-center justify-between gap-3">
         <div>
           <h1 className="text-2xl font-extrabold">📄 Détail recette</h1>
           <p className="app-muted">ID : {recipe.id}</p>
         </div>

         <button className="app-btn-secondary" onClick={() => router.push('/recipes')}>
           ← Retour
         </button>
       </div>
     </section>

     {/* Image + titre */}
     <section className="app-card p-6" style={{ marginTop: 16 }}>
       <RecipeImagePreview imageUrl={recipe.imageUrl} />

       {/* ✅ Titre recette en Playfair Display */}
       <h2
         className={playfair.className}
         style={{
           fontSize: 30,
           fontWeight: 700,
           lineHeight: 1.15,
           marginBottom: 6,
         }}
         >
         {recipe.title}
       </h2>

       <div className="mt-2 text-sm app-muted">
         <span className="app-badge">Portions : {recipe.servings}</span>
         <span style={{ marginLeft: 10 }}>
           Créée le {new Date(recipe.createdAt).toLocaleDateString('fr-FR')}
         </span>
       </div>

       {/* ✅ compteur freenium (si limits dispo) */}
       {limits && Number.isFinite(limits.limit) && (
         <div className="mt-3 text-sm app-muted">
           Pricing gratuit : {limits.used}/{limits.limit} • reste {limits.remaining}
         </div>
       )}
     </section>

       {limits?.blurPrices && (
        <PricingPaywallNotice remaining={limits.remaining} context="recipes"/>
       )}

     {/* Ingrédients */}
     <section className="app-card p-6" style={{ marginTop: 16 }}>
       <h3 className="text-lg font-extrabold">Ingrédients</h3>

       {ingredients.length ? (
         <div style={{ marginTop: 12 }}>
           {/* En-tête */}
           <div
             className="app-muted"
             style={{
               display: 'grid',
               gridTemplateColumns: '90px 70px 1fr 110px 110px',
               columnGap: 12,
               padding: '8px 10px',
               borderBottom: '1px solid var(--border)',
               fontSize: 12,
             }}
             >
             <div style={{ textAlign: 'right' }}>Qté</div>
             <div>Unité</div>
             <div style={{ paddingLeft: 14 }}>Ingrédient</div>
             <div style={{ textAlign: 'right' }}>Coût recette</div>
             <div style={{ textAlign: 'right' }}>Coût produit</div>
           </div>

           {/* Lignes */}
           <div>
             {ingredients.map((ing: any, i: number) => (
               <div
                 key={i}
                 style={{
                   display: 'grid',
                   gridTemplateColumns: '90px 70px 1fr 110px 110px',
                   columnGap: 12,
                   padding: '10px 10px',
                   borderBottom: '1px solid rgba(0,0,0,0.06)',
                   alignItems: 'baseline',
                 }}
                 >
                 <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                   {formatQty(ing.quantity)}
                 </div>

                 <div style={{ opacity: 0.85 }}>{ing.unit}</div>

                 <div style={{ paddingLeft: 14 }}>{ing.name}</div>

                 <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                   <Price value={isNum(ing.costRecipe) ? ing.costRecipe : null} blur={blurPrices} />
                 </div>

                 <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                   <Price value={isNum(ing.buyPriceEur) ? ing.buyPriceEur : null} blur={blurPrices} />
                 </div>
               </div>
             ))}
           </div>

           {/* Totaux */}
           <div
             style={{
               display: 'grid',
               gridTemplateColumns: '90px 70px 1fr 110px 110px',
               columnGap: 12,
               padding: '12px 10px 0',
               alignItems: 'baseline',
             }}
             >
             <div />
             <div />
             <div style={{ paddingLeft: 14, fontWeight: 800 }}>Totaux</div>

             <div style={{ textAlign: 'right', fontWeight: 800 }}>
               <Price value={totalRecipeCost} blur={blurPrices} />
             </div>

             <div style={{ textAlign: 'right', fontWeight: 800 }}>
               <Price value={totalProductsCost} blur={blurPrices} />
             </div>
           </div>

           {missingBuyCount > 0 && (
             <p className="app-muted" style={{ marginTop: 10, fontSize: 12 }}>
               ⚠️ Coût produit manquant pour {missingBuyCount} ingrédient(s) (pas encore enrichi ou pas
               trouvé).
             </p>
           )}

           {blurPrices && (
             <p className="app-muted" style={{ marginTop: 10, fontSize: 12 }}>
               🔒 Limite gratuite atteinte : les prix sont floutés.
             </p>
           )}
         </div>
       ) : (
         <p className="app-muted" style={{ marginTop: 10 }}>
           Aucun ingrédient
         </p>
       )}
     </section>

     {/* Étapes */}
     <section className="app-card p-6" style={{ marginTop: 16 }}>
       <h3 className="text-lg font-extrabold">Étapes</h3>

       {recipe.steps?.length ? (
         <div style={{ marginTop: 12 }}>
           {recipe.steps.map((s, i) => {
             const isAlt = i % 2 === 1

             return (
               <div
                 key={i}
                 className={`recipe-step-card${isAlt ? ' is-alt' : ''}`}
                 style={{
                   margin: '0 0 16px 0',
                   width: '100%',
                   maxWidth: 650,
                   background: 'var(--bg)',
                   border: '1px solid var(--border)',
                   borderRadius: 20,
                   padding: '12px 14px',
                 }}
                 >
                 <div style={{ marginBottom: 8 }}>
                   <span
                     style={{
                       display: 'inline-block',
                       fontSize: 11,
                       fontWeight: 500,
                       lineHeight: '18px',
                       padding: '0 8px',
                       borderRadius: 999,
                       background: 'rgba(122, 92, 67, 0.10)',
                       border: '1px solid rgba(122, 92, 67, 0.14)',
                       color: 'var(--primary)',
                       verticalAlign: 'middle',
                     }}
                     >
                     Étape {i + 1}
                   </span>
                 </div>

                 <div
                   style={{
                     whiteSpace: 'pre-wrap',
                     lineHeight: 1.65,
                     fontSize: 14,
                   }}
                   >
                   {String(s)}
                 </div>
               </div>
             )
           })}
         </div>
       ) : (
         <p className="app-muted" style={{ marginTop: 10 }}>
           Aucune étape
         </p>
       )}
     </section>
   </main>
 )
}