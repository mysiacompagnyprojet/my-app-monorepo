import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AuthTokenBridge from "./_auth-bridge";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Mon application",
  description: "Application de recettes et organisation",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
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
  );
}

