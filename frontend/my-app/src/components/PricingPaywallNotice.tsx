//frontend/my-app/src/components/PricingPaywallNotice.tsx - message paywall

'use client'

import Link from 'next/link'

type Props = {
 remaining?: number | null
}

export default function PricingPaywallNotice({ remaining }: Props) {
 const showRemaining =
   typeof remaining === 'number' && Number.isFinite(remaining) && remaining >= 0

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

     <p className="app-muted" style={{ margin: 0 }}>
       Tu as atteint la limite gratuite de 10 recettes avec prix visibles.
       Passe à Premium pour voir les prix sans limite.
     </p>

     {showRemaining && (
       <p className="app-muted" style={{ marginTop: 8, marginBottom: 0 }}>
         Recettes restantes avec prix visibles : {remaining}
       </p>
     )}

     <div style={{ marginTop: 12 }}>
       <Link href="/premium" className="app-btn-primary">
         Voir Premium
       </Link>
     </div>
   </div>
 )
}