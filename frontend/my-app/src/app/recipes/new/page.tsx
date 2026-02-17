// frontend/my-app/src/app/recipes/new/page.tsx
'use client'

import type React from 'react'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { apiFetch } from 'src/lib/api'
import type { OcrDraft, IngredientLine } from 'src/types/recipe'
import { IngredientPicker } from '@/components/IngredientPicker'
import Cropper from 'react-easy-crop'

type Line = IngredientLine & {
 unitPriceBuy?: number | null

 // ✅ prix "produit" (courses)
 buyPriceEur?: number | null
 buyLabel?: string | null
 buyRefQty?: number | null
 buyRefUnit?: string | null
 buyRecalced?: boolean

 // ✅ lien éventuel vers une base ingrédient (IngredientPicker)
 ingredientBaseId?: string | null

 note?: string
 quantityRaw?: string
 id?: any
 priceMatched?: boolean
 price?: { eurPer: number; perUnit: string } | null
 costEur?: number | null
}

type Draft = {
 title?: string
 servings?: number
 imageUrl?: string | null
 notes?: string | null
 steps?: string[]
 ingredients?: Array<Line | { raw: string } | string>
 trash?: string[]
 totalCostEur?: number
}

type EnrichIngredientOut = {
 name: string
 quantity: number
 unit: string
 costEur?: number
 costRecipe?: number
 unitPriceBuy?: number | null
 airtableId?: string | null
 priceMatched?: boolean
 note?: string
 price?: { eurPer: number; perUnit: string } | null

 buyPriceEur?: number | null
 buyLabel?: string | null
 buyRefQty?: number | null
 buyRefUnit?: string | null
}

type EnrichResponse =
 | { ok: true; ingredients: EnrichIngredientOut[] }
 | { ok: false; error: string; message?: string }

/* ──────────────────────────────────────────────────────────────
Helpers quantité : accepte 1/4, 1 1/2, 1,2
────────────────────────────────────────────────────────────── */

function canonUnitFront(uRaw: string): 'g' | 'ml' | 'piece' | null {
 const u = String(uRaw || '').trim().toLowerCase()
 if (!u) return null
 if (u === 'g' || u === 'gr' || u === 'gramme' || u === 'grammes') return 'g'
 if (u === 'kg' || u === 'kilo' || u === 'kilos') return 'g'
 if (u === 'ml') return 'ml'
 if (u === 'l' || u === 'litre' || u === 'litres') return 'ml'
 if (u === 'cl') return 'ml'
 if (u === 'dl') return 'ml'
 if (u === 'piece' || u === 'pièce' || u === 'pièces' || u === 'pcs') return 'piece'
 return null
}

function toBaseQtyFront(qty: number, unitRaw: string): { qty: number; unit: 'g' | 'ml' | 'piece' } | null {
 const u = String(unitRaw || '').trim().toLowerCase()
 const q = Number(qty || 0)
 if (!Number.isFinite(q)) return null

 const canon = canonUnitFront(u)
 if (!canon) return null

 // g
 if (u === 'kg' || u === 'kilo' || u === 'kilos') return { qty: q * 1000, unit: 'g' }
 if (canon === 'g') return { qty: q, unit: 'g' }

 // ml
 if (u === 'l' || u === 'litre' || u === 'litres') return { qty: q * 1000, unit: 'ml' }
 if (u === 'cl') return { qty: q * 10, unit: 'ml' }
 if (u === 'dl') return { qty: q * 100, unit: 'ml' }
 if (canon === 'ml') return { qty: q, unit: 'ml' }

 // piece
 return { qty: q, unit: 'piece' }
}

function computeCostCourses(ing: Line): number | null {
 const buyPrice = typeof ing.buyPriceEur === 'number' ? ing.buyPriceEur : null
 const refQty = typeof ing.buyRefQty === 'number' ? ing.buyRefQty : null
 const refUnit = typeof ing.buyRefUnit === 'string' ? ing.buyRefUnit : null
 if (!buyPrice || !refQty || !refUnit) return null

 const qBase = toBaseQtyFront(Number(ing.quantity || 0), String(ing.unit || ''))
 const packBase = toBaseQtyFront(refQty, refUnit)
 if (!qBase || !packBase) return null
 if (qBase.unit !== packBase.unit) return null

 const packs = Math.max(1, Math.ceil(qBase.qty / packBase.qty))
 return packs * buyPrice
}

function parseQtyInput(raw: string): number {
 const s = String(raw || '').trim()
 if (!s) return 0

 const mix = s.match(/^\s*(\d+)\s+(\d+)\s*\/\s*(\d+)\s*$/)
 if (mix) {
   const a = Number(mix[1])
   const b = Number(mix[2])
   const c = Number(mix[3])
   if (Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && c !== 0) return a + b / c
 }

 const frac = s.match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/)
 if (frac) {
   const a = Number(frac[1])
   const b = Number(frac[2])
   if (Number.isFinite(a) && Number.isFinite(b) && b !== 0) return a / b
 }

 const n = Number(s.replace(',', '.'))
 return Number.isFinite(n) ? n : 0
}

function formatQtyForInput(n: number, quantityRaw?: string): string {
 if (typeof quantityRaw === 'string' && quantityRaw.trim()) return quantityRaw.trim()
 if (!Number.isFinite(n)) return ''
 if (n === 0) return ''
 return String(n)
}

