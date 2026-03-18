// frontend/my-app/src/app/recipes/new/page.tsx
'use client'

import type React from 'react'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { apiFetch } from 'src/lib/api'
import type { OcrDraft, IngredientLine } from 'src/types/recipe'
import { IngredientPicker } from '@/components/IngredientPicker'
import Cropper from 'react-easy-crop'
import Price from '@/components/Price'
import PricingPaywallNotice from '@/components/PricingPaywallNotice'


type Line = IngredientLine & {
 unitPriceBuy?: number | null

 // ✅ prix "produit" (courses)
 buyPriceEur?: number | null
 buyLabel?: string | null
 buyRefQty?: number | null
 buyRefUnit?: string | null
 buyRecalced?: boolean
 gramsPerPiece?: number | null
 density_g_per_ml?: number | null
 mlPerPiece?: number | null

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

 gramsPerPiece?: number | null
 density_g_per_ml?: number | null
 mlPerPiece?: number | null
}

type EnrichResponse =
 | { ok: true; ingredients: EnrichIngredientOut[] }
 | { ok: false; error: string; message?: string }

 type EconomySuggestion = {
 ingredientName: string
 substitutions: Array<{
   id: string
   name: string
   buyPriceEur?: number | null
 }>
 savingEur?: number | null
 newTotalEur?: number | null
 label?: string | null
 note?: string | null
}

/* ──────────────────────────────────────────────────────────────
Helpers quantité : accepte 1/4, 1 1/2, 1,2
────────────────────────────────────────────────────────────── */

function canonUnitFront(uRaw: string): 'g' | 'ml' | 'piece' | 'tbsp' | 'tsp' | null {
 const u0 = String(uRaw || '').trim().toLowerCase()
 if (!u0) return null

 if (
   u0 === 'càs' ||
   u0 === 'cas' ||
   u0 === 'cs' ||
   (u0.includes('cuill') && u0.includes('soupe'))
 ) return 'tbsp'

 if (
   u0 === 'càc' ||
   u0 === 'cac' ||
   u0 === 'cc' ||
   (u0.includes('cuill') && u0.includes('cafe'))
 ) return 'tsp'

 if (u0 === 'g' || u0 === 'gr' || u0 === 'gramme' || u0 === 'grammes') return 'g'
 if (u0 === 'kg' || u0 === 'kilo' || u0 === 'kilos') return 'g'

 if (u0 === 'ml') return 'ml'
 if (u0 === 'l' || u0 === 'litre' || u0 === 'litres') return 'ml'
 if (u0 === 'cl') return 'ml'
 if (u0 === 'dl') return 'ml'

 if (
   u0 === 'piece' ||
   u0 === 'pieces' ||
   u0 === 'pièce' ||
   u0 === 'pièces' ||
   u0 === 'pcs' ||
   u0 === 'gousse' ||
   u0 === 'gousses' ||
   u0 === 'tranche' ||
   u0 === 'tranches'
 ) return 'piece'

 return null
}
function toBaseQtyFront(qty: number, unitRaw: string): { qty: number; unit: 'g' | 'ml' | 'piece' } | null {
 const u0 = String(unitRaw || '').trim().toLowerCase()
 const q = Number(qty || 0)
 if (!Number.isFinite(q)) return null

 const canon = canonUnitFront(u0)
 if (!canon) return null

 if (canon === 'tbsp') return { qty: q * 15, unit: 'ml' }
 if (canon === 'tsp') return { qty: q * 5, unit: 'ml' }

 // g
 if (u0 === 'kg' || u0 === 'kilo' || u0 === 'kilos') return { qty: q * 1000, unit: 'g' }
 if (canon === 'g') return { qty: q, unit: 'g' }

 // ml
 if (u0 === 'l' || u0 === 'litre' || u0 === 'litres') return { qty: q * 1000, unit: 'ml' }
 if (u0 === 'cl') return { qty: q * 10, unit: 'ml' }
 if (u0 === 'dl') return { qty: q * 100, unit: 'ml' }
 if (canon === 'ml') return { qty: q, unit: 'ml' }

 // piece
 return { qty: q, unit: 'piece' }
}

