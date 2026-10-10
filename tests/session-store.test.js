import test from "node:test";
import assert from "node:assert/strict";
import { UiSessionStore } from "../src/interactions/session-store.js";

test("UI sessions are short-lived and scoped to user, guild, and interaction type", () => {
  const store = new UiSessionStore(5000);
  const token = store.create({ type: "search", guildId: "guild-a", userId: "user-a", tracks: ["track"] }, 10000);
  assert.equal(store.get(token, { guildId: "guild-a", userId: "user-a", type: "search" }, 14999).tracks[0], "track");
  assert.equal(store.get(token, { guildId: "guild-b", userId: "user-a" }, 11000), null);
  assert.equal(store.get(token, { guildId: "guild-a", userId: "user-b" }, 11000), null);
  assert.equal(store.get(token, { guildId: "guild-a", userId: "user-a", type: "queue" }, 11000), null);
  assert.equal(store.get(token, { guildId: "guild-a", userId: "user-a" }, 15000), null);
  assert.equal(store.size, 0);
});
