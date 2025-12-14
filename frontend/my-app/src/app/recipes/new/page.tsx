'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { apiFetch } from 'src/lib/api'

type Line = { name: string; quantity: number; unit: string }

type Draft = {
  title?: string
  servings?: number
  imageUrl?: string | null
  notes?: string | null
  steps?: string[]
  ingredients?: Array<Line | { raw: string } | string>
  trash?: string[]
}

/* ──────────────────────────────────────────────────────────────
   Helpers quantité : accepte 1/4, 1 1/2, 1,2
────────────────────────────────────────────────────────────── */

function parseQtyInput(raw: string): number {
  const s = String(raw || '').trim()
  if (!s) return 0

  // mix "1 1/2"
  const mix = s.match(/^\s*(\d+)\s+(\d+)\s*\/\s*(\d+)\s*$/)
  if (mix) {
    const a = Number(mix[1])
    const b = Number(mix[2])
    const c = Number(mix[3])
    if (Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && c !== 0) return a + b / c
  }

  // fraction "1/4"
  const frac = s.match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/)
  if (frac) {
    const a = Number(frac[1])
    const b = Number(frac[2])
    if (Number.isFinite(a) && Number.isFinite(b) && b !== 0) return a / b
  }

  // décimal FR "1,2"
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

function formatQtyForInput(n: number): string {
  if (!Number.isFinite(n)) return ''
  if (n === 0) return ''
  return String(n)
}

