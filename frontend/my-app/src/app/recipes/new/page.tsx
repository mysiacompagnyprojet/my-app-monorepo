'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { apiFetch } from 'src/lib/api'

type Line = { name: string; quantity: number; unit: string }
type Draft = {
  title?: string
  servings?: number
  imageUrl?: string | null
  notes?: string | null
  steps?: string[] // peut venir d'un import
  // certains imports fournissent { ingredients: [{ name, quantity, unit }]} ou { ingredients: [{ raw: string }] }
  ingredients?: Array<Line | { raw: string }>
}

export default function NewRecipePage() {
  const router = useRouter()
  const search = useSearchParams()

  // --- ÉTATS DU FORMULAIRE ---
  const [title, setTitle] = useState('')
  const [servings, setServings] = useState(1)
  const [imageUrl, setImageUrl] = useState('')
  const [notes, setNotes] = useState('')
  const [steps, setSteps] = useState<string[]>([''])
  const [ingredients, setIngredients] = useState<Line[]>([{ name: '', quantity: 0, unit: 'g' }])
  const [status, setStatus] = useState<string>('')

  // --- UTILITAIRES FORMULAIRE ---
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

  // --- NORMALISATION D'UN BROUILLON D'IMPORT ---
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

    // Les imports peuvent fournir des lignes "raw" (texte libre) → on les place en "name" pour édition
    const rawIngs: Line[] = Array.isArray(d.ingredients)
      ? d.ingredients.map((it) => {
          if ('raw' in it) {
            return { name: String(it.raw), quantity: 0, unit: 'g' }
          }
          return {
            name: String(it.name || ''),
            quantity: Number(it.quantity || 0),
            unit: String(it.unit || 'g'),
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

  // --- PRÉREMPLISSAGE (Draft → Edit) ---
  // 1) Si on arrive avec ?prefill=1, on tente de charger sessionStorage.recipeDraft
  // 2) Sinon, on tente un brouillon laissé en session (utile si on revient en arrière)
  const shouldPrefill = useMemo(() => search.get('prefill') === '1', [search])
  useEffect(() => {
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
      setIngredients(norm.ingredients && norm.ingredients.length ? norm.ingredients : [{ name: '', quantity: 0, unit: 'g' }])

      // On ne supprime pas immédiatement le draft pour permettre un F5 sans le perdre.
      setStatus('📝 Brouillon importé — vérifie et corrige avant d’enregistrer.')
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldPrefill])

  // --- SUBMIT ---
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
  e.preventDefault(); // évite le rechargement de page

  try {
    setStatus('Enregistrement en cours…');

    // Nettoyage minimal : on enlève les champs vides
    const cleanSteps = steps.map(s => String(s || '').trim()).filter(Boolean);
    const cleanIngredients = ingredients
      .map(l => ({ ...l, name: String(l.name || '').trim() }))
      .filter(l => l.name); // on garde seulement les lignes avec un nom

    // Validation simple
    if (!title.trim()) {
      setStatus('❌ Le titre est obligatoire');
      return;
    }
    if (cleanIngredients.length === 0) {
      setStatus('❌ Ajoute au moins un ingrédient');
      return;
      }
      const payload = {
        title: title.trim(),
        servings: Number(servings || 1),
        imageUrl: imageUrl.trim(),
        notes: notes.trim(),
        steps: steps.map((s) => s.trim()).filter(Boolean),
        ingredients: ingredients.map((l) => ({
          name: String(l.name || '').trim(),
          quantity: Number(l.quantity || 0),
          unit: String(l.unit || '').trim() || 'g',
        })),
      }

      // Sécurité minimale : titre requis
      if (!payload.title) {
        setStatus('❌ Le titre est obligatoire.')
        return
      }

      await apiFetch('/recipes', { method: 'POST', body: JSON.stringify(payload) })

      setStatus('✅ Recette enregistrée');
      try { sessionStorage.removeItem('recipeDraft') } catch {}
      router.push('/recipes'); // ✅ active la redirection

      // succès
      setStatus('✅ Recette enregistrée')
      // le brouillon ne sert plus
      try { sessionStorage.removeItem('recipeDraft') } catch {}

      // Option : rediriger vers la liste/fiche recette si tu as la route prête
      // router.push('/recipes')
      } catch (e: any) {
      setStatus('❌ ' + (e?.message || 'Erreur inconnue'))
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: '2rem auto', padding: '1rem' }}>
      <h1>Nouvelle recette</h1>

      {status && (
        <div role="status" style={{ margin: '0.5rem 0', padding: '0.5rem', border: '1px solid #ddd', borderRadius: 8 }}>
          {status}
        </div>
      )}

      <form onSubmit={onSubmit}>
        <label style={{ display: 'block', marginTop: 12 }}>Titre</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          placeholder="Ex: Gâteau au yaourt"
          style={{ width: '100%' }}
        />

        <label style={{ display: 'block', marginTop: 12 }}>Portions</label>
        <input
          type="number"
          min={1}
          value={servings}
          onChange={(e) => setServings(Number(e.target.value || 1))}
          style={{ width: 120 }}
        />

        <label style={{ display: 'block', marginTop: 12 }}>Image URL</label>
        <input
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          placeholder="https://..."
          style={{ width: '100%' }}
        />

        <label style={{ display: 'block', marginTop: 12 }}>Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Conseils, variantes..."
          rows={3}
          style={{ width: '100%' }}
        />

        <h3 style={{ marginTop: 20 }}>Ingrédients</h3>
        {ingredients.map((l, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
            <input
              placeholder="nom (ex: Farine T45)"
              value={l.name}
              onChange={(e) => updateIng(i, 'name', e.target.value)}
              required
              style={{ flex: 2 }}
            />
            <input
              type="number"
              placeholder="qté"
              value={Number.isFinite(l.quantity) ? l.quantity : 0}
              onChange={(e) => updateIng(i, 'quantity', e.target.value)}
              style={{ width: 120 }}
            />
            <input
              placeholder="unité (g, ml, pièce...)"
              value={l.unit}
              onChange={(e) => updateIng(i, 'unit', e.target.value)}
              style={{ width: 160 }}
            />
            <button type="button" onClick={() => delIng(i)} aria-label="Supprimer l’ingrédient">
              −
            </button>
          </div>
        ))}
        <button type="button" onClick={addIng} style={{ marginBottom: 8 }}>
          + Ajouter un ingrédient
        </button>

        <h3 style={{ marginTop: 20 }}>Étapes</h3>
        {steps.map((s, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
            <input
              placeholder={`Étape ${i + 1}`}
              value={s}
              onChange={(e) => updateStep(i, e.target.value)}
              style={{ flex: 1 }}
            />
            <button type="button" onClick={() => delStep(i)} aria-label="Supprimer l’étape">
              −
            </button>
          </div>
        ))}
        <button type="button" onClick={addStep} style={{ marginBottom: 16 }}>
          + Ajouter une étape
        </button>

        <div style={{ marginTop: 16 }}>
          <button type="submit">Enregistrer</button>
        </div>
      </form>
    </div>
  )
}
