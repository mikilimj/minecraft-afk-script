const { resolveConfig, DEFAULT_GLOBAL, makeAccount } = require('../config');

test('inherits global section when override is false', () => {
  const global = { ...DEFAULT_GLOBAL, server: { host: 'g.host', port: 100, version: '1.20' } };
  const acc = makeAccount({ account: { username: 'bob', auth: 'offline', password: '' },
    overrides: { server: false }, server: { host: 'x', port: 1, version: 'z' } });
  const r = resolveConfig(global, acc);
  expect(r.host).toBe('g.host');
  expect(r.port).toBe(100);
  expect(r.version).toBe('1.20');
  expect(r.username).toBe('bob');
});

test('uses account section when override is true', () => {
  const global = { ...DEFAULT_GLOBAL, server: { host: 'g', port: 100, version: '1.20' } };
  const acc = makeAccount({ overrides: { server: true }, server: { host: 'own', port: 200, version: '1.21' } });
  const r = resolveConfig(global, acc);
  expect(r.host).toBe('own');
  expect(r.port).toBe(200);
});

test('account credentials always win regardless of overrides', () => {
  const acc = makeAccount({ account: { username: 'neo', auth: 'microsoft', password: 'pw' } });
  const r = resolveConfig(DEFAULT_GLOBAL, acc);
  expect(r.username).toBe('neo');
  expect(r.auth).toBe('microsoft');
  expect(r.password).toBe('pw');
});

test('global-only delays pass through', () => {
  const global = { ...DEFAULT_GLOBAL, lobbyDelay: 1234 };
  const r = resolveConfig(global, makeAccount({}));
  expect(r.lobbyDelay).toBe(1234);
});
