'use client'
import { useState } from 'react'
import { apiFetch } from 'src/lib/api'
import { useRouter } from 'next/navigation'

// --- Types ---
type Line = { name: string; quantity: number; unit: string }

type RecipeDraft = {
  title: string
  servings: number
  imageUrl: string
  notes: string
  steps: string[]
  ingredients: Line[]
}

type ImportUrlResponse = { draft: RecipeDraft }
type ImportOcrResponse = { draft: RecipeDraft }

export default function ImportRecipePage() {
  const [url, setUrl] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [status, setStatus] = useState('')
  const router = useRouter()

  async function importUrl() {
    setStatus('Import en cours...')
    try {
      const res = await apiFetch<ImportUrlResponse>('/import/url', {
        method: 'POST',
        body: JSON.stringify({ url })
      })
      localStorage.setItem('recipe:draft', JSON.stringify(res.draft))
      setStatus('✅ Import OK')
      router.push('/recipes/new')
    } catch (e: any) {
      setStatus('❌ ' + e.message)
    }
  }

  async function importOcr() {
    if (!files.length) return
    setStatus('OCR en cours...')

    const base = process.env.NEXT_PUBLIC_API_BASE || process.env.NEXT_PUBLIC_API_URL
    const token = localStorage.getItem('sb:token') || sessionStorage.getItem('sb:token') || ''

    const selected = files.slice(0, 5)

    const form = new FormData()
    for (const f of selected) {
      form.append('files', f) // 👈 multi
    }

    const res = await fetch(`${base}/import/ocr`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    })

    if (!res.ok) {
      setStatus('❌ ' + (await res.text()))
      return
    }

    const data: ImportOcrResponse = await res.json()
    localStorage.setItem('recipe:draft', JSON.stringify(data.draft))
    setStatus(`✅ OCR OK (${selected.length} image(s))`)
    router.push('/recipes/new')
  }

  return (
    <div style={{ maxWidth: 640, margin: '2rem auto' }}>
      <h1>Importer une recette</h1>

      <h3>Par URL</h3>
      <input placeholder="https://..." value={url} onChange={e => setUrl(e.target.value)} />
      <button onClick={importUrl}>Importer</button>

      <h3>Par photo (OCR)</h3>
      <input
        type="file"
        accept="image/*"
        multiple
        onChange={e => setFiles(Array.from(e.target.files ?? []))}
      />
      {files.length > 0 && (
        <p>
          {files.length} image(s) sélectionnée(s)
          {files.length > 5 ? ' — seules les 5 premières seront envoyées.' : ''}
        </p>
      )}
      <button onClick={importOcr} disabled={!files.length}>OCR</button>

      <p>{status}</p>
    </div>
  )
}
