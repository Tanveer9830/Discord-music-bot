import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from "discord.js";
import { BRAND_FOOTER, BRANDING, createBrandEmbed } from "../config/branding.js";
import { formatDuration, makeProgressBar, truncate } from "../utils/format.js";
import { trackArtist, trackTitle, trackUrl } from "../music/track-utils.js";

const buttonStyle = Object.freeze({
  previous: ButtonStyle.Secondary,
  rewind: ButtonStyle.Secondary,
  pause: ButtonStyle.Primary,
  resume: ButtonStyle.Primary,
  skip: ButtonStyle.Secondary,
  stop: ButtonStyle.Danger,
  forward: ButtonStyle.Secondary,
  loop: ButtonStyle.Secondary,
  shuffle: ButtonStyle.Secondary,
  queue: ButtonStyle.Secondary,
  favorite: ButtonStyle.Success,
  volume_down: ButtonStyle.Secondary,
  volume_up: ButtonStyle.Secondary,
});

function button(action, token, label, emoji, disabled = false) {
  const customId = `tpm:panel:${token}:${action}`;
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setEmoji(emoji)
    .setStyle(buttonStyle[action])
    .setDisabled(disabled);
}

function progressText(summary) {
  const duration = summary.current?.info?.length ?? 0;
  const position = summary.position ?? 0;
  if (summary.current?.info?.isStream || duration <= 0) {
    return "`LIVE`";
  }
  return `
\`${formatDuration(position)}\` ${makeProgressBar(position, duration)} \`${formatDuration(duration)}\``;
}

export function buildPlayerPanel(guild, summary, playlists = []) {
  const token = summary.componentToken;
  const active = Boolean(summary.current);
  const current = summary.current;
  const embed = createBrandEmbed({
    color: active ? 0x5c6bc0 : 0x596275,
    title: active ? `🎵 ${truncate(trackTitle(current), 240)}` : "🎵 TANVEER PRIME MUSIC",
    url: active && trackUrl(current) ? trackUrl(current) : undefined,
    description: active
      ? `**${truncate(trackArtist(current), 250)}**\n${progressText(summary)}`
      : "No track is playing. Use **/play** to start music or **/queue** to inspect upcoming tracks.",
  });
  if (current?.info?.artworkUrl && /^https:\/\//i.test(current.info.artworkUrl)) {
    embed.setThumbnail(current.info.artworkUrl);
  }
  if (active) {
    embed.addFields(
      { name: "Requested by", value: current.requester?.id ? `<@${current.requester.id}>` : "Autoplay / saved track", inline: true },
      { name: "Queue", value: `${summary.queue.length} upcoming`, inline: true },
      { name: "Volume", value: `${summary.volume}%`, inline: true },
      { name: "Playback", value: `${summary.paused ? "Paused" : "Playing"} • Loop: ${summary.loop} • Autoplay: ${summary.autoplay ? "On" : "Off"}`, inline: false },
      { name: "Filters", value: summary.filters.length ? summary.filters.map((filter) => `\`${filter}\``).join(", ") : "None", inline: false },
    );
    if (summary.queue.length > 0) {
      const upcoming = summary.queue.slice(0, 3).map((track, index) => `${index + 1}. **${truncate(trackTitle(track), 90)}** — ${truncate(trackArtist(track), 60)}`);
      embed.addFields({ name: "Up next", value: upcoming.join("\n"), inline: false });
    }
  }
  embed.setFooter({ text: BRAND_FOOTER });

  const disabled = !active;
  const rows = [
    new ActionRowBuilder().addComponents(
      button("previous", token, "Previous", "⏮️", disabled),
      button("rewind", token, "Rewind 10s", "⏪", disabled),
      button(summary.paused ? "resume" : "pause", token, summary.paused ? "Resume" : "Pause", summary.paused ? "▶️" : "⏸️", disabled),
      button("skip", token, "Skip", "⏭️", disabled),
      button("stop", token, "Stop", "⏹️", disabled),
    ),
    new ActionRowBuilder().addComponents(
      button("forward", token, "Forward 10s", "⏩", disabled),
      button("loop", token, `Loop: ${summary.loop}`, "🔁", disabled),
      button("shuffle", token, "Shuffle", "🔀", disabled || summary.queue.length < 2),
      button("queue", token, "Queue", "📜", false),
      button("favorite", token, "Favorite", "⭐", disabled),
    ),
    new ActionRowBuilder().addComponents(
      button("volume_down", token, "Volume −", "🔉", disabled),
      button("volume_up", token, "Volume +", "🔊", disabled),
    ),
  ];

  if (summary.queue.length > 0) {
    const options = summary.queue.slice(0, 25).map((track, index) => ({
      label: truncate(trackTitle(track), 100),
      description: truncate(`${trackArtist(track)} • ${formatDuration(track.info?.length ?? 0)}`, 100),
      value: String(index + 1),
    }));
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`tpm:queue-select:${token}`)
        .setPlaceholder("Jump to an upcoming track…")
        .addOptions(options),
    ));
  }

  const availablePlaylists = playlists.slice(0, 25);
  if (availablePlaylists.length > 0) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`tpm:playlist-select:${token}`)
        .setPlaceholder("Play one of your saved playlists…")
        .addOptions(availablePlaylists.map((playlist) => ({
          label: truncate(playlist.name, 100),
          description: `${playlist.trackCount} saved track${playlist.trackCount === 1 ? "" : "s"}`,
          value: playlist.id,
        }))),
    ));
  }
  return { embeds: [embed], components: rows.slice(0, 5) };
}

