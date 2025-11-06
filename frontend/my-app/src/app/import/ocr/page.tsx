'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function Page(){
  const [file,setFile]=useState<File|null>(null)
  const [status,setStatus]=useState('')
  const router=useRouter()
  async function run(){
    if(!file) return
    setStatus('OCR en cours…')
    const base = process.env.NEXT_PUBLIC_BACKEND_URL!
    const token = localStorage.getItem('sb:token') || sessionStorage.getItem('sb:token') || localStorage.getItem('token') || ''
    const form = new FormData(); form.append('file', file)
    const res = await fetch(`${base}/import/ocr`, { method:'POST', headers: token?{Authorization:`Bearer ${token}`}:{}, body: form })
    if(!res.ok){ setStatus('❌ '+await res.text()); return }
    const data = await res.json() // { draft }
    sessionStorage.setItem('recipeDraft', JSON.stringify(data.draft))     // ✅
    setStatus('✅ OCR OK'); router.push('/recipes/new?prefill=1')          // ✅
  }
  return (<main style={{padding:24}}>
    <h1>Importer par photo (OCR)</h1>
    <input type="file" accept="image/*" onChange={e=>setFile(e.target.files?.[0]||null)} />
    <button onClick={run} disabled={!file}>Lancer l’OCR</button>
    <p>{status}</p>
  </main>)
}
