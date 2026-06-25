const { normalizeConfig, DEFAULT_GLOBAL } = require('../config');

test('migrates a legacy flat config into global, empty accounts', () => {
  const out = normalizeConfig({ host: 'old.host', port: 5, antiAfk: { interval: 9999 } });
  expect(out.global.server.host).toBe('old.host');
  expect(out.global.server.port).toBe(5);
  expect(out.global.antiAfk.interval).toBe(9999);
  expect(out.accounts).toEqual([]);
});

test('passes through an already-new-shape config and fills account defaults', () => {
  const out = normalizeConfig({ global: { ...DEFAULT_GLOBAL },
    accounts: [{ name: 'A', account: { username: 'u', auth: 'offline', password: '' } }] });
  expect(out.accounts).toHaveLength(1);
  expect(out.accounts[0].id).toBeTruthy();
  expect(out.accounts[0].enabled).toBe(true);
  expect(out.accounts[0].overrides).toMatchObject({ server: false, position: false, antiAfk: false, reconnect: false });
});
