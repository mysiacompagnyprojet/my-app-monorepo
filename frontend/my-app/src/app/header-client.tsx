'use client'

import Image from 'next/image'
import { usePathname } from 'next/navigation'

export default function HeaderClient() {
const pathname = usePathname()
const isNewRecipe = pathname?.startsWith('/recipes/new')

return (
<header
className={`app-card app-container app-header ${
isNewRecipe ? 'app-header--compact' : ''
}`}
>
<nav className="flex items-center gap-3">
<a href="/" className="app-brand flex items-center gap-[4px]">
<Image
src="/brand/logo.png"
alt="MySia logo"
width={28}
height={28}
priority
/>
<span>MySia.app</span>
</a>

{!isNewRecipe && (
<>
<a href="/recipes">📜 Mes recettes</a>
<a href="/import/ocr">📷 Import OCR</a>
<a href="/recipes/new">➕ Nouvelle recette</a>
</>
)}
</nav>
</header>
)
}