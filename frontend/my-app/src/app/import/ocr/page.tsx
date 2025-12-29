//frontend/my-app/src/app/import/ocr/page.tsx
'use client'

import { Suspense, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { apiFetch } from 'src/lib/api'
import type { OcrDraft } from 'src/types/recipe'

type ImportOcrResponse =
  | { ok: true; draft: OcrDraft }
  | { ok: true; debug: any }
  | { ok: false; error: string; message?: string }

const MAX_FILES = 10

function OcrPageInner() {
  const router = useRouter()
  const search = useSearchParams()
  const isDebug = search.get('debug') === '1'

  const [files, setFiles] = useState<File[]>([])
  const [status, setStatus] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [debugOut, setDebugOut] = useState<any>(null)

  const [draft, setDraft] = useState<OcrDraft | null>(null)
  const canRun = useMemo(
    () => files.length >= 1 && files.length <= MAX_FILES && !isRunning,
    [files, isRunning]
  )

  async function run() {
    try {
      setDebugOut(null)
      setStatus('')

      if (!files.length) {
        setStatus('❌ Ajoute au moins 1 image.')
        return
      }

      if (files.length > MAX_FILES) {
        setStatus(`❌ Trop d'images : ${MAX_FILES} maximum.`)
        return
      }

      setIsRunning(true)
      setStatus('OCR en cours…')

      const form = new FormData()
      for (const f of files) form.append('files', f)

      const qs = isDebug ? '?debug=1' : ''

      const data = await apiFetch<ImportOcrResponse>(`/import/ocr${qs}`, {
        method: 'POST',
        headers: {
          'Accept-Language': navigator.language || 'fr-FR',
        },
        body: form,
      })

      if ('draft' in data) {
        setDraft(data.draft)
      }
      if ((data as any)?.ok === false) {
        setStatus('❌ ' + ((data as any)?.message || (data as any)?.error || 'Erreur OCR'))
        return
      }

      if ('debug' in data) {
        setDebugOut((data as any).debug)
        setStatus('✅ Debug reçu (aucune redirection)')
        return
      }

      const d = (data as any).draft as OcrDraft

      const merged: OcrDraft = {
        title: (d.title || '').toString().trim() || 'Recette importée',
        servings: Number(d.servings || 1) || 1,
        imageUrl: d.imageUrl ?? null,
        notes: (d.notes || '').toString(),
        steps: Array.isArray(d.steps)
          ? d.steps.map((s) => String(s || '').trim()).filter(Boolean)
          : [],
        ingredients: Array.isArray(d.ingredients) ? d.ingredients.filter(Boolean) : [],
        trash: Array.isArray(d.trash)
          ? d.trash.map((s) => String(s || '').trim()).filter(Boolean)
          : [],
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

  const statusKind =
    status.startsWith('✅') ? 'success' : status.startsWith('❌') ? 'error' : 'info'

  return (
    <main className="app-container" style={{ margin: '20px auto 40px' }}>
      {/* En-tête */}
      <section className="app-card p-5">
        <h1 className="text-2xl font-extrabold app-title">Importer par photo (OCR)</h1>

        <p className="mt-2 app-muted">
          Utilise cette page quand la recette est surtout une <b>image</b> : Pinterest, Instagram,
          Facebook, photo d&apos;un livre, etc.
        </p>

        {/* Instructions sous forme de carte interne */}
        <div
          className="mt-4 app-card p-4"
          style={{
            borderColor: 'var(--border)',
            boxShadow: 'none',
            background: 'rgba(255,255,255,0.7)',
          }}
        >
          <div className="text-sm font-bold" style={{ color: 'var(--primary)' }}>
            Comment faire
          </div>
          <ol className="mt-2 list-decimal" style={{ marginLeft: 18, lineHeight: 1.7 }}>
            <li>Fais une ou plusieurs captures d&apos;écran de la recette.</li>
            <li>Sélectionne toutes les images en même temps ci-dessous.</li>
            <li>On lit le texte sur toutes les images et on fusionne en une seule fiche.</li>
          </ol>
        </div>

        {/* Zone sélection fichiers */}
        <div className="mt-5">
          <label className="text-sm font-semibold" htmlFor="ocrFiles">
            Images de la recette
          </label>

          <input
            id="ocrFiles"
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            className="mt-2 w-full"
            style={{
              background: 'white',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: 12,
            }}
          />

          {files.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="app-badge">
                {files.length} image(s) sélectionnée(s)
              </span>
              <span className="text-sm app-muted">
                max {MAX_FILES}
                {files.length > MAX_FILES ? ' — ❌ trop d’images' : ''}
              </span>
            </div>
          )}

          {/* CTA */}
          <div className="mt-4 flex items-center gap-3">
            <button onClick={run} disabled={!canRun} className="app-btn-primary">
              {isRunning ? 'Traitement en cours…' : 'Lancer l’OCR'}
            </button>
            return (
            <div style={{ padding: 16 }}>
            {/* ... ton UI existant (upload, bouton run, status) ... */}

              {draft && (
              <div style={{ marginTop: 16 }}>
              <h3>Ingrédients</h3>

              {draft?.ingredients?.map((ing, idx) => (
              <div key={idx} style={{ padding: '8px 0', borderBottom: '1px solid #222' }}>
               <div>
                <strong>{ing.name}</strong>{' '}
                 <span style={{ opacity: 0.8 }}>
                 {ing.quantity ? `${ing.quantity}` : ''} {ing.unit || ''}
                  </span>
                  </div>

                  <div style={{ fontSize: 13, opacity: 0.85 }}>
                  {ing.priceMatched ? (
                 <>
                 <span>
                      Prix unitaire: {ing.price?.eurPer ?? '—'} € / {ing.price?.perUnit ?? '—'}
                  </span>
                  {' · '}
                   <span>
                    Coût: {typeof ing.costEur === 'number' ? `${ing.costEur.toFixed(2)} €` : '—'}
                   </span>
                    </>
                    ) : (
                    <span style={{ color: '#ffb020' }}>Prix non trouvé dans Airtable</span>
                   )}
                    </div>
                    </div>
                    ))}

                   {/* ✅ Total */}
                   <div style={{ marginTop: 12, fontWeight: 700 }}>
                       Total recette :{' '}
                        {typeof draft.totalCostEur === 'number' ? `${draft.totalCostEur.toFixed(2)} €` : '—'}
                       </div>
                       </div>
                       )}
                       </div>
                      );
            {isDebug && (
              <span className="app-badge" style={{ background: 'rgba(168,184,161,0.35)' }}>
                Debug actif
              </span>
            )}
          </div>

          {/* Status message */}
          {status && (
            <div
              className="mt-4 app-card p-3 text-sm"
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
                    statusKind === 'success'
                      ? 'rgba(43,43,43,0.95)'
                      : statusKind === 'error'
                      ? '#b00020'
                      : 'rgba(43,43,43,0.9)',
                }}
              >
                {status}
              </span>
            </div>
          )}

          {isDebug && (
            <p className="mt-3 text-sm app-muted">
              Mode debug actif : l’API renvoie un objet debug, sans redirection.
            </p>
          )}
        </div>
      </section>

      {/* Debug output */}
      {debugOut && (
        <section className="app-card p-5" style={{ marginTop: 16 }}>
          <h2 className="text-lg font-extrabold app-title">Debug</h2>
          <pre
            className="mt-3 app-card p-3 text-sm overflow-auto"
            style={{
              borderColor: 'var(--border)',
              boxShadow: 'none',
              background: 'rgba(255,255,255,0.7)',
              maxHeight: 420,
            }}
          >
            {JSON.stringify(debugOut, null, 2)}
          </pre>
        </section>
      )}
    </main>
  )
}

export default function Page() {
  return (
    <Suspense fallback={<div className="app-container" style={{ padding: 24 }}>Chargement…</div>}>
      <OcrPageInner />
    </Suspense>
  )
}