function NewRecipeInner() {
  const router = useRouter()
  const search = useSearchParams()

  const [title, setTitle] = useState('')
  const [servings, setServings] = useState(1)
  const [imageUrl, setImageUrl] = useState('')
  const [notes, setNotes] = useState('')
  const [steps, setSteps] = useState<string[]>([''])
  const [ingredients, setIngredients] = useState<Line[]>([{ name: '', quantity: 0, unit: '' }])
  const [qtyInputs, setQtyInputs] = useState<string[]>([''])
  const [trash, setTrash] = useState<string>('')
  const [status, setStatus] = useState<string>('')

  const prefill = useMemo(() => search.get('prefill') === '1', [search])

  useEffect(() => {
    if (!prefill) return

    try {
      const raw = sessionStorage.getItem('recipeDraft')
      if (!raw) return

      const d: Draft = JSON.parse(raw)

      setTitle(String(d.title || ''))
      setServings(Number(d.servings || 1) || 1)
      setImageUrl(String(d.imageUrl || ''))
      setNotes(String(d.notes || ''))

      const s = Array.isArray(d.steps) ? d.steps.map((x) => String(x || '').trim()).filter(Boolean) : []
      setSteps(s.length ? s : [''])

      const ing = Array.isArray(d.ingredients) ? d.ingredients : []
      const normalized = ing
  .map((row: any): Line | null => {
    if (!row) return null
    if (typeof row === 'string') return { name: row, quantity: 0, unit: '' }
    if (row.raw) return { name: String(row.raw), quantity: 0, unit: '' }

    return {
      name: String(row.name || '').trim(),
      quantity: Number(row.quantity || 0) || 0,
      unit: String(row.unit || ''),
    }
  })
  .filter((x): x is Line => x !== null)


      const finalIngredients = normalized.length ? normalized : [{ name: '', quantity: 0, unit: '' }]
      setIngredients(finalIngredients)
      setQtyInputs(finalIngredients.map((r) => formatQtyForInput(r.quantity)))

      const tr = Array.isArray(d.trash) ? d.trash.map((x) => String(x || '').trim()).filter(Boolean) : []
      setTrash(tr.join('\n'))
    } catch (e) {
      console.error('prefill parse error', e)
    }
  }, [prefill])

  function setIngredient(idx: number, patch: Partial<Line>) {
    setIngredients((prev) => {
      const copy = [...prev]
      copy[idx] = { ...copy[idx], ...patch }
      return copy
    })
  }

  function setQtyInput(idx: number, raw: string) {
    setQtyInputs((prev) => {
      const copy = [...prev]
      copy[idx] = raw
      return copy
    })
    setIngredient(idx, { quantity: parseQtyInput(raw) })
  }

  async function save() {
    try {
      setStatus('⏳ Enregistrement…')

      const payload = {
        title: title.trim() || 'Recette',
        servings: Number(servings || 1) || 1,
        imageUrl: imageUrl.trim() || null,
        notes: (notes || '').trim(),
        steps: steps.map((s) => String(s || '').trim()).filter(Boolean),
        ingredients: ingredients
          .map((i) => ({
            name: String(i.name || '').trim(),
            quantity: Number(i.quantity || 0) || 0,
            unit: String(i.unit || '').trim(),
          }))
          .filter((i) => i.name),
      }

      const res = await apiFetch('/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const txt = await res.text()
        setStatus('❌ ' + txt)
        return
      }

      setStatus('✅ Recette enregistrée')
      try {
        sessionStorage.removeItem('recipeDraft')
      } catch {}
      router.push('/recipes')
    } catch (e: any) {
      setStatus('❌ ' + (e?.message || 'Erreur'))
    }
  }

  return (
    <main style={{ padding: 24, maxWidth: 820, margin: '2rem auto' }}>
      <h1>Nouvelle recette</h1>

      {trash.trim() && (
        <details style={{ margin: '12px 0', padding: 12, border: '1px solid #eee', borderRadius: 10 }}>
          <summary style={{ cursor: 'pointer' }}>🗑️ Corbeille (texte non-recette détecté)</summary>
          <p style={{ fontSize: 13, opacity: 0.85 }}>
            Rien n’est envoyé en base ici : c’est juste pour voir ce qui a été filtré.
          </p>
          <textarea value={trash} onChange={(e) => setTrash(e.target.value)} rows={6} style={{ width: '100%', padding: 10 }} />
        </details>
      )}

      <div style={{ display: 'grid', gap: 10 }}>
        <label>
          Titre
          <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ width: '100%', padding: 8 }} />
        </label>

        <label>
          Portions
          <input
            type="number"
            min={1}
            value={servings}
            onChange={(e) => setServings(Number(e.target.value || 1))}
            style={{ width: 120, padding: 8 }}
          />
        </label>

        <label>
          Image URL
          <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} style={{ width: '100%', padding: 8 }} />
        </label>

        <label>
          Notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={5} style={{ width: '100%', padding: 8 }} />
        </label>
      </div>

      <h2 style={{ marginTop: 18 }}>Ingrédients</h2>
      <div style={{ display: 'grid', gap: 10 }}>
        {ingredients.map((ing, idx) => (
          <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 140px 120px', gap: 8 }}>
            <input
              placeholder="Ingrédient"
              value={ing.name}
              onChange={(e) => setIngredient(idx, { name: e.target.value })}
              style={{ padding: 8 }}
            />

            {/* INPUT TEXTE : accepte 1/4 et 1,2 */}
            <input
              placeholder="Quantité"
              value={qtyInputs[idx] ?? ''}
              onChange={(e) => setQtyInput(idx, e.target.value)}
              style={{ padding: 8 }}
            />

            <input
              placeholder="Unité"
              value={ing.unit}
              onChange={(e) => setIngredient(idx, { unit: e.target.value })}
              style={{ padding: 8 }}
            />
          </div>
        ))}

        <button
          onClick={() => {
            setIngredients((p) => [...p, { name: '', quantity: 0, unit: '' }])
            setQtyInputs((p) => [...p, ''])
          }}
          style={{ width: 220 }}
        >
          + Ajouter un ingrédient
        </button>
      </div>

      <h2 style={{ marginTop: 18 }}>Étapes</h2>
      <div style={{ display: 'grid', gap: 10 }}>
        {steps.map((s, idx) => (
          <textarea
            key={idx}
            value={s}
            onChange={(e) =>
              setSteps((prev) => {
                const copy = [...prev]
                copy[idx] = e.target.value
                return copy
              })
            }
            rows={2}
            style={{ width: '100%', padding: 8 }}
          />
        ))}

        <button onClick={() => setSteps((p) => [...p, ''])} style={{ width: 180 }}>
          + Ajouter une étape
        </button>
      </div>

      <div style={{ marginTop: 18, display: 'flex', gap: 10, alignItems: 'center' }}>
        <button onClick={save}>Enregistrer</button>
        {status && <span>{status}</span>}
      </div>
    </main>
  )
}

export default function Page() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Chargement…</div>}>
      <NewRecipeInner />
    </Suspense>
  )
}

