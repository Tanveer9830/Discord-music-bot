import { AttachmentBuilder, ChannelType } from "discord.js";
import { UiSessionStore } from "../interactions/session-store.js";
import { BRANDING, createBrandEmbed } from "../config/branding.js";
import { lookupAlbum, lookupArtist, lookupLyrics, artistCredit, releaseUrl } from "../music/discovery.js";
import { authorizeMusicAction, isAdministrator, isBotOwner } from "../permissions/music-permissions.js";
import { buildEqualizer, equalizerBands, presetFilter, clearFilter } from "../music/filters.js";
import { exportableTrack, trackArtist, trackKey, trackTitle } from "../music/track-utils.js";
import { validateTrackReference } from "../music/track-resolver.js";
import { buildPlaylistSelect, buildQueueEmbed, buildSearchEmbed, filterSelectMenu, loopSelectMenu, metadataListEmbed, queueActionMenu, queuePageButtons, trackMenu } from "../panels/music-panel.js";
import { formatDuration, truncate } from "../utils/format.js";

const uiSessions = new UiSessionStore();

function makeSession(data) {
  return uiSessions.create(data);
}

function getSession(token, interaction, type = null) {
  return uiSessions.get(token, { guildId: interaction.guildId, userId: interaction.user.id, type });
}

function statusEmbed(description, color = 0x5865f2, title = null) {
  const embed = createBrandEmbed({ color, description: truncate(description, 4000) });
  if (title) {
    embed.setTitle(truncate(title, 256));
  }
  return embed;
}

async function send(interaction, description, { ephemeral = true, color = 0x5865f2, title = null, components = [], files = [] } = {}) {
  const payload = { embeds: [statusEmbed(description, color, title)], components, files };
  if (interaction.deferred) {
    return interaction.editReply(payload);
  }
  if (interaction.replied) {
    return interaction.followUp({ ...payload, ephemeral });
  }
  return interaction.reply({ ...payload, ephemeral });
}

async function sendEmbed(interaction, embed, { ephemeral = true, components = [], files = [] } = {}) {
  const payload = { embeds: [embed], components, files };
  if (interaction.deferred) {
    return interaction.editReply(payload);
  }
  if (interaction.replied) {
    return interaction.followUp({ ...payload, ephemeral });
  }
  return interaction.reply({ ...payload, ephemeral });
}

async function defer(interaction, ephemeral = true) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral });
  }
}

async function guard(interaction, { database, music, config }, action = "play", options = {}) {
  const result = authorizeMusicAction(interaction, {
    database,
    music,
    ownerIds: config.ownerIds,
    action,
    ...options,
  });
  if (!result.ok) {
    await send(interaction, result.message, { color: 0xed4245 });
    return null;
  }
  return result;
}

function userVoiceChannel(interaction, client) {
  return interaction.member?.voice?.channelId
    ?? interaction.member?.voice?.channel?.id
    ?? client.guilds.cache.get(interaction.guildId)?.members.cache.get(interaction.user.id)?.voice?.channelId
    ?? null;
}

function isServerAdmin(interaction, ownerIds) {
  return isAdministrator(interaction) || isBotOwner(interaction.user.id, ownerIds);
}

function isAllowedMusicTextChannel(interaction, database) {
  const exempt = new Set(["dj", "musicsettings", "musicreset", "health", "help", "info", "stats"]);
  if (interaction.isChatInputCommand?.() && exempt.has(interaction.commandName)) {
    return true;
  }
  const settings = database.getGuildSettings(interaction.guildId);
  return settings.allowedTextChannelIds.length === 0 || settings.allowedTextChannelIds.includes(interaction.channelId);
}

function queueItems(music, guildId) {
  const state = music.getState(guildId);
  return { state, tracks: state?.queue.items ?? [] };
}

function playlistEmbed(playlist) {
  const lines = playlist.tracks.slice(0, 20).map((track, index) => {
    const link = track.info?.uri ? `[${truncate(trackTitle(track), 110)}](${track.info.uri})` : `**${truncate(trackTitle(track), 110)}**`;
    return `${index + 1}. ${link} — ${truncate(trackArtist(track), 80)}`;
  });
  const embed = createBrandEmbed({
    color: 0x5865f2,
    title: `🎼 Playlist: ${truncate(playlist.name, 180)}`,
    description: lines.length ? lines.join("\n") : "This playlist does not contain any tracks yet.",
  });
  embed.addFields(
    { name: "Tracks", value: String(playlist.tracks.length), inline: true },
    { name: "Visibility", value: playlist.visibility, inline: true },
    { name: "Owner", value: playlist.userId ? `<@${playlist.userId}>` : "Unknown", inline: true },
  );
  if (playlist.tracks.length > 20) {
    embed.addFields({ name: "More", value: `Showing the first 20 of ${playlist.tracks.length} tracks.`, inline: false });
  }
  return embed;
}

function validateTrackUrlForImport(value) {
  const reference = validateTrackReference(value);
  if (reference.kind !== "url") {
    throw new Error("Playlist imports require a supported HTTP(S) music URL for every track.");
  }
  return reference.query;
}

async function getPlaylistForUser(database, guildId, userId, identifier) {
  const byName = database.getAccessiblePlaylist(guildId, userId, identifier);
  if (byName) {
    return byName;
  }
  return database.getPlaylistByShareToken(identifier);
}

async function resolvePlaylistTracks(music, playlist) {
  return playlist.tracks.map((track) => ({ ...track, requester: null }));
}

async function displayQueue(interaction, { music }, page = 0, token = null) {
  const { state, tracks } = queueItems(music, interaction.guildId);
  const current = state?.current ?? null;
  const built = buildQueueEmbed({ tracks, page, current, guildName: interaction.guild?.name ?? "Server" });
  const sessionToken = token ?? makeSession({
    type: "queue",
    guildId: interaction.guildId,
    userId: interaction.user.id,
    trackKeys: tracks.map(trackKey),
  });
  const components = [];
  if (built.pages > 1) {
    components.push(queuePageButtons(sessionToken, built.page, built.pages));
  }
  const menu = queueActionMenu(tracks, sessionToken);
  if (menu) {
    components.push(menu);
  }
  return sendEmbed(interaction, built.embed, { ephemeral: true, components });
}

