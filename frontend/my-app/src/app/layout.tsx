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
title: 'Mysia.app',
description: 'Application de recettes et budget',
}

export default function RootLayout({
children,
}: {
children: React.ReactNode
}) {
return (
<html lang="fr">
{/* ✅ Inter par défaut sur toute l’app */}
<body className={`${inter.variable} ${playfair.variable} ${inter.className} antialiased`}>
<AuthTokenBridge />

{/* Header en “carte” pour rester dans la DA */}
<header className="app-card app-container app-header">
<nav className="flex flex-wrap gap-3 items-center px-4 py-3">
{/* ✅ Branding discret (remplace "Accueil") */}
<a className="app-brand" href="/">
Mysia.app
</a>

<a className="font-semibold" href="/recipes">
📜 Mes recettes
</a>

{/* ✅ Import OCR entre Mes recettes et Nouvelle recette */}
<a className="font-semibold" href="/import/ocr">
📷 Import OCR
</a>

<a className="font-semibold" href="/recipes/new">
➕ Nouvelle recette
</a>
</nav>
</header>

{/* Shell global */}
<div className="app-shell">
<div className="app-container">{children}</div>

{/* ✅ Branding discret en bas (comme sur la story) */}
<footer className="app-footer app-container">
<span className="app-footer-brand">Mysia.app</span>
</footer>
</div>
</body>
</html>
)
}