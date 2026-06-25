// tests/botCommands.test.js
const { BotRunner } = require('../botRunner');

function makeRunner() {
  return new BotRunner({
    accountId: 'a', name: 'A', config: {},
    profilesFolder: '/tmp/x', log: () => {}, setStatus: () => {},
  });
}

function fakeBot() {
  return {
    chat: jest.fn(),
    setControlState: jest.fn(),
    attack: jest.fn(),
    swingArm: jest.fn(),
    activateItem: jest.fn(),
    lookAt: jest.fn(),
    nearestEntity: jest.fn(() => ({ position: { offset: () => ({}) }, height: 1 })),
  };
}

test('chat forwards to bot.chat', () => {
  const r = makeRunner(); r.bot = fakeBot();
  r.command('chat', { text: '/hi' });
  expect(r.bot.chat).toHaveBeenCalledWith('/hi');
});

test('control sets and clearControls releases all keys', () => {
  const r = makeRunner(); r.bot = fakeBot();
  r.command('control', { key: 'forward', state: true });
  expect(r.bot.setControlState).toHaveBeenCalledWith('forward', true);
  r.command('clearControls', {});
  expect(r.bot.setControlState).toHaveBeenCalledWith('forward', false);
  expect(r.bot.setControlState).toHaveBeenCalledWith('jump', false);
});

test('attack attacks nearest entity', () => {
  const r = makeRunner(); r.bot = fakeBot();
  r.command('attack', {});
  expect(r.bot.attack).toHaveBeenCalled();
});

test('unknown action throws', () => {
  const r = makeRunner(); r.bot = fakeBot();
  expect(() => r.command('frobnicate', {})).toThrow(/unknown action/);
});

test('autoclick left mode swings on interval, stop clears it', () => {
  jest.useFakeTimers();
  const r = makeRunner(); r.bot = fakeBot();
  r.command('autoclick', { on: true, mode: 'left', intervalMs: 100 });
  jest.advanceTimersByTime(250);
  expect(r.bot.swingArm.mock.calls.length).toBe(2);
  r.command('autoclick', { on: false });
  jest.advanceTimersByTime(300);
  expect(r.bot.swingArm.mock.calls.length).toBe(2);
  jest.useRealTimers();
});

test('command is a no-op when bot is absent', () => {
  const r = makeRunner();   // no r.bot
  expect(() => r.command('chat', { text: 'x' })).not.toThrow();
});
