'use client'

import { useState } from 'react'
import { apiFetch } from 'src/lib/api'
import { useRouter } from 'next/navigation'

type Line = { name: string; quantity: number; unit: string }

type RecipeDraft = {
  title: string
  servings: number
  imageUrl: string
  notes: string
  steps: string[]
  ingredients: Line[]
  trash?: string[]
}

type ImportUrlResponse = { draft: RecipeDraft }
type ImportOcrResponse = { draft: RecipeDraft }

export default function ImportRecipePage() {
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState('')
  const router = useRouter()

  async function importUrl() {
    const cleanedUrl = url.trim()
    if (!cleanedUrl) return

    setStatus('Import en cours...')
    try {
      const res = await apiFetch<ImportUrlResponse>('/import/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: cleanedUrl }),
      })

      sessionStorage.setItem('recipeDraft', JSON.stringify(res.draft))
      setStatus('✅ Import OK')
      router.push('/recipes/new?prefill=1')
    } catch (e: any) {
      setStatus('❌ ' + (e?.message || 'Erreur'))
    }
  }

  async function importOcr() {
    if (!file) return
    setStatus('OCR en cours...')

    try {
      const base = process.env.NEXT_PUBLIC_BACKEND_URL!
      const token =
        localStorage.getItem('sb:token') ||
        sessionStorage.getItem('sb:token') ||
        ''

      const form = new FormData()
      form.append('files', file)

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

      sessionStorage.setItem('recipeDraft', JSON.stringify(data.draft))
      setStatus('✅ OCR OK')
      router.push('/recipes/new?prefill=1')
    } catch (e: any) {
      setStatus('❌ ' + (e?.message || 'Erreur'))
    }
  }

  return (
    <div style={{ maxWidth: 640, margin: '2rem auto' }}>
      <h1>Importer une recette</h1>

      <h3>Par URL</h3>
      <input
        placeholder="https://..."
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        style={{ width: '100%', padding: 8 }}
      />
      <div style={{ marginTop: 8 }}>
        <button onClick={importUrl} disabled={!url.trim()}>
          Importer
        </button>
      </div>

      <h3 style={{ marginTop: 18 }}>Par photo (OCR)</h3>
      <input
        type="file"
        accept="image/*"
        onChange={(e) => setFile(e.target.files?.[0] || null)}
      />
      <div style={{ marginTop: 8 }}>
        <button onClick={importOcr} disabled={!file}>
          OCR
        </button>
      </div>

      <p style={{ marginTop: 12 }}>{status}</p>
    </div>
  )
}
