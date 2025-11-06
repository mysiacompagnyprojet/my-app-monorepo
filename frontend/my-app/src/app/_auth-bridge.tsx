'use client'
import { useEffect } from 'react'
// Si tes imports absolus fonctionnent déjà, garde cette ligne :
import { supabase } from 'src/lib/supabase'
// Sinon, remplace par: import { supabase } from '../../lib/supabaseClient'

export default function AuthTokenBridge() {
  useEffect(() => {
    // Pose le token si une session existe déjà
    supabase.auth.getSession().then(({ data }) => {
      const t = data.session?.access_token
      if (t) {
        try { localStorage.setItem('sb:token', t) } catch {}
      }
    })

    // Écoute login / refresh / logout
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const t = session?.access_token
      if (t) { try { localStorage.setItem('sb:token', t) } catch {} }
      else { try { localStorage.removeItem('sb:token') } catch {} }
    })

    return () => { sub.subscription.unsubscribe() }
  }, [])

  return null
}