export function buildQueueEmbed({ tracks, page, pageSize = 10, current = null, guildName = "Server" }) {
  const pages = Math.max(1, Math.ceil(tracks.length / pageSize));
  const safePage = Math.max(0, Math.min(pages - 1, page));
  const start = safePage * pageSize;
  const visible = tracks.slice(start, start + pageSize);
  const lines = visible.map((track, index) => {
    const requester = track.requester?.id ? ` • <@${track.requester.id}>` : "";
    return `**${start + index + 1}.** [${truncate(trackTitle(track), 120)}](${trackUrl(track) || "https://github.com/Tanveer9830/Discord-music-bot"}) — ${truncate(trackArtist(track), 80)} \`${formatDuration(track.info?.length ?? 0)}\`${requester}`;
  });
  const embed = createBrandEmbed({
    color: 0x5865f2,
    title: `📜 Music queue • ${truncate(guildName, 80)}`,
    description: [
      current ? `**Now playing:** [${truncate(trackTitle(current), 120)}](${trackUrl(current) || BRANDING.repository})` : "**Now playing:** Nothing",
      "",
      lines.length ? lines.join("\n") : "No upcoming tracks.",
      "",
      `Page ${safePage + 1}/${pages} • ${tracks.length} upcoming track${tracks.length === 1 ? "" : "s"}`,
    ].join("\n"),
  });
  return { embed, page: safePage, pages };
}

export function queuePageButtons(token, page, pages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tpm:qpage:${token}:${page - 1}`).setLabel("Previous").setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
    new ButtonBuilder().setCustomId(`tpm:qpage:${token}:${page + 1}`).setLabel("Next").setStyle(ButtonStyle.Secondary).setDisabled(page >= pages - 1),
  );
}

export function queueActionMenu(tracks, token) {
  const options = tracks.slice(0, 25).map((track, index) => ({
    label: truncate(`Remove #${index + 1}: ${trackTitle(track)}`, 100),
    description: truncate(trackArtist(track), 100),
    value: String(index + 1),
  }));
  if (options.length === 0) {
    return null;
  }
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`tpm:queue-remove:${token}`)
      .setPlaceholder("Queue actions — choose a track to remove…")
      .addOptions(options),
  );
}

export class MusicPanelManager {
  constructor({ client, music, database, logger }) {
    this.client = client;
    this.music = music;
    this.database = database;
    this.logger = logger;
    this.panels = new Map();
  }

  async show(interaction) {
    const summary = this.music.getPlayerSummary(interaction.guildId);
    if (!summary) {
      return null;
    }
    this.music.rotateComponentToken(interaction.guildId);
    const refreshed = this.music.getPlayerSummary(interaction.guildId);
    const playlists = this.database.listPlaylists(interaction.guildId, interaction.user.id);
    const payload = buildPlayerPanel(interaction.guild, refreshed, playlists);
    await interaction.reply(payload);
    const message = await interaction.fetchReply();
    this.panels.set(interaction.guildId, {
      channelId: message.channelId,
      messageId: message.id,
      token: refreshed.componentToken,
      ownerId: interaction.user.id,
      lastEdit: Date.now(),
      timer: null,
    });
    return message;
  }

