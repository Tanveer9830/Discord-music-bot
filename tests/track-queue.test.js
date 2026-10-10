import test from "node:test";
import assert from "node:assert/strict";
import { TrackQueue } from "../src/music/track-queue.js";

const makeTrack = (id) => ({ encoded: `enc-${id}`, info: { identifier: String(id), uri: `https://youtube.com/watch?v=${id}`, title: `Track ${id}` } });

test("queue enforces size and uses validated one-based positions", () => {
  const queue = new TrackQueue();
  queue.add([makeTrack(1), makeTrack(2)], 2);
  assert.throws(() => queue.add(makeTrack(3), 2), /Queue limit/);
  assert.equal(queue.remove(2).info.identifier, "2");
  assert.throws(() => queue.remove(0), RangeError);
  assert.throws(() => queue.move(1, 2), RangeError);
});

test("move, swap, reverse, clear, and first-insertion preserve expected order", () => {
  const queue = new TrackQueue([makeTrack(1), makeTrack(2), makeTrack(3)]);
  queue.move(1, 3);
  assert.deepEqual(queue.items.map((track) => track.info.identifier), ["2", "3", "1"]);
  queue.swap(1, 3);
  assert.deepEqual(queue.items.map((track) => track.info.identifier), ["1", "3", "2"]);
  queue.reverse();
  assert.deepEqual(queue.items.map((track) => track.info.identifier), ["2", "3", "1"]);
  queue.addFirst(makeTrack(0));
  assert.equal(queue.takeNext().info.identifier, "0");
  assert.equal(queue.clear().length, 3);
  assert.equal(queue.length, 0);
});

test("unshuffle restores the exact saved order and deduplicate removes duplicate identities", () => {
  const items = [makeTrack(1), makeTrack(2), makeTrack(3), makeTrack(2)];
  const queue = new TrackQueue(items);
  assert.equal(queue.shuffle(() => 0), true);
  assert.notDeepEqual(queue.items, items);
  assert.equal(queue.unshuffle(), true);
  assert.deepEqual(queue.items, items);
  assert.equal(queue.deduplicate(), 1);
  assert.deepEqual(queue.items.map((track) => track.info.identifier), ["1", "2", "3"]);
  assert.equal(queue.unshuffle(), false);
});
