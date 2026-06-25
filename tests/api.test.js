const os = require('os');
const fs = require('fs');
const path = require('path');
process.env.AFK_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-test-'));
const request = require('supertest');
const { app } = require('../server');

test('GET /api/config returns {global, accounts}', async () => {
  const res = await request(app).get('/api/config');
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('global');
  expect(Array.isArray(res.body.accounts)).toBe(true);
});

test('POST /api/accounts adds an account with an id', async () => {
  const res = await request(app).post('/api/accounts')
    .send({ name: 'Bot1', account: { username: 'u', auth: 'offline', password: '' } });
  expect(res.status).toBe(200);
  expect(res.body.account.id).toBeTruthy();
  const list = await request(app).get('/api/config');
  expect(list.body.accounts.some((a) => a.id === res.body.account.id)).toBe(true);
});

test('DELETE /api/accounts/:id removes it', async () => {
  const add = await request(app).post('/api/accounts').send({ name: 'Temp' });
  const id = add.body.account.id;
  const del = await request(app).delete(`/api/accounts/${id}`);
  expect(del.status).toBe(200);
  const list = await request(app).get('/api/config');
  expect(list.body.accounts.some((a) => a.id === id)).toBe(false);
});

test('POST /api/config rejects bad port in global', async () => {
  const res = await request(app).post('/api/config')
    .send({ global: { server: { host: 'h', port: 99999, version: '1.21' } }, accounts: [] });
  expect(res.status).toBe(400);
});

test('start/stop unknown account id returns ok:false', async () => {
  const res = await request(app).post('/api/bot/start/nope');
  expect(res.body.ok).toBe(false);
});
