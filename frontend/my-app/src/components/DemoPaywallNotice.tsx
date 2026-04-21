//frontend/my-app/src/components/DemoPaywallNotice.tsx

'use client'

import Link from 'next/link'

type Props = {
  remaining: number
}

export default function DemoPaywallNotice({ remaining }: Props) {
  return (
    <div className="demo-paywall-card">
      <h3 className="demo-paywall-title">Voir le coût complet de cette recette</h3>

      <p className="demo-paywall-text">
        MySia a détecté les ingrédients et les étapes.
        <br />
        Crée ton compte pour voir le prix complet, le coût des courses et comment réduire la facture.
      </p>

      <p className="demo-paywall-meta">
        Essais restants aujourd’hui : {remaining}
      </p>

      <div className="demo-paywall-actions">
        <Link href="/create-account" className="app-btn-primary">
          Créer mon compte
        </Link>
      </div>
    </div>
  )
}