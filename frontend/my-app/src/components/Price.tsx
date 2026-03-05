//frontend/my-app/components/Price.tsx

type PriceProps = {
 value: number | null | undefined
 blur?: boolean
}

export default function Price({ value, blur = false }: PriceProps) {
 const n =
   typeof value === 'number'
     ? value
     : typeof value === 'string'
     ? Number(String(value).replace(',', '.'))
     : NaN

 if (!Number.isFinite(n)) return <span>—</span>

 const formatted = n.toFixed(2).replace('.', ',')

 if (blur) {
   return (
     <span style={{ filter: 'blur(5px)', userSelect: 'none' }}>
       {formatted} €
     </span>
   )
 }

 return <span>{formatted} €</span>
}