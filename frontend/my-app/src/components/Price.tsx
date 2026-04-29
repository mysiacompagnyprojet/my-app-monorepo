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

  if (n > 0 && n < 0.01) {
    if (blur) {
      return (
        <span style={{ filter: 'blur(10px)', userSelect: 'none' }}>
          {'< 0,01 €'}
        </span>
      )
    }

    return <span>{'< 0,01 €'}</span>
  }

  const formatted = n.toFixed(2).replace('.', ',')

  if (blur) {
    return (
      <span style={{ filter: 'blur(0px)', userSelect: 'none' }}>
        {formatted} €
      </span>
    )
  }

  return <span>{formatted} €</span>
}