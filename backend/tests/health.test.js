import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/index.js'; // si export; sinon ping manuel

it('GET /health -> {status:"ok"}', async () => {
  const res = await request('http://127.0.0.1:4000').get('/health');
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('ok');
});
