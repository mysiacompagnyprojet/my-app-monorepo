# My App Monorepo

C'est quoi ce projet ?
Comment l'installer ?
Comment le lancer ?
Quelle est la stucture générale ?
Où trouver la doc ?

Ce dépôt contient :
- frontend
- backend
- mobile

COMMANDE POUR CHERCHER ET ARRETER TERMINAL EN ECOUTE:
lsof -i :4000 pour trouver quel .... est ecouter
kill -9 ... numero de l'ecoute à la place des points


1-
export OCR_JSON=$(curl -s -X POST "http://localhost:4000/import/ocr?debug=1" -H "Authorization: Bearer $TOKEN" -F "files=@/Users/shirley/Capture test import-ocr/RECETTE15/RECETTE15.jpg")

echo "$OCR_JSON" | jq '.ok, .draft.title'

2-extraire uniquement le draft en JSON compact
export DRAFT=$(echo "$OCR_JSON" | jq -c '.draft')

echo "$DRAFT" | jq '.title, (.ingredients|length), (.steps|length)'

3-Creer recipeDraft en DB 
export DRAFT_ROW=$(curl -s -X POST "http://localhost:4000/recipe-drafts" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" 
-d "{\"title\": $(echo "$DRAFT" | jq -c '.title'), \"imageUrl\": null, \"sourceUrl\": null }")

echo "$DRAFT_ROW" | jq

4-recuperer ID
export DRAFT_ID=$(echo "$DRAFT_ROW" | jq -r '.draft.id')

echo "DRAFT_ID=$DRAFT_ID"

5-enregistrer parsed dans ce draft
curl -s -X PATCH "http://localhost:4000/recipe-drafts/$DRAFT_ID/parsed" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" 
-d "$(jq '{ parsed: .draft }' /tmp/ocr.json)"

6-creer la recette depuis le draft
curl -i -X POST "http://localhost:4000/recipes/from-draft/$DRAFT_ID" -H "Authorization: Bearer $TOKEN"

7-verifier que la recette est bien enregistree
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:4000/recipes" | jq '.[0] // .recipes[0]'



SCRIPTS :
history -s    (pour enregistré une commande)
code ~/.bashrc  (pour ouvrir le fichier bash)
source ~/.bashrc  (pour recharger bash)

export SUPABASE_URL='https://gzaqmbzfapgouydmsnop.supabase.co'

export SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd6YXFtYnpmYXBnb3V5ZG1zbm9wIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzU3ODU3NCwiZXhwIjoyMDczMTU0NTc0fQ.rfKtoIslfY0LwFeOUJN9aC2GzD0yVYirdm6yIBQSFgs'

export EMAIL_TEST='shirley.valeton88@gmail.com'

export PASS_TEST='Ja?Va0906?'

curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" -H "apikey: $SUPABASE_ANON_KEY" -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL_TEST\",\"password\":\"$PASS_TEST\"}"

export TOKEN=
echo TOKEN

SCRIPT TEST IMPORT OCR :
curl -i -X POST "http://localhost:4000/import/ocr?debug=title" -H "Authorization: Bearer $TOKEN" -F "files=@C:/Users/hp/Desktop/Projet avec ChatGPT/Capture test import-ocr/RECETTE16/RECETTE161.PNG" -F "files=@C:/Users/hp/Desktop/Projet avec ChatGPT/Capture test import-ocr/RECETTE16/RECETTE162.PNG" -F "files=@C:/Users/hp/Desktop/Projet avec ChatGPT/Capture test import-ocr/RECETTE16/RECETTE163.PNG"


SCRIPT TEST IMPORT OCR MAC : 
curl -i -X POST "http://localhost:4000/import/ocr?debug=title" -H "Authorization: Bearer $TOKEN" -F "files=@/Users/shirley/Capture test import-ocr/RECETTE1/RECETTE1.jpeg"

curl -i -X POST "http://localhost:4000/import/ocr?debug=title" -H "Authorization: Bearer $TOKEN" -F "files=@/Users/shirley/Capture test import-ocr/RECETTE2/RECETTE2.jpeg"

