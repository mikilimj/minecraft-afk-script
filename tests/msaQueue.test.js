const { MicrosoftAuthQueue } = require('../msaQueue');

function setup() {
  const active = [];
  const skipped = [];
  const q = new MicrosoftAuthQueue({
    broadcastActive: (p) => active.push(p),
    onSkip: (id) => { skipped.push(id); q.remove(id); },  // simulate stop() → remove()
  });
  return { q, active, skipped };
}

test('first request becomes active immediately', () => {
  const { q, active } = setup();
  q.request('a1', 'One', { verification_uri: 'u', user_code: 'C1' });
  expect(q.activeId).toBe('a1');
  expect(active.at(-1)).toMatchObject({ accountId: 'a1', name: 'One', user_code: 'C1' });
});

test('second request waits behind the first', () => {
  const { q } = setup();
  q.request('a1', 'One', { verification_uri: 'u', user_code: 'C1' });
  q.request('a2', 'Two', { verification_uri: 'u', user_code: 'C2' });
  expect(q.activeId).toBe('a1');
});

test('complete advances to the next queued account', () => {
  const { q, active } = setup();
  q.request('a1', 'One', { verification_uri: 'u', user_code: 'C1' });
  q.request('a2', 'Two', { verification_uri: 'u', user_code: 'C2' });
  q.complete('a1');
  expect(q.activeId).toBe('a2');
  expect(active.at(-1)).toMatchObject({ accountId: 'a2' });
});

test('skip stops the active account and advances', () => {
  const { q, skipped } = setup();
  q.request('a1', 'One', { verification_uri: 'u', user_code: 'C1' });
  q.request('a2', 'Two', { verification_uri: 'u', user_code: 'C2' });
  q.skip();
  expect(skipped).toEqual(['a1']);
  expect(q.activeId).toBe('a2');
});

test('queue empties to null active and broadcasts null', () => {
  const { q, active } = setup();
  q.request('a1', 'One', { verification_uri: 'u', user_code: 'C1' });
  q.complete('a1');
  expect(q.activeId).toBe(null);
  expect(active.at(-1)).toBe(null);
});

test('remove drops a waiting account without changing active', () => {
  const { q } = setup();
  q.request('a1', 'One', { verification_uri: 'u', user_code: 'C1' });
  q.request('a2', 'Two', { verification_uri: 'u', user_code: 'C2' });
  q.remove('a2');
  q.complete('a1');
  expect(q.activeId).toBe(null);
});

test('skip with 3 accounts advances to second, not third', () => {
  const { q, active } = setup();
  q.request('a1', 'One', { verification_uri: 'u', user_code: 'C1' });
  q.request('a2', 'Two', { verification_uri: 'u', user_code: 'C2' });
  q.request('a3', 'Three', { verification_uri: 'u', user_code: 'C3' });
  q.skip();   // skip A1
  expect(q.activeId).toBe('a2');
  q.skip();   // skip A2
  expect(q.activeId).toBe('a3');
});
