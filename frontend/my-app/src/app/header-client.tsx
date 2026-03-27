// frontend/my-app/src/app/header-client.tsx/
//logo mysia, les boutons: mes recettes, import ocr, nouvelle recette
// le bouton se connecter, ascenseur categorie à gauche
'use client'

import Image from 'next/image'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from 'src/lib/api'
import { createClient } from '@supabase/supabase-js'
import { FolderOpen, Camera, Plus } from 'lucide-react'

// --- Lecture des variables d'environnement (côté client) ---
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

type Category = {
 id: string
 name: string
 parentId: string | null
}

export default function HeaderClient() {
 const pathname = usePathname()
 const router = useRouter()
 const search = useSearchParams()

 const isNewRecipe = pathname?.startsWith('/recipes/new')
 const isRecipesPage = pathname?.startsWith('/recipes')
 const [isLoggedIn, setIsLoggedIn] = useState(false)
 

 // Drawer states
 const [drawerOpen, setDrawerOpen] = useState(false)
 const [panel, setPanel] = useState<'menu' | 'add'>('menu')

 // Add form states
 const [cats, setCats] = useState<Category[]>([])
 const [addMode, setAddMode] = useState<'category' | 'subcategory'>('category')
 const [newName, setNewName] = useState('')
 const [parentForSub, setParentForSub] = useState<string>('')

 async function refreshCats() {
  try {
    const json = await apiFetch<{ ok?: boolean; categories?: any[] }>('/recipe-categories', {
      method: 'GET',
    })

    const raw = Array.isArray((json as any)?.categories) ? (json as any).categories : []

    const flat: Category[] = raw.flatMap((parent: any) => {
      const parentCat: Category = {
        id: String(parent.id),
        name: String(parent.name),
        parentId: null,
      }

      const children: Category[] = Array.isArray(parent.children)
      ? parent.children.map((child: any) => ({
          id: String(child.id),
          name: String(child.name),
          parentId: String(parent.id),
        }))
        : []

        return [parentCat, ...children]
    })

    setCats(flat)
  } catch (e) {
    console.error('refreshCats error', e)
    setCats([])
  }
  }
 useEffect(() => {
 const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

 let unsub: { subscription?: { unsubscribe: () => void } } | null = null

 async function syncSession() {
   try {
     const {
       data: { session },
     } = await supabase.auth.getSession()

     setIsLoggedIn(Boolean(session))
   } catch {
     setIsLoggedIn(false)
   }
 }

 syncSession()

 const { data } = supabase.auth.onAuthStateChange((_event, session) => {
   setIsLoggedIn(Boolean(session))
 })

 unsub = data

 return () => {
   unsub?.subscription?.unsubscribe()
 }
}, [])

  useEffect(() => {
    if (!isLoggedIn) return
    refreshCats()
  }, [isLoggedIn])

 const parents = useMemo(() => cats.filter((c) => !c.parentId), [cats])
 const childrenByParent = useMemo(() => {
   const m: Record<string, Category[]> = {}
   for (const c of cats) {
     if (!c.parentId) continue
     if (!m[c.parentId]) m[c.parentId] = []
     m[c.parentId].push(c)
   }
   return m
 }, [cats])

 const [openParentId, setOpenParentId] = useState<string | null>(null)

 function goRecipesAll() {
   setDrawerOpen(false)
   router.push('/recipes')
 }

 function goRecipesCategory(categoryId: string) {
   setDrawerOpen(false)
   router.push(`/recipes?cat=${encodeURIComponent(categoryId)}`)
 }

 function handleRecipesClick() {
  if (!isRecipesPage) {
    router.push('/recipes?menu=1')
    return
  }

  setPanel('menu')
  setDrawerOpen(true)
 }

 // ✅ Amélioration: ne pas pousser ?sub tant que le backend ne gère pas /recipes?sub=
 function goRecipesSubCategory(subCategoryId: string) {
   // TODO: quand prêt côté backend -> router.push(`/recipes?sub=${encodeURIComponent(subCategoryId)}`)
   setDrawerOpen(false)
   router.push(`/recipes?cat=${encodeURIComponent(subCategoryId)}`)
 }

 function startAdd() {
   setPanel('add')
   setAddMode('category')
   setNewName('')
   setParentForSub(parents[0]?.id || '')
 }

 async function submitAdd() {
 const name = newName.trim()
 if (!name) return

 try {
   const body =
     addMode === 'category'
       ? { name, parentId: null }
       : { name, parentId: parentForSub || null }

   await apiFetch('/recipe-categories', {
     method: 'POST',
     body: JSON.stringify(body),
   })

   setNewName('')
   setPanel('menu')
   await refreshCats()
 } catch (e: any) {
   console.error('submitAdd error', e)
 }
}

 function deleteCat(id: string) {
   setCats((p) => p.filter((c) => c.id !== id && c.parentId !== id))
   if (openParentId === id) setOpenParentId(null)
 }

 function deleteSub(id: string) {
   setCats((p) => p.filter((c) => c.id !== id))
 }

 // ✅ Amélioration UX: si on change de page, on ferme le drawer
 useEffect(() => {
   setDrawerOpen(false)
   setPanel('menu')
   // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, search?.toString()])

  useEffect(() => {
    if (pathname?.startsWith('/recipes') && search?.get('menu') === '1') {
      setPanel('menu')
      setDrawerOpen(true)
    }
  }, [pathname, search])

 return (
   <>
     <header className={`app-card app-header ${isNewRecipe ? 'app-header--compact' : ''}`}>
       <nav className="app-header-nav"> 
         <a href="/" className="app-brand-logo">
           <Image src="/logo-mysia.PNG" alt="MySia" width={160} height={100} priority 
           style={{
            height: "auto", 
            width: "auto", 
            }}/>
           {/*<span>
             MySia<span className="app-brand-suffix">-app</span>
           </span>*/}
         </a>

         {!isNewRecipe && (
 <div className="app-nav-actions app-nav-actions--signed">
   {isLoggedIn ? (
     <>
       <button
          type="button"
          className="header-nav-pill header-nav-pill--recipes"
          onClick={handleRecipesClick}
        >
          <span className="header-nav-pill__icon"><FolderOpen size={20} /></span>
          <span>Mes recettes</span>
        </button>

       <a className="header-nav-pill header-nav-pill--ocr" href="/import/ocr">
         <span className="header-nav-pill__icon"><Camera size={20} /></span>
         <span>Import OCR</span>
       </a>

       <a className="header-nav-pill header-nav-pill--new" href="/recipes/new">
          <span className="header-nav-pill__icon"><Plus size={20} /></span>
          <span>Nouvelle recette</span>
       </a>
     </>
   ) : (
     <>
        <a className="landing-header-link" href="/premium">
          Tarifs
        </a>

        <button
          type="button"
          className="app-btn landing-header-login"
          onClick={() => router.push('/login')}
        >
          Connexion
        </button>
      </>
   )}
 </div>
)}
       </nav>
     </header>

     {drawerOpen && (
       <div
         role="dialog"
         aria-modal="true"
         onClick={() => setDrawerOpen(false)}
         style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000 }}
        >
         <div
           onClick={(e) => e.stopPropagation()}
           style={{
             position: 'absolute',
             top: 0,
             left: 0,
             height: '100%',
             width: 'min(380px, 92vw)',
             background: 'white',
             borderRight: '1px solid var(--border)',
             padding: 16,
             display: 'grid',
             gridTemplateRows: 'auto minmax(0, 1fr) auto',
             gap: 12,
           }}
           >
           <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
             <div style={{ fontWeight: 900, color: 'var(--primary)' }}>
               {panel === 'menu' ? 'Mes recettes' : 'Ajouter'}
             </div>
             <button type="button" className="app-btn app-btn-utility" onClick={() => setDrawerOpen(false)}>
               ✕
             </button>
           </div>

           {panel === 'menu' ? (
             <div style={{ overflowY: 'auto', overflowX: 'hidden', paddingRight: 6, minHeight: 0 }}>
               <button
                 type="button"
                 className="app-btn app-btn-secondary app-btn-utility"
                 style={{ width: '100%', justifyContent: 'flex-start' }}
                 onClick={goRecipesAll}
            >
                 Toutes mes recettes
               </button>

               <div style={{ height: 12 }} />

               <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                 <div style={{ fontWeight: 800, color: 'rgba(43,43,43,0.85)' }}>Catégories</div>
                 <button type="button" className="app-btn app-btn-primary" onClick={startAdd}>
                   + Ajouter
                 </button>
               </div>

               <div style={{ height: 10 }} />

               {parents.length === 0 ? (
                 <div className="app-card p-4" style={{ boxShadow: 'none', background: 'rgba(255,255,255,0.7)' }}>
                   <div style={{ fontWeight: 800, marginBottom: 6 }}>Aucune catégorie</div>
                   <div className="app-muted" style={{ fontSize: 13 }}>
                     Clique sur “Ajouter” pour créer ta première catégorie.
                   </div>
                 </div>
               ) : (
                 <div style={{ display: 'grid', gap: 10 }}>
                   {parents.map((p) => {
                     const subs = childrenByParent[p.id] || []
                     const isOpen = openParentId === p.id

                     return (
                       <div key={p.id} className="app-card p-3" style={{ boxShadow: 'none' }}>
                         <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                           <button
                             type="button"
                             className="app-btn app-btn-utility"
                             style={{ flex: 1, justifyContent: 'flex-start' }}
                             onClick={() => setOpenParentId(isOpen ? null : p.id)}
                        >
                             {p.name}
                           </button>

                           <button
                             type="button"
                             className="app-btn app-btn-secondary app-btn-utility"
                             onClick={() => goRecipesCategory(p.id)}
                             title="Voir les recettes de cette catégorie"
                        >
                             Voir
                           </button>

                           <button
                             type="button"
                             className="app-btn app-btn-utility"
                             onClick={() => deleteCat(p.id)}
                             title="Supprimer la catégorie"
                        >
                             🗑️
                           </button>
                         </div>

                         {isOpen && (
                           <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                             {subs.length > 0 ? (
                               subs.map((s) => (
                                 <div
                                   key={s.id}
                                   style={{
                                     display: 'flex',
                                     alignItems: 'center',
                                     justifyContent: 'space-between',
                                     gap: 10,
                                     paddingLeft: 8,
                                   }}
                                   >
                                   <button
                                     type="button"
                                     className="app-btn app-btn-utility"
                                     style={{ flex: 1, justifyContent: 'flex-start' }}
                                     onClick={() => goRecipesSubCategory(s.id)}
                                   >
                                     ↳ {s.name}
                                   </button>
                                   <button
                                     type="button"
                                     className="app-btn app-btn-utility"
                                     onClick={() => deleteSub(s.id)}
                                     title="Supprimer la sous-catégorie"
                                   >
                                     🗑️
                                   </button>
                                 </div>
                               ))
                             ) : (
                               <div className="app-muted" style={{ fontSize: 13, paddingLeft: 8 }}>
                                 Aucune sous-catégorie.
                               </div>
                             )}
                           </div>
                         )}
                       </div>
                     )
                   })}
                 </div>
               )}
             </div>
           ) : (
             <div style={{ overflowY: 'auto', overflowX: 'hidden', paddingRight: 6, minHeight: 0 }}>
               <div className="app-card p-4" style={{ boxShadow: 'none' }}>
                 <div style={{ fontWeight: 900, marginBottom: 10, color: 'var(--primary)' }}>Ajouter</div>

                 <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                   <button
                     type="button"
                     className={`app-btn app-btn-active ${addMode === 'category' ? 'app-btn-primary' : ''}`}
                     onClick={() => setAddMode('category')}
                    >
                     Catégorie
                   </button>
                   <button
                     type="button"
                     className={`app-btn app-btn-active ${addMode === 'subcategory' ? 'app-btn-primary' : ''}`}
                     onClick={() => setAddMode('subcategory')}
                     disabled={parents.length === 0}
                     title={parents.length === 0 ? 'Crée d’abord une catégorie' : undefined}
                    >
                     Sous-catégorie
                   </button>
                 </div>

                 {addMode === 'subcategory' && (
                   <label style={{ display: 'grid', gap: 6, marginBottom: 10, fontSize: 13, fontWeight: 800 }}>
                     Catégorie parente
                     <select
                       value={parentForSub}
                       onChange={(e) => setParentForSub(e.target.value)}
                       style={{ borderRadius: 12, padding: 10, border: '1px solid var(--border)' }}
                        >
                       {parents.map((p) => (
                         <option key={p.id} value={p.id}>
                           {p.name}
                         </option>
                       ))}
                     </select>
                   </label>
                 )}

                 <label style={{ display: 'grid', gap: 6, marginBottom: 10, fontSize: 13, fontWeight: 800 }}>
                   Nom
                   <input
                     value={newName}
                     onChange={(e) => setNewName(e.target.value)}
                     placeholder={addMode === 'category' ? 'Ex: Batch cooking' : 'Ex: Soupes'}
                     style={{ borderRadius: 12, padding: 10, border: '1px solid var(--border)' }}
                   />
                 </label>

                 <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                   <button type="button" className="app-btn app-btn-secondary" onClick={() => setPanel('menu')}>
                     Retour
                   </button>
                   <button type="button" className="app-btn app-btn-primary" onClick={submitAdd}>
                     Ajouter
                   </button>
                 </div>
               </div>
             </div>
           )}
           <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
             <div className="app-muted" style={{ fontSize: 12 }}>
               Filtrage via URL: ?cat=
             </div>
             <button
               type="button"
               className="app-btn app-btn-utility"
               onClick={() => {
                 setPanel('menu')
                 setDrawerOpen(false)
               }}
               >
               Fermer
             </button>
           </div>
         </div>
       </div>
     )}
   </>
 )
}