curl -i -X POST "http://localhost:4000/import/ocr?debug=title" -H "Authorization: Bearer $TOKEN" -F "files=@/Users/shirley/Capture test import-ocr/RECETTE3/RECETTE3.jpeg"

curl -i -X POST "http://localhost:4000/import/ocr?debug=title" -H "Authorization: Bearer $TOKEN" -F "files=@/Users/shirley/Capture test import-ocr/RECETTE4/RECETTE4.jpeg"

curl -i -X POST "http://localhost:4000/import/ocr?debug=title" -H "Authorization: Bearer $TOKEN" -F "files=@/Users/shirley/Capture test import-ocr/RECETTE5/RECETTE5.jpeg"

curl -i -X POST "http://localhost:4000/import/ocr?debug=title" -H "Authorization: Bearer $TOKEN" -F "files=@/Users/shirley/Capture test import-ocr/RECETTE6/RECETTE6.jpeg"

curl -i -X POST "http://localhost:4000/import/ocr?debug=title" -H "Authorization: Bearer $TOKEN" -F "files=@/Users/shirley/Capture test import-ocr/RECETTE7/RECETTE7.jpeg"

curl -i -X POST "http://localhost:4000/import/ocr?debug=title" -H "Authorization: Bearer $TOKEN" -F "files=@/Users/shirley/Capture test import-ocr/RECETTE8/RECETTE8.jpeg"

curl -i -X POST "http://localhost:4000/import/ocr?debug=title" -H "Authorization: Bearer $TOKEN" -F "files=@/Users/shirley/Capture test import-ocr/RECETTE9/RECETTE9.jpeg"

curl -i -X POST "http://localhost:4000/import/ocr?debug=title" -H "Authorization: Bearer $TOKEN" -F "files=@/Users/shirley/Capture test import-ocr/RECETTE10/RECETTE10.jpg"

curl -i -X POST "http://localhost:4000/import/ocr?debug=title" -H "Authorization: Bearer $TOKEN" -F "files=@/Users/shirley/Capture test import-ocr/RECETTE11/RECETTE11.jpg"

curl -i -X POST "http://localhost:4000/import/ocr?debug=title" -H "Authorization: Bearer $TOKEN" -F "files=@/Users/shirley/Capture test import-ocr/RECETTE12/RECETTE12.jpg"

curl -i -X POST "http://localhost:4000/import/ocr?debug=title" -H "Authorization: Bearer $TOKEN" -F "files=@/Users/shirley/Capture test import-ocr/RECETTE14/RECETTE14.jpg"

curl -i -X POST "http://localhost:4000/import/ocr?debug=title" -H "Authorization: Bearer $TOKEN" -F "files=@/Users/shirley/Capture test import-ocr/RECETTE15/RECETTE15.jpg"

url -i -X POST "http://localhost:4000/import/ocr?debug=title" -H "Authorization: Bearer $TOKEN" -F "files=@/Users/shirley/Capture test import-ocr/RECETTE16/RECETTE161.png" -F "files=@/Users/shirley/Capture test import-ocr/RECETTE16/RECETTE162.png" -F "files=@/Users/shirley/Capture test import-ocr/RECETTE16/RECETTE163.png"

curl -i -X POST "http://localhost:4000/import/ocr?debug=title" -H "Authorization: Bearer $TOKEN" -F "files=@/Users/shirley/Capture test import-ocr/RECETTE17/RECETTE17.jpeg"

curl -i -X POST "http://localhost:4000/import/ocr?debug=title" -H "Authorization: Bearer $TOKEN" -F "files=@/Users/shirley/Capture test import-ocr/RECETTE18/RECETTE18.jpeg"

curl -i -X POST "http://localhost:4000/import/ocr?debug=title" -H "Authorization: Bearer $TOKEN" -F "files=@/Users/shirley/Capture test import-ocr/RECETTE19/RECETTE19.jpeg"

curl -i -X POST "http://localhost:4000/import/ocr?debug=title" -H "Authorization: Bearer $TOKEN" -F "files=@/Users/shirley/Capture test import-ocr/RECETTE20/RECETTE20.jpeg"
