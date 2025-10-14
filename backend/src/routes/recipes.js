// backend/src/routes/recipes.js
const express = require('express');
const { prisma } = require('../lib/prisma');
const { mergeIngredients } = require('../utils/ingredients');

const router = express.Router();

function needAuth(req, res, next) {
  if (!req.user?.userId) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// GET /recipes
router.get('/', needAuth, async (req, res) => {
  const { userId } = req.user;
  const recipes = await prisma.recipe.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      servings: true,
      imageUrl: true,
      createdAt: true,
      ingredients: { select: { name: true, quantity: true, unit: true } },
    },
  });
  res.json({ ok: true, recipes });
});

// POST /recipes/changement ici
// POST /recipes  — crée une recette
router.post('/', needAuth, async (req, res) => {
  try {
    // 1) Normalisation + lecture sûre
    const body = req.body ?? {};
    let { title, servings, steps, imageUrl, notes } = body;

    // Accepte steps stringifié (cas fréquent quand l'appel envoie du texte)
    if (typeof steps === 'string') {
      try { steps = JSON.parse(steps); } catch {}
    }

    // 2) Validations claires (messages précis)
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ ok: false, error: "Champ 'title' manquant ou invalide" });
    }

    // servings: nombre >= 1 (par défaut 1 si absent)
    if (servings == null) servings = 1;
    servings = Number(servings);
    if (!Number.isFinite(servings) || servings < 1) {
      return res.status(400).json({ ok: false, error: "Champ 'servings' doit être un nombre >= 1" });
    }

    // steps: tableau (par défaut tableau vide)
    if (steps == null) steps = [];
    if (!Array.isArray(steps)) {
      return res.status(400).json({ ok: false, error: "Champ 'steps' doit être un tableau" });
    }

    // imageUrl/notes optionnels
    if (imageUrl && typeof imageUrl === 'object' && imageUrl.url) {
      imageUrl = imageUrl.url; // au cas où un import te donne { url: "..."}
    }
    if (notes == null) notes = '';

    // 3) Création en base
    const recipe = await prisma.recipe.create({
      data: {
        userId: req.user.userId,  // injecté par supabaseAuth / needAuth
        title,
        servings,
        steps,         // jsonb
        imageUrl: imageUrl || null,
        notes
      },
      select: { id: true, title: true, servings: true, steps: true, imageUrl: true, notes: true, createdAt: true }
    });

    return res.status(201).json({ ok: true, recipe });
  } catch (e) {
    console.error('POST /recipes error:', e);
    return res.status(500).json({ ok: false, error: 'internal error', message: e?.message });
  }
});
//ici
module.exports = router;
