'use client'

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { apiFetch } from 'src/lib/api'

type OcrIngredient = { name: string; quantity: number; unit: string }

type OcrDraft = {
  title: string
  servings: number
  imageUrl: string | null
  notes: string
  steps: string[]
  ingredients: OcrIngredient[]
  trash?: string[]
}

type ImportOcrResponse =
  | { ok: true; draft: OcrDraft }
  | { ok: true; debug: any }
  | { ok: false; error: string; message?: string }

export default function Page() {
  const router = useRouter()
  const search = useSearchParams()
  const isDebug = search.get('debug') === '1'

  const [files, setFiles] = useState<File[]>([])
  const [status, setStatus] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [debugOut, setDebugOut] = useState<any>(null)

  const canRun = useMemo(() => files.length >= 1 && files.length <= 5 && !isRunning, [files, isRunning])

  async function run() {
    try {
      setDebugOut(null)

      if (!files.length) {
        setStatus('❌ Ajoute au moins 1 image.')
        return
      }

      if (files.length > 5) {
        setStatus("❌ Trop d'images : 5 maximum.")
        return
      }

      setIsRunning(true)
      setStatus('OCR en cours…')

      const form = new FormData()
      for (const f of files) form.append('files', f)

      const qs = isDebug ? '?debug=1' : ''

      const res = await apiFetch(`/import/ocr${qs}`, {
        method: 'POST',
        body: form,
      })

      const data: ImportOcrResponse = await res.json()

      if (!res.ok || (data as any).ok === false) {
        const err = data as any
        setStatus('❌ ' + (err?.message || err?.error || 'Erreur OCR'))
        setIsRunning(false)
        return
      }

      // mode debug: on affiche le JSON, pas de redirection
      if ('debug' in data) {
        setDebugOut((data as any).debug)
        setStatus('✅ Debug reçu (aucune redirection)')
        setIsRunning(false)
        return
      }

      const d = (data as any).draft as OcrDraft

      const merged: OcrDraft = {
        title: (d.title || '').toString().trim() || 'Recette importée',
        servings: Number(d.servings || 1),
        imageUrl: d.imageUrl ?? null,
        notes: (d.notes || '').toString(),
        steps: Array.isArray(d.steps) ? d.steps.map((s) => String(s || '').trim()).filter(Boolean) : [],
        ingredients: Array.isArray(d.ingredients) ? d.ingredients.filter(Boolean) : [],
        trash: Array.isArray(d.trash) ? d.trash.map((s) => String(s || '').trim()).filter(Boolean) : [],
      }

      sessionStorage.setItem('recipeDraft', JSON.stringify(merged))
      setStatus(`✅ OCR OK (${files.length} image(s))`)
      router.push('/recipes/new?prefill=1')
    } catch (e: any) {
      setStatus('❌ ' + (e?.message || 'Erreur inconnue'))
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <main style={{ padding: 24, maxWidth: 720, margin: '2rem auto' }}>
      <h1>Importer par photo (OCR)</h1>

      <p style={{ marginTop: 8, marginBottom: 16 }}>
        Utilise cette page quand la recette est surtout une <b>image</b> : Pinterest, Instagram, Facebook, photo d&apos;un
        livre, etc.
      </p>

      <ol style={{ marginLeft: 20, marginBottom: 16 }}>
        <li>Fais une ou plusieurs captures d&apos;écran de la recette.</li>
        <li>Sélectionne toutes les images en même temps ci-dessous.</li>
        <li>Nous lisons le texte sur toutes les images et fusionnons le tout en une seule fiche.</li>
      </ol>

      <input
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        style={{ marginBottom: 12 }}
      />

      {files.length > 0 && (
        <p style={{ marginBottom: 8 }}>
          {files.length} image(s) sélectionnée(s) {files.length > 5 ? '— ❌ max 5' : ''}
        </p>
      )}

      <div style={{ marginTop: 8 }}>
        <button onClick={run} disabled={!canRun}>
          {isRunning ? 'Traitement en cours…' : 'Lancer l’OCR'}
        </button>
      </div>

      {status && <p style={{ marginTop: 12 }}>{status}</p>}

      {isDebug && (
        <p style={{ marginTop: 8, fontSize: 13, opacity: 0.8 }}>
          Mode debug actif : l’API renvoie un objet debug, sans redirection.
        </p>
      )}

      {debugOut && (
        <pre style={{ marginTop: 16, padding: 12, border: '1px solid #eee', borderRadius: 8, overflowX: 'auto' }}>
          {JSON.stringify(debugOut, null, 2)}
        </pre>
      )}
    </main>
  )
}