function computeCostCourses(ing: Line): number | null {
 const buyPrice = typeof ing.buyPriceEur === 'number' ? ing.buyPriceEur : null

 const refQty = typeof ing.buyRefQty === 'number' ? ing.buyRefQty : null
 const refUnit = typeof ing.buyRefUnit === 'string' ? ing.buyRefUnit : null
 if (buyPrice == null || refQty == null || refUnit == null) return null
 
 // base recette + base pack
 let qBase = toBaseQtyFront(Number(ing.quantity || 0), String(ing.unit || ''))
 const packBase = toBaseQtyFront(refQty, refUnit)
 if (!qBase || !packBase) return null

 // si déjà compatible => OK
 if (qBase.unit === packBase.unit) {
   const packs = Math.max(1, Math.ceil(qBase.qty / packBase.qty))
   return packs * buyPrice
 }

 // ---- conversions avancées ----

 // piece -> g via gramsPerPiece
 const gpp = typeof ing.gramsPerPiece === 'number' ? ing.gramsPerPiece : null
 if (qBase.unit === 'piece' && packBase.unit === 'g' && gpp && gpp > 0) {
   qBase = { qty: qBase.qty * gpp, unit: 'g' }
   const packs = Math.max(1, Math.ceil(qBase.qty / packBase.qty))
   return packs * buyPrice
 }

 // g -> piece via gramsPerPiece (rare mais propre)
 if (qBase.unit === 'g' && packBase.unit === 'piece' && gpp && gpp > 0) {
   qBase = { qty: qBase.qty / gpp, unit: 'piece' }
   const packs = Math.max(1, Math.ceil(qBase.qty / packBase.qty))
   return packs * buyPrice
 }

 // ml <-> g via densité
 const d = typeof ing.density_g_per_ml === 'number' ? ing.density_g_per_ml : null
 if (d && d > 0) {
   if (qBase.unit === 'ml' && packBase.unit === 'g') {
     qBase = { qty: qBase.qty * d, unit: 'g' }
     const packs = Math.max(1, Math.ceil(qBase.qty / packBase.qty))
     return packs * buyPrice
   }
   if (qBase.unit === 'g' && packBase.unit === 'ml') {
     qBase = { qty: qBase.qty / d, unit: 'ml' }
     const packs = Math.max(1, Math.ceil(qBase.qty / packBase.qty))
     return packs * buyPrice
   }
 }

 return null
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

// Nettoyage nom ingrédient pour lookup (muscade râpée (selon...) => muscade)
function normalizeIngredientForLookup(raw: string): string {
 let s = String(raw || '').trim()
 if (!s) return ''

 s = s.replace(/\([^)]*\)/g, ' ') // retire (...) partout
 s = s.replace(/\bselon\b.*$/gi, ' ') // retire "selon ..."
 s = s.replace(/[,;:].*$/g, ' ') // retire après virgule/;/: (souvent commentaires)
 s = s.replace(
   /\b(râpée?|haché(e)?|émincé(e)?|moulu(e)?|en\s+poudre|frais|ciselé(e)?|décortiqué(e)?)\b/gi,
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

 const [title, setTitle] = useState('')
 const [servings, setServings] = useState(1)
 const [imageUrl, setImageUrl] = useState('')
 const [notes, setNotes] = useState('')
 const [steps, setSteps] = useState<string[]>([''])
 const [ingredients, setIngredients] = useState<Line[]>([
   { name: '', quantity: 0, unit: '', buyRecalced: false },
 ])
 const [qtyInputs, setQtyInputs] = useState<string[]>([''])
 const [trash, setTrash] = useState<string>('')
 const [status, setStatus] = useState<string>('')

 const [isRepricing, setIsRepricing] = useState(false)
 const [economySuggestion, setEconomySuggestion] = useState<EconomySuggestion | null>(null)

 const [blurPrices, setBlurPrices] = useState(false)
 useEffect(() => {
   try {
     setBlurPrices(localStorage.getItem('pricing_blur') === '1')
   } catch {}
 }, [])

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
     (acc, i) =>
       acc + (typeof (i as any).costEur === 'number' ? ((i as any).costEur as number) : 0),
     0
   )
 }, [ingredients])

 const totalProducts = useMemo(() => {
   return ingredients.reduce((acc, ing) => {
     const v = computeCostCourses(ing)
     return acc + (typeof v === 'number' ? v : 0)
   }, 0)
 }, [ingredients])

 const costPerServing = useMemo(() => {
   if (!servings || servings <= 0) return null
   if (!totalCost || totalCost <= 0) return null
   return totalCost / servings
 }, [totalCost, servings])

 function getBudgetLevel(pricePerPerson: number | null) {
   if (pricePerPerson == null || !Number.isFinite(pricePerPerson)) return null
   if (pricePerPerson < 3) return 'smart'
   if (pricePerPerson <= 5) return 'medium'
   if (pricePerPerson <= 8) return 'high'
   return 'occasion'
 }

 const budgetLevel = getBudgetLevel(costPerServing)

 const topIngredients = useMemo(() => {
   return ingredients
     .map((ing) => {
     const costCourses = computeCostCourses(ing)
     return {
      name: ing.name,
      cost: typeof costCourses === 'number' ? costCourses: 0,
     }
    })
     .filter((i) => i.name && i.cost > 0)
     .sort((a, b) => b.cost - a.cost)
     .slice(0, 3)
 }, [ingredients])

 useEffect(() => {
   const validIngredients = ingredients
     .map((ing) => ({
       name: String(ing.name || '').trim(),
       costEur: typeof ing.costEur === 'number' ? ing.costEur : 0,
       ingredientBaseId:
         typeof ing.ingredientBaseId === 'string' ? ing.ingredientBaseId : null,
       id: typeof ing.id === 'string' ? ing.id : null,
     }))
     .filter((ing) => ing.name && ing.costEur > 0 && (ing.ingredientBaseId || ing.id))

   if (!validIngredients.length || totalCost <= 0) {
     setEconomySuggestion(null)
     return
   }

   const timer = setTimeout(async () => {
     try {
       const json = await apiFetch<{
         ok: boolean
         suggestion?: EconomySuggestion | null
       }>('/recipes/economy-suggestion', {
         method: 'POST',
         body: JSON.stringify({
           ingredients: validIngredients,
           totalCostEur: totalCost,
         }),
       })

       if (json?.ok) {
         setEconomySuggestion(json.suggestion ?? null)
       } else {
         setEconomySuggestion(null)
       }
     } catch {
       setEconomySuggestion(null)
     }
   }, 300)

   return () => clearTimeout(timer)
 }, [ingredients, totalCost])

 useEffect(() => {
   if (!fromOcr) return

   const raw = sessionStorage.getItem('recipeDraft')
   if (!raw || raw === 'null' || raw === 'undefined') return

   try {
     const d = JSON.parse(raw) as OcrDraft

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
         if (typeof row === 'string') {
           return { name: row, quantity: 0, unit: '', buyRecalced: false }
         }
         if (row.raw) {
           return { name: String(row.raw), quantity: 0, unit: '', buyRecalced: false }
         }

         const buyPriceEur =
           typeof row.buyPriceEur === 'number' ? row.buyPriceEur : row.buyPriceEur ?? null

         return {
           name: String(row.name || '').trim(),
           quantity: Number(row.quantity || 0) || 0,
           unit: String(row.unit || ''),
           quantityRaw:
             typeof row.quantityRaw === 'string' ? String(row.quantityRaw).trim() : undefined,

           price: row.price ?? null,
           costEur: typeof row.costEur === 'number' ? row.costEur : row.costEur ?? null,
           unitPriceBuy:
             typeof row.unitPriceBuy === 'number' ? row.unitPriceBuy : row.unitPriceBuy ?? null,
           priceMatched:
             typeof row.priceMatched === 'boolean' ? row.priceMatched : undefined,
           id: row.id ?? null,

           buyPriceEur,
           buyLabel:
             typeof row.buyLabel === 'string' ? row.buyLabel : row.buyLabel ?? null,
           buyRefQty:
             typeof row.buyRefQty === 'number' ? row.buyRefQty : row.buyRefQty ?? null,
           buyRefUnit:
             typeof row.buyRefUnit === 'string' ? row.buyRefUnit : row.buyRefUnit ?? null,
           gramsPerPiece:
             typeof row.gramsPerPiece === 'number' ? row.gramsPerPiece : row.gramsPerPiece ?? null,
           density_g_per_ml:
             typeof row.density_g_per_ml === 'number'
               ? row.density_g_per_ml
               : row.density_g_per_ml ?? null,

           buyRecalced: typeof buyPriceEur === 'number',
           note: typeof row.note === 'string' ? row.note : row.note ?? undefined,
         } as any
       })
       .filter((x: any): x is Line => x !== null)

     const finalIngredients = normalized.length
       ? normalized
       : [{ name: '', quantity: 0, unit: '', buyRecalced: false }]

     setIngredients(finalIngredients)
     setQtyInputs(finalIngredients.map((r: any) => formatQtyForInput(r.quantity, r.quantityRaw)))

     const tr = Array.isArray((d as any).trash)
       ? (d as any).trash.map((x: any) => String(x || '').trim()).filter(Boolean)
       : []
     setTrash(tr.join('\n'))
   } catch (e) {
     console.error('ocrDraft parse error', e)
   }

   try {
     sessionStorage.removeItem('recipeDraft')
   } catch {}
 }, [fromOcr])

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

     const s = Array.isArray(d.steps)
       ? d.steps.map((x) => String(x || '').trim()).filter(Boolean)
       : []
     setSteps(s.length ? s : [''])

     const ing = Array.isArray(d.ingredients) ? d.ingredients : []
     const normalized = ing
       .map((row: any): Line | null => {
         if (!row) return null
         if (typeof row === 'string') {
           return { name: row, quantity: 0, unit: '', buyRecalced: false }
         }
         if (row.raw) {
           return { name: String(row.raw), quantity: 0, unit: '', buyRecalced: false }
         }

         const buyPriceEur =
           typeof row.buyPriceEur === 'number' ? row.buyPriceEur : row.buyPriceEur ?? null

         return {
           name: String(row.name || '').trim(),
           quantity: Number(row.quantity || 0) || 0,
           unit: String(row.unit || ''),
           quantityRaw:
             typeof row.quantityRaw === 'string' ? String(row.quantityRaw).trim() : undefined,

           price: row.price ?? null,
           costEur: typeof row.costEur === 'number' ? row.costEur : null,
           unitPriceBuy:
             typeof row.unitPriceBuy === 'number' ? row.unitPriceBuy : row.unitPriceBuy ?? null,
           priceMatched: row.priceMatched ?? false,
           id: row.id ?? null,

           buyPriceEur,
           buyLabel:
             typeof row.buyLabel === 'string' ? row.buyLabel : row.buyLabel ?? null,
           buyRefQty:
             typeof row.buyRefQty === 'number' ? row.buyRefQty : row.buyRefQty ?? null,
           buyRefUnit:
             typeof row.buyRefUnit === 'string' ? row.buyRefUnit : row.buyRefUnit ?? null,
           gramsPerPiece:
             typeof row.gramsPerPiece === 'number' ? row.gramsPerPiece : row.gramsPerPiece ?? null,
           density_g_per_ml:
             typeof row.density_g_per_ml === 'number'
               ? row.density_g_per_ml
               : row.density_g_per_ml ?? null,

           buyRecalced: typeof buyPriceEur === 'number',
           note: typeof row.note === 'string' ? row.note : row.note ?? undefined,
         } as any
       })
       .filter((x: any): x is Line => x !== null)

     const finalIngredients = normalized.length
       ? normalized
       : [{ name: '', quantity: 0, unit: '', buyRecalced: false }]

     setIngredients(finalIngredients)
     setQtyInputs(finalIngredients.map((r: any) => formatQtyForInput(r.quantity, r.quantityRaw)))

     const tr = Array.isArray(d.trash)
       ? d.trash.map((x) => String(x || '').trim()).filter(Boolean)
       : []
     setTrash(tr.join('\n'))
   } catch (e) {
     console.error('prefill parse error', e)
   }
 }, [prefill])

 function setIngredient(idx: number, patch: Partial<Line>) {
   setIngredients((prev) => {
     const copy = [...prev]
     copy[idx] = {
       ...copy[idx],
       ...patch,
       buyRecalced: false,
     }
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

       const cost =
         typeof e.costEur === 'number'
           ? e.costEur
           : typeof e.costRecipe === 'number'
           ? e.costRecipe
           : null

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

         gramsPerPiece: typeof e.gramsPerPiece === 'number' ? e.gramsPerPiece : null,
         density_g_per_ml:
           typeof e.density_g_per_ml === 'number' ? e.density_g_per_ml : null,
         mlPerPiece: typeof e.mlPerPiece === 'number' ? e.mlPerPiece : null,

         note: typeof e.note === 'string' ? e.note : undefined,
       } as any
     }

     console.log('FRONT ENRICHED', enriched)
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
           ingredientBaseId: (i as any).ingredientBaseId ?? null,
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

     const enriched = Array.isArray((json as any).ingredients)
       ? (json as any).ingredients
       : []
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
     .map(
       (i) =>
         `${String(i.name || '').trim()}|${Number(i.quantity || 0) || 0}|${String(i.unit || '').trim()}`
     )
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

 const statusKind = status.startsWith('✅')
   ? 'success'
   : status.startsWith('❌')
   ? 'error'
   : status
   ? 'info'
   : null

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

 return (
   <main className="app-container recipe-editor-page">
     <section className="recipe-editor-head">
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

       <p className="recipe-editor-subtitle">
         Remplis l’essentiel. Tu peux toujours ajuster plus tard.
       </p>

       {blurPrices && (
         <p className="mt-2 text-sm app-muted" style={{ fontWeight: 800 }}>
           ⚠️ Limite atteinte : les prix sont floutés.
         </p>
       )}
     </section>

     {blurPrices && <PricingPaywallNotice context="import" />}

     {trash.trim() && (
       <section className="app-card p-5" style={{ marginTop: 16 }}>
         <details>
           <summary
             style={{
               cursor: 'pointer',
               fontWeight: 800,
               color: 'var(--primary)',
             }}
            >
             🗑️ Corbeille (texte non-recette détecté)
           </summary>

           <p className="mt-2 text-sm app-muted">
             Rien n’est envoyé en base ici : c’est juste pour voir ce qui a été filtré.
           </p>

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

     <section className="app-card recipe-editor-hero-card">
       <div className="recipe-form-top-grid">
         <div style={{ display: 'grid', gap: 21 }}>
           <label className="recipe-servings-block">
             <span className="recipe-servings-label">Portions</span>

             <div className="recipe-servings-control">
               <button
                 type="button"
                 className="app-btn app-btn-utility recipe-servings-btn"
                 onClick={() => setServings((prev) => Math.max(1, prev - 1))}
                 aria-label="Réduire le nombre de portions"
                >
                 −
               </button>

               <input
                 type="number"
                 min={1}
                 inputMode="numeric"
                 value={servings}
                 onChange={(e) => setServings(Math.max(1, Number(e.target.value || 1)))}
                 className="app-btn app-btn-utility recipe-servings-input"
               />

               <button
                 type="button"
                 className="app-btn app-btn-utility recipe-servings-btn"
                 onClick={() => setServings((prev) => prev + 1)}
                 aria-label="Augmenter le nombre de portions"
                >
                 +
               </button>
             </div>
           </label>
         </div>

         <div style={{ display: 'grid', gap: 14 }}>
           <label className="recipe-editor-image-drop">
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
               <div className="recipe-editor-image-stack">
                 <img
                   src={imageUrl}
                   alt="preview"
                   className="recipe-editor-image-preview"
                 />

                 <input
                   value={imageUrl}
                   onClick={(e) => e.stopPropagation()}
                   onChange={(e) => setImageUrl(e.target.value)}
                   className="recipe-editor-image-url"
                 />

                 <button
                   type="button"
                   className="app-btn recipe-editor-secondary-btn"
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
                 <div className="recipe-editor-image-plus">+</div>

                 <div className="recipe-editor-image-title">Ajouter une image</div>

                 <div className="recipe-editor-image-hint">
                   Clique sur le + pour choisir une photo
                 </div>
               </>
             )}
           </label>

           <div className="recipe-editor-costs">
             <div className="recipe-editor-costs-card">
               <div className="cost-pill-row cost-pill-row-recipe">
                 <span className="cost-pill-label recipe-color-2">Coût de la recette</span>
                 <span className="amount">
                   {' ≈ '} <Price value={totalCost} blur={blurPrices} />
                 </span>
               </div>
             </div>

             <div className="recipe-editor-costs-card">
               <div className="cost-pill-row cost-pill-row-courses">
                 <span className="cost-pill-label recipe-color-2">Coût des courses</span>
                 <span className="amount">
                   {' ≈ '} <Price value={totalProducts} blur={blurPrices} />
                 </span>
               </div>
             </div>
           </div>

           {totalCost > 0 && (
             <div
               className="recipe-analysis-card"
               style={{
                 marginTop: 16,
                 background: 'rgba(176,188,140,0.08)',
                 border: '1px solid rgba(176,188,140,0.25)',
               }}
              >
               {budgetLevel && (
                 <div className="recipe-budget-pills">
                   <div className={`recipe-budget-pill ${budgetLevel === 'smart' ? 'is-active' : ''}`}>
                     Budget malin
                   </div>
                   <div className={`recipe-budget-pill ${budgetLevel === 'medium' ? 'is-active' : ''}`}>
                     Budget moyen
                   </div>
                   <div className={`recipe-budget-pill ${budgetLevel === 'high' ? 'is-active' : ''}`}>
                     Budget élevé
                   </div>
                 </div>
               )}

               {topIngredients.length > 0 && (
                 <div>
                   <h3 className="recipe-analysis-section-title">
                     Les ingrédients les plus élevés :
                   </h3>

                   <div style={{ display: 'grid', gap: 4 }}>
                     {topIngredients.map((i, index) => (
                       <div key={index} className="recipe-analysis-top-item">
                         <span>
                           • {index + 1} {i.name}
                         </span>

                         <span className="recipe-analysis-price">
                           <Price value={i.cost} blur={blurPrices} />
                         </span>
                       </div>
                     ))}

                     {costPerServing && (
                       <div className="recipe-analysis-serving-card">
                         <div className="recipe-analysis-serving-label">Prix par personne :</div>
                         <div className="recipe-analysis-serving-value">
                           <Price value={costPerServing} blur={blurPrices} />
                         </div>
                         <div className="recipe-analysis-serving-meta">{servings} portions</div>
                       </div>
                     )}

                     {economySuggestion && (
                       <div style={{ marginTop: 16 }}>
                         <div className="recipe-analysis-section-title">
                           Comment réduire le coût :
                         </div>

                         <div className="recipe-analysis-saving-box">
                           <div className="recipe-analysis-saving-main">
                             • {economySuggestion.ingredientName}
                           </div>

                           {economySuggestion.substitutions?.length > 0 && (
                             <div style={{ marginBottom: 10 }}>
                               <div className="recipe-analysis-saving-label">
                                 {economySuggestion.label || 'Alternative possible selon la recette'} :
                               </div>

                               <div className="recipe-analysis-saving-list">
                                 {economySuggestion.substitutions.map((sub) => (
                                   <div key={sub.id} className="recipe-analysis-saving-item">
                                     . {sub.name}
                                   </div>
                                 ))}
                               </div>
                             </div>
                           )}

                           {economySuggestion.note && (
                             <div className="recipe-analysis-saving-note">
                               {economySuggestion.note}
                             </div>
                           )}

                           <div className="recipe-analysis-saving-strong">
                             Économie estimée : ~
                             <Price value={economySuggestion.savingEur} blur={blurPrices} />
                           </div>

                           <div className="recipe-analysis-saving-meta">
                             Nouveau coût recette :{' '}
                             <Price value={economySuggestion.newTotalEur} blur={blurPrices} />
                           </div>

                           <div className="recipe-analysis-saving-meta">
                             Nouveau prix/personne :{' '}
                             <Price
                               value={
                                 economySuggestion.newTotalEur != null && servings > 0
                                   ? economySuggestion.newTotalEur / servings
                                   : null
                               }
                               blur={blurPrices}
                             />
                           </div>
                         </div>
                       </div>
                     )}
                   </div>
                 </div>
               )}
             </div>
           )}
         </div>
       </div>
     </section>

     <section className="app-card app-card-no-border p-6" style={{ marginTop: 16 }}>
       <div className="ingredients-top">
         <div className="ingredients-head grid gap-1 text-sm font-semibold">
           <h2 className="recipe-color-2" style={sectionTitleStyle}>
             Ingrédients
           </h2>

           <p className="mt-2 text-sm app-muted">
             Un ingrédient par ligne : nom, quantité, unité, prix.
           </p>
         </div>

         <button
           onClick={() => recalcPrices({ silent: false })}
           disabled={isRepricing}
           className="app-btn app-btn-utility ingredients-recalc recipe-color-2"
           type="button"
          >
           {isRepricing ? 'Recalcul…' : 'Recalculer les prix'}
         </button>
       </div>

       <div className="mt-4 grid gap-3">
         {ingredients.map((ing, idx) => {
           const costCourses = computeCostCourses(ing)
           const costRecipe =
             typeof (ing as any).costEur === 'number' ? (ing as any).costEur : null

           return (
             <div key={idx} className="app-card p-3">
               <div className="ingredient-row-desktop">
                 <div className="ingredient-cell-name">
                   <input
                     placeholder="Nom de l'ingrédient..."
                     value={ing.name}
                     onChange={(e) => setIngredient(idx, { name: e.target.value })}
                     style={{
                       border: '1px solid var(--border)',
                       borderRadius: 12,
                       padding: 10,
                       width: '100%',
                     }}
                   />
                 </div>

                 <div className="ingredient-picker-wrap">
                   <IngredientPicker
                     querySeed={normalizeIngredientForLookup(ing.name)}
                     onPick={(item) => {
                       setIngredient(idx, {
                         name: item.nom,
                         ingredientBaseId: item.id,
                         id: item.id as any,
                       })

                       setTimeout(() => {
                         recalcPrices({ silent: true })
                       }, 0)
                     }}
                     buttonLabel="Voir les produits"
                   />
                 </div>

                 <input
                   placeholder="Qté"
                   value={qtyInputs[idx] ?? ''}
                   onChange={(e) => setQtyInput(idx, e.target.value)}
                   className="app-btn app-btn-utility"
                   style={{
                     borderRadius: 12,
                     padding: 10,
                     width: '100%',
                     justifyContent: 'flex-start',
                     fontWeight: 500,
                   }}
                 />

                 <input
                   placeholder="Unité"
                   value={ing.unit}
                   onChange={(e) => setIngredient(idx, { unit: e.target.value })}
                   className="app-btn app-btn-utility"
                   style={{
                     borderRadius: 12,
                     padding: 10,
                     width: '100%',
                   }}
                 />

                 <div className="ingredient-price-col">
                   <div className="ingredient-price-label">Coût recette</div>
                   <div className="ingredient-price-value cost-pill-row-recipe">
                     <Price value={costRecipe} blur={blurPrices} />
                   </div>
                 </div>

                 <div className="ingredient-price-col">
                   <div className="ingredient-price-label">Coût courses</div>
                   <div className="ingredient-price-value cost-pill-row-courses">
                     <Price value={costCourses} blur={blurPrices} />
                   </div>
                 </div>

                 <div className="ingredient-delete-col">
                   <button
                     type="button"
                     onClick={() => removeIngredient(idx)}
                     className="app-btn app-btn-utility"
                     style={smallXBtnStyle}
                    >
                     ✕
                   </button>
                 </div>
               </div>

               <div className="ingredient-row-mobile">
                 <div className="ingredient-mobile-top">
                   <input
                     placeholder="Nom de l'ingrédient..."
                     value={ing.name}
                     onChange={(e) => setIngredient(idx, { name: e.target.value })}
                     style={{
                       border: '1px solid var(--border)',
                       borderRadius: 12,
                       padding: 10,
                       width: '100%',
                     }}
                   />

                   <div className="ingredient-picker-wrap">
                     <IngredientPicker
                       querySeed={normalizeIngredientForLookup(ing.name)}
                       onPick={(item) => {
                         setIngredient(idx, {
                           name: item.nom,
                           ingredientBaseId: item.id,
                           id: item.id as any,
                         })

                         setTimeout(() => {
                           recalcPrices({ silent: true })
                         }, 0)
                       }}
                       buttonLabel="Voir les produits"
                     />
                   </div>
                 </div>

                 <div className="ingredient-mobile-meta">
                   <input
                     placeholder="Qté"
                     value={qtyInputs[idx] ?? ''}
                     onChange={(e) => setQtyInput(idx, e.target.value)}
                     className="app-btn-utility"
                     style={{
                       borderRadius: 20,
                       padding: 10,
                       width: '100%',
                       justifyContent: 'flex-start',
                       fontWeight: 500,
                     }}
                   />

                   <input
                     placeholder="Unité"
                     value={ing.unit}
                     onChange={(e) => setIngredient(idx, { unit: e.target.value })}
                     className="app-btn app-btn-utility"
                     style={{
                       borderRadius: 20,
                       padding: '6px 10px',
                       width: '100%',
                       justifyContent: 'flex-start',
                       fontWeight: 500,
                     }}
                   />
                 </div>

                 <div className="ingredient-mobile-prices">
                   <div className="ingredient-mobile-pricebox">
                     <div className="ingredient-price-label">Coût recette</div>
                     <div className="ingredient-price-value cost-pill-row-recipe">
                       <Price value={costRecipe} blur={blurPrices} />
                     </div>
                   </div>

                   <div className="ingredient-mobile-pricebox">
                     <div className="ingredient-price-label">Coût courses</div>
                     <div className="ingredient-price-value cost-pill-row-courses">
                       <Price value={costCourses} blur={blurPrices} />
                     </div>
                   </div>

                   <button
                     type="button"
                     onClick={() => removeIngredient(idx)}
                     className="app-btn app-btn-utility"
                     style={smallXBtnStyle}
                    >
                     ✕
                   </button>
                 </div>
               </div>
             </div>
           )
         })}

         <button
           onClick={() => {
             setIngredients((p) => [
               ...p,
               { name: '', quantity: 0, unit: '', buyRecalced: false },
             ])
             setQtyInputs((p) => [...p, ''])
           }}
           className="app-btn app-btn-secondary app-btn-utility paper-ui recipe-color-2"
           style={{ width: 'min(260px, 100%)' }}
           type="button"
          >
           + Ajouter un ingrédient
         </button>
       </div>
     </section>

     <section className="app-card p-5" style={{ marginTop: 16 }}>
       <div
         style={{
           display: 'flex',
           justifyContent: 'center',
           alignItems: 'center',
           gap: 14,
           flexWrap: 'wrap',
         }}
        >
         <div>
           {status && (
             <p
               style={{
                 margin: 0,
                 fontWeight: 700,
                 color:
                   statusKind === 'success'
                     ? '#2f6f3e'
                     : statusKind === 'error'
                     ? '#b00020'
                     : 'var(--primary)',
               }}
              >
               {status}
             </p>
           )}
         </div>

         <button
           type="button"
           onClick={save}
           className="app-btn app-btn-sage"
           style={{
             minWidth: 280,
             height: 60,
             fontSize: 35,
             fontWeight: 800,
             borderRadius: 14,
             boxShadow: '0 12px 22px rgba(176,188,140,0.35)',
           }}
          >
           Enregistrer la recette
         </button>
       </div>
     </section>

     {isCropping && imageUrl && (
       <div
         style={{
           position: 'fixed',
           inset: 0,
           zIndex: 2000,
           background: 'rgba(30, 22, 18, 0.72)',
           display: 'grid',
           placeItems: 'center',
           padding: 16,
         }}
        >
         <div
           className="app-card"
           style={{
             width: 'min(920px, 100%)',
             padding: 16,
             display: 'grid',
             gap: 14,
           }}
          >
           <div
             style={{
               position: 'relative',
               width: '100%',
               height: 'min(70vh, 560px)',
               borderRadius: 18,
               overflow: 'hidden',
               background: '#111',
             }}
            > 
             <Cropper
               image={imageUrl}
               crop={crop}
               zoom={zoom}
               aspect={4 / 3}
               onCropChange={setCrop}
               onZoomChange={setZoom}
               onCropComplete={onCropComplete}
             />
           </div>

           <div style={{ display: 'grid', gap: 8 }}>
             <label className="text-sm font-semibold recipe-color-2">
               Zoom
               <input
                 type="range"
                 min={1}
                 max={3}
                 step={0.01}
                 value={zoom}
                 onChange={(e) => setZoom(Number(e.target.value))}
                 style={{ width: '100%' }}
               />
             </label>
           </div>

           <div
             style={{
               display: 'flex',
               justifyContent: 'flex-end',
               gap: 10,
               flexWrap: 'wrap',
             }}
            > 
             <button
               type="button"
               className="app-btn app-btn-secondary"
               onClick={() => setIsCropping(false)}
               disabled={isUploadingCrop}
              >
               Annuler
             </button>

             <button
               type="button"
               className="app-btn app-btn-primary"
               onClick={confirmCrop}
               disabled={isUploadingCrop}
              >
               {isUploadingCrop ? 'Envoi…' : 'Valider le recadrage'}
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