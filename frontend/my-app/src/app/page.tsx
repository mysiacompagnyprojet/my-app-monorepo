// frontend/my-app/src/app/page.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'

// --- Lecture des variables d'environnement (côté client) ---
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

export default function Home() {
    const router = useRouter()
    const [checking, setChecking] = useState(true)

    const supabase = useMemo(() => {
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null
        return createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    }, [])

    useEffect(() => {
        let mounted = true
        async function run() {
            if (!supabase) {
                if (mounted) setChecking(false)
                return
            }

            const { data } = await supabase.auth.getSession()

            // si deja connecte on va direct import ocr
            if (data.session) {
                router.replace('/import/ocr')
                return
            }

            // sinon on reste sur la page d'accueil magik link
            if (mounted) setChecking(false)
        }
        run()
        return () => {
            mounted = false
        }
    }, [supabase, router])

    //eviter un flash de l'ecran login si session existe
    if (checking) return null

    return (
        <div className="flex flex-col gap-6">
            {/* Carte principale */}
            <section className="app-card p-5">
                {/* ✅ Boutons du haut supprimés (Import OCR / Mes recettes / Nouvelle recette) */}

                {/* Container login (bêta) */}
                <div className="mt-6">
                    <LoginCard nextPath="/import/ocr" />
                </div>
            </section>
        </div>
    )
}

function LoginCard({ nextPath }: { nextPath: string }) {
    const [email, setEmail] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [magicStatus, setMagicStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle')

    const supabase = useMemo(() => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null
        return createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    }, [])

    const supabaseConfigMissing = !SUPABASE_URL || !SUPABASE_ANON_KEY

    async function handleMagicLink() {
        setMagicStatus('loading')
        setError(null)
        setBusy(true)

        try {
            if (!supabase) {
                throw new Error(
                    'Configuration Supabase manquante : NEXT_PUBLIC_SUPABASE_URL ou NEXT_PUBLIC_SUPABASE_ANON_KEY'
                )
            }

            const origin =
            typeof window !== 'undefined' //&& window.location.origin.includes('localhost')
            ? window.location.origin
            : 'https://my-app-monorepo.vercel.app'

            const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(nextPath)}`

            const { error } = await supabase.auth.signInWithOtp({
                email,
                options: { emailRedirectTo: redirectTo },
            })

            if (error) throw error
            setMagicStatus('sent')
        } catch (err: any) {
            setMagicStatus('error')
            setError(err?.message ?? 'Erreur magic link.')
        } finally {
            setBusy(false)
        }
    }

    return (
        <section className="app-card p-5">
            <h2 className="text-lg font-extrabold app-title">Connexion</h2>

            <p className="mt-1 app-muted text-sm">
                Accède à la bêta de MySia par lien magique pour tester l’import de recettes et le calcul du budget.
            </p>

            <div className="mt-4 grid gap-2">
                <label className="grid gap-1 text-sm font-semibold">
                    Email
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        style={{
                            background: 'white',
                            border: '1px solid var(--border)',
                            borderRadius: 10,
                            padding: 10,
                        }}
                    />
                </label>

                <button
                    onClick={handleMagicLink}
                    disabled={busy || magicStatus === 'loading' || !email || supabaseConfigMissing}
                    className="app-btn-secondary w-full"
                    type="button"
                >
                    {magicStatus === 'loading'
                        ? 'Envoi du lien…'
                        : magicStatus === 'sent'
                        ? 'Lien envoyé ✅'
                        : 'Recevoir mon lien magique'
                    }
                </button>

                {magicStatus === 'sent' && (
                    <p className="mt-2 app-muted text-sm">
                        Ouvre ton mail sur <strong>le même appareil</strong> et clique sur le lien.
                    </p>
                )}

                {error && (
                    <div
                        className="mt-3 app-card p-3 text-sm"
                        style={{
                            boxShadow: 'none',
                            borderColor: 'rgba(176,0,32,0.25)',
                            background: 'rgba(176,0,32,0.06)',
                        }}
                    >
                        <strong style={{ color: '#b00020' }}>Erreur :</strong> {error}
                    </div>
                )}

                {supabaseConfigMissing && (
                    <div
                        className="mt-3 app-card p-3 text-sm"
                        style={{
                            boxShadow: 'none',
                            borderColor: 'rgba(176,0,32,0.25)',
                            background: 'rgba(176,0,32,0.06)',
                        }}
                    >
                        <strong style={{ color: '#b00020' }}>Configuration manquante :</strong>
                        <br />
                            Vérifie les variables Vercel : <code>NEXT_PUBLIC_SUPABASE_URL</code> et{' '}
                            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>.
                    </div>
                )}
            </div>
        </section>
    )
}