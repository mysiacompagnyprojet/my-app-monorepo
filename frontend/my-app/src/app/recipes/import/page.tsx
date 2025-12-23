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

  const statusKind =
    status.startsWith('✅') ? 'success' : status.startsWith('❌') ? 'error' : 'info'

  return (
    <main className="app-container" style={{ margin: '40px auto' }}>
      <section className="app-card p-6">
        <h1 className="text-2xl font-extrabold app-title">Importer une recette</h1>
        <p className="mt-2 app-muted">
          Choisis la méthode la plus simple pour toi : URL (site/blog) ou photo (OCR).
        </p>

        {/* Par URL */}
        <div className="mt-6 app-card p-5" style={{ boxShadow: 'none', background: 'rgba(255,255,255,0.7)' }}>
          <h2 className="text-lg font-extrabold app-title">Par URL</h2>

          <label className="mt-3 block text-sm font-semibold" htmlFor="importUrl">
            URL de la recette
          </label>
          <input
            id="importUrl"
            placeholder="https://..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="mt-2 w-full"
            style={{
              background: 'white',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: 12,
              maxWidth: 720,
            }}
          />

          <div className="mt-4">
            <button onClick={importUrl} disabled={!url.trim()} className="app-btn-primary">
              Importer par URL
            </button>
          </div>
        </div>

        {/* Par OCR */}
        <div className="mt-4 app-card p-5" style={{ boxShadow: 'none', background: 'rgba(255,255,255,0.7)' }}>
          <h2 className="text-lg font-extrabold app-title">Par photo (OCR)</h2>

          <label className="mt-3 block text-sm font-semibold" htmlFor="importOcr">
            Image de la recette
          </label>
          <input
            id="importOcr"
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="mt-2 w-full"
            style={{
              background: 'white',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: 12,
              maxWidth: 720,
            }}
          />

          <div className="mt-4">
            <button onClick={importOcr} disabled={!file} className="app-btn-primary">
              Lancer l’OCR
            </button>
          </div>
        </div>

        {/* Status */}
        {status && (
          <div
            className="mt-5 app-card p-3 text-sm"
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
            }}
          >
            <span
              style={{
                fontWeight: 700,
                color:
                  statusKind === 'error'
                    ? '#b00020'
                    : 'rgba(43,43,43,0.9)',
              }}
            >
              {status}
            </span>
          </div>
        )}
      </section>
    </main>
  )
}
