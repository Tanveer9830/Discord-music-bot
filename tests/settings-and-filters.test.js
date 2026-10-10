import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_GUILD_SETTINGS, normalizeGuildSettings } from "../src/music/settings.js";
import { buildEqualizer, clearFilter, equalizerBands, presetFilter, resolveFilterCapability } from "../src/music/filters.js";

test("guild settings normalize limits, values, arrays, and snowflakes", () => {
  const settings = normalizeGuildSettings({
    defaultVolume: 300,
    maxVolume: 100,
    maxQueueSize: 5000,
    voteSkipPercentage: 5,
    djRoleId: "bad-id",
    allowedVoiceChannelIds: ["12345678901234567", "bad", "12345678901234567"],
  });
  assert.equal(settings.defaultVolume, 100);
  assert.equal(settings.maxVolume, 100);
  assert.equal(settings.maxQueueSize, 1000);
  assert.equal(settings.voteSkipPercentage, 1);
  assert.deepEqual(settings.allowedVoiceChannelIds, ["12345678901234567"]);
  assert.equal(settings.djRoleId, null);
  assert.equal(DEFAULT_GUILD_SETTINGS.stay247, false);
  assert.ok(DEFAULT_GUILD_SETTINGS.djRequiredActions.includes("loop"));
  assert.ok(DEFAULT_GUILD_SETTINGS.djRequiredActions.includes("autoplay"));
});

test("native Lavalink presets produce valid equalizer/filter shapes", () => {
  const equalizer = buildEqualizer("bassboost");
  assert.equal(equalizer.length, 15);
  assert.deepEqual(equalizer.map((band) => band.band), Array.from({ length: 15 }, (_, index) => index));
  assert.equal(equalizer[0].gain, 0.6);
  assert.equal(equalizerBands("flat").length, 0);
  assert.deepEqual(presetFilter("nightcore"), { timescale: { speed: 1.15, pitch: 1.15, rate: 1 } });
  assert.ok(resolveFilterCapability("channelmix"));
  assert.deepEqual(clearFilter({ karaoke: {}, rotation: {} }, "rotation"), { karaoke: {} });
  assert.throws(() => presetFilter("invented"), /Unknown audio preset/);
});
