// frontend/my-app/src/types/demo.ts

export type DemoIngredientLine = {
  name: string
  quantity: number
  unit: string
  quantityRaw?: string
  priceMatched?: boolean
  pricing: {
    visible: boolean
    locked: boolean
    costEur?: number | null
  }
}

export type DemoOcrSuccessResponse = {
  ok: true
  demo: true
  trial: {
    used: number
    limit: number
    remaining: number
  }
  recipe: {
    title: string
    servings: number
    imageUrl: string | null
    notes: string
    ingredients: DemoIngredientLine[]
    steps: string[]
  }
  totals: {
    recipe: { locked: true }
    courses: { locked: true }
  }
  budgetBadge: { locked: true }
  economySuggestion: { locked: true }
  actions: {
    canSave: false
    requiresAccount: true
    createAccountUrl: string
  }
}

export type DemoOcrErrorResponse = {
  ok: false
  error: string
  message?: string
}

export type DemoOcrResponse = DemoOcrSuccessResponse | DemoOcrErrorResponse