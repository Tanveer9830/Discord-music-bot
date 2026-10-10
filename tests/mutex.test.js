import test from "node:test";
import assert from "node:assert/strict";
import { KeyedMutex } from "../src/utils/mutex.js";

test("keyed mutex serializes operations per guild without blocking other guilds", async () => {
  const mutex = new KeyedMutex();
  const order = [];
  const wait = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
  await Promise.all([
    mutex.runExclusive("guild-a", async () => { order.push("a1-start"); await wait(20); order.push("a1-end"); }),
    mutex.runExclusive("guild-a", async () => { order.push("a2"); }),
    mutex.runExclusive("guild-b", async () => { order.push("b1"); }),
  ]);
  assert.ok(order.indexOf("a1-end") < order.indexOf("a2"));
  assert.ok(order.indexOf("b1") < order.indexOf("a1-end"));
});
