// frontend/my-app/src/app/recipes/[id]/page.tsx
'use client'

import { useEffect, useState, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'
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
 const [economySuggestions, setEconomySuggestions] = useState<any[]>([])

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

 useEffect(() => {
  if (!recipe) return
  if (!recipe.ingredients?.length) return

  const currentRecipe = recipe
  async function loadEconomy(){
    try{

      const res = await apiFetch('/recipes/economy-suggestion', {
        method: 'POST',
        body: JSON.stringify({
          ingredients: currentRecipe.ingredients,
          totalCostEur: currentRecipe.totalCostEur
        })
      })

      if(res?.suggestion) {
        setEconomySuggestions([res.suggestion])
      }
    }catch(e) {
      console.error(e)
    }
  }
  loadEconomy()
 },[recipe])

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
  <main className={`${inter.className} app-container recipe-detail-page`}>
    <section className="recipe-detail-hero">
      <div className="recipe-detail-hero__media">
        {recipe.imageUrl ? (
          <RecipeImagePreview imageUrl={recipe.imageUrl} />
        ) : (
        <div className="recipe-detail-hero__placeholder">
          <div className="recipe-detail-hero__placeholder-inner">
            <div className="recipe-detail-hero__placeholder-badge">+</div>
            <p className="recipe-detail-hero__placeholder-title">Aucune photo ajoutée</p>
            <p className="recipe-detail-hero__placeholder-text">
              Cette recette a été enregistrée sans image. Tu peux en ajouter une en la modifiant.
            </p>
          </div>  
        </div>
        )}
      </div>

      <div className="recipe-detail-hero__content">
        <div className="recipe-detail-hero__top">
          <div>
            <p className="recipe-detail-eyebrow">Recette enregistrée</p>

            <h1 className={`${playfair.className} recipe-detail-title`}>
              {recipe.title}
            </h1>

            <div className="recipe-detail-meta">
              <span className="recipe-detail-meta-badge">
                {recipe.servings} portion{recipe.servings > 1 ? 's' : ''}
              </span>

              <span className="recipe-detail-meta-date">
                Créée le {new Date(recipe.createdAt).toLocaleDateString('fr-FR')}
              </span>
            </div>
          </div>

          <div className="recipe-detail-actions">
            <button
              className="app-btn app-btn-utility"
              onClick={() => router.push(`/recipes/new?edit=${recipe.id}`)}
            >
              Modifier la recette
            </button>

            <button
              className="app-btn app-btn-secondary"
              onClick={() => router.push('/recipes')}
            >
              ← Retour
            </button>
          </div>
        </div>

        {limits && Number.isFinite(limits.limit) && (
          <p className="recipe-detail-limit-text">
            Analyses gratuites utilisées : {limits.used}/{limits.limit} • il reste {limits.remaining}
          </p>
        )}
      </div>
    </section>

    {limits?.blurPrices && (
      <PricingPaywallNotice remaining={limits.remaining} context="recipes" />
    )}

    <section className="recipe-detail-top-grid">
  <div className="recipe-detail-costs-card">
    <div className="recipe-detail-costs-grid">
      <div className="recipe-detail-cost-pill recipe-detail-cost-pill--recipe">
        <div className="recipe-detail-cost-label">Coût recette</div>
        <div className="recipe-detail-cost-value">
          ≈ <Price value={totalRecipeCost} blur={blurPrices} />
        </div>
      </div>

      <div className="recipe-detail-cost-pill recipe-detail-cost-pill--courses">
        <div className="recipe-detail-cost-label">Coût courses</div>
        <div className="recipe-detail-cost-value">
          ≈ <Price value={totalProductsCost} blur={blurPrices} />
        </div>
      </div>

      <div className="recipe-detail-cost-pill recipe-detail-cost-pill--serving">
        <div className="recipe-detail-cost-label">Prix par personne</div>
        <div className="recipe-detail-cost-value">
          ≈ <Price value={costPerServing} blur={blurPrices} />
        </div>
      </div>
    </div>
  </div>

  <div className="recipe-detail-right-col">
    {totalRecipeCost > 0 && (
      <section className="recipe-detail-analysis-card">
        <h2 className="recipe-detail-section-title">
          Ce que coûte vraiment cette recette
        </h2>

        {budgetLevel && (
          <div className="recipe-budget-pills recipe-detail-budget-pills">
            <div className={`recipe-budget-pill ${budgetLevel === 'smart' ? 'is-active' : ''}`}>
              Budget malin
            </div>

            <div className={`recipe-budget-pill ${budgetLevel === 'medium' ? 'is-active' : ''}`}>
              Budget moyen
            </div>

            <div className={`recipe-budget-pill ${budgetLevel === 'high' ? 'is-active' : ''}`}>
              Budget élevé
            </div>
          </div>
        )}

        {topIngredients.length > 0 && (
          <div className="recipe-detail-top-block">
            <h3 className="recipe-detail-subtitle">
              Les ingrédients les plus élevés
            </h3>

            <div className="recipe-detail-top-list">
              {topIngredients.map((i, index) => (
                <div key={index} className="recipe-detail-top-item">
                  <span>
                    • {index + 1} {i.name}
                  </span>

                  <span className="recipe-detail-top-price">
                    <Price value={i.cost} blur={blurPrices} />
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    )}

    {economySuggestions.length > 0 && (
      <section className="recipe-detail-economy-card">
        <h2 className="recipe-detail-section-title">
          Comment réduire le coût
        </h2>

        <div className="recipe-detail-accordion-list">
          {economySuggestions.map((s: any, i) => (
            <details key={i} className="recipe-detail-accordion">
              <summary className="recipe-detail-accordion-summary">
                <div className="recipe-detail-accordion-main">
                  <div className="recipe-detail-accordion-title">
                    {s.ingredientName}
                  </div>

                  {s.savingEur && (
                    <div className="recipe-detail-accordion-saving">
                      Économie estimée ≈ {s.savingEur.toFixed(2)} €
                    </div>
                  )}
                </div>

                <div className="recipe-detail-accordion-icon">+</div>
              </summary>

              <div className="recipe-detail-accordion-content">
                {s.substitutions?.length > 0 && (
                  <div>
                    <div className="recipe-detail-saving-label">
                      Alternatives possibles :
                    </div>

                    <div className="recipe-detail-saving-list">
                      {s.substitutions.map((sub: any, j: number) => (
                        <div key={j} className="recipe-detail-saving-item">
                          • {sub.name}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {s.newTotalEur && (
                  <div className="recipe-detail-accordion-metrics">
                    <div className="recipe-detail-saving-meta">
                      Nouveau coût recette ≈ {s.newTotalEur.toFixed(2)} €
                    </div>

                    <div className="recipe-detail-saving-meta">
                      Nouveau prix par personne ≈ {(s.newTotalEur / recipe.servings).toFixed(2)} €
                    </div>
                  </div>
                )}
              </div>
            </details>
          ))}
        </div>
      </section>
    )}
  </div>
</section>


    <section className="recipe-detail-section-card">
      <div className="recipe-detail-section-head">
        <h2 className="recipe-detail-section-title">Ingrédients</h2>
      </div>

      {ingredients.length ? (
        <div className="recipe-detail-section-body">
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
                      <Price value={isNum(ing.costRecipe) ? ing.costRecipe : null} blur={blurPrices} />
                    </div>
                  </div>

                  <div>
                    <div className="recipe-detail-mobile-label">Coût produit</div>
                    <div className="recipe-detail-mobile-value recipe-cost-product">
                      <Price value={isNum(ing.buyPriceEur) ? ing.buyPriceEur : null} blur={blurPrices} />
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
            <p className="recipe-detail-note">
              ⚠️ Coût produit manquant pour {missingBuyCount} ingrédient(s).
            </p>
          )}

          {blurPrices && (
            <p className="recipe-detail-note">
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

    <section className="recipe-detail-section-card">
      <div className="recipe-detail-section-head">
        <h2 className="recipe-detail-section-title">Étapes</h2>
      </div>

      {recipe.steps?.length ? (
        <div className="recipe-detail-steps-list">
          {recipe.steps.map((s, i) => {
            const isAlt = i % 2 === 1

            return (
              <div key={i} className={`recipe-step-card${isAlt ? ' is-alt' : ''}`}>
                <div style={{ marginBottom: 8 }}>
                  <span className="recipe-step-badge">Étape {i + 1}</span>
                </div>

                <div className="recipe-step-text">{String(s)}</div>
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