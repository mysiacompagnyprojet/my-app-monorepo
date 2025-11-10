'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from 'src/lib/api'
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

// --- Styles PDF ---
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
      .then((r) => setRecipes(r.recipes))
      .catch((e) => setStatus('❌ ' + e.message))
  }, [])

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
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

  // --- Document PDF (utilise items + totals de l'état) ---
  function ListPDF() {
    return (
      <Document>
        <Page size="A4" style={pdfStyles.page}>
          <Text style={pdfStyles.h1}>Liste de courses</Text>

          {/* En-têtes colonnes */}
          <View style={pdfStyles.headerRow}>
            <Text style={pdfStyles.cellName}>Ingrédient</Text>
            <Text style={pdfStyles.cellQty}>Qté</Text>
            <Text style={pdfStyles.cellUnit}>Unité</Text>
            <Text style={pdfStyles.cellCost}>Coût recette (€)</Text>
            <Text style={pdfStyles.cellBuy}>Prix achat (€)</Text>
          </View>

          {/* Lignes ingrédients */}
          {items.map((it, i) => (
            <View key={i} style={pdfStyles.row}>
              <Text style={pdfStyles.cellName}>{it.name}</Text>
              <Text style={pdfStyles.cellQty}>{it.quantity}</Text>
              <Text style={pdfStyles.cellUnit}>{it.unit}</Text>
              <Text style={pdfStyles.cellCost}>
                {((it.recipeCost ?? 0).toFixed(2))} €
              </Text>
              <Text style={pdfStyles.cellBuy}>
                {((it.buyPrice ?? 0).toFixed(2))} €
              </Text>
            </View>
          ))}

          {/* Totaux */}
          {totals && (
            <View style={{ marginTop: 12 }}>
              <Text>
                Total coût de revient : {totals.recipeCost.toFixed(2)} €
              </Text>
              <Text>
                Total achat : {totals.buyPrice.toFixed(2)} €
              </Text>
            </View>
          )}
        </Page>
      </Document>
    )
  }

  return (
    <div style={{ maxWidth: 760, margin: '2rem auto' }}>
      <h1>Liste de courses</h1>

      <h3>Choisir des recettes</h3>
      <ul>
        {recipes.map((r) => (
          <li key={r.id}>
            <label>
              <input
                type="checkbox"
                checked={selected.includes(r.id)}
                onChange={() => toggle(r.id)}
              />
              {r.title}
            </label>
          </li>
        ))}
      </ul>

      <button onClick={buildList} disabled={selected.length === 0}>
        Générer la liste
      </button>
      <p>{status}</p>

      {items.length > 0 && (
        <>
          <h3>Ingrédients</h3>
          <table>
            <thead>
              <tr>
                <th>Ingrédient</th>
                <th>Qté</th>
                <th>Unité</th>
                <th>Coût recette (€)</th>
                <th>Prix achat (€)</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i}>
                  <td>{it.name}</td>
                  <td>{it.quantity}</td>
                  <td>{it.unit}</td>
                  <td>{(it.recipeCost ?? 0).toFixed(2)}</td>
                  <td>{(it.buyPrice ?? 0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {totals && (
            <p style={{ marginTop: '0.75rem' }}>
              <b>Total coût de revient :</b> {totals.recipeCost.toFixed(2)} € —{' '}
              <b>Total achat :</b> {totals.buyPrice.toFixed(2)} €
            </p>
          )}

          {/* Bouton Export PDF */}
          <div style={{ marginTop: '1rem' }}>
            <PDFDownloadLink
              document={<ListPDF />}
              fileName="liste-de-courses.pdf"
            >
              {({ loading }) => (
                <button disabled={loading}>
                  {loading ? 'Génération…' : 'Exporter en PDF'}
                </button>
              )}
            </PDFDownloadLink>
          </div>
        </>
      )}
    </div>
  )
}
