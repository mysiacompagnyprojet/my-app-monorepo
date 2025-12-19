import { describe, it, expect } from 'vitest';
import { parseRawLine, mergeIngredients } from '../src/utils/ingredients.js';

describe('parseRawLine', () => {
  it('parses "300 g spaghetti"', () => {
    const out = parseRawLine('300 g spaghetti');

    // On vérifie les champs importants
    expect(out.quantity).toBe(300);
    expect(out.unit).toBe('g');

    // Le code peut normaliser la casse ("Spaghetti" vs "spaghetti")
    expect(String(out.name).toLowerCase()).toBe('spaghetti');
  });
});

describe('mergeIngredients', () => {
  it('merge by name+unit', () => {
    const out = mergeIngredients([
      { name: 'Spaghetti', quantity: 300, unit: 'g' },
      { name: 'spaghetti', quantity: 200, unit: 'g' },
    ]);

    // On attend un seul ingrédient fusionné
    expect(out.length).toBe(1);

    // On vérifie les champs importants
    expect(String(out[0].name).toLowerCase()).toBe('spaghetti');
    expect(out[0].unit).toBe('g');
    expect(out[0].quantity).toBe(500);

    // Si ton code ajoute costRecipe, on l'accepte tant que c'est un nombre
    if ('costRecipe' in out[0]) {
      expect(typeof out[0].costRecipe).toBe('number');
    }
  });
});

