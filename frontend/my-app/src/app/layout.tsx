// frontend/my-app/src/app/layout.tsx

import type { Metadata } from 'next'
import { Inter, Playfair_Display } from 'next/font/google'
import './globals.css'
import AuthTokenBridge from './_auth-bridge'
import HeaderClient from './header-client'

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
title: 'MySia-app',
description: 'Application de recettes et budget',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
return (
<html lang="fr">
<body className={`${inter.variable} ${playfair.variable} ${inter.className} antialiased`}>
<AuthTokenBridge />

{/* ✅ Header géré côté client (menu / compact selon la page) */}
<HeaderClient />

{/* ✅ Shell global */}
<div className="app-shell">
<div className="app-container">{children}</div>

{/* ✅ Branding discret en bas (comme sur la story) */}
<footer className="app-footer app-container">
<span className="app-footer-brand">MySia-app</span>
</footer>
</div>
</body>
</html>
)
}