//frontend/my-app/src/types/recipe.ts
export type IngredientLine = {
name: string;
quantity?: number;
unit?: string;
quantityRaw?: string;

// ✅ Airtable pricing (V1)
price?: { eurPer: number; perUnit: string } | null;
costEur?: number | null;
priceMatched?: boolean;
airtableId?: string | null;
};

export type OcrDraft = {
title: string;
servings: number;
imageUrl: string | null;
notes: string;
ingredients: IngredientLine[];
steps: string[];
trash?: string[];

// ✅ total calculé backend
totalCostEur?: number | null;
};

