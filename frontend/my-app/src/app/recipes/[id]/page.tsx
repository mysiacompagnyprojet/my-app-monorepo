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

type RecipeIngredient = {
 name: string
 quantity: number
 unit: string
 costRecipe?: number | null
 buyPriceEur?: number | null
}

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
 ingredients?: RecipeIngredient[]
}

type Limits = {
 blurPrices: boolean
 used: number
 limit: number
 remaining: number
}

type TopIngredient = {
 name: string
 cost: number
}

function getBudgetLevel(pricePerPerson: number | null) {
 if (pricePerPerson == null || !Number.isFinite(pricePerPerson)) return null

 if (pricePerPerson < 3) return 'smart'
 if (pricePerPerson <= 5) return 'medium'
 if (pricePerPerson <= 8) return 'high'
 return 'occasion'
}

export default function RecipeDetailPage() {
 const router = useRouter()
 const params = useParams()
 const id = String((params as any)?.id || '')

 const [recipe, setRecipe] = useState<Recipe | null>(null)
 const [loading, setLoading] = useState(true)
 const [err, setErr] = useState<string | null>(null)
 const [limits, setLimits] = useState<Limits | null>(null)

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
   if (isNum(recipe?.totalCostEur)) return Number(recipe?.totalCostEur)
   return ingredients.reduce((sum, ing) => sum + (isNum(ing.costRecipe) ? ing.costRecipe : 0), 0)
 }, [ingredients, recipe?.totalCostEur])

 const totalProductsCost = useMemo(() => {
   if (isNum(recipe?.totalCoursesEur)) return Number(recipe?.totalCoursesEur)
   return ingredients.reduce((sum, ing) => sum + (isNum(ing.buyPriceEur) ? ing.buyPriceEur : 0), 0)
 }, [ingredients, recipe?.totalCoursesEur])

 const missingBuyCount = ingredients.filter((ing) => !isNum(ing.buyPriceEur)).length

 const costPerServing = useMemo(() => {
   if (!recipe?.servings || recipe.servings <= 0) return null
   if (!totalRecipeCost || totalRecipeCost <= 0) return null
   return totalRecipeCost / recipe.servings
 }, [recipe?.servings, totalRecipeCost])

 const budgetLevel = useMemo(() => getBudgetLevel(costPerServing), [costPerServing])

 const topIngredients = useMemo<TopIngredient[]>(() => {
   return ingredients
     .map((ing) => ({
       name: String(ing.name || '').trim(),
       cost: isNum(ing.costRecipe) ? ing.costRecipe : 0,
     }))
     .filter((ing) => ing.name && ing.cost > 0)
     .sort((a, b) => b.cost - a.cost)
     .slice(0, 3)
 }, [ingredients])

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
           Erreur 401 : non connectée
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

       {limits && Number.isFinite(limits.limit) && (
         <div className="mt-3 text-sm app-muted">
           Analyses gratuites utilisées : {limits.used}/{limits.limit} • il reste {limits.remaining}
         </div>
       )}
     </section>

     {limits?.blurPrices && <PricingPaywallNotice remaining={limits.remaining} context="recipes" />}

     {/* Analyse */}
     {totalRecipeCost > 0 && (
       <section
         className="app-card p-6"
         style={{
           marginTop: 16,
           background: 'rgba(176,188,140,0.08)',
           border: '1px solid rgba(176,188,140,0.25)',
         }}
        >
         <h3
           style={{
             fontWeight: 800,
             marginBottom: 12,
             color: 'var(--primary)',
             fontSize: 18,
           }}
          > 
           Ce que coûte vraiment cette recette
         </h3>

         <div
           style={{
             fontSize: 13,
             opacity: 0.7,
             marginBottom: 12,
           }}
          >
           Les ingrédients les plus chers sont ceux qui font monter le budget.
         </div>

         {costPerServing && (
           <div style={{ marginBottom: 14 }}>
             <div className="app-muted" style={{ fontWeight: 700 }}>
               Prix par personne
             </div>

             <div style={{ fontSize: 20, fontWeight: 800 }}>
               <Price value={costPerServing} blur={blurPrices} />
             </div>

             <div
               style={{
                 fontSize: 13,
                 opacity: 0.7,
               }}
              > 
               {recipe.servings} portions
             </div>

             {budgetLevel && (
               <div
                 style={{
                   display: 'flex',
                   gap: 8,
                   flexWrap: 'wrap',
                   marginTop: 10,
                 }}
                >
                 <div
                   style={{
                     padding: '6px 12px',
                     borderRadius: 999,
                     fontSize: 13,
                     fontWeight: 700,
                     background:
                       budgetLevel === 'smart' ? 'rgba(176,188,140,0.28)' : 'rgba(0,0,0,0.06)',
                     color:
                       budgetLevel === 'smart' ? 'var(--primary)' : 'rgba(43,43,43,0.75)',
                   }}
                  >
                   Budget malin
                 </div>

                 <div
                   style={{
                     padding: '6px 12px',
                     borderRadius: 999,
                     fontSize: 13,
                     fontWeight: 700,
                     background:
                       budgetLevel === 'medium' ? 'rgba(230,190,120,0.30)' : 'rgba(0,0,0,0.06)',
                     color:
                       budgetLevel === 'medium' ? 'var(--primary)' : 'rgba(43,43,43,0.75)',
                   }}
                  >
                   Budget moyen
                 </div>

                 <div
                   style={{
                     padding: '6px 12px',
                     borderRadius: 999,
                     fontSize: 13,
                     fontWeight: 700,
                     background:
                       budgetLevel === 'high' ? 'rgba(180,120,120,0.18)' : 'rgba(0,0,0,0.06)',
                     color:
                       budgetLevel === 'high' ? 'var(--primary)' : 'rgba(43,43,43,0.75)',
                   }}
                  >
                   Budget élevé
                 </div>

                 <div
                   style={{
                     padding: '6px 12px',
                     borderRadius: 999,
                     fontSize: 13,
                     fontWeight: 700,
                     background:
                       budgetLevel === 'occasion'
                         ? 'rgba(123,68,46,0.16)'
                         : 'rgba(0,0,0,0.06)',
                     color:
                       budgetLevel === 'occasion' ? 'var(--primary)' : 'rgba(43,43,43,0.75)',
                   }}
                  >
                   Occasion
                 </div>
               </div>
             )}
           </div>
         )}

         {topIngredients.length > 0 && (
           <div>
             <div
               className="app-muted"
               style={{
                 fontWeight: 700,
                 marginBottom: 6,
               }}
              >
               Ce qui coûte le plus
             </div>

             <div style={{ display: 'grid', gap: 4 }}>
               {topIngredients.map((i, index) => (
                 <div
                   key={index}
                   style={{
                     display: 'flex',
                     justifyContent: 'space-between',
                     gap: 12,
                   }}
                  >
                   <span>
                     #{index + 1} {i.name}
                   </span>

                   <span
                     style={{
                       fontWeight: 700,
                       color: 'var(--primary)',
                       whiteSpace: 'nowrap',
                     }}
                    >
                     <Price value={i.cost} blur={blurPrices} />
                   </span>
                 </div>
               ))}
             </div>
           </div>
         )}
       </section>
     )}

     {/* Ingrédients */}
     <section className="app-card p-6" style={{ marginTop: 16 }}>
       <h3 className="text-lg font-extrabold">Ingrédients</h3>

       {ingredients.length ? (
         <div style={{ marginTop: 12 }}>
           {/* DESKTOP */}
           <div className="recipe-detail-table-desktop">
             <div className="recipe-detail-table-head app-muted">
               <div style={{ textAlign: 'right' }}>Qté</div>
               <div>Unité</div>
               <div style={{ paddingLeft: 14 }}>Ingrédient</div>
               <div style={{ textAlign: 'right' }}>Coût recette</div>
               <div style={{ textAlign: 'right' }}>Coût produit</div>
             </div>

             <div>
               {ingredients.map((ing, i) => (
                 <div key={i} className="recipe-detail-table-row">
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

             <div className="recipe-detail-table-total">
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
           </div>

           {/* MOBILE */}
           <div className="recipe-detail-mobile-list">
             {ingredients.map((ing, i) => (
               <div key={i} className="recipe-detail-mobile-card">
                 <div className="recipe-detail-mobile-name">{ing.name}</div>

                 <div className="recipe-detail-mobile-meta">
                   <span>
                     <strong>Qté :</strong> {formatQty(ing.quantity)}
                   </span>
                   <span>
                     <strong>Unité :</strong> {ing.unit}
                   </span>
                 </div>

                 <div className="recipe-detail-mobile-prices">
                   <div>
                     <div className="recipe-detail-mobile-label">Coût recette</div>
                     <div className="recipe-detail-mobile-value recipe-cost-recipe">
                       <Price
                         value={isNum(ing.costRecipe) ? ing.costRecipe : null}
                         blur={blurPrices}
                       />
                     </div>
                   </div>

                   <div>
                     <div className="recipe-detail-mobile-label">Coût produit</div>
                     <div className="recipe-detail-mobile-value recipe-cost-product">
                       <Price
                         value={isNum(ing.buyPriceEur) ? ing.buyPriceEur : null}
                         blur={blurPrices}
                       />
                     </div>
                   </div>
                 </div>
               </div>
             ))}

             <div className="recipe-detail-mobile-card recipe-detail-mobile-total">
               <div className="recipe-detail-mobile-name">Totaux</div>

               <div className="recipe-detail-mobile-prices">
                 <div>
                   <div className="recipe-detail-mobile-label">Coût recette</div>
                   <div className="recipe-detail-mobile-value recipe-cost-recipe">
                     <Price value={totalRecipeCost} blur={blurPrices} />
                   </div>
                 </div>

                 <div>
                   <div className="recipe-detail-mobile-label">Coût produit</div>
                   <div className="recipe-detail-mobile-value recipe-cost-product">
                     <Price value={totalProductsCost} blur={blurPrices} />
                   </div>
                 </div>
               </div>
             </div>
           </div>

           {missingBuyCount > 0 && (
             <p className="app-muted" style={{ marginTop: 10, fontSize: 12 }}>
               ⚠️ Coût produit manquant pour {missingBuyCount} ingrédient(s).
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