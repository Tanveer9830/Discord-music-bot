import test from "node:test";
import assert from "node:assert/strict";
import { buildResolverIdentifier, normalizeLoadedTracks, validateSearchQuery, validateTrackReference } from "../src/music/track-resolver.js";

test("search text becomes an explicit Lavalink source query", () => {
  assert.deepEqual(validateTrackReference("  artist - song  "), { kind: "search", query: "artist - song" });
  assert.equal(buildResolverIdentifier("artist - song", "ytsearch"), "ytsearch:artist - song");
  assert.equal(buildResolverIdentifier("artist - song", "scsearch"), "scsearch:artist - song");
});

test("supported HTTPS URLs are normalized and passed through", () => {
  const reference = validateTrackReference("https://youtu.be/abc123?t=12");
  assert.equal(reference.kind, "url");
  assert.equal(reference.host, "youtu.be");
  assert.equal(buildResolverIdentifier(reference.query), "https://youtu.be/abc123?t=12");
});

test("unsupported URLs and unsafe query values are rejected before Lavalink", () => {
  assert.throws(() => validateTrackReference("https://open.spotify.com/track/id"), /Spotify links provide metadata/);
  assert.throws(() => validateTrackReference("file:///etc/passwd"), /HTTP or HTTPS/);
  assert.throws(() => validateTrackReference("https://example.invalid/song"), /Unsupported music URL host/);
  assert.throws(() => validateSearchQuery("x".repeat(201)), /200 characters/);
  assert.throws(() => validateSearchQuery("song\nname"), /control characters/);
});

test("Lavalink v4 load types normalize without inventing tracks", () => {
  const track = { encoded: "encoded", info: { title: "Actual result" } };
  assert.deepEqual(normalizeLoadedTracks({ loadType: "track", data: track }), { type: "track", tracks: [track] });
  assert.deepEqual(normalizeLoadedTracks({ loadType: "search", data: [track] }), { type: "search", tracks: [track] });
  assert.deepEqual(normalizeLoadedTracks({ loadType: "playlist", data: { info: { name: "List" }, tracks: [track] } }), { type: "playlist", tracks: [track], name: "List" });
  assert.deepEqual(normalizeLoadedTracks({ loadType: "empty", data: {} }), { type: "empty", tracks: [] });
  assert.deepEqual(normalizeLoadedTracks({ loadType: "error", data: { message: "source failed" } }), { type: "error", tracks: [], message: "source failed" });
});
