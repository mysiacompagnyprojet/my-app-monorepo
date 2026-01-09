// frontend/my-app/src/app/layout.tsx
import type { Metadata } from 'next'
import { Inter, Playfair_Display } from 'next/font/google'
import './globals.css'
import AuthTokenBridge from './_auth-bridge'

// ✅ Police STRUCTURE / APPLICATION (global)
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  weight: ['400', '500', '600', '700'],
})

// ✅ Police TITRES recettes (à utiliser seulement quand tu veux)
const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-playfair',
  weight: ['400', '600', '700'],
})

export const metadata: Metadata = {
  title: 'Mon application',
  description: 'Application de recettes et organisation',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      {/* ✅ Inter par défaut sur toute l’app */}
      <body className={`${inter.variable} ${playfair.variable} ${inter.className} antialiased`}>
        <AuthTokenBridge />

        {/* Header en “carte” pour rester dans la DA */}
        <header className="app-card app-container" style={{ marginTop: 16 }}>
          <nav className="flex flex-wrap gap-3 items-center px-4 py-3">
            <a className="font-bold app-title" href="/">
              Accueil
            </a>
            <a className="font-semibold" href="/recipes">
              📜 Mes recettes
            </a>
            <a className="font-semibold" href="/recipes/new">
              ➕ Nouvelle recette
            </a>
          </nav>
        </header>

        {/* Shell global */}
        <div className="app-shell">
          <div className="app-container">{children}</div>
        </div>
      </body>
    </html>
  )
}