function fmtEur(v: any): string {
 const n = typeof v === 'string' ? Number(String(v).replace(',', '.')) : Number(v)
 if (!Number.isFinite(n)) return '—'
 return `${n.toFixed(2)} €`
}

// Nettoyage nom ingrédient pour lookup (muscade râpée (selon...) => muscade)
function normalizeIngredientForLookup(raw: string): string {
 let s = String(raw || '').trim()
 if (!s) return ''

 s = s.replace(/\([^)]*\)/g, ' ') // retire (...) partout
 s = s.replace(/\bselon\b.*$/gi, ' ') // retire "selon ..."
 s = s.replace(/[,;:].*$/g, ' ') // retire après virgule/;/: (souvent commentaires)
 s = s.replace(
   /\b(râpée?|haché(e)?|émincé(e)?|moulu(e)?|en\s+poudre|frais|ciselé(e)?|décortiqué(e)?)\b/gi, //enlever car ça bloqué crème frîche dans les ingrédient |fraîche
   ' '
 )

 s = s.replace(/\s+/g, ' ').trim()
 return s
}

function isNotFoundLine(ing: Line): boolean {
 const nameOk = String(ing?.name || '').trim().length > 0
 if (!nameOk) return false

 if (ing.ingredientBaseId) return false

 if (ing.priceMatched === false) return true
 //if (!(ing as any).id) return true

 const note = String(ing.note || '').toLowerCase()
 if (note.includes('non trouvé') || note.includes('introuvable')) return true

 return false
}

/* ──────────────────────────────────────────────────────────────
Crop helpers (évite les problèmes CORS en passant par fetch -> blob)
────────────────────────────────────────────────────────────── */

async function createImageFromUrl(url: string): Promise<HTMLImageElement> {
 const r = await fetch(url, { cache: 'no-store' })
 if (!r.ok) throw new Error(`Image download failed (${r.status})`)

 const blob = await r.blob()
 const objectUrl = URL.createObjectURL(blob)

 return new Promise<HTMLImageElement>((resolve, reject) => {
   const img = new Image()
   img.onload = () => {
     URL.revokeObjectURL(objectUrl)
     resolve(img)
   }
   img.onerror = () => {
     URL.revokeObjectURL(objectUrl)
     reject(new Error('Image load failed'))
   }
   img.src = objectUrl
 })
}

async function getCroppedBlob(
 imageSrc: string,
 cropPixels: { x: number; y: number; width: number; height: number }
): Promise<Blob> {
 const image = await createImageFromUrl(imageSrc)

 const canvas = document.createElement('canvas')
 const ctx = canvas.getContext('2d')
 if (!ctx) throw new Error('Canvas non supporté')

 canvas.width = Math.max(1, Math.round(cropPixels.width))
 canvas.height = Math.max(1, Math.round(cropPixels.height))

 ctx.drawImage(
   image,
   cropPixels.x,
   cropPixels.y,
   cropPixels.width,
   cropPixels.height,
   0,
   0,
   cropPixels.width,
   cropPixels.height
 )

 return new Promise<Blob>((resolve, reject) => {
   canvas.toBlob(
     (blob) => {
       if (!blob) return reject(new Error('Impossible de générer le blob'))
       resolve(blob)
     },
     'image/jpeg',
     0.92
   )
 })
}

