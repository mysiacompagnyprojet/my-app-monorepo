//frontend/src/app/login/page.tsx

'use client'

import Image from 'next/image'
import Link from 'next/link'
import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { API_URL } from '../../lib/api'
import { supabase } from '../../lib/supabase'

function fireAndForgetAuthSync(token: string) {
  if (!API_URL) return;

  const syncUrl = `${API_URL.replace(/\/+$/, '')}/auth/sync`;

  fetch(syncUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    credentials: 'include',
    keepalive: true,
    body: JSON.stringify({ from: 'password_login' }),
  }).catch((e) => {
    console.error('[auth/sync] background sync failed', e);
  });
}

function LoginInner() {
  const router = useRouter()
  const search = useSearchParams()

  const nextParam = (search.get('next') || '/recipes').trim()
  const nextPath = nextParam.startsWith('/') ? nextParam : '/recipes'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) throw error

      const token = data.session?.access_token
      if (!token) {
        throw new Error('Session manquante après connexion')
      }

      try {
        localStorage.setItem('sb:token', token)
      } catch {}

      fireAndForgetAuthSync(token)

      router.replace(nextPath)
      router.refresh()
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : typeof err === 'string'
          ? err
          : 'Erreur inconnue'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="app-container authPage">
      <section className="authShell">
        <div className="authIntroCard">
          <p className="authEyebrow">Bienvenue sur</p>
          <h1 className="authIntroTitle">MySia</h1>

          <p className="authIntroText">
            Importez vos recettes et voyez leur vrai coût avant de faire les courses.
          </p>

          <ul className="authBenefits">
            <li><span className="authCheck">✓</span><span>Coût de la recette</span></li>
            <li><span className="authCheck">✓</span><span>Coût total des courses</span></li>
            <li><span className="authCheck">✓</span><span>Prix par personne</span></li>
          </ul>

          <div className="authPhoneWrap">
            <div className="authPhone">
              <div className="authPhoneImage">
                <Image
                  src="/landing-phone-shot.jpg"
                  alt="Aperçu MySia"
                  fill
                  className="authPhoneImageImg"
                  sizes="(max-width: 760px) 70vw, 270px"
                  priority
                />
              </div>
            </div>
          </div>
        </div>

        <div className="authFormCard">
          <h2 className="authTitle">Connexion</h2>
          <p className="authText">Accédez à votre espace MySia en toute sécurité.</p>

          <form onSubmit={onSubmit} className="authForm">
            <label className="authLabel">
              Email
              <input
                className="authInput"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>

            <label className="authLabel">
              Mot de passe
              <input
                className="authInput"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>

            <button disabled={busy} type="submit" className="authPrimaryBtn">
              {busy ? 'Connexion…' : 'Se connecter'}
            </button>
          </form>

          {error && (
            <div className="authAlertError">
              <strong>Erreur :</strong> {error}
            </div>
          )}

          <p className="authFooterLink">
            Première connexion ? <Link href="/create-account">Créer mon compte</Link>
          </p>
        </div>
      </section>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Chargement…</div>}>
      <LoginInner />
    </Suspense>
  )
}