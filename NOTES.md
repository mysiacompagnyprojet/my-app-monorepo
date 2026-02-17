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

au 13/02
/* micro grain */
    repeating-linear-gradient(0deg,
            rgba(0, 0, 0, var(--paper-fibers)) 0px,
            rgba(0, 0, 0, var(--paper-fibers)) 1px,
            rgba(255,255,255, calc(var(--paper-fibers) * 0.9)) 2px,
            rgba(255,255,255, calc(var(--paper-fibers) * 0.9)) 3px
    ),
    repeating-linear-gradient(90deg,
            rgba(0,0,0, var(--paper-grain)) 0px,
            rgba(0,0,0, var(--paper-grain)) 1px,
            rgba(255,255,255, calc(var(--paper-grain) * 0.9)) 2px,
            rgba(255,255,255, calc(var(--paper-grain) * 0.9)) 3px
    );


    repeating-linear-gradient(0deg,
            rgba(var(--grain-brown), var(--paper-fibers)) 0px,
            rgba(var(--grain-dark), var(--paper-fibers)) 1px,
            rgba(var(--grain-warm), calc(var(--paper-fibers) * 0.9)) 2px,
            rgba(var(--grain-warm), calc(var(--paper-fibers) * 0.9)) 3px
    ),
    repeating-linear-gradient(90deg,
            rgba(var(--grain-warm), var(--paper-grain)) 0px,
            rgba(var(--grain-warm), var(--paper-grain)) 1px,
            rgba(var(--grain-light), calc(var(--paper-grain) * 0.9)) 2px,
            rgba(var(--grain-light), calc(var(--paper-grain) * 0.9)) 3px
    );


    au 13/02 18:38

    :root {
    --bg: #F7F4EF; /* Beige chaud*/
    --text: #2E2220; /* Anthracite doux */
    --muted: rgba(46,34,32,0.65);

    --card: rgba(255,255,255,0.78);/* Cartes */
    --card-2: rgba(255,255,255,0.64);
    --border: rgba(230,220,210,0.85);/* Séparateurs (beige plus foncé) */

    --primary: #7B442E;/* Brun chaud (CTA / titres / actifs) */
    --primary-2: #6B3A26;/* Variante hover */

    --sage: #68650A;/* Vert sauge (succès) */

    --input: rgba(255,255,255,0.82);

    /* vieux papiers */
    --paper-warm: rgba(214,191,162,0.22);
    --paper-vignette: rgba(0,0,0,0.06);
    --paper-stain: 0.2;/* intensité des grosses tache 0.2 */
    --paper-grain: 0.5; /* intensité des grains à l'horizontal 0.2 */
    --paper-fibers: 0.1;/* intensité des grains à la vertical 0.07*/
    /* couleur grains */
    --grain-brown: 120, 72, 44; /* brun chaud  120, 72, 44 -  90, 50, 30*/
    --grain-warm: 218, 207, 204; /* jaune/orange 214, 176, 120 - */
    --grain-light: 218, 207, 204;/* crème 246, 236, 214 */
    --grain-black: 0, 0, 0; /* noir */
}
html, body {
    height: 100%;
    /*background: var(--bg);
    color: var(--text);*/
}
body {
    /*color: var(--text);
    background: var(--bg);*/
    background: transparent;
}

html::before {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 0;

    background:
    /*linear-gradient(270deg, #F7F4EF 30%, #F2E9DE 55%, #EFE3D5 100%);*/
    radial-gradient(1200px 900px at 18% 12%, rgba(255,255,255,0.55), rgba(255,255,255,0) 60%),
    radial-gradient(1100px 900px at 55% 110%, var(--paper-warm), rgba(255,255,255,0) 60%),
    radial-gradient(120% 90% at 50% 10%, rgba(0,0,0,0) 55%, var(--paper-vignette) 100%);

    opacity: 1;
}

html::after {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 1;

    background:
    /* vignette légére effet papier */
    /*radial-gradient(120% 90% at 50% 10%, rgba(0,0,0,0) 55%, rgba(50, 30, 15, 0.10) 100%),*/
        
    /* taches */
    radial-gradient(260px 200px at 18% 22%,
        rgba(120,85,55, var(--paper-stain)) 0%,
        rgba(120,85,55, 0) 72%
    ),
    radial-gradient(360px 260px at 78% 35%,
        rgba(90,65,44, calc(var(--paper-stain) * 0.8)) 0%,
        rgba(90,65,44, 0) 74%
    ),
    radial-gradient(520px 360px at 55% 88%,
        rgba(70,50,35, calc(var(--paper-stain) * 0.6)) 0%,
        rgba(70,50,35, 0) 78%
    ),

    /* micro grain */
       repeating-linear-gradient(0deg,
            rgba(var(--grain-brown), var(--paper-fibers)) 0px,
            rgba(var(--grain-warm), var(--paper-fibers)) 1px,
            rgba(255,255,255, calc(var(--paper-fibers) * 0.9)) 2px,
            rgba(255,255,255, calc(var(--paper-fibers) * 0.9)) 3px
    ),
    repeating-linear-gradient(90deg,
            rgba(var(--grain-brown), var(--paper-fibers)) 0px,
            rgba(var(--grain-warm), var(--paper-fibers)) 1px,
            rgba(255,255,255, calc(var(--paper-grain) * 0.9)) 2px,
            rgba(255,255,255, calc(var(--paper-grain) * 0.9)) 3px
    );
    opacity: 0.75;
    mix-blend-mode: normal; /*normal;*/    
}

<h1
         className="recipe-title editable-title"
         contentEditable
         suppressContentEditableWarning
         onInput={(e) => {
           setTitle(e.currentTarget.textContent || '')
         }}
         onBlur={(e) => {
           setTitle(e.currentTarget.textContent?.trim() || '')
         }}
         >
         {title?.trim() || 'Titre de la recette'}
       </h1>
