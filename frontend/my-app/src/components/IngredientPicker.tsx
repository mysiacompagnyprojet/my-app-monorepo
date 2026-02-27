'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase' // adapte le chemin si ton client Supabase est ailleurs

type IngredientBaseItem = {
    id: string
    nom: string
    type_unite?: string | null
    unite_g_ml_piece?: number | null
    densite_g_ml?: number | null
    quantite_de_reference?: number | null
    prix_d_achat?: number | null
    prix_kg_l_piece?: number | null
}

type Props = {
    querySeed: string
    onPick: (item: IngredientBaseItem) => void
    buttonLabel?: string
}

export function IngredientPicker({
    querySeed,
    onPick,
    buttonLabel = 'Voir les produits',
}: Props) {
    const [open, setOpen] = useState(false)
    const [q, setQ] = useState(querySeed || '')
    const [items, setItems] = useState<IngredientBaseItem[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // quand tu ouvres, initialise la recherche avec le nom actuel
    useEffect(() => {
        if (open) setQ(querySeed || '')
    }, [open, querySeed])

    const effectiveQ = useMemo(() => (q || '').trim(), [q])

    async function fetchSuggestions() {
        setError(null)
        setLoading(true)
        try {
            const baseUrl = process.env.NEXT_PUBLIC_BACKEND_URL
            if (!baseUrl) throw new Error('NEXT_PUBLIC_BACKEND_URL manquant')

            const { data } = await supabase.auth.getSession()
            const token = data.session?.access_token
            //if (!token) throw new Error('Pas de session (token manquant). Reconnecte-toi.')

            const url = `${baseUrl}/ingredients-base/suggest?q=${encodeURIComponent(effectiveQ)}`
            const res = await fetch(url, {
                headers: { Authorization: `Bearer ${token}` },
            })

            if (res.status === 401 ) {
                throw new Error('Pas de session (token manquant). Reconnecte-toi')
            }    

            const json = await res.json()
            console.log('[FRONT ingredients sample]', json?.ingredients?.[0])
            if (!res.ok) throw new Error(json?.error || `Erreur API suggest (${res.status})`)

            setItems(json.items || [])
          } catch (e: any) {
            setError(e?.message || 'Erreur')
            setItems([])
          } finally {
            setLoading(false)
          }
        }

        useEffect(() => {
            if (!open) return
            if (!effectiveQ) {
                setItems([])
                return
            }
            // petit debounce simple
            const t = setTimeout(fetchSuggestions, 250)
            return () => clearTimeout(t)
            // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, effectiveQ])

const miniBtnStyle: React.CSSProperties = {
    padding: '6px 10px',
    borderRadius: 10,
    fontSize: 11,
    lineHeight: 1.1,
    whiteSpace: 'nowrap',
}

if (!open) {
    return (
        <div style={{ display: 'flex', justifyContent: 'flex-end'}}>
            <button
                type="button"
                className="app-btn-secondary"
                onClick={() => setOpen(true)}
                style={{ 
                    padding: '6px 10px', 
                    borderRadius: 10,
                    fontSize: 11,
                    lineHeight: '12px',
                    whiteSpace: 'nowrap', 
                }}
            >
                {buttonLabel}
            </button>
             </div>
    )
}

return (
    <div style={{ marginTop: 6 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Rechercher (ex: beurre)"
                style={{
                    background: 'white',
                    border: '1px solid var(--border)',
                    borderRadius: 12,
                    padding: 10,
                    width: 260,
                }}
            />
            <button
                type="button"
                className="app-btn-secondary"
                onClick={() => setOpen(false)}
                style={miniBtnStyle}
            >
                Fermer
            </button>
        </div>

        {loading && (
            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
                Chargement…
            </div>
        )}
        {error && (
            <div style={{ fontSize: 12, color: 'crimson', marginTop: 6 }}>
                {error}</div>
        )}

        {!loading && !error && items.length > 0 && (
            <div
                style={{
                    marginTop: 8,
                    border: '1px solid rgba(0,0,0,0.08)',
                    borderRadius: 12,
                    overflow: 'hidden',
                    background: 'white',
                    maxWidth: 520,
                }}
            >
                {items.slice(0, 12).map((it) => (
                    <button
                        key={it.id}
                        type="button"
                        onClick={() => {
                            onPick(it)
                            setOpen(false)
                        }}
                        style={{
                            display: 'block',
                            width: '100%',
                            textAlign: 'left',
                            padding: '10px 12px',
                            border: 'none',
                            background: 'transparent',
                            cursor: 'pointer',
                        }}
                    >
                        <div style={{ fontWeight: 600 }}>{it.nom}</div>
                        <div style={{ fontSize: 12, opacity: 0.7 }}>
                            {it.prix_d_achat != null ? `${it.prix_d_achat} €` : '—'}
                        </div>
                    </button>
                ))}
            </div>
        )}

        {!loading && !error && effectiveQ && items.length === 0 && (
            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
                Aucun résultat
            </div>
        )}
        </div>
    )
}