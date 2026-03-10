// frontend/my-app/src/app/layout.tsx
import type { Metadata } from 'next'
import { Inter, Playfair_Display } from 'next/font/google'
import './globals.css'
import AuthTokenBridge from './_auth-bridge'
import HeaderClient from './header-client'
import { Suspense } from 'react'

const inter = Inter({
 subsets: ['latin'],
 variable: '--font-inter',
 weight: ['400', '500', '600', '700'],
})

const playfair = Playfair_Display({
 subsets: ['latin'],
 variable: '--font-playfair',
 weight: ['400', '600', '700'],
})

export const metadata: Metadata = {
 title: 'MySia-app',
 description: 'Application de recettes et budget',
}

export const viewport = {
 width: 'device-width',
 initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
 return (
   <html lang="fr">
     <body className={`${inter.variable} ${playfair.variable} ${inter.className} antialiased`}>
       <AuthTokenBridge />

       <div className="app-shell">
         <div className="app-container">
           <Suspense fallback={null}>
             <HeaderClient />
           </Suspense>
         </div>

         {children}

         <div className="app-container">
           <footer className="app-footer">
             <span className="app-footer-brand">MySia-app</span>
           </footer>
         </div>
       </div>
     </body>
   </html>
 )
}