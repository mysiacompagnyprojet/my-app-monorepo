'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { apiFetch } from 'src/lib/api' // si l'import casse, remplace temporairement par un chemin relatif

// ───────────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────────
type Line = { name: string; quantity: number; unit: string }
type Draft = {
  title?: string
  servings?: number
  imageUrl?: string | null
  notes?: string | null
  steps?: string[] // peut venir d'un import
  ingredients?: Array<Line | { raw: string }>
}

// ───────────────────────────────────────────────────────────────────────────────
// Composant interne avec TOUTE la logique
// ───────────────────────────────────────────────────────────────────────────────
function NewRecipeInner() {
  const router = useRouter()
  const search = useSearchParams()

  // États du formulaire
  const [title, setTitle] = useState('')
  const [servings, setServings] = useState(1)
  const [imageUrl, setImageUrl] = useState('')
  const [notes, setNotes] = useState('')
  const [steps, setSteps] = useState<string[]>([''])
  const [ingredients, setIngredients] = useState<Line[]>([{ name: '', quantity: 0, unit: 'g' }])
  const [status, setStatus] = useState<string>('')

  // Pour autoriser l'accès à sessionStorage côté client
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  // ──────────────────────────────────────────────
  // Outils UI
  // ──────────────────────────────────────────────
  function updateStep(i: number, v: string) {
    setSteps((s) => s.map((x, idx) => (idx === i ? v : x)))
  }
  function addStep() {
    setSteps((s) => [...s, ''])
  }
  function delStep(i: number) {
    setSteps((s) => s.filter((_, idx) => idx !== i))
  }

  function updateIng(i: number, field: keyof Line, v: string) {
    setIngredients((arr) =>
      arr.map((x, idx) =>
        idx === i ? { ...x, [field]: field === 'quantity' ? Number(v || 0) : v } : x
      )
    )
  }
  function addIng() {
    setIngredients((arr) => [...arr, { name: '', quantity: 0, unit: 'g' }])
  }
  function delIng(i: number) {
    setIngredients((arr) => arr.filter((_, idx) => idx !== i))
  }

  // ──────────────────────────────────────────────
  // Normalisation d'un brouillon d'import
  // ──────────────────────────────────────────────
  function normalizeDraft(d: Draft): {
    title: string
    servings: number
    imageUrl: string
    notes: string
    steps: string[]
    ingredients: Line[]
  } {
    const safeTitle = (d.title || '').toString()
    const safeServings = Number(d.servings || 1)
    const safeImage = (d.imageUrl || '') as string
    const safeNotes = (d.notes || '') as string
    const safeSteps = Array.isArray(d.steps) && d.steps.length ? d.steps.map((s) => String(s)) : ['']

    const rawIngs: Line[] = Array.isArray(d.ingredients)
      ? d.ingredients.map((it) => {
          if ('raw' in it) {
            return { name: String(it.raw), quantity: 0, unit: 'g' }
          }
          return {
            name: String((it as Line).name || ''),
            quantity: Number((it as Line).quantity || 0),
            unit: String((it as Line).unit || 'g'),
          }
        })
      : []

    const safeIngs = rawIngs.length ? rawIngs : [{ name: '', quantity: 0, unit: 'g' }]

    return {
      title: safeTitle,
      servings: Number.isFinite(safeServings) && safeServings > 0 ? safeServings : 1,
      imageUrl: safeImage,
      notes: safeNotes,
      steps: safeSteps,
      ingredients: safeIngs,
    }
  }

  // ──────────────────────────────────────────────
  // Préremplissage automatique si ?prefill=1
  // ──────────────────────────────────────────────
  const shouldPrefill = useMemo(() => search.get('prefill') === '1', [search])

  useEffect(() => {
    if (!mounted) return
    try {
      const raw = sessionStorage.getItem('recipeDraft')
      if (!raw) return
      if (!shouldPrefill && !search.get('prefill')) return

      const parsed = JSON.parse(raw) as Draft
      const norm = normalizeDraft(parsed)

      setTitle(norm.title)
      setServings(norm.servings)
      setImageUrl(norm.imageUrl || '')
      setNotes(norm.notes || '')
      setSteps(norm.steps && norm.steps.length ? norm.steps : [''])
      setIngredients(
        norm.ingredients && norm.ingredients.length ? norm.ingredients : [{ name: '', quantity: 0, unit: 'g' }]
      )

      setStatus('📝 Brouillon importé — vérifie et corrige avant d’enregistrer.')
    } catch {
      // ignore
    }
  }, [mounted, shouldPrefill, search])

  // ──────────────────────────────────────────────
  // Chargement manuel du brouillon
  // ──────────────────────────────────────────────
  function prefillFromSessionManually() {
    try {
      const raw = sessionStorage.getItem('recipeDraft')
      if (!raw) { setStatus('⚠️ Aucun brouillon en session.'); return }
      const parsed = JSON.parse(raw) as Draft
      const norm = normalizeDraft(parsed)
      setTitle(norm.title)
      setServings(norm.servings)
      setImageUrl(norm.imageUrl || '')
      setNotes(norm.notes || '')
      setSteps(norm.steps && norm.steps.length ? norm.steps : [''])
      setIngredients(
        norm.ingredients && norm.ingredients.length ? norm.ingredients : [{ name: '', quantity: 0, unit: 'g' }]
      )
      setStatus('📝 Brouillon chargé depuis la session.')
    } catch {
      setStatus('⚠️ Impossible de lire le brouillon (JSON).')
    }
  }

  // ──────────────────────────────────────────────
  // Submit
  // ──────────────────────────────────────────────
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    try {
      setStatus('Enregistrement en cours…')

      const cleanSteps = steps.map(s => String(s || '').trim()).filter(Boolean)
      const cleanIngredients = ingredients
        .map(l => ({ ...l, name: String(l.name || '').trim() }))
        .filter(l => l.name)

      if (!title.trim()) {
        setStatus('❌ Le titre est obligatoire')
        return
      }
      if (cleanIngredients.length === 0) {
        setStatus('❌ Ajoute au moins un ingrédient')
        return
      }

      const payload = {
        title: title.trim(),
        servings: Number(servings || 1),
        imageUrl: imageUrl.trim(),
        notes: notes.trim(),
        steps: cleanSteps,
        ingredients: cleanIngredients.map(l => ({
          name: l.name,
          quantity: Number(l.quantity || 0),
          unit: String(l.unit || '').trim() || 'g',
        })),
      }

      await apiFetch('/recipes', { method: 'POST', body: JSON.stringify(payload) })

      try { sessionStorage.removeItem('recipeDraft') } catch {}
      setStatus('✅ Recette enregistrée')
      router.push('/recipes')
    } catch (e: any) {
      setStatus('❌ ' + (e?.message || 'Erreur inconnue'))
    }
  }

  // ──────────────────────────────────────────────
  // UI
  // ──────────────────────────────────────────────
  return (
    <div style={styles.container}>
      <h1 style={styles.h1}>Nouvelle recette</h1>

      {status && (
        <div role="status" style={styles.status}>{status}</div>
      )}

      {mounted && search.get('prefill') !== '1' && sessionStorage.getItem('recipeDraft') && (
        <div style={styles.draftBox}>
          Un brouillon d’import est disponible.&nbsp;
          <button type="button" onClick={prefillFromSessionManually} style={styles.secondaryBtn}>
            Charger le brouillon
          </button>
        </div>
      )}

      <form onSubmit={onSubmit} style={styles.form}>
        {/* Titre */}
        <label style={styles.label}>Titre</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          placeholder="Ex: Gâteau au yaourt"
          style={styles.input}
        />

        {/* Portions */}
        <label style={styles.label}>Portions</label>
        <input
          type="number"
          min={1}
          value={servings}
          onChange={(e) => setServings(Number(e.target.value || 1))}
          style={{ ...styles.input, maxWidth: 160 }}
        />

        {/* Image URL + aperçu */}
        <label style={styles.label}>Image URL</label>
        <input
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          placeholder="https://..."
          style={styles.input}
        />
        {imageUrl?.trim() ? (
          <div style={{ marginTop: 8 }}>
            <img
              src={imageUrl.trim()}
              alt="Aperçu"
              style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid #eee' }}
            />
          </div>
        ) : null}

        {/* Notes */}
        <label style={styles.label}>Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Conseils, variantes..."
          rows={3}
          style={{ ...styles.input, minHeight: 96 }}
        />

        {/* Ingrédients */}
        <h3 style={styles.h3}>Ingrédients</h3>
        {ingredients.map((l, i) => (
          <div key={i} style={styles.row}>
            <input
              placeholder="nom (ex: Farine T45)"
              value={l.name}
              onChange={(e) => updateIng(i, 'name', e.target.value)}
              required
              style={{ ...styles.input, flex: 2 }}
            />
            <input
              type="number"
              placeholder="qté"
              value={Number.isFinite(l.quantity) ? l.quantity : 0}
              onChange={(e) => updateIng(i, 'quantity', e.target.value)}
              style={{ ...styles.input, maxWidth: 140 }}
            />
            <input
              placeholder="unité (g, ml, pièce...)"
              value={l.unit}
              onChange={(e) => updateIng(i, 'unit', e.target.value)}
              style={{ ...styles.input, maxWidth: 180 }}
            />
            <button type="button" onClick={() => delIng(i)} aria-label="Supprimer l’ingrédient" style={styles.iconBtn}>
              −
            </button>
          </div>
        ))}
        <button type="button" onClick={addIng} style={{ ...styles.secondaryBtn, marginBottom: 8 }}>
          + Ajouter un ingrédient
        </button>

        {/* Étapes */}
        <h3 style={styles.h3}>Étapes</h3>
        {steps.map((s, i) => (
          <div key={i} style={styles.row}>
            <input
              placeholder={`Étape ${i + 1}`}
              value={s}
              onChange={(e) => updateStep(i, e.target.value)}
              style={{ ...styles.input, flex: 1 }}
            />
            <button type="button" onClick={() => delStep(i)} aria-label="Supprimer l’étape" style={styles.iconBtn}>
              −
            </button>
          </div>
        ))}
        <button type="button" onClick={addStep} style={{ ...styles.secondaryBtn, marginBottom: 16 }}>
          + Ajouter une étape
        </button>

        <div style={{ marginTop: 16 }}>
          <button type="submit" style={styles.primaryBtn}>Enregistrer</button>
        </div>
      </form>
    </div>
  )
}

