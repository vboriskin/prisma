'use strict';
/* ============================================================
   tests/unit/event-bus.test.js — AUDIT_HOLISTIC P3
   --
   Покрывает app/eventBus.js: on / off / emit / once / clear /
   payload-passing / handler-isolation / unsubscribe-during-emit.
   ============================================================ */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let _EventBus;
async function freshBus() {
  // Минимальный window stub (модуль вешает window.EventBus при импорте).
  if (typeof globalThis.window === 'undefined') globalThis.window = {};
  if (!_EventBus) {
    const m = await import('../../app/eventBus.js');
    _EventBus = m.EventBus;
  }
  _EventBus.clear();
  return _EventBus;
}

describe('EventBus.on / emit', () => {
  test('подписчик получает payload', async () => {
    const EventBus = await freshBus();
    let received = null;
    EventBus.on('hello', p => { received = p; });
    EventBus.emit('hello', { a: 1 });
    assert.deepEqual(received, { a: 1 });
  });

  test('emit без подписчиков — no-op', async () => {
    const EventBus = await freshBus();
    EventBus.emit('orphan'); // не должно бросать
    assert.equal(EventBus._listenerCount('orphan'), 0);
  });

  test('on validates аргументы', async () => {
    const EventBus = await freshBus();
    assert.throws(() => EventBus.on('', () => {}),     /non-empty string/);
    assert.throws(() => EventBus.on('x', null),        /must be function/);
    assert.throws(() => EventBus.on('x', 'not-a-fn'),  /must be function/);
  });

  test('один и тот же handler регистрируется один раз (Set semantics)', async () => {
    const EventBus = await freshBus();
    const fn = () => {};
    EventBus.on('e', fn);
    EventBus.on('e', fn);
    assert.equal(EventBus._listenerCount('e'), 1);
  });
});

describe('EventBus.off / unsubscribe', () => {
  test('on() возвращает unsubscribe-функцию', async () => {
    const EventBus = await freshBus();
    let count = 0;
    const unsub = EventBus.on('tick', () => { count++; });
    EventBus.emit('tick');
    unsub();
    EventBus.emit('tick');
    assert.equal(count, 1);
  });

  test('off убирает handler', async () => {
    const EventBus = await freshBus();
    let count = 0;
    const fn = () => { count++; };
    EventBus.on('e', fn);
    EventBus.off('e', fn);
    EventBus.emit('e');
    assert.equal(count, 0);
    assert.equal(EventBus._listenerCount('e'), 0);
  });

  test('off для несуществующего event — no-op', async () => {
    const EventBus = await freshBus();
    EventBus.off('nope', () => {}); // не должно бросать
    assert.equal(EventBus._listenerCount('nope'), 0);
  });
});

describe('EventBus.once', () => {
  test('handler вызывается ровно раз', async () => {
    const EventBus = await freshBus();
    let count = 0;
    EventBus.once('boom', () => { count++; });
    EventBus.emit('boom');
    EventBus.emit('boom');
    EventBus.emit('boom');
    assert.equal(count, 1);
    assert.equal(EventBus._listenerCount('boom'), 0);
  });

  test('once отписывается даже если handler бросил', async () => {
    const EventBus = await freshBus();
    EventBus.once('e', () => { throw new Error('boom'); });
    EventBus.emit('e'); // не должно прорваться
    assert.equal(EventBus._listenerCount('e'), 0);
  });
});

describe('EventBus.clear', () => {
  test('clear() без аргумента чистит всё', async () => {
    const EventBus = await freshBus();
    EventBus.on('a', () => {});
    EventBus.on('b', () => {});
    EventBus.clear();
    assert.equal(EventBus._events().length, 0);
  });

  test('clear(name) чистит только этот event', async () => {
    const EventBus = await freshBus();
    EventBus.on('a', () => {});
    EventBus.on('b', () => {});
    EventBus.clear('a');
    assert.equal(EventBus._listenerCount('a'), 0);
    assert.equal(EventBus._listenerCount('b'), 1);
  });
});

describe('EventBus — изоляция handler-ошибок', () => {
  test('throw в одном handler не ломает других', async () => {
    const EventBus = await freshBus();
    let okCount = 0;
    // Перехватываем console.warn чтобы не шуметь в spec-выводе.
    const origWarn = console.warn;
    console.warn = () => {};
    try {
      EventBus.on('e', () => { throw new Error('first'); });
      EventBus.on('e', () => { okCount++; });
      EventBus.on('e', () => { okCount++; });
      EventBus.emit('e');
    } finally {
      console.warn = origWarn;
    }
    assert.equal(okCount, 2);
  });

  test('handler может отписать сам себя без ломания итерации', async () => {
    const EventBus = await freshBus();
    let count = 0;
    const fn = () => { count++; EventBus.off('e', fn); };
    const fn2 = () => { count++; };
    EventBus.on('e', fn);
    EventBus.on('e', fn2);
    EventBus.emit('e');
    EventBus.emit('e');
    // На первый emit оба отработали (count+=2), на второй — только fn2 (count+=1).
    assert.equal(count, 3);
  });
});
