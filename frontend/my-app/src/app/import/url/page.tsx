// frontend/my-app/src/app/import/url/page.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import PricingPaywallNotice from '@/components/PricingPaywallNotice'

// ✅ Types
type Limits = {
 blurPrices: boolean
 used: number
 limit: number
 remaining: number
}

type RecipeDraft = {
 title: string
 servings: number
 imageUrl: string | null
 notes?: string | null
 steps: string[]
 ingredients: any[]
}

type ImportUrlResponse =
 | { ok: true; draft: RecipeDraft; limits?: Limits | null }
 | { ok: false; error: string; message?: string }

export default function Page() {
 const [url, setUrl] = useState('')
 const [status, setStatus] = useState('')
 const [limits, setLimits] = useState<Limits | null>(null)

 const router = useRouter()

 async function run() {
   try {
     const cleanedUrl = url.trim()
     if (!cleanedUrl) return

     setStatus('Import en cours…')
     setLimits(null)

     const res = await apiFetch<ImportUrlResponse>('/import/url', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ url: cleanedUrl }),
     })

     // ✅ si l’API renvoie {ok:false} (même en 200)
     if ((res as any)?.ok === false) {
       setStatus('❌ ' + ((res as any)?.message || (res as any)?.error || 'Erreur import URL'))
       return
     }

     // ✅ stocker limits (pour l’UI)
     const lim = (res as any)?.limits ?? null
     setLimits(lim)

     // ✅ persister la règle de flou globale
     localStorage.setItem('pricing_blur', lim?.blurPrices ? '1' : '0')

     sessionStorage.setItem('recipeDraft', JSON.stringify((res as any).draft))
     setStatus('✅ Import OK')

     // ✅ URL ≠ OCR → prefill=1
     router.push('/recipes/new?prefill=1')
   } catch (e: any) {
     setStatus('❌ ' + (e?.message || 'Erreur'))
   }
 }

 const statusKind = status.startsWith('✅') ? 'success' : status.startsWith('❌') ? 'error' : 'info'

 return (
   <main className="app-container" style={{ margin: '20px auto 40px' }}>
     <section className="app-card p-5">
       <h1 className="text-2xl font-extrabold app-title">Importer par URL</h1>

       <p className="mt-2 app-muted">
         Colle le lien d’une recette (blog, site, etc.). Nous allons la convertir en une fiche modifiable.
       </p>

       <div className="mt-5">
         <label className="text-sm font-semibold" htmlFor="importUrl">
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

         <div className="mt-4 flex items-center gap-3">
           <button onClick={run} disabled={!url.trim()} className="app-btn-primary">
             Importer
           </button>

           <a className="app-btn-secondary" href="/import/ocr">
             Import par photo (OCR)
           </a>
         </div>

         {/* ✅ Info freemium */}
         {limits && (
           <div className="mt-3 text-sm app-muted">
             {limits.blurPrices
               ? 'Limite atteinte : les prix seront floutés.'
               : `Il te reste ${limits.remaining} recette(s) avec prix visibles sur ${limits.limit}.`}
           </div>
         )}

         {limits?.blurPrices && (
          <PricingPaywallNotice remaining={limits.remaining} context="import" />
         )}
         
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
       </div>
     </section>
   </main>
 )
}