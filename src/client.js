import { Client, EmbedBuilder, GatewayIntentBits, REST, Routes, Events } from "discord.js";
import { Connectors, Shoukaku } from "shoukaku";
import { commandDefinitions } from "./commands/definitions.js";
import { createInteractionHandler } from "./commands/handler.js";
import { MusicDatabase } from "./database/database.js";
import { BRAND_FOOTER } from "./config/branding.js";
import { createLogger } from "./utils/logger.js";
import { MusicManager } from "./music/music-manager.js";
import { MusicPanelManager } from "./panels/music-panel.js";
import { nodeUrl } from "./config/env.js";
import { trackArtist, trackTitle, trackUrl } from "./music/track-utils.js";

export function createDiscordClient() {
  return new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });
}

export function createShoukaku(client, config) {
  const nodes = config.nodes.map((node) => ({
    name: node.name,
    url: nodeUrl(node),
    auth: node.password,
    secure: node.secure,
    ...(node.group ? { group: node.group } : {}),
  }));
  return new Shoukaku(new Connectors.DiscordJS(client), nodes, {
    resume: true,
    resumeTimeout: 60,
    resumeByLibrary: true,
    reconnectTries: 8,
    reconnectInterval: 5,
    restTimeout: 30,
    moveOnDisconnect: nodes.length > 1,
    userAgent: "TANVEER-PRIME-MUSIC/1.0 (https://github.com/Tanveer9830/Discord-music-bot)",
  });
}

export function commandRegistrationRoute(config) {
  return config.devGuildId
    ? Routes.applicationGuildCommands(config.clientId, config.devGuildId)
    : Routes.applicationCommands(config.clientId);
}

export async function deployApplicationCommands(config, token, logger = createLogger()) {
  if (!config.clientId || !token) {
    throw new Error("Discord application ID and bot token are required to register slash commands.");
  }
  const rest = new REST({ version: "10" }).setToken(token);
  const route = commandRegistrationRoute(config);
  await rest.put(route, { body: commandDefinitions });
  const scope = config.devGuildId ? `development guild ${config.devGuildId}` : "global application commands";
  logger.info("Discord slash commands registered", { count: commandDefinitions.length, scope });
  return { count: commandDefinitions.length, scope };
}

export function createServices(config) {
  const logger = createLogger(config.logLevel);
  const client = createDiscordClient();
  const database = new MusicDatabase(config.databasePath);
  const panelRef = { current: null };
  const shoukaku = createShoukaku(client, config);
  const music = new MusicManager({
    client,
    shoukaku,
    database,
    config,
    logger,
    onStateChange: (guildId, options) => panelRef.current?.schedule(guildId, options),
    onAnnouncement: async (guildId, track) => {
      const settings = database.getGuildSettings(guildId);
      const guild = client.guilds.cache.get(guildId);
      const channel = settings.announceChannelId
        ? client.channels.cache.get(settings.announceChannelId)
        : guild?.systemChannel;
      if (!channel?.isTextBased?.() || !track) {
        return;
      }
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`🎵 Now playing: ${trackTitle(track).slice(0, 200)}`)
        .setDescription(`**${trackArtist(track).slice(0, 200)}**${trackUrl(track) ? `\n[Open track](${trackUrl(track)})` : ""}`)
        .setFooter({ text: BRAND_FOOTER });
      if (track.info?.artworkUrl && /^https:\/\//i.test(track.info.artworkUrl)) {
        embed.setThumbnail(track.info.artworkUrl);
      }
      await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {
        logger.warn("Now-playing announcement could not be sent", { guildId });
      });
    },
  });
  const panels = new MusicPanelManager({ client, music, database, logger });
  panelRef.current = panels;
  const handler = createInteractionHandler({ client, database, music, panels, shoukaku, config, logger });
  client.on(Events.InteractionCreate, (interaction) => {
    void handler(interaction);
  });
  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    void music.onVoiceStateUpdate(oldState, newState).catch((error) => {
      logger.warn("Voice-state recovery action failed", { guildId: newState.guild.id, error: error?.message });
    });
  });

  let commandsRegisteredOnStartup = false;
  client.once(Events.ClientReady, () => {
    const nodes = music.getNodeStatuses();
    logger.info("Discord client is ready", {
      guilds: client.guilds.cache.size,
      lavalinkConnectedNodes: nodes.filter((node) => node.connected).length,
    });
    void music.restoreSessions().catch((error) => logger.warn("Saved music session restoration failed", { error: error?.message }));
    if (config.commandRegistration === "on-startup" && !commandsRegisteredOnStartup) {
      commandsRegisteredOnStartup = true;
      void deployApplicationCommands(config, config.token, logger).catch((error) => {
        logger.error("Automatic slash command registration failed", { error: error?.message });
      });
    }
  });

  return { client, database, shoukaku, music, panels, logger };
}
