import { describe, it, expect } from 'vitest';
import { parseRawLine, mergeIngredients } from '../src/utils/ingredients.js';

describe('parseRawLine', () => {
  it('parses "300 g spaghetti"', () => {
    expect(parseRawLine('300 g spaghetti')).toEqual({ name: 'spaghetti', quantity: 300, unit: 'g' });
  });
});

describe('mergeIngredients', () => {
  it('merge by name+unit', () => {
    const out = mergeIngredients([
      { name: 'Spaghetti', quantity: 300, unit: 'g' },
      { name: 'spaghetti', quantity: 200, unit: 'g' }
    ]);
    expect(out).toContainEqual({ name: 'Spaghetti', unit: 'g', quantity: 500 });
  });
});
