'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type OcrDraft = {
  title?: string
  servings?: number
  imageUrl?: string | null
  notes?: string | null
  steps?: string[]
  ingredients?: any[]
}

export default function ImportOcrPage() {
  const [files, setFiles] = useState<File[]>([])
  const [status, setStatus] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const router = useRouter()

  async function run() {
    if (!files.length || isRunning) return

    setIsRunning(true)
    setStatus(`OCR en cours… (1 / ${files.length})`)

    const base = process.env.NEXT_PUBLIC_BACKEND_URL!
    const token =
      localStorage.getItem('sb:token') ||
      sessionStorage.getItem('sb:token') ||
      localStorage.getItem('token') ||
      ''

    const merged: OcrDraft = {
      title: '',
      servings: 1,
      imageUrl: null,
      notes: '',
      steps: [],
      ingredients: [],
    }

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        setStatus(`OCR en cours… (${i + 1} / ${files.length})`)

        const form = new FormData()
        form.append('file', file)

        const res = await fetch(`${base}/import/ocr`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: form,
        })

        if (!res.ok) {
          const txt = await res.text()
          setStatus(`❌ Erreur sur le fichier ${i + 1} : ${txt}`)
          setIsRunning(false)
          return
        }

        const data = (await res.json()) as { draft: OcrDraft }
        const d = data?.draft || {}

        // --- fusion des brouillons ---
        if (!merged.title && d.title) merged.title = d.title
        if (!merged.servings && d.servings) merged.servings = d.servings
        if (!merged.imageUrl && d.imageUrl) merged.imageUrl = d.imageUrl

        // notes : on concatène proprement
        const parts: string[] = []
        if (merged.notes) parts.push(merged.notes)
        if (d.notes) parts.push(d.notes)
        merged.notes = parts.join('\n\n') || undefined

        if (Array.isArray(d.steps)) {
          merged.steps = [...(merged.steps || []), ...d.steps]
        }
        if (Array.isArray(d.ingredients)) {
          merged.ingredients = [...(merged.ingredients || []), ...d.ingredients]
        }
      }

      // Nettoyage minimal
      merged.title = (merged.title || '').toString().trim() || 'Recette importée'
      merged.servings = Number(merged.servings || 1)
      merged.steps = (merged.steps || []).map((s) => String(s || '').trim()).filter(Boolean)
      merged.ingredients = (merged.ingredients || []).filter(Boolean)

      // Sauvegarde du brouillon fusionné
      sessionStorage.setItem('recipeDraft', JSON.stringify(merged))
      setStatus(`✅ OCR OK sur ${files.length} image(s)`)
      router.push('/recipes/new?prefill=1')
    } catch (e: any) {
      setStatus('❌ ' + (e?.message || 'Erreur inconnue'))
      setIsRunning(false)
    }
  }

  return (
    <main style={{ padding: 24, maxWidth: 720, margin: '2rem auto' }}>
      <h1>Importer par photo (OCR)</h1>

      <p style={{ marginTop: 8, marginBottom: 16 }}>
        Utilise cette page quand la recette est surtout une <b>image</b> :
        Pinterest, Instagram, Facebook, photo d&apos;un livre, etc.
      </p>
      <ol style={{ marginLeft: 20, marginBottom: 16 }}>
        <li>Fais une ou plusieurs captures d&apos;écran de la recette.</li>
        <li>Sélectionne toutes les images en même temps ci-dessous.</li>
        <li>Nous lisons le texte (OCR) sur chaque image et fusionnons le tout dans une seule fiche.</li>
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
          {files.length} image(s) sélectionnée(s)
        </p>
      )}

      <div style={{ marginTop: 8 }}>
        <button onClick={run} disabled={!files.length || isRunning}>
          {isRunning ? 'Traitement en cours…' : 'Lancer l’OCR'}
        </button>
      </div>

      {status && <p style={{ marginTop: 12 }}>{status}</p>}
    </main>
  )
}
