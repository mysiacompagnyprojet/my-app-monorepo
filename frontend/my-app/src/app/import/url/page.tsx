'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from 'src/lib/api' // garde tes en-têtes + token
type RecipeDraft = { title:string; servings:number; imageUrl:string|null; notes?:string|null; steps:string[]; ingredients:any[] }
export default function Page(){
  const [url,setUrl]=useState(''); const [status,setStatus]=useState('');
  const router=useRouter();
  async function run(){
    try{
      setStatus('Import en cours…');
      const res = await apiFetch<{draft:RecipeDraft}>('/import/url',{method:'POST',body:JSON.stringify({url})});
      sessionStorage.setItem('recipeDraft', JSON.stringify(res.draft)); // ✅
      setStatus('✅ Import OK');
      router.push('/recipes/new?prefill=1');                           // ✅
    }catch(e:any){ setStatus('❌ '+(e.message||'Erreur')); }
  }
  return (<main style={{padding:24}}>
    <h1>Importer par URL</h1>
    <input placeholder="https://..." value={url} onChange={e=>setUrl(e.target.value)} />
    <button onClick={run} disabled={!url}>Importer</button>
    <p>{status}</p>
  </main>);
}
