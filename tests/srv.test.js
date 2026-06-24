const { resolveServerAddress } = require('../server');

function srvError(code) {
  const err = new Error(`queryConfig ${code}`);
  err.code = code;
  return err;
}

describe('resolveServerAddress', () => {
  test('returns host:port unchanged when host is an IPv4 address (no SRV lookup)', async () => {
    const resolveSrv = jest.fn();
    const r = await resolveServerAddress('83.168.106.230', 25789, { resolveSrv });
    expect(r).toEqual({ host: '83.168.106.230', port: 25789 });
    expect(resolveSrv).not.toHaveBeenCalled();
  });

  test('returns SRV target name and port when an SRV record exists', async () => {
    const resolveSrv = jest.fn().mockResolvedValue([
      { name: 'nl21.icehost.pl', port: 25789, priority: 0, weight: 5 },
    ]);
    const r = await resolveServerAddress('starsmc.pl', 25565, { resolveSrv });
    expect(r).toEqual({ host: 'nl21.icehost.pl', port: 25789 });
    expect(resolveSrv).toHaveBeenCalledWith('_minecraft._tcp.starsmc.pl');
  });

  test('falls back to literal host:port when domain has no SRV record (ENODATA)', async () => {
    const resolveSrv = jest.fn().mockRejectedValue(srvError('ENODATA'));
    const r = await resolveServerAddress('play.example.com', 25565, { resolveSrv });
    expect(r).toEqual({ host: 'play.example.com', port: 25565 });
    expect(resolveSrv).toHaveBeenCalledTimes(1);
  });

  test('falls back to literal host:port when SRV name does not exist (ENOTFOUND)', async () => {
    const resolveSrv = jest.fn().mockRejectedValue(srvError('ENOTFOUND'));
    const r = await resolveServerAddress('play.example.com', 25565, { resolveSrv });
    expect(r).toEqual({ host: 'play.example.com', port: 25565 });
    expect(resolveSrv).toHaveBeenCalledTimes(1);
  });

  test('falls back to literal host:port when SRV answer is empty', async () => {
    const resolveSrv = jest.fn().mockResolvedValue([]);
    const r = await resolveServerAddress('play.example.com', 25565, { resolveSrv });
    expect(r).toEqual({ host: 'play.example.com', port: 25565 });
  });

  test('retries on transient resolver failure then returns the SRV target', async () => {
    const resolveSrv = jest
      .fn()
      .mockRejectedValueOnce(srvError('ESERVFAIL'))
      .mockRejectedValueOnce(srvError('ETIMEOUT'))
      .mockResolvedValue([{ name: 'nl21.icehost.pl', port: 25789 }]);
    const r = await resolveServerAddress('starsmc.pl', 25565, {
      resolveSrv,
      retries: 3,
      retryDelayMs: 0,
    });
    expect(r).toEqual({ host: 'nl21.icehost.pl', port: 25789 });
    expect(resolveSrv).toHaveBeenCalledTimes(3);
  });

  test('gives up after exhausting retries and returns literal host:port', async () => {
    const resolveSrv = jest.fn().mockRejectedValue(srvError('ESERVFAIL'));
    const r = await resolveServerAddress('starsmc.pl', 25565, {
      resolveSrv,
      retries: 2,
      retryDelayMs: 0,
    });
    expect(r).toEqual({ host: 'starsmc.pl', port: 25565 });
    // initial attempt + 2 retries
    expect(resolveSrv).toHaveBeenCalledTimes(3);
  });
});
