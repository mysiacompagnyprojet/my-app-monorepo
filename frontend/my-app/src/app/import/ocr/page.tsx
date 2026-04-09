// frontend/my-app/src/app/import/ocr/page.tsx
'use client'

import { Suspense, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import type { OcrDraft } from '@/types/recipe'
import Price from '@/components/Price'
import PricingPaywallNotice from '@/components/PricingPaywallNotice'

type PricingPolicy = {
 blurPrices: boolean
 used: number
 limit: number
 remaining: number
}

type ImportOcrResponse =
 | { ok: true; draft: OcrDraft; pricingPolicy?: PricingPolicy }
 | { ok: true; debug: any; pricingPolicy?: PricingPolicy }
 | { ok: false; error: string; message?: string }

const MAX_FILES = 10

function OcrPageInner() {
 const router = useRouter()
 const search = useSearchParams()

 // ✅ on garde l’ancienne logique : debug via URL ?debug=1
 const isDebug = search.get('debug') === '1'

 const [files, setFiles] = useState<File[]>([])
 const [status, setStatus] = useState('')
 const [isRunning, setIsRunning] = useState(false)
 const [debugOut, setDebugOut] = useState<any>(null)
 const [draft, setDraft] = useState<OcrDraft | null>(null)

 // ✅ nouveau : policy (flou + compteur)
 const [pricingPolicy, setPricingPolicy] = useState<PricingPolicy | null>(null)

 const canRun = useMemo(
   () => files.length >= 1 && files.length <= MAX_FILES && !isRunning,
   [files, isRunning]
 )

 async function run() {
   try {
     setDebugOut(null)
     setDraft(null)
     setPricingPolicy(null)
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

     // ✅ on garde l’ancienne mécanique de debug côté backend
     const qs = isDebug ? '?debug=1' : ''

     const data = await apiFetch<ImportOcrResponse>(`/import/ocr${qs}`, {
       method: 'POST',
       headers: { 'Accept-Language': navigator.language || 'fr-FR' },
       body: form,
     })

     // Erreur API
     if ((data as any)?.ok === false) {
       setStatus(
         '❌ ' + ((data as any)?.message || (data as any)?.error || 'Erreur OCR')
       )
       return
     }

     // ✅ nouveau : récupère la policy + stocke la règle globale de flou
     if ('pricingPolicy' in data && (data as any).pricingPolicy) {
       const p = (data as any).pricingPolicy as PricingPolicy
       setPricingPolicy(p)
       localStorage.setItem('pricing_blur', p.blurPrices ? '1' : '0')
     } else {
       // par défaut : pas de flou
       localStorage.setItem('pricing_blur', '0')
     }

     // Mode debug (pas de redirection) — on garde l’ancien comportement
     if ('debug' in data) {
       setDebugOut((data as any).debug)
       setStatus('✅ Debug reçu (aucune redirection)')
       return
     }

     // Draft OK
     if ('draft' in data) {
       setDraft(data.draft)
       sessionStorage.setItem('recipeDraft', JSON.stringify(data.draft))
       router.push('/recipes/new?from=ocr')
       return
     }

     setStatus('❌ Réponse inattendue du serveur.')
   } catch (e: any) {
     setStatus('❌ ' + (e?.message || 'Erreur inconnue'))
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
          <p className="ocr-eyebrow">Import OCR</p>
          <h1 className="ocr-title">
            Importer une recette depuis une ou des images
          </h1>

          <p className="ocr-subtitle">
            Capture d’écran Pinterest, Instagram, Facebook, photo de livre ou fiche recette :
            <br />
            MySia rassemble tout pour préparer une recette exploitable.
          </p>
        </header>  

       {/* Instructions (ancienne version conservée) */}
        <section className="ocr-how-card">
          <h2 className="ocr-section-title">Comment ça marche</h2>
          <div className="ocr-how-grid">
            <article className="ocr-step-card">
              <span className="ocr-step-number">1</span>
              <div>
                <h3>📸 Prends tes captures</h3>
                <p>Pinterest, Instagram, Facebook, livre ou fiche recette.</p>
              </div>
            </article>  

            <article className="ocr-step-card">
              <span className="ocr-step-number">2</span>
              <div>
                <h3>🖼️ Sélectionne les images</h3>
                <p>Tu peux envoyer plusieurs images d'une même recette.</p>
              </div>
            </article>

            <article className="ocr-step-card">
              <span className="ocr-step-number">3</span>
              <div>
                <h3>✨ MySia regroupe tout</h3>
                <p>Les ingrédients sont fusionnés dans un brouillon prêt à être retravaillé</p>
              </div>
            </article>
          </div>
        </section>  

       {/* Upload */}
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

          <label className="ocr-upload-box" htmlFor="ocrFiles">
            <div className="ocr-upload-icon">📷</div>
            <div className="ocr-upload-title">Choisir une ou plusieurs images</div>
            <div className="ocr-upload-text">
              Formats image classiques acceptés. Maximum {MAX_FILES} fichiers.
            </div>

            <input
              id="ocrFiles"
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              className="ocr-file-input"
            />
          </label>

          <p className="ocr-help-text">
            Tu peux sélectionner plusieurs images en même temps.
            {files.length > MAX_FILES ? ` Trop d’images : maximum ${MAX_FILES}.` : ''}
          </p>

          <div className="ocr-actions">
            <button
              onClick={run}
              disabled={!canRun}
              className="ocr-run-btn"
              type="button"
            >
              {isRunning ? 'Traitement en cours…' : 'Lancer l’OCR'}
            </button>

            {isDebug && (
              <span className="app-badge ocr-debug-badge">
                Debug actif
              </span>
            )}
          </div>
        </section>

        {/* ✅ nouveau : info freemium (ne change rien si absent) */}
        {pricingPolicy && (
          <div className="ocr-policy-text">
            {pricingPolicy.blurPrices
              ? 'Limite atteinte : les prix sont floutés.'
              : `Il te reste ${pricingPolicy.remaining} recette(s) avec prix visibles sur ${pricingPolicy.limit}.`}
          </div>
        )}

        {/* bloc du paywall*/}
        {pricingPolicy?.blurPrices && (
          <PricingPaywallNotice remaining={pricingPolicy.remaining} context="import" />
        )}

        {/* Aperçu (ancienne version conservée, mais prix via <Price/> + blur) */}
        {draft && (
          <div className="ocr-preview-card">
            <h3 className="ocr-section-title">Aperçu ingrédients + prix</h3>
            <div className="ocr-preview-list">
              {draft.ingredients?.map((ing, idx) => (
                <div key={idx} className="ocr-preview-item">
                  <div className="ocr-preview-row">
                    <div>
                      <strong>{ing.name}</strong>{' '}
                      <span style={{ opacity: 0.8 }}>
                        {ing.quantity ? `${ing.quantity}` : ''} {ing.unit || ''}
                      </span>
                    </div>

                    <div className="ocr-preview-price">
                      <Price value={(ing as any).costEur} blur={pricingPolicy?.blurPrices} />
                    </div>
                  </div>

                  {(ing as any).priceMatched === false && (
                    <div className="ocr-preview-warning">
                      Prix non trouvé dans Airtable (0 appliqué)
                    </div>
                  )}
                </div>
              ))}
            </div>
              <div className="ocr-preview-total">
                <div className="cost-summary">
                  <div className="cost-pill">
                    <div className="cost-pill-row">
                      <div className="cost-pill-label">Coût recette ≈</div>
                      <div className="cost-pill-value">
                       <span className="amount">
                         <Price
                           value={(draft as any).totalCostEur}
                           blur={pricingPolicy?.blurPrices}
                         />
                       </span>
                     </div>
                   </div>
                 </div>
               </div>
             </div>
          </div>   
        )}

        {/* Status (ancienne version conservée) */}
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
            <span className="ocr-status-text">
              {status}
            </span>
          </div>
        )}

        {isDebug && (
          <p className="mt-3 text-sm app-muted">
            Mode debug actif : l’API renvoie un objet debug, sans redirection.
          </p>
        )}
       
        {/* Debug output (ancienne version conservée) */}
        {debugOut && (
          <section className="ocr-debug-card">
            <h2 className="text-lg font-extrabold app-title">Debug</h2>

            <pre
              className="ocr-debug-pre">
              {JSON.stringify(debugOut, null, 2)}
            </pre>
          </section>
        )} 
      </section>  
   </main>
  )
}

export default function Page() {
 return (
   <Suspense
     fallback={
       <div className="app-container" style={{ padding: 24 }}>
         Chargement…
       </div>
     }
    >
     <OcrPageInner />
   </Suspense>
 )
}