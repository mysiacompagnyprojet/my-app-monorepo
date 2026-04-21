'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import {
  PDFDownloadLink,
  Page,
  Text,
  View,
  Document,
  StyleSheet,
} from '@react-pdf/renderer'

// --- Types ---
type Recipe = { id: string; title: string }
type Item = {
  name: string
  quantity: number
  unit: string
  recipeCost?: number
  buyPrice?: number
}

type ListRecipesResponse = { recipes: Recipe[] }
type BuildListResponse = {
  items: Item[]
  totals: { recipeCost: number; buyPrice: number }
}

// --- Styles PDF (INCHANGÉS) ---
const pdfStyles = StyleSheet.create({
  page: { padding: 24 },
  h1: { fontSize: 20, marginBottom: 12 },
  row: {
    flexDirection: 'row',
    fontSize: 12,
    borderBottom: 1,
    paddingVertical: 4,
  },
  headerRow: {
    flexDirection: 'row',
    fontSize: 12,
    paddingVertical: 6,
    marginBottom: 4,
    borderBottom: 2,
  },
  cellName: { width: '40%' },
  cellQty: { width: '15%' },
  cellUnit: { width: '15%' },
  cellCost: { width: '15%' },
  cellBuy: { width: '15%' },
})

// --- Composant principal ---
export default function ShoppingListPage() {
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [totals, setTotals] = useState<{ recipeCost: number; buyPrice: number } | null>(null)
  const [status, setStatus] = useState('')

  useEffect(() => {
  apiFetch<ListRecipesResponse>('/recipes')
    .then((r) => setRecipes(Array.isArray((r as any).recipes) ? (r as any).recipes : []))
    .catch((e) => setStatus('❌ ' + e.message))
  }, [])




  //useEffect(() => {
    //apiFetch<ListRecipesResponse>('/recipes')
      //.then((r) => setRecipes(r.recipes))
      //.catch((e) => setStatus('❌ ' + e.message))
  //}, [])

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  async function buildList() {
    setStatus('Calcul en cours…')
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

  // --- Document PDF (inchangé) ---
  function ListPDF() {
    return (
      <Document>
        <Page size="A4" style={pdfStyles.page}>
          <Text style={pdfStyles.h1}>Liste de courses</Text>

          <View style={pdfStyles.headerRow}>
            <Text style={pdfStyles.cellName}>Ingrédient</Text>
            <Text style={pdfStyles.cellQty}>Qté</Text>
            <Text style={pdfStyles.cellUnit}>Unité</Text>
            <Text style={pdfStyles.cellCost}>Coût recette (€)</Text>
            <Text style={pdfStyles.cellBuy}>Prix achat (€)</Text>
          </View>

          {items.map((it, i) => (
            <View key={i} style={pdfStyles.row}>
              <Text style={pdfStyles.cellName}>{it.name}</Text>
              <Text style={pdfStyles.cellQty}>{it.quantity}</Text>
              <Text style={pdfStyles.cellUnit}>{it.unit}</Text>
              <Text style={pdfStyles.cellCost}>
                {(it.recipeCost ?? 0).toFixed(2)} €
              </Text>
              <Text style={pdfStyles.cellBuy}>
                {(it.buyPrice ?? 0).toFixed(2)} €
              </Text>
            </View>
          ))}

          {totals && (
            <View style={{ marginTop: 12 }}>
              <Text>Total coût de revient : {totals.recipeCost.toFixed(2)} €</Text>
              <Text>Total achat : {totals.buyPrice.toFixed(2)} €</Text>
            </View>
          )}
        </Page>
      </Document>
    )
  }

  const statusKind =
    status.startsWith('✅') ? 'success' : status.startsWith('❌') ? 'error' : 'info'

  return (
    <main className="app-container" style={{ margin: '40px auto' }}>
      {/* En-tête */}
      <section className="app-card p-6">
        <h1 className="text-2xl font-extrabold app-title">Liste de courses</h1>
        <p className="mt-2 app-muted">
          Sélectionne des recettes et obtiens une liste claire, optimisée pour ton budget.
        </p>
      </section>

      {/* Sélection recettes */}
      <section className="app-card p-6" style={{ marginTop: 16 }}>
        <h2 className="text-lg font-extrabold app-title">Choisir des recettes</h2>

        {(recipes?.length ?? 0 ) === 0 ? (
          <p className="mt-3 app-muted">Aucune recette disponible.</p>
        ) : (
          <ul className="mt-4 grid gap-2" style={{ listStyle: 'none', padding: 0 }}>
            {recipes.map((r) => (
              <li
                key={r.id}
                className="app-card px-4 py-3"
                style={{
                  boxShadow: 'none',
                  background: 'rgba(255,255,255,0.7)',
                  borderColor: 'var(--border)',
                }}
              >
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.includes(r.id)}
                    onChange={() => toggle(r.id)}
                  />
                  <span className="font-medium">{r.title}</span>
                </label>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5">
          <button
            onClick={buildList}
            disabled={selected.length === 0}
            className="app-btn-primary"
          >
            Générer la liste
          </button>
        </div>

        {status && (
          <div
            className="mt-4 app-card p-3 text-sm"
            style={{
              boxShadow: 'none',
              borderColor:
                statusKind === 'success'
                  ? 'rgba(168,184,161,0.7)'
                  : statusKind === 'error'
                  ? 'rgba(176,0,32,0.25)'
                  : 'var(--border)',
              background:
                statusKind === 'success'
                  ? 'rgba(168,184,161,0.15)'
                  : statusKind === 'error'
                  ? 'rgba(176,0,32,0.06)'
                  : 'rgba(255,255,255,0.7)',
              fontWeight: 700,
              color: statusKind === 'error' ? '#b00020' : 'rgba(43,43,43,0.95)',
            }}
          >
            {status}
          </div>
        )}
      </section>

      {/* Résultat */}
      {items.length > 0 && (
        <section className="app-card p-6" style={{ marginTop: 16 }}>
          <h2 className="text-lg font-extrabold app-title">Ingrédients</h2>

          <div className="mt-4 overflow-x-auto">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)' }}>
                  <th align="left">Ingrédient</th>
                  <th>Qté</th>
                  <th>Unité</th>
                  <th>Coût recette (€)</th>
                  <th>Prix achat (€)</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td>{it.name}</td>
                    <td align="center">{it.quantity}</td>
                    <td align="center">{it.unit}</td>
                    <td align="center">{(it.recipeCost ?? 0).toFixed(2)}</td>
                    <td align="center">{(it.buyPrice ?? 0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totals && (
            <div className="mt-4 flex flex-wrap gap-4">
              <span className="app-badge">
                Coût de revient : {totals.recipeCost.toFixed(2)} €
              </span>
              <span className="app-badge">
                Total achat : {totals.buyPrice.toFixed(2)} €
              </span>
            </div>
          )}

          {/* Export PDF */}
          <div className="mt-6">
            <PDFDownloadLink
              document={<ListPDF />}
              fileName="liste-de-courses.pdf"
            >
              {({ loading }) => (
                <button className="app-btn-secondary" disabled={loading}>
                  {loading ? 'Génération…' : 'Exporter en PDF'}
                </button>
              )}
            </PDFDownloadLink>
          </div>
        </section>
      )}
    </main>
  )
}

