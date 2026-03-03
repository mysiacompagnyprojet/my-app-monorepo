// frontend/my-app/src/app/header-client.tsx
'use client'

import Image from 'next/image'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'

type Category = {
 id: string
 name: string
 parentId: string | null
}

const LS_KEY = 'mysia_recipe_categories_v1'

function uid() {
 return Math.random().toString(16).slice(2) + '-' + Date.now().toString(16)
}

function loadCats(): Category[] {
 try {
   const raw = localStorage.getItem(LS_KEY)
   if (!raw) return []
   const v = JSON.parse(raw)
   return Array.isArray(v) ? v : []
 } catch {
   return []
 }
}

function saveCats(list: Category[]) {
 try {
   localStorage.setItem(LS_KEY, JSON.stringify(list))
 } catch {}
}

export default function HeaderClient() {
 const pathname = usePathname()
 const router = useRouter()
 const search = useSearchParams()

 const isNewRecipe = pathname?.startsWith('/recipes/new')

 // Drawer states
 const [drawerOpen, setDrawerOpen] = useState(false)
 const [panel, setPanel] = useState<'menu' | 'add'>('menu')

 // Add form states
 const [cats, setCats] = useState<Category[]>([])
 const [addMode, setAddMode] = useState<'category' | 'subcategory'>('category')
 const [newName, setNewName] = useState('')
 const [parentForSub, setParentForSub] = useState<string>('')

 useEffect(() => {
   setCats(loadCats())
 }, [])

 useEffect(() => {
   saveCats(cats)
 }, [cats])

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

 // ✅ Amélioration: ne pas pousser ?sub tant que le backend ne gère pas /recipes?sub=
 function goRecipesSubCategory(_subCategoryId: string) {
   // TODO: quand prêt côté backend -> router.push(`/recipes?sub=${encodeURIComponent(subCategoryId)}`)
   setDrawerOpen(false)
   router.push('/recipes')
 }

 function startAdd() {
   setPanel('add')
   setAddMode('category')
   setNewName('')
   setParentForSub(parents[0]?.id || '')
 }

 function submitAdd() {
   const name = newName.trim()
   if (!name) return

   if (addMode === 'category') {
     const next: Category = { id: uid(), name, parentId: null }
     setCats((p) => [...p, next])
     setNewName('')
     setPanel('menu')
     return
   }

   if (!parentForSub) return
   const next: Category = { id: uid(), name, parentId: parentForSub }
   setCats((p) => [...p, next])
   setNewName('')
   setPanel('menu')
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

 return (
   <>
     <header className={`app-card app-container app-header ${isNewRecipe ? 'app-header--compact' : ''}`}>
       <nav className="flex items-center gap-3" style={{ width: '100%', justifyContent: 'space-between' }}>
         <a href="/" className="app-brand flex items-center gap-2">
           <Image src="/brand/logo.png" alt="MySia logo" width={56} height={56} priority />
           <span>
             MySia<span className="app-brand-suffix">.app</span>
           </span>
         </a>

         {!isNewRecipe && (
           <div className="flex items-center gap-3">
             <button
               type="button"
               className="app-btn app-btn-utility"
               onClick={() => {
                 setPanel('menu')
                 setDrawerOpen(true)
               }}
               >
               📜 Mes recettes
             </button>

             <a href="/import/ocr">📷 Import OCR</a>
             <a href="/recipes/new">➕ Nouvelle recette</a>
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
             gridTemplateRows: 'auto 1fr auto',
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
             <div style={{ overflow: 'auto', paddingRight: 6 }}>
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
             <div style={{ overflow: 'auto', paddingRight: 6 }}>
               <div className="app-card p-4" style={{ boxShadow: 'none' }}>
                 <div style={{ fontWeight: 900, marginBottom: 10, color: 'var(--primary)' }}>Ajouter</div>

                 <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                   <button
                     type="button"
                     className={`app-btn app-btn-utility ${addMode === 'category' ? 'app-btn-primary' : ''}`}
                     onClick={() => setAddMode('category')}
                    >
                     Catégorie
                   </button>
                   <button
                     type="button"
                     className={`app-btn app-btn-utility ${addMode === 'subcategory' ? 'app-btn-primary' : ''}`}
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

               <div className="app-muted" style={{ fontSize: 12, marginTop: 10 }}>
                 (Temporaire) Les catégories sont stockées en localStorage. On branchera Supabase/Prisma après.
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