// ──────────────────────────────────────────────
// Force dynamique (sécurité pour Next 15 + searchParams)
// ──────────────────────────────────────────────
export const dynamic = 'force-dynamic'

// ──────────────────────────────────────────────
// Wrapper exporté avec Suspense
// ──────────────────────────────────────────────
export default function NewRecipePage() {
  return (
    <Suspense fallback={<main style={styles.container}>Chargement…</main>}>
      <NewRecipeInner />
    </Suspense>
  )
}

// ───────────────────────────────────────────────────────────────────────────────
// Styles
// ───────────────────────────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 800,
    margin: '2rem auto',
    padding: '1.25rem',
  },
  h1: {
    fontSize: '1.75rem',
    fontWeight: 700,
    marginBottom: '0.5rem',
  },
  h3: {
    fontSize: '1.15rem',
    fontWeight: 700,
    marginTop: 20,
    marginBottom: 8,
  },
  status: {
    margin: '0.75rem 0',
    padding: '0.75rem',
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    background: '#fafafa',
  },
  draftBox: {
    margin: '0.25rem 0 1rem',
    padding: '0.6rem',
    border: '1px dashed #c7c7c7',
    borderRadius: 10,
    background: '#fcfcfc',
  },
  form: {
    display: 'block',
  },
  label: {
    display: 'block',
    marginTop: 12,
    marginBottom: 6,
    fontWeight: 600,
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    outline: 'none',
  },
  row: {
    display: 'flex',
    gap: 8,
    marginBottom: 8,
    alignItems: 'center',
  },
  iconBtn: {
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    padding: '8px 12px',
    cursor: 'pointer',
    background: '#fff',
  },
  secondaryBtn: {
    border: '1px solid #d1d5db',
    background: '#fff',
    padding: '10px 14px',
    borderRadius: 10,
    cursor: 'pointer',
  },
  primaryBtn: {
    border: 'none',
    background: '#111827',
    color: 'white',
    padding: '12px 16px',
    borderRadius: 12,
    cursor: 'pointer',
    fontWeight: 600,
  },
}
