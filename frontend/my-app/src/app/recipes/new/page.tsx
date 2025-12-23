'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { apiFetch } from 'src/lib/api'

type Line = { name: string; quantity: number; unit: string; quantityRaw?: string }

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
   IMPORTANT: on ne "jolifie" PAS 0.5 -> 1/2
   - Si on a quantityRaw (ex: "1/2" ou "0,5"), on l’affiche.
   - Sinon on affiche le nombre tel quel ("0.5", "0.75", etc.)
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

function formatQtyForInput(n: number, quantityRaw?: string): string {
  if (typeof quantityRaw === 'string' && quantityRaw.trim()) return quantityRaw.trim()
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
            quantityRaw: typeof row.quantityRaw === 'string' ? String(row.quantityRaw).trim() : undefined,
          }
        })
        .filter((x): x is Line => x !== null)

      const finalIngredients = normalized.length ? normalized : [{ name: '', quantity: 0, unit: '' }]
      setIngredients(finalIngredients)

      setQtyInputs(finalIngredients.map((r) => formatQtyForInput(r.quantity, r.quantityRaw)))

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

    setIngredient(idx, { quantity: parseQtyInput(raw), quantityRaw: undefined })
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

  const statusKind =
    status.startsWith('✅') ? 'success' : status.startsWith('❌') ? 'error' : status ? 'info' : null

  return (
    <main className="app-container" style={{ margin: '40px auto' }}>
      {/* Header */}
      <section className="app-card p-6">
        <h1 className="text-2xl font-extrabold app-title">Nouvelle recette</h1>
        <p className="mt-2 app-muted">
          Remplis l’essentiel. Tu peux toujours ajuster plus tard.
        </p>
      </section>

      {/* Corbeille */}
      {trash.trim() && (
        <section className="app-card p-5" style={{ marginTop: 16 }}>
          <details>
            <summary style={{ cursor: 'pointer', fontWeight: 800, color: 'var(--primary)' }}>
              🗑️ Corbeille (texte non-recette détecté)
            </summary>
            <p className="mt-2 text-sm app-muted">
              Rien n’est envoyé en base ici : c’est juste pour voir ce qui a été filtré.
            </p>
            <textarea
              value={trash}
              onChange={(e) => setTrash(e.target.value)}
              rows={6}
              className="mt-3 w-full"
              style={{
                background: 'white',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: 12,
              }}
            />
          </details>
        </section>
      )}

      {/* Infos recette */}
      <section className="app-card p-6" style={{ marginTop: 16 }}>
        <h2 className="text-lg font-extrabold app-title">Informations</h2>

        <div className="mt-4 grid gap-4">
          <label className="grid gap-1 text-sm font-semibold">
            Titre
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={{
                background: 'white',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: 12,
              }}
            />
          </label>

          <div className="flex flex-wrap items-end gap-4">
            <label className="grid gap-1 text-sm font-semibold">
              Portions
              <input
                type="number"
                min={1}
                value={servings}
                onChange={(e) => setServings(Number(e.target.value || 1))}
                style={{
                  width: 140,
                  background: 'white',
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  padding: 12,
                }}
              />
            </label>

            <span className="app-badge">Lisible en un coup d’œil</span>
          </div>

          <label className="grid gap-1 text-sm font-semibold">
            Image URL
            <input
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              style={{
                background: 'white',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: 12,
              }}
            />
          </label>

          <label className="grid gap-1 text-sm font-semibold">
            Notes
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={5}
              style={{
                background: 'white',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: 12,
              }}
            />
          </label>
        </div>
      </section>

      {/* Ingrédients */}
      <section className="app-card p-6" style={{ marginTop: 16 }}>
        <h2 className="text-lg font-extrabold app-title">Ingrédients</h2>
        <p className="mt-2 text-sm app-muted">
          Un ingrédient par ligne : nom, quantité, unité.
        </p>

        <div className="mt-4 grid gap-3">
          {ingredients.map((ing, idx) => (
            <div
              key={idx}
              className="app-card p-3"
              style={{
                boxShadow: 'none',
                background: 'rgba(255,255,255,0.7)',
                borderColor: 'var(--border)',
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 140px 120px',
                  gap: 10,
                }}
              >
                <input
                  placeholder="Ingrédient"
                  value={ing.name}
                  onChange={(e) => setIngredient(idx, { name: e.target.value })}
                  style={{
                    background: 'white',
                    border: '1px solid var(--border)',
                    borderRadius: 12,
                    padding: 10,
                  }}
                />

                <input
                  placeholder="Quantité"
                  value={qtyInputs[idx] ?? ''}
                  onChange={(e) => setQtyInput(idx, e.target.value)}
                  style={{
                    background: 'white',
                    border: '1px solid var(--border)',
                    borderRadius: 12,
                    padding: 10,
                  }}
                />

                <input
                  placeholder="Unité"
                  value={ing.unit}
                  onChange={(e) => setIngredient(idx, { unit: e.target.value })}
                  style={{
                    background: 'white',
                    border: '1px solid var(--border)',
                    borderRadius: 12,
                    padding: 10,
                  }}
                />
              </div>
            </div>
          ))}

          <button
            onClick={() => {
              setIngredients((p) => [...p, { name: '', quantity: 0, unit: '' }])
              setQtyInputs((p) => [...p, ''])
            }}
            className="app-btn-secondary"
            style={{ width: 260 }}
          >
            + Ajouter un ingrédient
          </button>
        </div>
      </section>

      {/* Étapes */}
      <section className="app-card p-6" style={{ marginTop: 16 }}>
        <h2 className="text-lg font-extrabold app-title">Étapes</h2>
        <p className="mt-2 text-sm app-muted">
          1 étape = 1 bloc. Garde les phrases courtes.
        </p>

        <div className="mt-4 grid gap-3">
          {steps.map((s, idx) => (
            <div
              key={idx}
              className="app-card p-3"
              style={{
                boxShadow: 'none',
                background: 'rgba(255,255,255,0.7)',
                borderColor: 'var(--border)',
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="app-badge">Étape {idx + 1}</span>
              </div>

              <textarea
                value={s}
                onChange={(e) =>
                  setSteps((prev) => {
                    const copy = [...prev]
                    copy[idx] = e.target.value
                    return copy
                  })
                }
                rows={2}
                style={{
                  width: '100%',
                  background: 'white',
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  padding: 12,
                }}
              />
            </div>
          ))}

          <button onClick={() => setSteps((p) => [...p, ''])} className="app-btn-secondary" style={{ width: 220 }}>
            + Ajouter une étape
          </button>
        </div>
      </section>

      {/* Actions */}
      <section className="app-card p-6" style={{ marginTop: 16 }}>
        <div className="flex flex-wrap gap-3 items-center">
          <button onClick={save} className="app-btn-primary">
            Enregistrer
          </button>

          {status && (
            <span
              className="app-card px-3 py-2 text-sm"
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
                color: statusKind === 'error' ? '#b00020' : 'rgba(43,43,43,0.95)',
                fontWeight: 800,
              }}
            >
              {status}
            </span>
          )}
        </div>
      </section>
    </main>
  )
}

export default function Page() {
  return (
    <Suspense fallback={<div className="app-container" style={{ padding: 24 }}>Chargement…</div>}>
      <NewRecipeInner />
    </Suspense>
  )
}
