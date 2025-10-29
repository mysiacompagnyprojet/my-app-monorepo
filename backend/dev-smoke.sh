#!/usr/bin/env bash
set -euo pipefail

# --- Config requise ---
: "${SUPABASE_URL:?Missing SUPABASE_URL}"
: "${SUPABASE_ANON_KEY:?Missing SUPABASE_ANON_KEY}"
: "${EMAIL_TEST:?Missing EMAIL_TEST}"
: "${PASS_TEST:?Missing PASS_TEST}"
API="http://127.0.0.1:4000"

echo "1) Récup token Supabase…"
TOKEN=$(curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL_TEST\",\"password\":\"$PASS_TEST\"}" | jq -r .access_token)
test -n "$TOKEN"

echo "2) /auth/sync…"
curl -s -X POST "$API/auth/sync" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"ping": true}' | jq .

echo "3) POST /recipes…"
PAY=./payload-recipe.json
if [ ! -f "$PAY" ]; then
  cat > "$PAY" <<'JSON'
{
  "title": "Purée maison",
  "servings": 2,
  "steps": ["Cuire les pommes de terre", "Écraser", "Mélanger"],
  "imageUrl": "",
  "notes": "",
  "ingredients": [
    { "name": "Pomme de terre", "quantity": 500, "unit": "g" },
    { "name": "Oeuf", "quantity": 2, "unit": "pièces" },
    { "name": "Huile d'olive", "quantity": 10, "unit": "ml" }
  ]
}
JSON
fi
curl -s -X POST "$API/recipes" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json; charset=utf-8" \
  --data-binary @"$PAY" | jq .

echo "4) GET /recipes -> récup 2 IDs…"
IDS=$(curl -s "$API/recipes" -H "Authorization: Bearer $TOKEN" | \
  jq -r '.recipes[:2] | map(.id) | {recipeIds: .}')
echo "$IDS" | jq .

echo "5) POST /shopping-list…"
curl -s -X POST "$API/shopping-list" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d "$IDS" | jq .

echo "✅ Smoke test terminé."
