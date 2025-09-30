'use client'
import { useEffect, useState } from 'react'
import { apiFetch } from 'src/lib/api'

// --- Types ---
type Recipe = { id: string; title: string }
type Item = { name: string; quantity: number; unit: string; recipeCost?: number; buyPrice?: number }

type ListRecipesResponse = { recipes: Recipe[] }
type BuildListResponse = { items: Item[]; totals: { recipeCost: number; buyPrice: number } }

export default function ShoppingListPage() {
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [totals, setTotals] = useState<{ recipeCost: number; buyPrice: number } | null>(null)
  const [status, setStatus] = useState('')

  useEffect(() => {
    apiFetch<ListRecipesResponse>('/recipes')
      .then(r => setRecipes(r.recipes))
      .catch(e => setStatus('❌ ' + e.message))
  }, [])

  function toggle(id: string) {
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])
  }

  async function buildList() {
    setStatus('Calcul en cours...')
    try {
      const r = await apiFetch<BuildListResponse>('/shopping-list', {
        method: 'POST',
        body: JSON.stringify({ recipeIds: selected }),
      })
      setItems(r.items)
      setTotals(r.totals)
      setStatus('✅ Liste prête')
    } catch (e: any) {
      setStatus('❌ ' + e.message)
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: '2rem auto' }}>
      <h1>Liste de courses</h1>
      <h3>Choisir des recettes</h3>
      <ul>
        {recipes.map(r => (
          <li key={r.id}>
            <label>
              <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} />
              {r.title}
            </label>
          </li>
        ))}
      </ul>
      <button onClick={buildList} disabled={selected.length === 0}>Générer la liste</button>
      <p>{status}</p>

      {items.length > 0 && (
        <>
          <h3>Ingrédients</h3>
          <table>
            <thead>
              <tr>
                <th>Ingrédient</th><th>Qté</th><th>Unité</th><th>Coût recette (€)</th><th>Prix achat (€)</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i}>
                  <td>{it.name}</td><td>{it.quantity}</td><td>{it.unit}</td>
                  <td>{(it.recipeCost || 0).toFixed(2)}</td>
                  <td>{(it.buyPrice || 0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {totals && (
            <p>
              <b>Total coût de revient :</b> {totals.recipeCost.toFixed(2)} € —{" "}
              <b>Total achat :</b> {totals.buyPrice.toFixed(2)} €
            </p>
          )}
        </>
      )}
    </div>
  )
}
