NOTES GENERALES/INFO :
26/01 -- 
  TitleUtils :  les fonctions du fichier sont bien déclaré que dans ce fichier, les fonctions importées dans le fichier sont utilisées.
  ocrTitle : les fonctions du fichier sont déclaré que dans celui-ci, les fonctions utilisées sont bien importées.




backend/src/routes/import-ocr.js
  1 - remplacer par ci dessous le 20/01 - if (/\b(g|gr|kg|ml|cl|dl|l)\b/.test(t)) return true;

ancien btn + root dans global.css :

:root {
/* Fond & texte */
--bg: #F6F1EB; /* Beige chaud */
--text: #2B2B2B; /* Anthracite doux */

/* Surfaces */
--card: #FFFFFF; /* Cartes */
--border: #E6DCD2; /* Séparateurs (beige plus foncé) */

/* Accents */
--primary: #8B6A4F; /* Brun chaud (CTA / titres / actifs) */
--primary-2: #7A5C43; /* Variante hover */
--success: #A8B8A1; /* Vert sauge (succès) */
}
.app-btn-primary {
background: var(--primary);
color: white;
border-radius: 10px;
padding: 10px 14px;
font-weight: 700;
transition: background 150ms ease;
}
.app-btn-primary:hover {
background: var(--primary-2);
}
.app-btn-primary:disabled {
opacity: 0.6;
cursor: not-allowed;
}

.app-btn-secondary {
background: transparent;
color: var(--text);
border: 1px solid var(--border);
border-radius: 10px;
padding: 10px 14px;
font-weight: 700;
transition: background 150ms ease;
}
.app-btn-secondary:hover {
background: rgba(230, 220, 210, 0.55);
}  



body::before {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 0;

    /*grain leger*/
    background:
        /*radial-gradient(120% 90% at 50% 10%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.06) 100%),*/
        repeating-linear-gradient(0deg,
            rgba(0,0,0,0.010) 0px,
            rgba(0,0,0,0.010) 1px,
            rgba(255,255,255,0.012) 2px,
            rgba(255,255,255,0.012) 3px,
        );
    opacity: 0.22;
    mix-blend-mode: normal;    
}

body {
    color: var(--text);
    background: 
        radial-gradient(1200px 700px at 18% 12% rgba(255,255,255,0.70), rgba(255,255,255,0) 60%),
        radial-gradient(900px 650px at 82% 28% rgba(255,244,228,0.55), rgba(255,244,228,0) 58%),
        radial-gradient(1100px 900px at 50% 110% rgba(214,191,162,0.22), rgba(214,191,162,0) 55%),
        linear-gradient(180deg, #F6F1EB 0%, #F2E9DE 55%, #EFE3D5 100%);
}

html::after {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 1;

    background:
    /* vignette légére effet papier */
    radial-gradient(120% 90% at 50% 10%, rgba(0,0,0,0) 55%, rgba(80,55,35,0.12) 100%),
        
    /* taches */
    radial-gradient(260px 200px at 18% 22%,
        rgba(140,95,60,0.10)
        rgba(140,95,60,0) 70%
    ),
    radial-gradient(320px 240px at 78% 35%,
        rgba(120,85,55,0.08),
        rgba(120,85,55,0) 72%
    ),
    radial-gradient(420px 320px at 55% 88%,
        rgba(120,85,55,0.06),
        rgba(120,85,55,0) 75%
    ),

    /* micro grain */
    repeating-linear-gradient(0deg,
            rgba(0,0,0,0.050) 20px,
            rgba(0,0,0,0.050) 20px,
            rgba(255,255,255,0.050) 20px,
            rgba(255,255,255,0.050) 20px,
    ),
    repeating-linear-gradient(90deg,
            rgba(0,0,0,0.050) 0px,
            rgba(0,0,0,0.050) 1px,
            rgba(255,255,255,0.50) 20px,
            rgba(255,255,255,0.50) 20px,
    );

    opacity: 0.55;
    mix-blend-mode: multiply; /*normal;*/    
}