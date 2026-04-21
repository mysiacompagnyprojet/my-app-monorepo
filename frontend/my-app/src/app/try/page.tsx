// frontend/my-app/src/app/try/page.tsx

'use client'

import Image from 'next/image'
import { useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api'
import Price from '@/components/Price'
import DemoPaywallNotice from '@/components/DemoPaywallNotice'
import type { DemoOcrResponse, DemoOcrSuccessResponse } from '@/types/demo'

const MAX_FILES = 2

export default function TryPage() {
  const [files, setFiles] = useState<File[]>([])
  const [status, setStatus] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [result, setResult] = useState<DemoOcrSuccessResponse | null>(null)

  const resultRef = useRef<HTMLElement | null>(null)

  const previewUrls = useMemo(() => {
    return files.map((file) => URL.createObjectURL(file))
  }, [files])

  useEffect(() => {
    return () => {
      previewUrls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [previewUrls])

  useEffect(() => {
    if (!result) return

    const id = window.setTimeout(() => {
      resultRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }, 120)

    return () => window.clearTimeout(id)
  }, [result])

  const canRun = files.length >= 1 && files.length <= MAX_FILES && !isRunning

  async function run() {
    try {
      setStatus('')
      setResult(null)

      if (!files.length) {
        setStatus('❌ Ajoute au moins 1 image.')
        return
      }

      if (files.length > MAX_FILES) {
        setStatus(`❌ Maximum ${MAX_FILES} images pour le test gratuit.`)
        return
      }

      setIsRunning(true)
      setStatus('Analyse en cours…')

      const form = new FormData()
      for (const f of files) form.append('files', f)

      const data = await apiFetch<DemoOcrResponse>('/demo/ocr', {
        method: 'POST',
        headers: { 'Accept-Language': navigator.language || 'fr-FR' },
        body: form,
      })

      if (!data.ok) {
        setStatus(`❌ ${data.message || data.error || 'Erreur OCR'}`)
        return
      }

      setResult(data)
      setStatus('✅ Analyse terminée')
    } catch (e: any) {
      if (e?.message === 'DEMO_LIMIT_REACHED') {
        setStatus('❌ Tu as atteint la limite du test gratuit pour aujourd’hui.')
      } else if (e?.message === 'TOO_MANY_FILES') {
        setStatus(`❌ Maximum ${MAX_FILES} images pour le test gratuit.`)
      } else if (e?.message === 'NO_FILES') {
        setStatus('❌ Ajoute au moins 1 image.')
      } else {
        setStatus(`❌ ${e?.message || 'Erreur inconnue'}`)
      }
    } finally {
      setIsRunning(false)
    }
  }

  const statusKind = status.startsWith('✅')
    ? 'success'
    : status.startsWith('❌')
      ? 'error'
      : 'info'

  return (
    <main className="app-container ocr-page">
      <section className="ocr-shell">
        <header className="ocr-head">
          <p className="ocr-eyebrow">Test gratuit</p>
          <h1 className="ocr-title">Tester MySia avec une capture</h1>

          <p className="ocr-subtitle">
            Envoie jusqu’à 2 captures d’écran d’une même recette.
            <br />
            Aucun compte nécessaire pour voir ce que MySia comprend.
          </p>
        </header>

        {!result && (
          <>
            <section className="ocr-how-card">
              <h2 className="ocr-section-title">Comment ça marche</h2>

              <div className="ocr-how-grid">
                <article className="ocr-step-card">
                  <span className="ocr-step-number">1</span>
                  <div>
                    <h3>📸 Ajoute jusqu’à 2 images</h3>
                    <p>Instagram, TikTok, Pinterest, photo de livre ou fiche recette.</p>
                  </div>
                </article>

                <article className="ocr-step-card">
                  <span className="ocr-step-number">2</span>
                  <div>
                    <h3>✨ MySia analyse</h3>
                    <p>Le titre, les ingrédients et les étapes sont détectés automatiquement.</p>
                  </div>
                </article>

                <article className="ocr-step-card">
                  <span className="ocr-step-number">3</span>
                  <div>
                    <h3>🔓 Débloque la suite</h3>
                    <p>Crée ton compte pour voir le coût complet et enregistrer la recette.</p>
                  </div>
                </article>
              </div>
            </section>

            <section className="ocr-import-card">
              <div className="ocr-import-head">
                <div>
                  <h2 className="ocr-section-title">Ajouter les images</h2>
                  <p className="ocr-section-text">
                    Sélectionne entre 1 et {MAX_FILES} image(s). Plus les captures sont nettes,
                    meilleur sera le résultat.
                  </p>
                </div>

                {files.length > 0 && (
                  <div className="ocr-count-badge">
                    {files.length} image(s) sélectionnée(s)
                  </div>
                )}
              </div>

              <label className="ocr-upload-box" htmlFor="demoOcrFiles">
                <div className="ocr-upload-icon">📷</div>
                <div className="ocr-upload-title">Choisir 1 ou 2 images</div>
                <div className="ocr-upload-text">
                  Maximum {MAX_FILES} fichiers pour le test gratuit.
                </div>

                <input
                  id="demoOcrFiles"
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) =>
                    setFiles(Array.from(e.target.files ?? []).slice(0, MAX_FILES))
                  }
                  className="ocr-file-input"
                />
              </label>

              <p className="ocr-help-text">
                Tu peux sélectionner 2 captures d’une même recette.
              </p>

              <div className="ocr-actions">
                <button
                  onClick={run}
                  disabled={!canRun}
                  className="ocr-run-btn"
                  type="button"
                >
                  {isRunning ? 'Analyse en cours…' : 'Tester avec mes captures'}
                </button>
              </div>
            </section>

            {previewUrls.length > 0 && (
              <section className="ocr-preview-card">
                <h2 className="ocr-section-title">Aperçu des images</h2>

                <div className="try-preview-grid">
                  {previewUrls.map((url, index) => (
                    <div key={url} className="try-preview-card">
                      <Image
                        src={url}
                        alt={`Capture ${index + 1}`}
                        fill
                        unoptimized
                        className="try-preview-image"
                      />
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {status && (
          <div
            className={`ocr-status-card ${
              statusKind === 'success'
                ? 'is-success'
                : statusKind === 'error'
                  ? 'is-error'
                  : 'is-info'
            }`}
          >
            <span className="ocr-status-text">{status}</span>
          </div>
        )}

        {result && (
          <>
            <section ref={resultRef} className="try-result-card">
              <h2 className="ocr-section-title">Résultat détecté</h2>

              {result.recipe.imageUrl && (
                <div className="try-result-media">
                  <Image
                    src={result.recipe.imageUrl}
                    alt={result.recipe.title || 'Recette détectée'}
                    fill
                    className="try-result-media-img"
                    sizes="280px"
                  />
                </div>
              )}

              <div className="try-result-block">
                <div className="try-result-field">
                  <div className="try-result-label">Titre</div>
                  <div className="try-result-title">
                    {result.recipe.title || 'Titre non détecté'}
                  </div>
                </div>

                <div className="try-result-field">
                  <div className="try-result-label">Ingrédients détectés</div>

                  <div className="ocr-preview-list">
                    {result.recipe.ingredients.map((ing, idx) => (
                      <div key={`${ing.name}-${idx}`} className="ocr-preview-item">
                        <div className="ocr-preview-row">
                          <div>
                            <strong>{ing.name}</strong>{' '}
                            <span className="app-muted">
                              {ing.quantity ? `${ing.quantity}` : ''} {ing.unit || ''}
                            </span>
                          </div>

                          <div className="ocr-preview-price">
                            {ing.pricing.visible ? (
                              <Price value={ing.pricing.costEur ?? null} />
                            ) : (
                              <span className="lock-pill demo-blur-value">10,80 €</span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="try-result-field">
                  <div className="try-result-label">Étapes détectées</div>

                  <ol className="try-steps-list">
                    {result.recipe.steps.map((step, index) => (
                      <li key={`${index}-${step}`}>{step}</li>
                    ))}
                  </ol>
                </div>

                {result.recipe.notes && (
                  <div className="try-result-field">
                    <div className="try-result-label">Notes détectées</div>
                    <div className="try-notes-box">{result.recipe.notes}</div>
                  </div>
                )}
              </div>
            </section>

            <section className="try-costs-card">
              <h2 className="ocr-section-title">
                Coûts complets <span className="demo-lock-hint">(débloqué avec un compte)</span>
              </h2>

              <div className="try-costs-grid">
                <div className="try-cost-row">
                  <span className="try-cost-label">Coût recette</span>
                  <span className="lock-pill lock-pill--wide demo-blur-value">23,70 €</span>
                </div>

                <div className="try-cost-row">
                  <span className="try-cost-label">Coût courses</span>
                  <span className="lock-pill lock-pill--wide demo-blur-value">25,60 €</span>
                </div>

                <div className="try-cost-row">
                  <span className="try-cost-label">Badge budget</span>
                  <span className="lock-text">🔒 Débloqué avec un compte</span>
                </div>

                <div className="try-cost-row">
                  <span className="try-cost-label">Comment réduire le coût</span>
                  <span className="lock-text">🔒 Débloqué avec un compte</span>
                </div>
              </div>

              <DemoPaywallNotice remaining={result.trial.remaining} />
            </section>
          </>
        )}
      </section>
    </main>
  )
}