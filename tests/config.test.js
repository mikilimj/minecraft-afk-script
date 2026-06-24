const { normalizeLoadedConfig } = require('../server');

describe('normalizeLoadedConfig', () => {
  test('fills all missing fields with defaults', () => {
    const r = normalizeLoadedConfig({});
    expect(r.host).toBe('');
    expect(r.port).toBe(25565);
    expect(r.version).toBe('1.21.4');
    expect(r.auth).toBe('offline');
    expect(r.password).toBe('');
    expect(r.position.enabled).toBe(false);
    expect(r.position.y).toBe(64);
    expect(r.antiAfk.enabled).toBe(true);
    expect(r.antiAfk.interval).toBe(20000);
    expect(r.reconnect.enabled).toBe(true);
    expect(r.reconnect.delaySeconds).toBe(30);
    expect(r.lobbyDelay).toBe(2000);
  });

  test('preserves provided values including reconnect', () => {
    const r = normalizeLoadedConfig({
      host: 'play.example.com',
      port: 19132,
      username: 'TestBot',
      auth: 'microsoft',
      position: { enabled: true, x: 10, y: 70, z: -5, yaw: 90, pitch: 0 },
      antiAfk: { enabled: false, interval: 5000 },
      reconnect: { enabled: false, delaySeconds: 60 },
    });
    expect(r.host).toBe('play.example.com');
    expect(r.port).toBe(19132);
    expect(r.position.enabled).toBe(true);
    expect(r.position.x).toBe(10);
    expect(r.antiAfk.enabled).toBe(false);
    expect(r.antiAfk.interval).toBe(5000);
    expect(r.reconnect.enabled).toBe(false);
    expect(r.reconnect.delaySeconds).toBe(60);
  });

  test('handles legacy Polish field names', () => {
    const r = normalizeLoadedConfig({
      haslo: 'secret',
      pozycja: { wlaczone: true, x: 1, y: 2, z: 3, yaw: 0, pitch: 0 },
      antiAFK: { wlaczone: false, interwal: 10000 },
      opoznienieLobby: 3000,
      opoznienieRuchu: 4000,
    });
    expect(r.password).toBe('secret');
    expect(r.position.enabled).toBe(true);
    expect(r.position.x).toBe(1);
    expect(r.antiAfk.enabled).toBe(false);
    expect(r.antiAfk.interval).toBe(10000);
    expect(r.lobbyDelay).toBe(3000);
    expect(r.movementDelay).toBe(4000);
  });

  test('reconnect defaults to { enabled: true, delaySeconds: 30 } when absent', () => {
    const r = normalizeLoadedConfig({ host: 'mc.example.com' });
    expect(r.reconnect).toEqual({ enabled: true, delaySeconds: 30 });
  });
});
