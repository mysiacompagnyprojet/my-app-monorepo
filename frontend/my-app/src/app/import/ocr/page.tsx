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
    setStatus(`OCR en cours… (${Math.min(files.length, 5)} image(s))`)

    const base = process.env.NEXT_PUBLIC_BACKEND_URL!
    const token =
      localStorage.getItem('sb:token') ||
      sessionStorage.getItem('sb:token') ||
      localStorage.getItem('token') ||
      ''

    // On limite à 5 images (comme le backend)
    const selected = files.slice(0, 5)

    const merged: OcrDraft = {
      title: '',
      servings: 1,
      imageUrl: null,
      notes: '',
      steps: [],
      ingredients: [],
    }

    try {
      // ✅ Un seul appel backend avec plusieurs images
      const form = new FormData()
      for (const f of selected) {
        form.append('files', f) // 👈 champ multi
      }

      const res = await fetch(`${base}/import/ocr`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      })

      if (!res.ok) {
        const txt = await res.text()
        setStatus(`❌ Erreur OCR : ${txt}`)
        setIsRunning(false)
        return
      }

      const data = (await res.json()) as { draft: OcrDraft }
      const d = data?.draft || {}

      // --- fusion (ici, backend renvoie déjà un draft global, mais on sécurise) ---
      if (d.title) merged.title = d.title
      if (typeof d.servings === 'number') merged.servings = d.servings
      if (typeof d.imageUrl !== 'undefined') merged.imageUrl = d.imageUrl ?? null

      merged.notes = (d.notes || '').toString().trim() || undefined
      merged.steps = (Array.isArray(d.steps) ? d.steps : [])
        .map((s) => String(s || '').trim())
        .filter(Boolean)

      merged.ingredients = (Array.isArray(d.ingredients) ? d.ingredients : []).filter(Boolean)

      // Nettoyage minimal
      merged.title = (merged.title || '').toString().trim() || 'Recette importée'
      merged.servings = Number(merged.servings || 1)

      // Sauvegarde du brouillon fusionné
      sessionStorage.setItem('recipeDraft', JSON.stringify(merged))
      setStatus(`✅ OCR OK sur ${selected.length} image(s)`)
      router.push('/recipes/new?prefill=1')
    } catch (e: any) {
      setStatus('❌ ' + (e?.message || 'Erreur inconnue'))
      setIsRunning(false)
    } finally {
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
          {files.length > 5 ? ' — seules les 5 premières seront envoyées.' : ''}
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