async function executeMusicCommand(interaction, deps) {
  const { music, database, config, panels, logger, client } = deps;
  const name = interaction.commandName;
  const sub = interaction.options.getSubcommand(false);

  if (["play", "playnext", "playskip", "playtop"].includes(name)) {
    const action = name === "playskip" ? "skip" : name === "playtop" ? "playnext" : "play";
    if (!await guard(interaction, deps, action, { needsVoice: true })) {
      return;
    }
    await defer(interaction, true);
    const query = interaction.options.getString("query", true);
    const mode = name === "playskip" ? "skip" : ["playnext", "playtop"].includes(name) ? "next" : "append";
    const loaded = await music.resolve(query);
    const result = await music.play(interaction.guildId, userVoiceChannel(interaction, client), loaded.tracks, {
      mode,
      requester: { id: interaction.user.id, tag: interaction.user.tag ?? interaction.user.username },
    });
    const first = loaded.tracks[0];
    const queueLabel = mode === "skip" ? "Started now" : mode === "next" ? "Added at the front of the queue" : result.state.current === null ? "Added" : "Added to the queue";
    const playlistNote = loaded.type === "playlist" ? `Loaded source playlist **${truncate(loaded.name || "Playlist", 100)}**. ` : "";
    return send(interaction, `${playlistNote}${queueLabel}: **${truncate(trackTitle(first), 180)}** — ${truncate(trackArtist(first), 120)}. ${loaded.tracks.length > 1 ? `Added ${loaded.tracks.length} tracks.` : ""}`, { title: "Music request" });
  }

  if (["pause", "resume"].includes(name)) {
    if (!await guard(interaction, deps, "pause")) {
      return;
    }
    await defer(interaction);
    const paused = await music.pause(interaction.guildId, name === "pause");
    return send(interaction, paused ? "Playback paused." : "Playback resumed.");
  }

  if (["skip", "previous", "stop", "seek", "forward", "rewind", "restart"].includes(name)) {
    const action = name === "stop" ? "stop" : name === "seek" || name === "forward" || name === "rewind" || name === "restart" ? "seek" : name;
    if (!await guard(interaction, deps, action)) {
      return;
    }
    await defer(interaction);
    let result;
    if (name === "skip") {
      result = await music.skip(interaction.guildId);
      return send(interaction, result.track ? `Skipped to **${truncate(trackTitle(result.track), 180)}**.` : "Playback ended; the queue is empty.");
    }
    if (name === "previous") {
      result = await music.previous(interaction.guildId);
      return send(interaction, `Playing previous track: **${truncate(trackTitle(result), 180)}**.`);
    }
    if (name === "stop") {
      await music.stop(interaction.guildId);
      return send(interaction, "Playback stopped and the upcoming queue was cleared.");
    }
    if (name === "seek") {
      const target = interaction.options.getNumber("seconds", true) * 1000;
      result = await music.seek(interaction.guildId, target);
      return send(interaction, `Seeked to **${formatDuration(result)}**.`);
    }
    if (name === "restart") {
      await music.restart(interaction.guildId);
      return send(interaction, "Restarted the current track.");
    }
    const current = music.getState(interaction.guildId)?.player?.position ?? 0;
    const seconds = interaction.options.getInteger("seconds") ?? 10;
    const delta = (name === "forward" ? 1 : -1) * seconds * 1000;
    result = await music.seek(interaction.guildId, current + delta);
    return send(interaction, `${name === "forward" ? "Forwarded" : "Rewound"} to **${formatDuration(result)}**.`);
  }

  if (["join", "leave", "disconnect"].includes(name)) {
    const leaving = name !== "join";
    if (!await guard(interaction, deps, leaving ? "stop" : "play", { needsVoice: !leaving })) {
      return;
    }
    await defer(interaction);
    if (leaving) {
      await music.leave(interaction.guildId);
      return send(interaction, "Stopped music, disabled 24/7 reconnection for this server, and left voice.");
    }
    await music.join(interaction.guildId, userVoiceChannel(interaction, client));
    return send(interaction, "Joined your voice channel.");
  }

  if (["nowplaying", "panel"].includes(name)) {
    const state = music.getPlayerSummary(interaction.guildId);
    if (!state) {
      return send(interaction, "There is no active music player in this server. Use **/play** or **/join** first.");
    }
    await panels.show(interaction);
    return;
  }

  if (name === "queue") {
    const permitted = await guard(interaction, deps, "queue", { needsVoice: false });
    if (!permitted) {
      return;
    }
    return displayQueue(interaction, deps, (interaction.options.getInteger("page") ?? 1) - 1);
  }

  if (["remove", "move", "swap", "clear", "shuffle", "unshuffle", "skipto", "deduplicate", "reversequeue"].includes(name)) {
    const action = name === "clear" ? "clear" : ["shuffle", "unshuffle"].includes(name) ? "shuffle" : name === "skipto" ? "skipto" : name === "reversequeue" ? "reversequeue" : name;
    if (!await guard(interaction, deps, action)) {
      return;
    }
    await defer(interaction);
    if (name === "remove") {
      const removed = await music.removeFromQueue(interaction.guildId, interaction.options.getInteger("position", true));
      return send(interaction, `Removed **${truncate(trackTitle(removed), 180)}** from the queue.`);
    }
    if (name === "move") {
      const moved = await music.moveQueue(interaction.guildId, interaction.options.getInteger("from", true), interaction.options.getInteger("to", true));
      return send(interaction, `Moved **${truncate(trackTitle(moved), 180)}** to queue position ${interaction.options.getInteger("to", true)}.`);
    }
    if (name === "swap") {
      await music.swapQueue(interaction.guildId, interaction.options.getInteger("first", true), interaction.options.getInteger("second", true));
      return send(interaction, "Swapped the selected upcoming queue positions.");
    }
    if (name === "clear") {
      const removed = await music.clearQueue(interaction.guildId);
      return send(interaction, `Cleared ${removed} upcoming track${removed === 1 ? "" : "s"}.`);
    }
    if (name === "shuffle") {
      const changed = await music.shuffleQueue(interaction.guildId);
      return send(interaction, changed ? "Shuffled the upcoming queue." : "Add at least two tracks before shuffling.");
    }
    if (name === "unshuffle") {
      const changed = await music.unshuffleQueue(interaction.guildId);
      return send(interaction, changed ? "Restored the queue order from before the shuffle." : "There is no saved pre-shuffle order.");
    }
    if (name === "skipto") {
      const track = await music.skipTo(interaction.guildId, interaction.options.getInteger("position", true));
      return send(interaction, `Skipped to **${truncate(trackTitle(track), 180)}**.`);
    }
    if (name === "deduplicate") {
      const removed = await music.deduplicateQueue(interaction.guildId);
      return send(interaction, `Removed ${removed} duplicate track${removed === 1 ? "" : "s"}.`);
    }
    const count = await music.reverseQueue(interaction.guildId);
    return send(interaction, `Reversed the ${count}-track upcoming queue.`);
  }

  if (name === "queueinfo") {
    if (!await guard(interaction, deps, "queue", { needsVoice: false })) {
      return;
    }
    const summary = music.getPlayerSummary(interaction.guildId);
    const totalMs = (summary?.queue ?? []).reduce((total, track) => total + Math.max(0, track.info?.length ?? 0), 0);
    return send(interaction, `**Current:** ${summary?.current ? truncate(trackTitle(summary.current), 180) : "Nothing playing"}\n**Upcoming:** ${summary?.queue.length ?? 0}\n**Upcoming duration:** ${formatDuration(totalMs)}\n**Loop:** ${summary?.loop ?? "off"} • **Autoplay:** ${summary?.autoplay ? "On" : "Off"}`, { title: "Queue information" });
  }

  if (name === "history" || name === "recentlyplayed") {
    const history = database.listHistory(interaction.guildId, interaction.user.id, 20);
    const embed = createBrandEmbed({
      color: 0x5865f2,
      title: "🕒 Recently played",
      description: history.length
        ? history.map((track, index) => `${index + 1}. ${track.info?.uri ? `[${truncate(trackTitle(track), 120)}](${track.info.uri})` : `**${truncate(trackTitle(track), 120)}**`} — ${truncate(trackArtist(track), 80)}`).join("\n")
        : "No listening history is stored for you in this server.",
    });
    return sendEmbed(interaction, embed);
  }

  if (name === "savequeue") {
    if (!await guard(interaction, deps, "queue", { needsVoice: false })) {
      return;
    }
    const count = await music.saveQueue(interaction.guildId, interaction.user.id, interaction.options.getString("name", true));
    return send(interaction, `Saved ${count} current/upcoming tracks privately. Use **/loadqueue** to append them later.`);
  }

  if (name === "loadqueue") {
    if (!await guard(interaction, deps, "play")) {
      return;
    }
    await defer(interaction);
    const result = await music.loadSavedQueue(interaction.guildId, userVoiceChannel(interaction, client), interaction.user.id, interaction.options.getString("name", true));
    return send(interaction, `Loaded your saved queue. ${result.added} track${result.added === 1 ? "" : "s"} added.`);
  }

  if (name === "volume") {
    if (!await guard(interaction, deps, "volume")) {
      return;
    }
    await defer(interaction);
    const value = await music.setVolume(interaction.guildId, interaction.options.getInteger("value", true));
    return send(interaction, `Playback volume set to **${value}%**.`);
  }

  if (["equalizer", "bassboost", "filter", "clearfilters", "nightcore", "vaporwave", "karaoke", "timescale", "8d", "lowpass", "rotation", "distortion", "channelmix"].includes(name)) {
    if (!await guard(interaction, deps, "filter")) {
      return;
    }
    await defer(interaction);
    const state = music.getState(interaction.guildId);
    const currentFilters = { ...(state?.filters ?? {}) };
    let message;
    if (name === "clearfilters") {
      await music.clearFilters(interaction.guildId);
      message = "Cleared all active native Lavalink filters.";
    } else if (name === "equalizer") {
      const preset = interaction.options.getString("preset", true);
      const eq = equalizerBands(preset);
      const next = { ...currentFilters };
      if (eq.length) {
        next.equalizer = eq;
      } else {
        delete next.equalizer;
      }
      await music.updateFilters(interaction.guildId, next);
      message = `Equalizer set to **${preset}**.`;
    } else if (name === "bassboost") {
      const enabled = interaction.options.getBoolean("enabled", true);
      const next = enabled ? { ...currentFilters, equalizer: buildEqualizer("bassboost") } : clearFilter(currentFilters, "equalizer");
      await music.updateFilters(interaction.guildId, next);
      message = enabled ? "Native Lavalink bass boost enabled." : "Bass boost disabled.";
    } else if (name === "filter") {
      const preset = interaction.options.getString("preset", true);
      if (preset === "off" || preset === "flat") {
        await music.clearFilters(interaction.guildId);
        message = "Cleared audio filters.";
      } else {
        await music.updateFilters(interaction.guildId, presetFilter(preset));
        message = `Applied the native Lavalink **${preset}** preset.`;
      }
    } else if (["nightcore", "vaporwave", "karaoke", "8d"].includes(name)) {
      const enabled = interaction.options.getBoolean("enabled", true);
      const key = name === "8d" ? "rotation" : name === "nightcore" || name === "vaporwave" ? "timescale" : "karaoke";
      const next = enabled ? { ...currentFilters, ...presetFilter(name) } : clearFilter(currentFilters, key);
      await music.updateFilters(interaction.guildId, next);
      message = `${enabled ? "Enabled" : "Disabled"} **${name}**.`;
    } else if (name === "timescale") {
      const timescale = {
        ...(interaction.options.getNumber("speed") == null ? {} : { speed: interaction.options.getNumber("speed") }),
        ...(interaction.options.getNumber("pitch") == null ? {} : { pitch: interaction.options.getNumber("pitch") }),
        ...(interaction.options.getNumber("rate") == null ? {} : { rate: interaction.options.getNumber("rate") }),
      };
      if (Object.keys(timescale).length === 0) {
        timescale.speed = 1;
      }
      await music.updateFilters(interaction.guildId, { ...currentFilters, timescale });
      message = `Applied Lavalink timescale: speed **${timescale.speed ?? "default"}**, pitch **${timescale.pitch ?? "default"}**, rate **${timescale.rate ?? "default"}**.`;
    } else if (name === "lowpass") {
      const smoothing = interaction.options.getInteger("smoothing", true);
      await music.updateFilters(interaction.guildId, { ...currentFilters, lowPass: { smoothing } });
      message = `Applied native low-pass filter (smoothing ${smoothing}).`;
    } else if (name === "rotation") {
      const rotationHz = interaction.options.getNumber("rate", true);
      await music.updateFilters(interaction.guildId, { ...currentFilters, rotation: { rotationHz } });
      message = `Set Lavalink rotation to **${rotationHz} Hz**.`;
    } else if (name === "distortion") {
      const amount = interaction.options.getNumber("amount", true);
      const next = amount === 0 ? clearFilter(currentFilters, "distortion") : {
        ...currentFilters,
        distortion: { sinOffset: 0, sinScale: amount, cosOffset: 0, cosScale: 1, tanOffset: 0, tanScale: amount, offset: 0, scale: 1 },
      };
      await music.updateFilters(interaction.guildId, next);
      message = amount === 0 ? "Distortion disabled." : `Set native Lavalink distortion to **${amount}**.`;
    } else {
      const amount = interaction.options.getNumber("amount", true);
      const next = amount === 0 ? clearFilter(currentFilters, "channelMix") : {
        ...currentFilters,
        channelMix: { leftToLeft: 1 - amount, leftToRight: amount, rightToLeft: amount, rightToRight: 1 - amount },
      };
      await music.updateFilters(interaction.guildId, next);
      message = amount === 0 ? "Channel mix reset." : `Applied stereo channel mix **${amount}**.`;
    }
    const token = makeSession({ type: "filter", guildId: interaction.guildId, userId: interaction.user.id });
    return send(interaction, message, { components: [filterSelectMenu(token)] });
  }

  if (name === "search") {
    if (!await guard(interaction, deps, "search", { needsVoice: false })) {
      return;
    }
    await defer(interaction);
    const query = interaction.options.getString("query", true);
    const source = interaction.options.getString("source") ?? "default";
    const prefix = source === "default" ? config.searchPrefix : source;
    const tracks = await music.search(query, prefix);
    const token = makeSession({ type: "search", guildId: interaction.guildId, userId: interaction.user.id, tracks });
    const menu = trackMenu(tracks, token);
    return sendEmbed(interaction, buildSearchEmbed(query, tracks), { components: menu ? [menu] : [] });
  }

  if (name === "lyrics") {
    const current = music.getState(interaction.guildId)?.current;
    if (!current) {
      return send(interaction, "Start a track first. Lyrics are looked up from track metadata; they are never generated or invented.");
    }
    await defer(interaction);
    const lyrics = await lookupLyrics(current);
    if (!lyrics) {
      return send(interaction, `The lyrics provider has no result for **${truncate(trackTitle(current), 180)}**.`, { color: 0xfee75c });
    }
    const clipped = lyrics.length > 3800 ? `${lyrics.slice(0, 3750)}\n\n[Provider response truncated to fit Discord.]` : lyrics;
    const embed = createBrandEmbed({ color: 0x5865f2, title: `📝 ${truncate(trackTitle(current), 220)}`, description: clipped });
    embed.addFields({ name: "Artist", value: truncate(trackArtist(current), 200), inline: false });
    return sendEmbed(interaction, embed);
  }

  if (name === "artist") {
    await defer(interaction);
    const query = interaction.options.getString("name", true);
    const artists = await lookupArtist(query);
    const embed = metadataListEmbed(`🎤 Artist metadata: ${query}`, artists, (artist) => {
      const labels = [artist.type, artist.country, artist["life-span"]?.begin ? `from ${artist["life-span"].begin}` : null].filter(Boolean).join(" • ");
      const tags = artist.tags?.slice(0, 3).map((tag) => tag.name).join(", ");
      return `**${truncate(artist.name, 120)}**${artist.disambiguation ? ` (${truncate(artist.disambiguation, 120)})` : ""}${labels ? `\n${truncate(labels, 150)}` : ""}${tags ? `\nTags: ${truncate(tags, 120)}` : ""}\n[MusicBrainz](https://musicbrainz.org/artist/${encodeURIComponent(artist.id)})`;
    });
    return sendEmbed(interaction, embed);
  }

  if (name === "album") {
    await defer(interaction);
    const query = interaction.options.getString("name", true);
    const releases = await lookupAlbum(query);
    const embed = metadataListEmbed(`💿 Release metadata: ${query}`, releases, (release) => {
      const details = [release["first-release-date"], release["primary-type"], artistCredit(release)].filter(Boolean).join(" • ");
      return `**${truncate(release.title, 140)}**\n${truncate(details, 180)}\n[MusicBrainz release group](${releaseUrl(release)})`;
    });
    return sendEmbed(interaction, embed);
  }

  if (["similar", "recommend"].includes(name)) {
    if (!await guard(interaction, deps, "search", { needsVoice: false })) {
      return;
    }
    await defer(interaction);
    const current = music.getState(interaction.guildId)?.current;
    const rawSeed = name === "similar" ? interaction.options.getString("query") : interaction.options.getString("seed", true);
    const seed = rawSeed || (current ? `${trackArtist(current)} ${trackTitle(current)}` : "");
    if (!seed) {
      return send(interaction, "Provide a seed or start a track first.");
    }
    const searchText = name === "similar" ? `${seed} similar music` : `${seed} recommendations`;
    const tracks = await music.search(searchText);
    const token = makeSession({ type: "search", guildId: interaction.guildId, userId: interaction.user.id, tracks });
    const menu = trackMenu(tracks, token, "Select a matching source-search result…");
    const label = name === "similar" ? "Related source search" : "Recommendation-style source search";
    const note = "Lavalink does not expose a standard personalized recommendation API here; these are genuine provider search results, not fabricated recommendations.";
    return sendEmbed(interaction, createBrandEmbed({ color: 0x5865f2, title: `🔎 ${label}`, description: `${note}\n\n${buildSearchEmbed(searchText, tracks).data.description}` }), { components: menu ? [menu] : [] });
  }

  if (name === "radio") {
    if (!await guard(interaction, deps, "play")) {
      return;
    }
    await defer(interaction);
    const seed = interaction.options.getString("seed", true);
    const tracks = await music.search(`${seed} radio mix`);
    const unique = [];
    const seen = new Set();
    for (const track of tracks) {
      const key = trackKey(track);
      if (!seen.has(key)) {
        unique.push(track);
        seen.add(key);
      }
      if (unique.length >= 10) {
        break;
      }
    }
    const result = await music.play(interaction.guildId, userVoiceChannel(interaction, client), unique, { requester: { id: interaction.user.id, tag: interaction.user.tag ?? interaction.user.username } });
    return send(interaction, `Queued ${result.added} real Lavalink source-search results for **${truncate(seed, 150)}**. Lavalink has no standard personalized radio endpoint here; this is a matching search queue, not a provider radio stream.`);
  }

  if (name === "random") {
    if (!await guard(interaction, deps, "play")) {
      return;
    }
    await defer(interaction);
    const genres = ["ambient music", "classical music", "electronic music", "hip hop music", "jazz music", "pop music", "rock music", "film soundtrack"];
    const genre = interaction.options.getString("genre") ?? genres[Math.floor(Math.random() * genres.length)];
    const tracks = await music.search(genre);
    const playable = tracks.filter((track) => track.encoded);
    if (!playable.length) {
      throw new Error("The configured Lavalink source returned no playable random results.");
    }
    const selected = playable[Math.floor(Math.random() * playable.length)];
    await music.play(interaction.guildId, userVoiceChannel(interaction, client), selected, { requester: { id: interaction.user.id, tag: interaction.user.tag ?? interaction.user.username } });
    return send(interaction, `Played a real search result: **${truncate(trackTitle(selected), 180)}** — ${truncate(trackArtist(selected), 120)} (${genre}).`);
  }

  if (name === "favorite") {
    if (!await guard(interaction, deps, "favorite", { needsVoice: false })) {
      return;
    }
    const current = music.getState(interaction.guildId)?.current;
    if (!current) {
      return send(interaction, "There is no current track to favorite.");
    }
    const added = database.addFavorite(interaction.guildId, interaction.user.id, current);
    return send(interaction, added ? `Saved **${truncate(trackTitle(current), 180)}** to your favorites.` : "That track is already in your favorites.");
  }

  if (name === "unfavorite") {
    if (!await guard(interaction, deps, "favorite", { needsVoice: false })) {
      return;
    }
    const query = interaction.options.getString("track");
    const current = music.getState(interaction.guildId)?.current;
    const key = query ?? (current ? trackKey(current) : "");
    if (!key) {
      return send(interaction, "Provide a track title or URL, or start a track first.");
    }
    const removed = database.removeFavorite(interaction.guildId, interaction.user.id, key);
    return send(interaction, removed ? "Removed the matching favorite." : "No matching favorite was found.");
  }

  if (name === "favorites") {
    const tracks = database.listFavorites(interaction.guildId, interaction.user.id);
    const embed = createBrandEmbed({
      color: 0x5865f2,
      title: "⭐ Your favorites",
      description: tracks.length ? tracks.slice(0, 20).map((track, index) => `${index + 1}. ${track.info?.uri ? `[${truncate(trackTitle(track), 120)}](${track.info.uri})` : `**${truncate(trackTitle(track), 120)}**`} — ${truncate(trackArtist(track), 80)}`).join("\n") : "You have not saved any favorites in this server.",
    });
    const token = makeSession({ type: "favorites", guildId: interaction.guildId, userId: interaction.user.id, tracks });
    const menu = trackMenu(tracks, token, "Play a favorite…");
    return sendEmbed(interaction, embed, { components: menu ? [menu] : [] });
  }

  if (name === "playlist") {
    const operation = sub;
    if (operation === "create") {
      const playlist = database.createPlaylist(interaction.guildId, interaction.user.id, interaction.options.getString("name", true));
      return send(interaction, `Created private playlist **${truncate(playlist.name, 120)}**.`);
    }
    if (operation === "add") {
      await defer(interaction);
      const playlist = database.getOwnedPlaylist(interaction.guildId, interaction.user.id, interaction.options.getString("name", true));
      if (!playlist) {
        throw new Error("You can only add tracks to a playlist you own.");
      }
      const loaded = await music.resolve(interaction.options.getString("query", true));
      const count = Math.min(loaded.tracks.length, Math.max(0, 100 - playlist.tracks.length));
      if (count === 0) {
        throw new Error("This playlist already has 100 tracks or the source returned no tracks.");
      }
      database.addPlaylistTracks(playlist.id, loaded.tracks.slice(0, count));
      return send(interaction, `Added ${count} real source track${count === 1 ? "" : "s"} to **${truncate(playlist.name, 100)}**.`);
    }
    if (operation === "remove") {
      const playlist = database.getOwnedPlaylist(interaction.guildId, interaction.user.id, interaction.options.getString("name", true));
      if (!playlist) {
        throw new Error("You can only remove tracks from a playlist you own.");
      }
      const track = database.removePlaylistTrack(playlist.id, interaction.options.getInteger("position", true));
      return send(interaction, `Removed **${truncate(trackTitle(track), 180)}** from **${truncate(playlist.name, 100)}**.`);
    }
    if (operation === "delete") {
      const playlist = database.getOwnedPlaylist(interaction.guildId, interaction.user.id, interaction.options.getString("name", true));
      if (!playlist) {
        throw new Error("You can only delete a playlist you own.");
      }
      if (!await guard(interaction, deps, "playlist-delete", { needsVoice: false })) {
        return;
      }
      database.deletePlaylist(playlist.id);
      return send(interaction, `Deleted playlist **${truncate(playlist.name, 100)}**. Other playlists and history were not affected.`);
    }
    if (operation === "rename") {
      const playlist = database.getOwnedPlaylist(interaction.guildId, interaction.user.id, interaction.options.getString("name", true));
      if (!playlist) {
        throw new Error("You can only rename a playlist you own.");
      }
      const renamed = database.renamePlaylist(playlist.id, interaction.options.getString("new_name", true));
      return send(interaction, `Renamed playlist to **${truncate(renamed.name, 100)}**.`);
    }
    if (operation === "view") {
      const requestedName = interaction.options.getString("name");
      const playlists = database.listPlaylists(interaction.guildId, interaction.user.id);
      if (!requestedName) {
        const embed = createBrandEmbed({
          color: 0x5865f2,
          title: "🎼 Saved playlists",
          description: playlists.length ? playlists.map((playlist) => `• **${truncate(playlist.name, 100)}** — ${playlist.trackCount} tracks${playlist.visibility === "shared" ? " • shared" : ""}`).join("\n") : "You have no playlists yet. Use **/playlist create** to make one.",
        });
        const token = makeSession({ type: "playlists", guildId: interaction.guildId, userId: interaction.user.id, playlistIds: playlists.map((playlist) => playlist.id) });
        const menu = buildPlaylistSelect(playlists, token);
        return sendEmbed(interaction, embed, { components: menu ? [menu] : [] });
      }
      const playlist = await getPlaylistForUser(database, interaction.guildId, interaction.user.id, requestedName);
      if (!playlist || (playlist.guildId !== interaction.guildId) || (playlist.userId !== interaction.user.id && playlist.visibility !== "shared")) {
        throw new Error("No accessible playlist with that name or share code was found in this server.");
      }
      const token = makeSession({ type: "playlists", guildId: interaction.guildId, userId: interaction.user.id, playlistIds: playlists.map((entry) => entry.id) });
      const menu = buildPlaylistSelect(playlists, token);
      return sendEmbed(interaction, playlistEmbed(playlist), { components: menu ? [menu] : [] });
    }
    if (operation === "play") {
      if (!await guard(interaction, deps, "play")) {
        return;
      }
      await defer(interaction);
      const playlist = await getPlaylistForUser(database, interaction.guildId, interaction.user.id, interaction.options.getString("name", true));
      if (!playlist || (playlist.guildId !== interaction.guildId) || (playlist.userId !== interaction.user.id && playlist.visibility !== "shared")) {
        throw new Error("No accessible playlist with that name or share code was found in this server.");
      }
      if (!playlist.tracks.length) {
        throw new Error("That playlist is empty.");
      }
      const tracks = await resolvePlaylistTracks(music, playlist);
      const result = await music.play(interaction.guildId, userVoiceChannel(interaction, client), tracks, { requester: { id: interaction.user.id, tag: interaction.user.tag ?? interaction.user.username } });
      return send(interaction, `Queued **${truncate(playlist.name, 100)}** with ${result.added} saved tracks.`);
    }
    if (operation === "import") {
      const nameValue = interaction.options.getString("name", true);
      let parsed;
      try {
        parsed = JSON.parse(interaction.options.getString("json", true));
      } catch {
        throw new Error("Import data must be valid JSON.");
      }
      if (!parsed || !Array.isArray(parsed.tracks) || parsed.tracks.length < 1 || parsed.tracks.length > 100) {
        throw new Error("Import JSON must be an object containing 1 to 100 tracks.");
      }
      const tracks = parsed.tracks.map((entry, index) => {
        if (!entry || typeof entry !== "object" || typeof entry.url !== "string") {
          throw new Error(`Imported track ${index + 1} must include a supported URL.`);
        }
        const url = validateTrackUrlForImport(entry.url);
        return {
          encoded: "",
          info: {
            identifier: "",
            isSeekable: false,
            author: truncate(String(entry.artist ?? "Unknown artist"), 200),
            length: 0,
            isStream: false,
            title: truncate(String(entry.title ?? url), 200),
            uri: url,
            sourceName: "imported-url",
          },
          query: url,
        };
      });
      const playlist = database.createPlaylist(interaction.guildId, interaction.user.id, nameValue);
      database.addPlaylistTracks(playlist.id, tracks);
      return send(interaction, `Imported ${tracks.length} validated supported URLs into **${truncate(playlist.name, 100)}**. URLs are resolved by your Lavalink source when played.`);
    }
    if (operation === "export") {
      const playlist = await getPlaylistForUser(database, interaction.guildId, interaction.user.id, interaction.options.getString("name", true));
      if (!playlist || (playlist.guildId !== interaction.guildId) || (playlist.userId !== interaction.user.id && playlist.visibility !== "shared")) {
        throw new Error("No accessible playlist with that name was found.");
      }
      const exported = {
        format: "tanveer-prime-music-playlist-v1",
        name: playlist.name,
        tracks: playlist.tracks.map(exportableTrack).filter((track) => track.url),
      };
      if (!exported.tracks.length) {
        throw new Error("No exportable source URLs are stored in this playlist.");
      }
      const filename = `${playlist.name.replace(/[^a-z0-9-_]+/gi, "-").slice(0, 40) || "playlist"}.json`;
      const file = new AttachmentBuilder(Buffer.from(JSON.stringify(exported, null, 2)), { name: filename });
      return sendEmbed(interaction, statusEmbed(`Exported **${truncate(playlist.name, 100)}** as JSON.`, 0x5865f2), { files: [file] });
    }
    if (operation === "share") {
      const playlist = database.getOwnedPlaylist(interaction.guildId, interaction.user.id, interaction.options.getString("name", true));
      if (!playlist) {
        throw new Error("You can only share a playlist you own.");
      }
      const token = database.sharePlaylist(playlist.id);
      return send(interaction, `Read-only share code for **${truncate(playlist.name, 100)}**:\n\`${token}\`\nOther members in this server can use **/playlist view name:${token}** or **/playlist play name:${token}**. Treat the code as access to the playlist.`, { color: 0x57f287 });
    }
    if (operation === "duplicate") {
      const source = await getPlaylistForUser(database, interaction.guildId, interaction.user.id, interaction.options.getString("name", true));
      if (!source || source.guildId !== interaction.guildId || (source.userId !== interaction.user.id && source.visibility !== "shared")) {
        throw new Error("No accessible playlist with that name or share code was found.");
      }
      const copy = database.duplicatePlaylist(interaction.guildId, interaction.user.id, source, interaction.options.getString("new_name", true));
      return send(interaction, `Copied ${copy.tracks.length} tracks into your private playlist **${truncate(copy.name, 100)}**.`);
    }
  }

  if (name === "loop") {
    if (!await guard(interaction, deps, "loop")) {
      return;
    }
    const mode = interaction.options.getString("mode", true);
    await music.setLoop(interaction.guildId, mode);
    const token = makeSession({ type: "loop", guildId: interaction.guildId, userId: interaction.user.id });
    return send(interaction, `Loop mode set to **${mode}**.`, { components: [loopSelectMenu(token, mode)] });
  }

  if (name === "autoplay") {
    if (!await guard(interaction, deps, "autoplay")) {
      return;
    }
    const enabled = interaction.options.getBoolean("enabled", true);
    await music.setAutoplay(interaction.guildId, enabled);
    return send(interaction, `Source-search autoplay is **${enabled ? "on" : "off"}**. Autoplay is a best-effort Lavalink source search, not a personalized recommender.`);
  }

  if (name === "247" || name === "stay") {
    const enabled = interaction.options.getBoolean("enabled", true);
    if (!await guard(interaction, deps, "settings", { needsVoice: enabled })) {
      return;
    }
    const channelId = enabled ? userVoiceChannel(interaction, client) : null;
    if (enabled) {
      await music.join(interaction.guildId, channelId);
    }
    await music.setStay247(interaction.guildId, enabled, channelId);
    return send(interaction, enabled
      ? `Best-effort 24/7 reconnect is enabled for <#${channelId}>. Discord, the host, and Lavalink outages can still interrupt voice.`
      : "Best-effort 24/7 reconnect is disabled.");
  }

  if (name === "voteskip") {
    if (!await guard(interaction, deps, "skip")) {
      return;
    }
    const settingsValue = database.getGuildSettings(interaction.guildId);
    const result = await music.voteSkip(interaction.guildId, interaction.user.id, {
      minimum: settingsValue.voteSkipMinimum,
      percentage: settingsValue.voteSkipPercentage,
    });
    return send(interaction, result.skipped
      ? `Vote threshold reached (${result.votes}/${result.required}). Skipping.`
      : result.alreadyVoted ? `You already voted (${result.votes}/${result.required}).` : `Vote recorded (${result.votes}/${result.required}).`, { color: result.skipped ? 0x57f287 : 0x5865f2 });
  }

  if (name === "announce") {
    if (!await guard(interaction, deps, "settings", { needsVoice: false })) {
      return;
    }
    const enabled = interaction.options.getBoolean("enabled", true);
    const settingsValue = database.setGuildSettings(interaction.guildId, { defaultAnnouncements: enabled });
    await music.toggleAnnouncements(interaction.guildId, enabled);
    return send(interaction, `Now-playing announcements are ${settingsValue.defaultAnnouncements ? "enabled" : "disabled"}.`);
  }

  if (name === "dj") {
    const action = sub;
    if (action === "list") {
      const settingsValue = database.getGuildSettings(interaction.guildId);
      const controllers = database.listControllers(interaction.guildId);
      const embed = createBrandEmbed({
        color: 0x5865f2,
        title: "🎧 Music DJ access",
        description: `**DJ role:** ${settingsValue.djRoleId ? `<@&${settingsValue.djRoleId}>` : "Not set"}\n**Authorized controllers:** ${controllers.length ? controllers.map((entry) => `<@${entry.userId}>`).join(", ") : "None"}\n**DJ-only actions:** ${settingsValue.djRequiredActions.map((entry) => `\`${entry}\``).join(", ") || "None"}`,
      });
      return sendEmbed(interaction, embed);
    }
    if (!isServerAdmin(interaction, config.ownerIds)) {
      return send(interaction, "Only a server administrator or the configured bot owner can manage DJ roles and controller access.", { color: 0xed4245 });
    }
    if (action === "role") {
      const role = interaction.options.getRole("role", true);
      database.setGuildSettings(interaction.guildId, { djRoleId: role.id });
      return send(interaction, `DJ role set to <@&${role.id}>.`);
    }
    if (action === "authorize") {
      const user = interaction.options.getUser("user", true);
      const changed = database.addController(interaction.guildId, user.id, interaction.user.id);
      return send(interaction, changed ? `Authorized <@${user.id}> as a music controller.` : `<@${user.id}> was already authorized.`);
    }
    if (action === "deauthorize") {
      const user = interaction.options.getUser("user", true);
      const changed = database.removeController(interaction.guildId, user.id);
      return send(interaction, changed ? `Removed <@${user.id}> from authorized music controllers.` : `<@${user.id}> was not an authorized controller.`);
    }
    const setting = database.getGuildSettings(interaction.guildId);
    const key = interaction.options.getString("action", true);
    const enabled = interaction.options.getBoolean("dj_only", true);
    const required = new Set(setting.djRequiredActions);
    if (enabled) {
      required.add(key);
    } else {
      required.delete(key);
    }
    database.setGuildSettings(interaction.guildId, { djRequiredActions: [...required] });
    return send(interaction, `Action **${key}** is now ${enabled ? "DJ-only" : "available to ordinary listeners (subject to other checks)"}.`);
  }

  if (name === "musicsettings") {
    if (sub === "show") {
      const settingsValue = database.getGuildSettings(interaction.guildId);
      const embed = createBrandEmbed({
        color: 0x5865f2,
        title: "⚙️ Server music settings",
        description: [
          `Default/max volume: **${settingsValue.defaultVolume}% / ${settingsValue.maxVolume}%**`,
          `Queue limit: **${settingsValue.maxQueueSize}** • Idle timeout: **${settingsValue.idleDisconnectSeconds}s**`,
          `DJ role: ${settingsValue.djRoleId ? `<@&${settingsValue.djRoleId}>` : "Not set"}`,
          `Announcement channel: ${settingsValue.announceChannelId ? `<#${settingsValue.announceChannelId}>` : "Server system channel / none"}`,
          `Allowed voice channels: ${settingsValue.allowedVoiceChannelIds.length ? settingsValue.allowedVoiceChannelIds.map((id) => `<#${id}>`).join(", ") : "All"}`,
          `Allowed text channels: ${settingsValue.allowedTextChannelIds.length ? settingsValue.allowedTextChannelIds.map((id) => `<#${id}>`).join(", ") : "All"}`,
          `Default loop/autoplay: **${settingsValue.defaultLoop} / ${settingsValue.defaultAutoplay ? "on" : "off"}**`,
          `Vote skip: **${settingsValue.voteSkipMinimum} minimum / ${Math.round(settingsValue.voteSkipPercentage * 100)}%**`,
          `24/7 stay: **${settingsValue.stay247 ? "on" : "off"}** • History: **${settingsValue.historyEnabled ? "on" : "off"}`,
          `Idle preset: **${settingsValue.defaultPreset}** • Announcements: **${settingsValue.defaultAnnouncements ? "on" : "off"}`,
          `DJ-only actions: ${settingsValue.djRequiredActions.map((item) => `\`${item}\``).join(", ") || "None"}`,
        ].join("\n"),
      });
      return sendEmbed(interaction, embed);
    }
    if (!isServerAdmin(interaction, config.ownerIds)) {
      return send(interaction, "Only a server administrator or the configured bot owner can change server music settings.", { color: 0xed4245 });
    }
    const settingsValue = database.getGuildSettings(interaction.guildId);
    if (sub === "default-volume") {
      const value = interaction.options.getInteger("value", true);
      if (value > settingsValue.maxVolume) {
        throw new Error("Default volume cannot exceed the server maximum volume.");
      }
      database.setGuildSettings(interaction.guildId, { defaultVolume: value });
      return send(interaction, `Default volume set to ${value}%.`);
    }
    if (sub === "max-volume") {
      const value = interaction.options.getInteger("value", true);
      if (value < settingsValue.defaultVolume) {
        throw new Error("Maximum volume cannot be lower than the configured default volume.");
      }
      database.setGuildSettings(interaction.guildId, { maxVolume: value });
      return send(interaction, `Maximum volume set to ${value}%.`);
    }
    if (sub === "queue-limit") {
      const updated = await music.setQueueLimit(interaction.guildId, interaction.options.getInteger("value", true));
      return send(interaction, `Maximum upcoming queue size set to ${updated.maxQueueSize}.`);
    }
    if (sub === "idle-timeout") {
      const seconds = interaction.options.getInteger("seconds", true);
      database.setGuildSettings(interaction.guildId, { idleDisconnectSeconds: seconds });
      return send(interaction, seconds === 0 ? "Idle voice auto-disconnect is disabled." : `Idle voice auto-disconnect set to ${seconds} seconds.`);
    }
    if (sub === "default-loop") {
      const mode = interaction.options.getString("mode", true);
      database.setGuildSettings(interaction.guildId, { defaultLoop: mode });
      return send(interaction, `New players will default to **${mode}** loop.`);
    }
    if (sub === "default-autoplay") {
      const enabled = interaction.options.getBoolean("enabled", true);
      database.setGuildSettings(interaction.guildId, { defaultAutoplay: enabled });
      return send(interaction, `New players will default to source-search autoplay **${enabled ? "on" : "off"}**.`);
    }
    if (sub === "vote-skip") {
      const minimum = interaction.options.getInteger("minimum", true);
      const percentage = interaction.options.getNumber("percentage", true);
      database.setGuildSettings(interaction.guildId, { voteSkipMinimum: minimum, voteSkipPercentage: percentage });
      return send(interaction, `Vote-skip threshold set to **${minimum} minimum / ${Math.round(percentage * 100)}%**.`);
    }
    if (sub === "announcement-channel") {
      const channel = interaction.options.getChannel("channel");
      const clear = interaction.options.getBoolean("clear") ?? false;
      if (clear) {
        database.setGuildSettings(interaction.guildId, { announceChannelId: null });
        return send(interaction, "Configured announcement channel cleared. The bot will use the server system channel when available.");
      }
      if (!channel) {
        throw new Error("Choose a text channel or set clear:true.");
      }
      database.setGuildSettings(interaction.guildId, { announceChannelId: channel.id });
      return send(interaction, `Now-playing announcements will use <#${channel.id}>.`);
    }
    if (sub === "history") {
      const enabled = interaction.options.getBoolean("enabled", true);
      database.setGuildSettings(interaction.guildId, { historyEnabled: enabled });
      return send(interaction, `Per-user listening history ${enabled ? "enabled" : "disabled"}. Existing records are retained until database cleanup.`);
    }
    if (sub === "stay-247") {
      const enabled = interaction.options.getBoolean("enabled", true);
      const channelId = enabled ? music.getVoiceChannelId(interaction.guildId) ?? userVoiceChannel(interaction, client) : null;
      if (enabled) {
        if (!channelId) {
          throw new Error("Join a voice channel or connect the bot before enabling 24/7 mode.");
        }
        await music.join(interaction.guildId, channelId);
      }
      await music.setStay247(interaction.guildId, enabled, channelId);
      return send(interaction, `Default 24/7 mode ${enabled ? `enabled for <#${channelId}>` : "disabled"}. Voice availability is best effort.`);
    }
    if (sub === "default-preset") {
      const preset = interaction.options.getString("preset", true);
      database.setGuildSettings(interaction.guildId, { defaultPreset: preset });
      return send(interaction, `Default audio preset set to **${preset}**. It will be applied when a new music player session starts.`);
    }
    if (sub === "channels") {
      const scope = interaction.options.getString("scope", true);
      const action = interaction.options.getString("action", true);
      const channel = interaction.options.getChannel("channel");
      const key = scope === "voice" ? "allowedVoiceChannelIds" : "allowedTextChannelIds";
      const values = [...settingsValue[key]];
      if (action === "clear") {
        database.setGuildSettings(interaction.guildId, { [key]: [] });
        return send(interaction, `Cleared ${scope} channel restrictions.`);
      }
      if (!channel) {
        throw new Error("Select a channel for add/remove, or use Clear restrictions.");
      }
      const isCorrectType = scope === "voice"
        ? channel.type === ChannelType.GuildVoice
        : [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type);
      if (!isCorrectType) {
        throw new Error(`Select a ${scope} channel for this setting.`);
      }
      if (action === "add" && !values.includes(channel.id)) {
        values.push(channel.id);
      } else if (action === "remove") {
        const index = values.indexOf(channel.id);
        if (index >= 0) {
          values.splice(index, 1);
        }
      }
      database.setGuildSettings(interaction.guildId, { [key]: values });
      return send(interaction, `${scope} channel restrictions updated.`);
    }
  }

  if (name === "musicreset") {
    if (!isServerAdmin(interaction, config.ownerIds)) {
      return send(interaction, "Only a server administrator or the configured bot owner can reset music settings.", { color: 0xed4245 });
    }
    database.resetGuildSettings(interaction.guildId);
    return send(interaction, "Reset server music settings and DJ controller access. Playlists, favorites, saved queues, history, and credentials were preserved.");
  }

  if (name === "health" || name === "info" || name === "stats") {
    const connectedNodes = music.getNodeStatuses();
    const connectedCount = connectedNodes.filter((node) => node.connected).length;
    const queueCount = [...music.states.values()].reduce((sum, state) => sum + state.queue.length, 0);
    const description = [
      `**Project:** ${BRANDING.project}`,
      `**Creator:** ${BRANDING.creator}`,
      `**Discord:** ${client.isReady() ? "connected" : "not ready"}${client.ws?.ping >= 0 ? ` • gateway ${client.ws.ping} ms` : ""}`,
      `**Lavalink:** ${connectedCount}/${connectedNodes.length} node(s) connected${connectedNodes.length ? ` (${connectedNodes.map((node) => `${node.name}: ${node.state}${node.version ? ` v${node.version}` : ""}`).join(", ")})` : " — not configured/connected"}`,
      `**Guilds:** ${client.guilds.cache.size} • **Active players:** ${music.getActivePlayerCount()} • **Queued tracks:** ${queueCount}`,
      `**Storage:** SQLite schema v${database.getMigrationVersion()} • single-instance mode`,
      `**Repository:** ${BRANDING.repository}`,
    ].join("\n");
    return send(interaction, description, { title: name === "stats" ? "📊 TANVEER PRIME MUSIC statistics" : name === "health" ? "🩺 TANVEER PRIME MUSIC health" : "ℹ️ TANVEER PRIME MUSIC", color: connectedCount > 0 && client.isReady() ? 0x57f287 : 0xfee75c });
  }

  if (name === "help") {
    const embed = createBrandEmbed({
      color: 0x5865f2,
      title: "🎵 TANVEER PRIME MUSIC — Music-only help",
      description: [
        "**Playback:** /play, /playnext, /playskip, /playtop, /pause, /resume, /skip, /previous, /stop, /seek, /forward, /rewind, /restart, /join, /leave, /nowplaying",
        "**Queue:** /queue, /remove, /move, /swap, /clear, /shuffle, /unshuffle, /skipto, /queueinfo, /history, /deduplicate, /reversequeue, /savequeue, /loadqueue",
        "**Audio:** /volume, /equalizer, /bassboost, /filter, /clearfilters, /nightcore, /vaporwave, /karaoke, /timescale, /8d, /lowpass, /rotation, /distortion, /channelmix",
        "**Discovery:** /search, /lyrics, /artist, /album, /similar, /recommend, /radio, /random, /favorites, /favorite, /unfavorite, /recentlyplayed",
        "**Playlists & session:** /playlist, /loop, /autoplay, /247, /stay, /voteskip, /announce, /dj, /musicsettings, /musicreset",
        "**Controls:** Use /panel or /nowplaying for buttons and menus. Search, queue, filter, loop, and playlist commands also provide select menus.",
        "**Notes:** Audio comes from configured Lavalink source managers. Spotify URLs do not yield audio by themselves; metadata searches and lyrics depend on external providers.",
      ].join("\n\n"),
    });
    return sendEmbed(interaction, embed);
  }

  logger.warn("No implementation matched a registered command", { command: name, subcommand: sub });
  return send(interaction, "That command is not implemented in this build. Please update the bot or check the command registration.", { color: 0xed4245 });
}

async function handlePanelButton(interaction, deps, token, action) {
  const { music, database, panels } = deps;
  if (!panels.isCurrentToken(interaction.guildId, token)) {
    return send(interaction, "This panel control is stale. Run **/nowplaying** to refresh it.", { color: 0xfee75c });
  }
  const actionPermissions = {
    previous: "previous",
    rewind: "seek",
    pause: "pause",
    resume: "pause",
    skip: "skip",
    stop: "stop",
    forward: "seek",
    loop: "loop",
    shuffle: "shuffle",
    queue: "queue",
    favorite: "favorite",
    volume_down: "volume",
    volume_up: "volume",
  };
  const permissionAction = actionPermissions[action];
  if (!permissionAction) {
    return send(interaction, "Unknown player control.", { color: 0xed4245 });
  }
  const needsVoice = !["queue", "favorite"].includes(action);
  if (!await guard(interaction, deps, permissionAction, { needsVoice })) {
    return;
  }
  if (action === "queue") {
    return displayQueue(interaction, deps, 0);
  }
  if (action === "favorite") {
    const current = music.getState(interaction.guildId)?.current;
    if (!current) {
      return send(interaction, "There is no current track to favorite.");
    }
    const added = database.addFavorite(interaction.guildId, interaction.user.id, current);
    return send(interaction, added ? `Saved **${truncate(trackTitle(current), 180)}** to your favorites.` : "That track is already in your favorites.");
  }
  await defer(interaction);
  if (action === "previous") {
    const track = await music.previous(interaction.guildId);
    return send(interaction, `Playing previous track: **${truncate(trackTitle(track), 180)}**.`);
  }
  if (action === "rewind" || action === "forward") {
    const state = music.getState(interaction.guildId);
    const current = state?.player?.position ?? 0;
    const target = current + (action === "forward" ? 10000 : -10000);
    const position = await music.seek(interaction.guildId, target);
    return send(interaction, `Moved to ${formatDuration(position)}.`);
  }
  if (action === "pause" || action === "resume") {
    const paused = await music.pause(interaction.guildId, action === "pause");
    return send(interaction, paused ? "Playback paused." : "Playback resumed.");
  }
  if (action === "skip") {
    const result = await music.skip(interaction.guildId);
    return send(interaction, result.track ? `Skipped to **${truncate(trackTitle(result.track), 180)}**.` : "Playback ended; the queue is empty.");
  }
  if (action === "stop") {
    await music.stop(interaction.guildId);
    return send(interaction, "Playback stopped and the upcoming queue was cleared.");
  }
  if (action === "loop") {
    const state = music.getState(interaction.guildId);
    const next = state?.loop === "off" ? "track" : state?.loop === "track" ? "queue" : "off";
    await music.setLoop(interaction.guildId, next);
    return send(interaction, `Loop mode set to **${next}**.`);
  }
  if (action === "shuffle") {
    const state = music.getState(interaction.guildId);
    const wasShuffled = Boolean(state?.queue.isShuffled);
    const changed = wasShuffled ? await music.unshuffleQueue(interaction.guildId) : await music.shuffleQueue(interaction.guildId);
    return send(interaction, changed ? (wasShuffled ? "Queue unshuffled." : "Queue shuffled.") : "Add at least two tracks before shuffling.");
  }
  const state = music.getState(interaction.guildId);
  const settings = database.getGuildSettings(interaction.guildId);
  const nextVolume = Math.max(0, Math.min(settings.maxVolume, state.volume + (action === "volume_up" ? 5 : -5)));
  const volume = await music.setVolume(interaction.guildId, nextVolume);
  return send(interaction, `Volume set to ${volume}%.`);
}

async function handleComponent(interaction, deps) {
  const { music, database, panels, client } = deps;
  const parts = interaction.customId.split(":");
  if (parts[0] !== "tpm") {
    return;
  }
  const type = parts[1];
  if (type === "panel") {
    return handlePanelButton(interaction, deps, parts[2], parts.slice(3).join(":"));
  }

  if (type === "qpage") {
    const token = parts[2];
    const session = getSession(token, interaction, "queue");
    if (!session) {
      return send(interaction, "This queue page expired. Run **/queue** again.", { color: 0xfee75c });
    }
    const page = Number(parts[3]);
    const state = music.getState(interaction.guildId);
    const tracks = state?.queue.items ?? [];
    session.trackKeys = tracks.map(trackKey);
    const built = buildQueueEmbed({ tracks, page, current: state?.current, guildName: interaction.guild?.name ?? "Server" });
    const components = [];
    if (built.pages > 1) {
      components.push(queuePageButtons(token, built.page, built.pages));
    }
    const menu = queueActionMenu(tracks, token);
    if (menu) {
      components.push(menu);
    }
    return interaction.update({ embeds: [built.embed], components });
  }

  if (type === "queue-remove") {
    const token = parts[2];
    const session = getSession(token, interaction, "queue");
    if (!session) {
      return send(interaction, "This queue menu expired. Run **/queue** again.", { color: 0xfee75c });
    }
    const currentTracks = music.getState(interaction.guildId)?.queue.items ?? [];
    const currentKeys = currentTracks.map(trackKey);
    if (!Array.isArray(session.trackKeys) || session.trackKeys.length !== currentKeys.length
      || session.trackKeys.some((key, index) => key !== currentKeys[index])) {
      return send(interaction, "The queue changed since this menu was displayed. Run **/queue** again before removing a track.", { color: 0xfee75c });
    }
    if (!await guard(interaction, deps, "remove")) {
      return;
    }
    const position = Number(interaction.values[0]);
    const removed = await music.removeFromQueue(interaction.guildId, position);
    const state = music.getState(interaction.guildId);
    const built = buildQueueEmbed({ tracks: state?.queue.items ?? [], page: 0, current: state?.current, guildName: interaction.guild?.name ?? "Server" });
    const menu = queueActionMenu(state?.queue.items ?? [], token);
    return interaction.update({ content: `Removed **${truncate(trackTitle(removed), 150)}**.`, embeds: [built.embed], components: menu ? [menu] : [] });
  }

  if (type === "search-select" || type === "filter-select" || type === "loop-select" || type === "playlist-select") {
    const token = parts[2];
    if (type === "playlist-select" && panels.isCurrentToken(interaction.guildId, token)) {
      if (!await guard(interaction, deps, "play")) {
        return;
      }
      await defer(interaction);
      const playlist = database.getPlaylistById(interaction.values[0]);
      if (!playlist || playlist.guildId !== interaction.guildId || (playlist.userId !== interaction.user.id && playlist.visibility !== "shared")) {
        throw new Error("That playlist is no longer available to you.");
      }
      const tracks = await resolvePlaylistTracks(music, playlist);
      const result = await music.play(interaction.guildId, userVoiceChannel(interaction, client), tracks, { requester: { id: interaction.user.id, tag: interaction.user.tag ?? interaction.user.username } });
      return send(interaction, `Queued **${truncate(playlist.name, 100)}** with ${result.added} saved tracks.`);
    }
    if (type === "playlist-select") {
      const session = getSession(token, interaction, "playlists");
      if (!session || !session.playlistIds.includes(interaction.values[0])) {
        return send(interaction, "This playlist menu expired or is no longer available. Run **/playlist view** again.", { color: 0xfee75c });
      }
      if (!await guard(interaction, deps, "play")) {
        return;
      }
      await defer(interaction);
      const playlist = database.getPlaylistById(interaction.values[0]);
      if (!playlist || playlist.guildId !== interaction.guildId || (playlist.userId !== interaction.user.id && playlist.visibility !== "shared")) {
        throw new Error("That playlist is no longer available to you.");
      }
      const tracks = await resolvePlaylistTracks(music, playlist);
      const result = await music.play(interaction.guildId, userVoiceChannel(interaction, client), tracks, { requester: { id: interaction.user.id, tag: interaction.user.tag ?? interaction.user.username } });
      return send(interaction, `Queued **${truncate(playlist.name, 100)}** with ${result.added} saved tracks.`);
    }
    if (type === "filter-select") {
      const session = getSession(token, interaction, "filter");
      if (!session) {
        return send(interaction, "This filter menu expired. Run **/filter** again.", { color: 0xfee75c });
      }
      if (!await guard(interaction, deps, "filter")) {
        return;
      }
      const preset = interaction.values[0];
      if (preset === "flat") {
        await music.clearFilters(interaction.guildId);
      } else {
        await music.updateFilters(interaction.guildId, presetFilter(preset));
      }
      return send(interaction, `Applied **${preset}** using native Lavalink filters.`);
    }
    if (type === "loop-select") {
      const session = getSession(token, interaction, "loop");
      if (!session) {
        return send(interaction, "This loop menu expired. Run **/loop** again.", { color: 0xfee75c });
      }
      if (!await guard(interaction, deps, "loop")) {
        return;
      }
      await music.setLoop(interaction.guildId, interaction.values[0]);
      return send(interaction, `Loop mode set to **${interaction.values[0]}**.`);
    }
    if (type === "search-select") {
      const session = getSession(token, interaction);
      if (!session || !["search", "favorites"].includes(session.type)) {
        return send(interaction, "These search results expired. Run the search or favorites command again.", { color: 0xfee75c });
      }
      if (!await guard(interaction, deps, "play")) {
        return;
      }
      const index = Number(interaction.values[0]);
      const track = session.tracks[index];
      if (!track) {
        throw new Error("The selected track is no longer available.");
      }
      await defer(interaction);
      await music.play(interaction.guildId, userVoiceChannel(interaction, client), track, { requester: { id: interaction.user.id, tag: interaction.user.tag ?? interaction.user.username } });
      return send(interaction, `Queued **${truncate(trackTitle(track), 180)}** — ${truncate(trackArtist(track), 100)}.`);
    }
  }

  if (type === "queue-select") {
    const token = parts[2];
    if (!panels.isCurrentToken(interaction.guildId, token)) {
      return send(interaction, "This player panel is stale. Run **/nowplaying** to refresh it.", { color: 0xfee75c });
    }
    if (!await guard(interaction, deps, "skipto")) {
      return;
    }
    const position = Number(interaction.values[0]);
    await defer(interaction);
    const track = await music.skipTo(interaction.guildId, position);
    return send(interaction, `Skipped to **${truncate(trackTitle(track), 180)}**.`);
  }
  return send(interaction, "This music control is not recognized or has expired.", { color: 0xfee75c });
}

export function createInteractionHandler(dependencies) {
  return async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        if (!interaction.inGuild()) {
          await send(interaction, "Music commands are available in a Discord server only.", { color: 0xed4245 });
          return;
        }
        if (!isAllowedMusicTextChannel(interaction, dependencies.database)) {
          await send(interaction, "Music controls are restricted to the server's configured music text channel(s).", { color: 0xed4245 });
          return;
        }
        await executeMusicCommand(interaction, dependencies);
      } else if (interaction.isButton() || interaction.isStringSelectMenu()) {
        if (!interaction.inGuild()) {
          await send(interaction, "Music controls are available in a server only.", { color: 0xed4245 });
          return;
        }
        if (!isAllowedMusicTextChannel(interaction, dependencies.database)) {
          await send(interaction, "Music controls are restricted to the server's configured music text channel(s).", { color: 0xed4245 });
          return;
        }
        await handleComponent(interaction, dependencies);
      }
    } catch (error) {
      dependencies.logger.error("Discord interaction failed", { command: interaction.commandName ?? interaction.customId, error: error?.message ?? "unknown error" });
      try {
        await send(interaction, error?.message || "The request could not be completed. Check Lavalink and the server's music settings.", { color: 0xed4245, title: "Music request failed" });
      } catch (replyError) {
        dependencies.logger.warn("Could not send the interaction error response", { code: replyError?.code });
      }
    }
  };
}
