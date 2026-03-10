//frontend/my-app/src/components/PricingPaywallNotice.tsx - message paywall

'use client'

import Link from 'next/link'

type Props = {
 remaining?: number | null
 context?: 'recipes' | 'import'
}

export default function PricingPaywallNotice({ remaining, context = 'recipes' }: Props) {
 const showRemaining =
   typeof remaining === 'number' && Number.isFinite(remaining) && remaining >= 0

 const message =
   context === 'import'
     ? `Tu as utilisé tes 10 recettes gratuites avec prix visibles.

Passe en Premium pour voir :
• le vrai prix des recettes
• le coût des courses
• le détail des ingrédients et de leurs prix`
     : `Tu as utilisé tes 10 recettes gratuites avec prix visibles.

Passe en Premium pour débloquer le vrai prix de toutes tes recettes.`

 return (
   <div
     className="app-card p-4"
     style={{
       boxShadow: 'none',
       borderColor: 'rgba(139,106,79,0.18)',
       background: 'rgba(139,106,79,0.06)',
       marginTop: 12,
     }}
     >
     <div style={{ fontWeight: 800, color: 'var(--primary)', marginBottom: 6 }}>
       Limite gratuite atteinte
     </div>

     <p className="app-muted" style={{ margin: 0, whiteSpace: 'pre-line' }}>
       {message}
     </p>

     {showRemaining && (
       <p className="app-muted" style={{ marginTop: 8, marginBottom: 0 }}>
         Recettes restantes avec prix visibles : {remaining}
       </p>
     )}

     <div style={{ marginTop: 12 }}>
       <Link href="/premium" className="app-btn-primary">
         Débloquer les prix
       </Link>
     </div>
   </div>
 )
}