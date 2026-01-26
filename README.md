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

