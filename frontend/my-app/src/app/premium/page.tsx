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
      setStatus('Redirection vers Stripe…')

      // Appel de ton backend : POST /billing/checkout
      const res = await apiFetch<CheckoutResponse>('/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({}), // pas de payload particulier
      })

      if (!res.url) {
        setStatus('❌ URL de redirection manquante')
        return
      }

      // Redirection vers la page de paiement Stripe
      window.location.href = res.url
    } catch (e: any) {
      setStatus('❌ ' + (e?.message || 'Erreur'))
    }
  }

  return (
    <main
      style={{
        padding: 24,
        maxWidth: 600,
        margin: '2rem auto',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
      }}
    >
      <h1 style={{ fontSize: '1.8rem', marginBottom: '0.5rem' }}>Premium</h1>
      <p style={{ marginBottom: '1rem' }}>
        Passe en version premium pour débloquer les imports illimités et les
        fonctionnalités avancées.
      </p>

      <button
        onClick={goToStripe}
        style={{
          padding: '0.75rem 1.5rem',
          borderRadius: 10,
          border: 'none',
          background: '#111827',
          color: '#fff',
          cursor: 'pointer',
          fontSize: '1rem',
        }}
      >
        Passer Premium
      </button>

      {status && (
        <p style={{ marginTop: '1rem' }}>
          {status}
        </p>
      )}
    </main>
  )
}