  schedule(guildId, { positionOnly = false } = {}) {
    const entry = this.panels.get(String(guildId));
    if (!entry || entry.timer) {
      return;
    }
    const minInterval = positionOnly ? 12000 : 3500;
    const delay = Math.max(250, minInterval - (Date.now() - entry.lastEdit));
    entry.timer = setTimeout(() => {
      entry.timer = null;
      void this.#edit(String(guildId), entry);
    }, delay);
    entry.timer.unref?.();
  }

  async #edit(guildId, entry) {
    const channel = await this.client.channels.fetch(entry.channelId).catch(() => null);
    const message = await channel?.messages?.fetch(entry.messageId).catch(() => null);
    if (!message) {
      this.panels.delete(guildId);
      return;
    }
    const summary = this.music.getPlayerSummary(guildId);
    if (!summary) {
      this.panels.delete(guildId);
      return;
    }
    const playlists = this.database.listPlaylists(guildId, entry.ownerId);
    const payload = buildPlayerPanel(message.guild, summary, playlists);
    try {
      await message.edit(payload);
      entry.token = summary.componentToken;
      entry.lastEdit = Date.now();
    } catch (error) {
      this.logger.warn("Music panel could not be updated", { guildId, code: error?.code });
    }
  }

  isCurrentToken(guildId, token) {
    const state = this.music.getState(guildId);
    return Boolean(state && state.componentToken === token);
  }

  async close() {
    for (const entry of this.panels.values()) {
      if (entry.timer) {
        clearTimeout(entry.timer);
      }
    }
    this.panels.clear();
  }
}

export function buildSearchEmbed(query, tracks, sourceLabel = "Lavalink") {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🔎 Search results: ${truncate(query, 180)}`)
    .setDescription(tracks.slice(0, 10).map((track, index) => {
      const url = trackUrl(track) || BRANDING.repository;
      return `**${index + 1}.** [${truncate(trackTitle(track), 100)}](${url}) — ${truncate(trackArtist(track), 80)} \`${formatDuration(track.info?.length ?? 0)}\``;
    }).join("\n") || "No playable search results were returned.")
    .setFooter({ text: `${sourceLabel} • ${BRAND_FOOTER}` });
  return embed;
}

export function trackMenu(tracks, token, placeholder = "Select a track…") {
  const options = tracks.slice(0, 25).map((track, index) => ({
    label: truncate(trackTitle(track), 100),
    description: truncate(`${trackArtist(track)} • ${formatDuration(track.info?.length ?? 0)}`, 100),
    value: String(index),
  }));
  if (options.length === 0) {
    return null;
  }
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`tpm:search-select:${token}`)
      .setPlaceholder(placeholder)
      .addOptions(options),
  );
}

export function filterSelectMenu(token) {
  const presets = ["flat", "rock", "pop", "jazz", "classical", "bassboost", "nightcore", "vaporwave", "karaoke", "8d", "lowpass"];
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`tpm:filter-select:${token}`)
      .setPlaceholder("Choose a Lavalink audio filter…")
      .addOptions(presets.map((value) => ({ label: value === "8d" ? "8D rotation" : value[0].toUpperCase() + value.slice(1), value }))),
  );
}

export function loopSelectMenu(token, selected = "off") {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`tpm:loop-select:${token}`)
      .setPlaceholder("Choose a loop mode…")
      .addOptions(["off", "track", "queue"].map((value) => ({ label: value[0].toUpperCase() + value.slice(1), value, default: value === selected }))),
  );
}

export function metadataListEmbed(title, entries, formatEntry) {
  const embed = createBrandEmbed({
    color: 0x5865f2,
    title: truncate(title, 256),
    description: entries.length ? entries.slice(0, 5).map((entry, index) => `${index + 1}. ${formatEntry(entry)}`).join("\n\n") : "No metadata results were found.",
  });
  return embed;
}

export function buildPlaylistSelect(playlists, token) {
  if (!playlists.length) {
    return null;
  }
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`tpm:playlist-select:${token}`)
      .setPlaceholder("Choose a saved playlist to queue…")
      .addOptions(playlists.slice(0, 25).map((playlist) => ({
        label: truncate(playlist.name, 100),
        description: `${playlist.trackCount ?? playlist.tracks?.length ?? 0} tracks${playlist.visibility === "shared" ? " • shared" : ""}`,
        value: playlist.id,
      }))),
  );
}
