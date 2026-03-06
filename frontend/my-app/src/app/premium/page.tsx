//frontend/my-app/src/app/premium/page.tsx

'use client'

import { useState } from 'react'
import { apiFetch } from 'src/lib/api'

type CheckoutResponse = {
  ok: boolean
  url: string
}

export default function PremiumPage() {
  const [status, setStatus] = useState<string>('')

  async function goToStripe() {
    try {
      setStatus('Redirection vers le paiement sécurisé…')

      // Appel backend : POST /billing/checkout
      const res = await apiFetch<CheckoutResponse>('/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({}),
      })

      if (!res.url) {
        setStatus('❌ URL de redirection manquante')
        return
      }

      window.location.href = res.url
    } catch (e: any) {
      setStatus('❌ ' + (e?.message || 'Erreur'))
    }
  }

  const statusKind =
    status.startsWith('❌') ? 'error' : status ? 'info' : null

  return (
    <main className="app-container" style={{ margin: '40px auto' }}>
      <section className="app-card p-6">
        <h1 className="text-2xl font-extrabold app-title">Passer en Premium</h1>

        <p className="mt-3 app-muted">
          Débloque toutes les fonctionnalités avancées et profite de l’application
          sans limite, en toute sérénité.
        </p>

        {/* Avantages */}
        <ul
          className="mt-4 text-sm"
          style={{ lineHeight: 1.8, paddingLeft: 18 }}
        >
          <li>✔ Imports illimités (URL & OCR)</li>
          <li>✔ Accès aux fonctionnalités avancées</li>
          <li>✔ Évolutions futures incluses</li>
        </ul>

        {/* CTA */}
        <div className="mt-6">
          <button
            onClick={goToStripe}
            className="app-btn-primary"
          >
            Passer Premium
          </button>

          <p className="mt-2 text-xs app-muted">
            Paiement sécurisé via Stripe. Annulation possible à tout moment.
          </p>
        </div>

        {/* Status */}
        {status && (
          <div
            className="mt-4 app-card p-3 text-sm"
            style={{
              boxShadow: 'none',
              borderColor:
                statusKind === 'error'
                  ? 'rgba(176,0,32,0.25)'
                  : 'var(--border)',
              background:
                statusKind === 'error'
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