function NewRecipeInner() {
 const router = useRouter()
 const search = useSearchParams()

 //const [draft, setDraft] = useState<OcrDraft | null>(null)

 const [title, setTitle] = useState('')
 const [servings, setServings] = useState(1)
 const [imageUrl, setImageUrl] = useState('')
 const [notes, setNotes] = useState('')
 const [steps, setSteps] = useState<string[]>([''])
 const [ingredients, setIngredients] = useState<Line[]>([{ name: '', quantity: 0, unit: '', buyRecalced: false }])
 const [qtyInputs, setQtyInputs] = useState<string[]>([''])
 const [trash, setTrash] = useState<string>('')
 const [status, setStatus] = useState<string>('')

 const [isRepricing, setIsRepricing] = useState(false)

 // Crop UI
 const [isCropping, setIsCropping] = useState(false)
 const [crop, setCrop] = useState({ x: 0, y: 0 })
 const [zoom, setZoom] = useState(1)
 const [croppedAreaPixels, setCroppedAreaPixels] = useState<{
   x: number
   y: number
   width: number
   height: number
 } | null>(null)
 const [isUploadingCrop, setIsUploadingCrop] = useState(false)

 const onCropComplete = (_: any, croppedPixels: any) => {
   setCroppedAreaPixels(croppedPixels)
 }

 const prefill = useMemo(() => search.get('prefill') === '1', [search])
 const fromOcr = useMemo(() => search.get('from') === 'ocr', [search])

 const totalCost = useMemo(() => {
   return ingredients.reduce(
     (acc, i) => acc + (typeof (i as any).costEur === 'number' ? ((i as any).costEur as number) : 0),
     0
   )
 }, [ingredients])

 const totalProducts = useMemo(() => {
   return ingredients.reduce((acc, ing) => {
    const v = computeCostCourses(ing)
    return acc + (typeof v === 'number' ? v : 0)
   }, 0)
  }, [ingredients])

 // 1) Pré-remplissage depuis OCR
 useEffect(() => {
   if (!fromOcr) return

   const raw = sessionStorage.getItem('recipeDraft')
   if (!raw || raw === 'null' || raw === 'undefined') return

   try {
     const d = JSON.parse(raw) as OcrDraft
     //setDraft(d)

     setTitle(String((d as any).title || ''))
     setServings(Number((d as any).servings || 1) || 1)
     setImageUrl(String((d as any).imageUrl || ''))
     setNotes(String((d as any).notes || ''))

     const s = Array.isArray((d as any).steps)
       ? (d as any).steps.map((x: any) => String(x || '').trim()).filter(Boolean)
       : []
     setSteps(s.length ? s : [''])

     const ing = Array.isArray((d as any).ingredients) ? (d as any).ingredients : []
     const normalized = ing
       .map((row: any): Line | null => {
         if (!row) return null
         if (typeof row === 'string') return { name: row, quantity: 0, unit: '', buyRecalced: false }
         if (row.raw) return { name: String(row.raw), quantity: 0, unit: '', buyRecalced: false }

         const buyPriceEur = typeof row.buyPriceEur === 'number' ? row.buyPriceEur : row.buyPriceEur ?? null

         return {
           name: String(row.name || '').trim(),
           quantity: Number(row.quantity || 0) || 0,
           unit: String(row.unit || ''),
           quantityRaw: typeof row.quantityRaw === 'string' ? String(row.quantityRaw).trim() : undefined,

           price: row.price ?? null,
           costEur: typeof row.costEur === 'number' ? row.costEur : row.costEur ?? null,
           unitPriceBuy: typeof row.unitPriceBuy === 'number' ? row.unitPriceBuy : row.unitPriceBuy ?? null,
           priceMatched: typeof row.priceMatched === 'boolean' ? row.priceMatched : undefined,
           id: row.id ?? null,

           buyPriceEur,
           buyLabel: typeof row.buyLabel === 'string' ? row.buyLabel : row.buyLabel ?? null,
           buyRefQty: typeof row.buyRefQty === 'number' ? row.buyRefQty : row.buyRefQty ?? null,
           buyRefUnit: typeof row.buyRefUnit === 'string' ? row.buyRefUnit : row.buyRefUnit ?? null,

           buyRecalced: typeof buyPriceEur === 'number',
           note: typeof row.note === 'string' ? row.note : row.note ?? undefined,
         } as any
       })
       .filter((x: any): x is Line => x !== null)

     const finalIngredients = normalized.length ? normalized : [{ name: '', quantity: 0, unit: '', buyRecalced: false }]

     setIngredients(finalIngredients)
     setQtyInputs(finalIngredients.map((r: any) => formatQtyForInput(r.quantity, r.quantityRaw)))

     const tr = Array.isArray((d as any).trash) ? (d as any).trash.map((x: any) => String(x || '').trim()).filter(Boolean) : []
     setTrash(tr.join('\n'))
   } catch (e) {
     console.error('ocrDraft parse error', e)
   }

   try {
     sessionStorage.removeItem('recipeDraft')
   } catch {}
 }, [fromOcr])

 // 2) Pré-remplissage générique (prefill=1)
 useEffect(() => {
   if (!prefill) return

   try {
     const raw = sessionStorage.getItem('recipeDraft')
     if (!raw || raw === 'null' || raw === 'undefined') return

     const d: Draft = JSON.parse(raw)

     setTitle(String(d.title || ''))
     setServings(Number(d.servings || 1) || 1)
     setImageUrl(String(d.imageUrl || ''))
     setNotes(String(d.notes || ''))

     const s = Array.isArray(d.steps) ? d.steps.map((x) => String(x || '').trim()).filter(Boolean) : []
     setSteps(s.length ? s : [''])

     const ing = Array.isArray(d.ingredients) ? d.ingredients : []
     const normalized = ing
       .map((row: any): Line | null => {
         if (!row) return null
         if (typeof row === 'string') return { name: row, quantity: 0, unit: '', buyRecalced: false }
         if (row.raw) return { name: String(row.raw), quantity: 0, unit: '', buyRecalced: false }

         const buyPriceEur = typeof row.buyPriceEur === 'number' ? row.buyPriceEur : row.buyPriceEur ?? null

         return {
           name: String(row.name || '').trim(),
           quantity: Number(row.quantity || 0) || 0,
           unit: String(row.unit || ''),
           quantityRaw: typeof row.quantityRaw === 'string' ? String(row.quantityRaw).trim() : undefined,

           price: row.price ?? null,
           costEur: typeof row.costEur === 'number' ? row.costEur : null,
           unitPriceBuy: typeof row.unitPriceBuy === 'number' ? row.unitPriceBuy : row.unitPriceBuy ?? null,
           priceMatched: row.priceMatched ?? false,
           id: row.id ?? null,

           buyPriceEur,
           buyLabel: typeof row.buyLabel === 'string' ? row.buyLabel : row.buyLabel ?? null,
           buyRefQty: typeof row.buyRefQty === 'number' ? row.buyRefQty : row.buyRefQty ?? null,
           buyRefUnit: typeof row.buyRefUnit === 'string' ? row.buyRefUnit : row.buyRefUnit ?? null,

           buyRecalced: typeof buyPriceEur === 'number',
           note: typeof row.note === 'string' ? row.note : row.note ?? undefined,
         } as any
       })
       .filter((x: any): x is Line => x !== null)

     const finalIngredients = normalized.length ? normalized : [{ name: '', quantity: 0, unit: '', buyRecalced: false }]

     setIngredients(finalIngredients)
     setQtyInputs(finalIngredients.map((r: any) => formatQtyForInput(r.quantity, r.quantityRaw)))

     const tr = Array.isArray(d.trash) ? d.trash.map((x) => String(x || '').trim()).filter(Boolean) : []
     setTrash(tr.join('\n'))
   } catch (e) {
     console.error('prefill parse error', e)
   }
 }, [prefill])

 function setIngredient(idx: number, patch: Partial<Line>) {
   setIngredients((prev) => {
     const copy = [...prev]
     copy[idx] = { ...copy[idx], ...patch, buyRecalced: false }
     return copy
   })
 }

 function setQtyInput(idx: number, raw: string) {
   setQtyInputs((prev) => {
     const copy = [...prev]
     copy[idx] = raw
     return copy
   })

   setIngredient(idx, { quantity: parseQtyInput(raw), quantityRaw: undefined } as any)
 }

 function removeIngredient(idx: number) {
   setIngredients((prev) => {
     const copy = prev.filter((_, i) => i !== idx)
     return copy.length ? copy : [{ name: '', quantity: 0, unit: '', buyRecalced: false }]
   })

   setQtyInputs((prev) => {
     const copy = prev.filter((_, i) => i !== idx)
     return copy.length ? copy : ['']
   })
 }

 function removeStep(idx: number) {
   setSteps((prev) => {
     const copy = prev.filter((_, i) => i !== idx)
     return copy.length ? copy : ['']
   })
 }

 function applyEnriched(enriched: EnrichIngredientOut[], idxs: number[]) {
   setIngredients((prev) => {
     const copy = [...prev]

     for (let k = 0; k < enriched.length; k++) {
       const idx = idxs[k]
       const old = copy[idx]
       const e = enriched[k] as any

       const cost = typeof e.costEur === 'number' ? e.costEur : typeof e.costRecipe === 'number' ? e.costRecipe : null

       copy[idx] = {
         ...old,
         quantityRaw: (old as any)?.quantityRaw,
         costEur: typeof cost === 'number' ? cost : null,
         unitPriceBuy: typeof e.unitPriceBuy === 'number' ? e.unitPriceBuy : null,
         priceMatched: typeof e.priceMatched === 'boolean' ? e.priceMatched : Boolean(e.id),
         id: e.id ?? null,
         price: e.price ?? (old as any)?.price ?? null,

         buyPriceEur: typeof e.buyPriceEur === 'number' ? e.buyPriceEur : null,
         buyLabel: typeof e.buyLabel === 'string' ? e.buyLabel : null,
         buyRefQty: typeof e.buyRefQty === 'number' ? e.buyRefQty : null,
         buyRefUnit: typeof e.buyRefUnit === 'string' ? e.buyRefUnit : null,
         buyRecalced: true,

         note: typeof e.note === 'string' ? e.note : undefined,
       } as any
     }

     return copy
   })
 }

 async function recalcPrices(opts?: { silent?: boolean }) {
   const silent = Boolean(opts?.silent)

   try {
     setIsRepricing(true)
     if (!silent) setStatus('⏳ Recalcul des prix…')

     const idxs: number[] = []
     const list = ingredients
       .map((i, idx) => {
         const name = normalizeIngredientForLookup(i.name)
         if (!name) return null
         idxs.push(idx)
         return {
           name,
           quantity: Number(i.quantity || 0) || 0,
           unit: String(i.unit || '').trim(),
         }
       })
       .filter(Boolean) as Array<{ name: string; quantity: number; unit: string }>

     if (!list.length) {
       if (!silent) setStatus('❌ Ajoute au moins un ingrédient avant de recalculer.')
       return
     }

     const json = await apiFetch<EnrichResponse>('/recipes/enrich-ingredients', {
       method: 'POST',
       body: JSON.stringify({ ingredients: list }),
     })

     if (!json || (json as any).ok !== true) {
       const msg = (json as any)?.message || (json as any)?.error || 'Erreur inconnue'
       if (!silent) setStatus('❌ Recalcul impossible: ' + msg)
       return
     }

     const enriched = Array.isArray((json as any).ingredients) ? (json as any).ingredients : []
     if (!enriched.length) {
       if (!silent) setStatus('❌ Recalcul impossible: réponse vide.')
       return
     }

     applyEnriched(enriched, idxs)
     if (!silent) setStatus('✅ Prix recalculés')
   } catch (e: any) {
     if (!silent) setStatus('❌ ' + (e?.message || 'Erreur'))
   } finally {
     setIsRepricing(false)
   }
 }

 const repricingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
 const lastSigRef = useRef<string>('')

 const ingredientsSig = useMemo(() => {
   return ingredients
     .map((i) => `${String(i.name || '').trim()}|${Number(i.quantity || 0) || 0}|${String(i.unit || '').trim()}`)
     .join('||')
 }, [ingredients])

 useEffect(() => {
   if (!ingredients.length) return
   const hasRealIngredient = ingredients.some((i) => String(i.name || '').trim())
   if (!hasRealIngredient) return

   if (ingredientsSig === lastSigRef.current) return
   lastSigRef.current = ingredientsSig

   if (repricingTimerRef.current) clearTimeout(repricingTimerRef.current)

   repricingTimerRef.current = setTimeout(() => {
     recalcPrices({ silent: true })
   }, 500)

   return () => {
     if (repricingTimerRef.current) clearTimeout(repricingTimerRef.current)
   }
   // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [ingredientsSig])

 async function uploadCroppedImage(croppedBlob: Blob) {
   const form = new FormData()
   form.append('file', croppedBlob, 'recipe.jpg')

   const res = await apiFetch<{ ok: true; imageUrl: string }>('/upload/recipe-image', {
     method: 'POST',
     body: form as any,
   })

   setImageUrl(res.imageUrl)
 }

 async function confirmCrop() {
   if (!imageUrl || !croppedAreaPixels) return
   try {
     setIsUploadingCrop(true)
     setStatus('⏳ Recadrage en cours…')
     const blob = await getCroppedBlob(imageUrl, croppedAreaPixels)
     await uploadCroppedImage(blob)
     setIsCropping(false)
     setStatus('✅ Image recadrée')
   } catch (e: any) {
     console.error(e)
     setStatus('❌ ' + (e?.message || 'Erreur recadrage'))
   } finally {
     setIsUploadingCrop(false)
   }
 }

 async function save() {
   try {
     setStatus('⏳ Enregistrement…')

     const payload = {
       title: title.trim() || 'Recette',
       servings: Number(servings || 1) || 1,
       imageUrl: imageUrl.trim() || null,
       notes: (notes || '').trim(),
       steps: steps.map((s) => String(s || '').trim()).filter(Boolean),
       ingredients: ingredients
         .map((i) => ({
           name: String(i.name || '').trim(),
           quantity: Number(i.quantity || 0) || 0,
           unit: String(i.unit || '').trim(),
         }))
         .filter((i) => i.name),
     }

     await apiFetch('/recipes', {
       method: 'POST',
       body: JSON.stringify(payload),
     })

     setStatus('✅ Recette enregistrée')
     try {
       sessionStorage.removeItem('recipeDraft')
     } catch {}
     router.push('/recipes')
   } catch (e: any) {
     setStatus('❌ ' + (e?.message || 'Erreur'))
   }
 }

 const statusKind =
   status.startsWith('✅') ? 'success' : status.startsWith('❌') ? 'error' : status ? 'info' : null

 const smallXBtnStyle: React.CSSProperties = {
   width: 30,
   height: 30,
   padding: 0,
   display: 'grid',
   placeItems: 'center',
   fontSize: 14,
   lineHeight: '14px',
   borderRadius: 10,
 }

 const sectionTitleStyle: React.CSSProperties = {
   fontSize: '1.13rem',
   fontWeight: 800,
   color: 'var(--primary)',
 }

 const inputStyle: React.CSSProperties = {
   background: 'white',
   border: '1px solid var(--border)',
   borderRadius: 12,
   padding: 14,
 }

 return (
   <main className="app-container" style={{ margin: '40px auto' }}>
     <section style={{ marginBottom: 16 }}>
       <input
         value={title}
         onChange={(e) => setTitle(e.target.value)}
         placeholder="Titre de la recette"
         className="recipe-title editable-title"
         style={{
          background: 'transparent',
          border: 'none',
          outline: 'none',
          width: '100%',
         }}
       />

       <p className="recipe-color-1">Remplis l’essentiel. Tu peux toujours ajuster plus tard.</p>
     </section>

     {trash.trim() && (
       <section className="app-card p-5" style={{ marginTop: 16 }}>
         <details>
           <summary style={{ cursor: 'pointer', fontWeight: 800, color: 'var(--primary)' }}>
             🗑️ Corbeille (texte non-recette détecté)
           </summary>
           <p className="mt-2 text-sm app-muted">Rien n’est envoyé en base ici : c’est juste pour voir ce qui a été filtré.</p>
           <textarea
             value={trash}
             onChange={(e) => setTrash(e.target.value)}
             rows={6}
             className="mt-3 w-full"
             style={{
               background: 'white',
               border: '1px solid var(--border)',
               borderRadius: 12,
               padding: 12,
             }}
           />
         </details>
       </section>
     )}

     <section className="app-card p-6" style={{ marginTop: 16 }}>
       <div
         style={{
           display: 'grid',
           gridTemplateColumns: '1fr 1fr',
           gap: 28,
           marginTop: 2,
           alignItems: 'start',
         }}
         >
         {/* ========================= */}
         {/* COLONNE GAUCHE            */}
         {/* ========================= */}
         <div style={{ display: 'grid', gap: 21 }}>
           {/* Portions */}
           <label className="grid gap-1 text-sm font-semibold recipe-color-2">
             Portions
             <input
               type="number"
               className="app-btn app-btn-utility"
               min={1}
               value={servings}
               onChange={(e) => setServings(Number(e.target.value || 1))}
               style={{
                 width: 120,
               }}
             />
           </label>

           {/* Notes */}
           <label className="grid gap-1 text-sm font-semibold app-btn app-btn-utility paper-ui recipe-color-2">
             Notes
             <textarea
               value={notes}
               onChange={(e) => setNotes(e.target.value)}
               rows={6}
               style={{
                 minHeight: 170,
               }}
             />
           </label>
         </div>

         {/* ========================= */}
         {/* COLONNE DROITE            */}
         {/* ========================= */}
         <div style={{ display: 'grid', gap: 14 }}>
           {/* Bloc image */}
           <label
             style={{
               border: '1px dashed var(--border)',
               borderRadius: 18,
               padding: 28,
               textAlign: 'center',
               cursor: 'pointer',
               display: 'block',
             }}
             >
             <input
               type="file"
               accept="image/*"
               style={{ display: 'none' }}
               onChange={(e) => {
                 const file = e.target.files?.[0]
                 if (!file) return

                 const localUrl = URL.createObjectURL(file)
                 setImageUrl(localUrl)
               }}
             />

             {imageUrl ? (
               <div
                 style={{
                   display: 'grid',
                   gap: 16,
                 }}
                 >
                 <img
                   src={imageUrl}
                   alt="preview"
                   style={{
                     width: '100%',
                     borderRadius: 14,
                     objectFit: 'cover',
                     maxHeight: 260,
                   }}
                 />

                 <input
                   value={imageUrl}
                   onClick={(e) => e.stopPropagation()}
                   onChange={(e) => setImageUrl(e.target.value)}
                   style={inputStyle}
                 />

                 <button
                   type="button"
                   className="app-btn app-btn-sage recipe-color-2"
                   onClick={(e) => {
                     e.preventDefault()
                     setCrop({ x: 0, y: 0 })
                     setZoom(1)
                     setCroppedAreaPixels(null)
                     setIsCropping(true)
                   }}
                   >
                   Recadrer l’image
                 </button>
               </div>
             ) : (
               <>
                 <div
                   style={{
                     width: 60,
                     height: 60,
                     borderRadius: '50%',
                     background: 'rgba(176, 188, 140, 0.4)',
                     display: 'grid',
                     placeItems: 'center',
                     margin: '0 auto 16px auto',
                     fontSize: 28,
                   }}
                   >
                   +
                 </div>

                 <div className="recipe-color-2" style={{ fontWeight: 700, marginBottom: 6 }}>Ajouter une image</div>

                 <div className="recipe-color-1" style={{ fontSize: 13, opacity: 0.6, marginBottom: 16 }}>Clique sur le + pour choisir une photo</div>
               </>
             )}
           </label>

           {/* ✅ MODIF: on déplace les 2 coûts ICI, sous “Ajouter une image” */}
           <div className="cost-summary" style={{ justifyContent: 'flex-start' }}>
             <div className="cost-pill paper-ui" style={{ minWidth: 0 }}>
               <div className="cost-pill-row cost-pill-row-recipe">
                 <span className="cost-pill-label recipe-color-2">Coût recette</span>
                 <span className="amount">≈ {totalCost.toFixed(2)} €</span>
               </div>
             </div>

             <div className="cost-pill paper-ui" style={{ minWidth: 0 }}>
               <div className="cost-pill-row cost-pill-row-courses">
                 <span className="cost-pill-label recipe-color-2">Coût courses</span>
                 <span className="amount">≈ {totalProducts.toFixed(2)} €</span>
               </div>
             </div>
           </div>
         </div>
       </div>
     </section>

     {/* Ingrédients */}
     <section className="app-card app-card-no-border p-6" style={{ marginTop: 16 }}>
       {/* Bandeau du haut : titre (gauche) + action (droite) */}
       <div className="ingredients-top">
         <div className="ingredients-head grid gap-1 text-sm font-semibold" style={{ marginBottom: 0 }}>
           <h2 className="recipe-color-2" style={sectionTitleStyle}>Ingrédients</h2>
           <p className="mt-2 text-sm app-muted">Un ingrédient par ligne : nom, quantité, unité, prix.</p>
         </div>

         <button
           onClick={() => recalcPrices({ silent: false })}
           disabled={isRepricing}
           className="app-btn app-btn-utility ingredients-recalc recipe-color-2"
           type="button">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span
                aria-hidden="true"
                className={isRepricing ? 'icon-spin' : ''}
                style={{ 
                  width: 18, 
                  height: 18, 
                  display: 'inline-flex', 
                  alignItems: 'center', 
                  justifyContent: 'center' 
                }}
              >
                <svg 
                  viewBox="0 0 24 24" 
                  width="18" 
                  height="18" 
                  fill="none" 
                  stroke="#68650A" 
                  strokeWidth="2"
                >
                  <rect x="6" y="3" width="12" height="18" rx="2"/>
                    <path d="M8 7h8" />
                    <path d="M9 11h1M12 11h1M15 11h1" />
                    <path d="M9 14h1M12 14h1M15 14h1" />
                    <path d="M9 17h1M12 17h1M15 17h1" />
                </svg>
              </span>
              <span>{isRepricing ? 'Recalcul…' : 'Recalculer les prix'}</span>
            </span>
         </button>
       </div>

       <div className="mt-4 grid gap-3">
         {ingredients.map((ing, idx) => {
           const isBuyPriceReady = ing.buyRecalced === true && typeof ing.buyPriceEur === 'number'

           return (
             <div
               key={idx}
               style={{
                 boxShadow: 'none',
                 background: 'rgba(255,255,255,0.7)',
                 borderColor: 'var(--border)',
               }}
               >
               <div
                 style={{
                   display: 'grid',
                   gridTemplateColumns: '1fr 65px 70px 200px 44px',
                   gap: 10,
                   alignItems: 'center',
                 }}
                 >
                 <div
                   className="app-card p-3 paper-ui"
                   style={{
                     display: 'flex',
                     alignItems: 'center',
                     gap: 8,
                     background: 'white',
                     border: '1px solid var(--border)',
                     borderRadius: 12,
                     padding: '0 8px',
                     minWidth: 0,
                   }}
                   >
                   <input
                     placeholder="Nom de l'ingrédient..."
                     value={ing.name}
                     onChange={(e) => setIngredient(idx, { name: e.target.value })}
                     style={{
                       flex: 1,
                       minWidth: 0,
                       background: 'transparent',
                       border: 'none',
                       outline: 'none',
                       padding: 11,
                     }}
                   />

                   <IngredientPicker
                     querySeed={normalizeIngredientForLookup(ing.name)}
                     onPick={(item) => {
                       setIngredient(idx, {
                         name: item.nom,
                         ingredientBaseId: item.id,
                         id: item.id as any,
                         //priceMatched: true,
                         note: undefined,
                       } as any)
                       setTimeout(() => {
                        recalcPrices({ silent: true})
                       }, 0)
                     }}
                     buttonLabel="Voir les produits"
                   />
                 </div>

                 <input
                   placeholder="Qté"
                   value={qtyInputs[idx] ?? ''}
                   onChange={(e) => setQtyInput(idx, e.target.value)}
                   style={{
                     borderRadius: 12,
                     padding: 11,
                   }}
                 />

                 <input
                   placeholder="Unité"
                   value={ing.unit}
                   onChange={(e) => setIngredient(idx, { unit: e.target.value })}
                   style={{
                     borderRadius: 12,
                     padding: 11,
                   }}
                 />

                 <div
                   style={{
                     minWidth: 0,
                     display: 'flex',
                     justifyContent: 'center',//'flex-end'
                     gap: 6, //50
                     alignItems: 'center',
                     fontSize: 13,
                     fontWeight: 800,
                   }}
                   >
                   <div style={{ textAlign: 'center' }}>
                     <div style={{ fontSize: 13, opacity: 0.6, fontWeight: 800, lineHeight: '12px' }}>Coût recette</div>
                     <div className='cost-pill-row-recipe' style={{ fontSize: 13, fontWeight: 800 }}>
                       {fmtEur(typeof (ing as any).costEur === 'number' ? (ing as any).costEur : null)}
                     </div>
                   </div>

                   <div style={{ textAlign: 'center' }}>
                     <div style={{ fontSize: 13, opacity: 0.6, fontWeight: 800, lineHeight: '12px' }}>Coût courses</div>
                     <div className='cost-pill-row-courses' style={{ fontSize: 13, fontWeight: 800, opacity: isBuyPriceReady ? 1 : 0.35 }}>
                       {isBuyPriceReady ? fmtEur(computeCostCourses(ing)) : '—'}
                     </div>
                   </div>
                 </div>

                 <button
                   type="button"
                   onClick={() => removeIngredient(idx)}
                   className="app-btn app-btn-utility"
                   style={smallXBtnStyle}
                   title="Supprimer cette ligne"
                   >
                   ✕
                 </button>
               </div>

                 <div style={{ fontSize: 11, opacity: 0.6 }}>
                id: {(ing as any).ingredientBaseId ?? (ing as any).id ?? '—'}
                </div>

               {isNotFoundLine(ing) && (
                 <div
                   style={{
                     marginTop: 6,
                     fontSize: 12,
                     fontWeight: 600,
                     color: 'rgba(90, 70, 50, 0.85)',
                     background: 'rgba(255, 193, 7, 0.06)',
                     border: '1px solid rgba(255, 193, 7, 0.25)',
                     borderRadius: 10,
                     padding: '6px 10px',
                   }}
                   >
                   ⚠️ Ingrédient non trouvé — prix mis à 0,00 € (tu peux quand même enregistrer).
                 </div>
               )}
             </div>
           )
         })}

         <button
           onClick={() => {
             setIngredients((p) => [...p, { name: '', quantity: 0, unit: '', buyRecalced: false }])
             setQtyInputs((p) => [...p, ''])
           }}
           className="app-btn app-btn-secondary app-btn-utility paper-ui recipe-color-2"
           style={{ width: 260 }}
           type="button"
           >
           + Ajouter un ingrédient
         </button>
       </div>
     </section>

     {/* Étapes */}
     <section className="app-card p-6" style={{ marginTop: 16 }}>
       <h2 style={sectionTitleStyle}>Étapes</h2>
       <p className="mt-2 text-sm app-muted">1 étape = 1 bloc. Garde les phrases courtes.</p>

       <div className="mt-4 grid gap-3">
         {steps.map((s, idx) => (
           <div
             key={idx}
             className="p-3"//app-card
             style={{
               boxShadow: 'none',
               background: 'rgba(255, 255, 255, 0.95)',
               borderColor: 'var(--border)',
               borderRadius: 12,
             }}
             >
             <div className="flex items-center justify-between gap-2 mb-2">
               <div
                 style={{
                   display: 'flex',
                   alignItems: 'center',
                   gap: 15,
                   fontSize: 15,//11
                   fontWeight: 700,
                   color: 'var(--primary)',//'rgba(117, 99, 94, 0.7)'
                   letterSpacing: 0.2,
                   //background: 'rgba(120, 120, 120, 0.12)',
                   //borderRadius: 1,
                   //padding: '4px 8px',
                 }}
                 >
                  <div
                    style={{
                      width: 32,
                      height:32,
                      borderRadius: '50%',
                      background: 'rgba(176, 188, 140, 0.4)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 14,
                      fontWeight: '700',
                      color: '#75635E',
                      lineHeight: 1,
                    }}
                   >
                    {idx + 1}
                  </div> 
                <span
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    color: 'var(--primary)',
                    letterSpacing: 0.2,
                    lineHeight: 1,
                  }}
                >
                 Étape
               </span>
              </div>
               <button
                 type="button"
                 onClick={() => removeStep(idx)}
                 className="app-btn app-btn-utility"
                 style={smallXBtnStyle}
                 title="Supprimer cette étape"
                 >
                 ✕
               </button>
             </div>

             <textarea
               value={s}
               onChange={(e) =>
                 setSteps((prev) => {
                   const copy = [...prev]
                   copy[idx] = e.target.value
                   return copy
                 })
               }
               rows={3}
               style={{
                 width: '100%',
                 background: 'white',
                 border: '1px solid var(--border)',
                 borderRadius: 12,
                 padding: 14,
                 minHeight: 90,
               }}
             />
           </div>
         ))}

         <button onClick={() => setSteps((p) => [...p, ''])} className="app-btn app-btn-secondary app-btn-utility paper-ui recipe-color-2" style={{ width: 220 }} type="button">
           + Ajouter une étape
         </button>
       </div>
     </section>

     {/* Save + status */}
     <section className="app-card p-6" style={{ marginTop: 16}}>
       <div className="flex flex-wrap gap-3 items-center justify-center">
         <button onClick={save} className="app-btn-sage app-btn-lg" 
            style={{ 
              display: 'flex', 
              borderRadius: 14,
              justifyContent: 'center',
              alignItems: 'center',
              gap: 16,
              flexWrap: 'wrap',
              }} 
            type="button">
           Enregistrer la recette
         </button>

         {status && (
           <span
             className="app-card px-3 py-2 text-sm"
             style={{
               boxShadow: 'none',
               borderColor:
                 statusKind === 'success'
                   ? 'rgba(168,184,161,0.7)'
                   : statusKind === 'error'
                     ? 'rgba(176,0,32,0.25)'
                     : 'var(--border)',
               background:
                 statusKind === 'success'
                   ? 'rgba(168,184,161,0.15)'
                   : statusKind === 'error'
                     ? 'rgba(176,0,32,0.06)'
                     : 'rgba(255,255,255,0.7)',
               color: statusKind === 'error' ? '#b00020' : 'rgba(43,43,43,0.95)',
               fontWeight: 800,
             }}
             >
             {status}
           </span>
         )}
       </div>
     </section>

     {/* MODAL CROP */}
     {isCropping && imageUrl?.trim() && (
       <div
         style={{
           position: 'fixed',
           inset: 0,
           background: 'rgba(0,0,0,0.55)',
           display: 'grid',
           placeItems: 'center',
           zIndex: 50,
           padding: 16,
         }}
         >
         <div
           style={{
             width: 'min(920px, 95vw)',
             background: 'white',
             borderRadius: 14,
             border: '1px solid var(--border)',
             overflow: 'hidden',
           }}
           >
           <div style={{ padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
             <div style={{ fontWeight: 800 }}>Recadrer l’image</div>
             <button type="button" className="app-btn app-btn-secondary" onClick={() => setIsCropping(false)}>
               Fermer
             </button>
           </div>

           <div style={{ position: 'relative', width: '100%', height: 480, background: '#111' }}>
             <Cropper
               image={imageUrl}
               crop={crop}
               zoom={zoom}
               onCropChange={setCrop}
               onZoomChange={setZoom}
               onCropComplete={onCropComplete}
               aspect={4 / 3}
               cropShape="rect"
               showGrid
             />
           </div>

           <div
             style={{
               padding: 12,
               display: 'flex',
               alignItems: 'center',
               gap: 12,
               borderTop: '1px solid var(--border)',
             }}
             >
             <div style={{ fontSize: 12, opacity: 0.7, minWidth: 40 }}>Zoom</div>

             <input
               type="range"
               min={1}
               max={3}
               step={0.01}
               value={zoom}
               onChange={(e) => setZoom(Number(e.target.value))}
               style={{ width: '100%' }}
             />

             <div style={{ fontSize: 12, opacity: 0.7, minWidth: 42, textAlign: 'right' }}>{zoom.toFixed(2)}</div>
           </div>
             
           <div style={{ padding: 12, display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'center' }}>
             <button
               type="button"
               className="app-btn-primary"
               onClick={confirmCrop}
               disabled={isUploadingCrop || !croppedAreaPixels}
               style={{ minWidth: 220, opacity: isUploadingCrop ? 0.7 : 1 }}
              >
               {isUploadingCrop ? 'Upload…' : 'Valider le recadrage'}
             </button>
           </div>
         </div>
       </div>
     )}
   </main>
 )
}

export default function Page() {
 return (
   <Suspense fallback={<div className="app-container" style={{ padding: 24 }}>Chargement…</div>}>
     <NewRecipeInner />
   </Suspense>
 )
}