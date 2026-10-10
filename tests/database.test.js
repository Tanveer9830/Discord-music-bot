import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MusicDatabase } from "../src/database/database.js";

const makeTrack = (id, requesterId = "12345678901234567") => ({
  encoded: `encoded-${id}`,
  info: {
    identifier: String(id),
    isSeekable: true,
    author: "Artist",
    length: 180000,
    isStream: false,
    title: `Track ${id}`,
    uri: `https://www.youtube.com/watch?v=${id}`,
    sourceName: "youtube",
  },
  requester: { id: requesterId, tag: "Listener#0001" },
});

function openTemporaryDatabase(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "tanveer-prime-test-"));
  const databasePath = path.join(directory, "music.sqlite");
  const database = new MusicDatabase(databasePath);
  t.after(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { database, databasePath, directory };
}

test("versioned SQLite migrations are idempotent and settings are isolated per guild", (t) => {
  const { database, databasePath } = openTemporaryDatabase(t);
  assert.equal(database.getMigrationVersion(), 3);
  database.setGuildSettings("guild-a", { defaultVolume: 120, maxVolume: 180, djRoleId: "12345678901234567" });
  database.setGuildSettings("guild-b", { defaultVolume: 30 });
  assert.equal(database.getGuildSettings("guild-a").defaultVolume, 120);
  assert.equal(database.getGuildSettings("guild-b").defaultVolume, 30);
  assert.equal(database.getGuildSettings("guild-b").maxVolume, 150);

  database.close();
  const reopened = new MusicDatabase(databasePath);
  assert.equal(reopened.getMigrationVersion(), 3);
  assert.equal(reopened.getGuildSettings("guild-a").defaultVolume, 120);
  reopened.close();
});

test("playlists persist, enforce ownership, support sharing and retain stable positions", (t) => {
  const { database } = openTemporaryDatabase(t);
  const playlist = database.createPlaylist("guild-a", "user-a", "Road trip");
  database.addPlaylistTracks(playlist.id, [makeTrack("one"), makeTrack("two")]);
  assert.equal(database.getOwnedPlaylist("guild-a", "user-a", "road trip").tracks.length, 2);
  assert.equal(database.getAccessiblePlaylist("guild-a", "user-b", "Road trip"), null);
  assert.equal(database.getAccessiblePlaylist("guild-b", "user-a", "Road trip"), null);
  assert.throws(() => database.createPlaylist("guild-a", "user-a", "ROAD TRIP"), /already have a playlist/);

  const removed = database.removePlaylistTrack(playlist.id, 1);
  assert.equal(removed.info.title, "Track one");
  assert.equal(database.getPlaylistById(playlist.id).tracks[0].info.title, "Track two");
  const shareToken = database.sharePlaylist(playlist.id);
  assert.equal(database.getPlaylistByShareToken(shareToken).tracks.length, 1);
  assert.equal(database.getAccessiblePlaylist("guild-a", "user-b", "Road trip").id, playlist.id);

  const copy = database.duplicatePlaylist("guild-a", "user-b", database.getPlaylistById(playlist.id), "Copy");
  assert.equal(copy.tracks.length, 1);
  database.renamePlaylist(copy.id, "Copy 2");
  assert.equal(database.getOwnedPlaylist("guild-a", "user-b", "Copy 2").id, copy.id);
  assert.equal(database.deletePlaylist(copy.id), true);
});

test("favorites, history, queues, authorized controllers, and sessions remain scoped and persistent", (t) => {
  const { database, databasePath } = openTemporaryDatabase(t);
  const track = makeTrack("favorite-track");
  assert.equal(database.addFavorite("guild-a", "user-a", track), true);
  assert.equal(database.addFavorite("guild-a", "user-a", track), false);
  assert.equal(database.listFavorites("guild-a", "user-a").length, 1);
  assert.equal(database.listFavorites("guild-b", "user-a").length, 0);
  assert.equal(database.removeFavorite("guild-a", "user-a", track.info.title), true);
  assert.equal(database.addFavorite("guild-a", "user-a", track), true);

  database.addHistory("guild-a", "user-a", track);
  assert.equal(database.listHistory("guild-a", "user-a").length, 1);
  assert.equal(database.listHistory("guild-a", "user-b").length, 0);
  database.saveQueue("guild-a", "user-a", "Friday", [track]);
  assert.equal(database.loadQueue("guild-a", "user-a", "friday").length, 1);
  assert.equal(database.loadQueue("guild-b", "user-a", "Friday"), null);
  assert.equal(database.addController("guild-a", "controller", "admin"), true);
  assert.equal(database.isController("guild-a", "controller"), true);
  assert.equal(database.isController("guild-b", "controller"), false);

  database.saveSession("guild-a", {
    current: track,
    queue: [makeTrack("up-next")],
    voiceChannelId: "12345678901234567",
    position: 45000,
    volume: 90,
    loop: "queue",
    autoplay: true,
    announce: false,
    filters: { rotation: { rotationHz: 0.2 } },
  });
  database.close();
  const reopened = new MusicDatabase(databasePath);
  const session = reopened.getSession("guild-a");
  assert.equal(session.current.info.title, "Track favorite-track");
  assert.equal(session.queue.length, 1);
  assert.equal(session.position, 45000);
  assert.equal(session.filters.rotation.rotationHz, 0.2);
  assert.equal(session.current.requester, undefined);
  reopened.close();
});
