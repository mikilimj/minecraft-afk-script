const request = require('supertest');
const { app } = require('../server');

describe('GET /api/config', () => {
  test('returns 200 with host, port, reconnect fields', async () => {
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('host');
    expect(res.body).toHaveProperty('port');
    expect(res.body.reconnect).toHaveProperty('delaySeconds');
    expect(res.body.reconnect).toHaveProperty('enabled');
  });
});

describe('POST /api/config', () => {
  const validCfg = {
    host: 'mc.test.com', port: 25565, version: '1.21.4',
    username: 'Bot', auth: 'offline', password: '',
    position: { enabled: false, x: 0, y: 64, z: 0, yaw: 0, pitch: 0 },
    antiAfk: { enabled: true, interval: 20000 },
    reconnect: { enabled: true, delaySeconds: 30 },
    lobbyDelay: 2000, movementDelay: 3000, clickDelay: 700,
  };

  test('accepts valid config and returns ok:true', async () => {
    const res = await request(app).post('/api/config').send(validCfg);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('rejects port 99999', async () => {
    const res = await request(app)
      .post('/api/config')
      .send({ ...validCfg, port: 99999 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/port/);
  });

  test('rejects port 0', async () => {
    const res = await request(app)
      .post('/api/config')
      .send({ ...validCfg, port: 0 });
    expect(res.status).toBe(400);
  });

  test('rejects reconnect.delaySeconds 9999', async () => {
    const res = await request(app)
      .post('/api/config')
      .send({ ...validCfg, reconnect: { enabled: true, delaySeconds: 9999 } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/delaySeconds/);
  });

  test('rejects reconnect.delaySeconds 0', async () => {
    const res = await request(app)
      .post('/api/config')
      .send({ ...validCfg, reconnect: { enabled: true, delaySeconds: 0 } });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/bot/stop', () => {
  test('always returns ok:true', async () => {
    const res = await request(app).post('/api/bot/stop');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
