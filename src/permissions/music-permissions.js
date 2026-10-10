import { PermissionFlagsBits } from "discord.js";

export function isAdministrator(interaction) {
  const permissions = interaction.memberPermissions ?? interaction.member?.permissions;
  try {
    return Boolean(permissions?.has(PermissionFlagsBits.Administrator));
  } catch {
    return false;
  }
}

export function isBotOwner(userId, ownerIds = []) {
  return ownerIds.includes(String(userId));
}

export function isDJ(interaction, settings, database, ownerIds = []) {
  if (isBotOwner(interaction.user.id, ownerIds) || isAdministrator(interaction)) {
    return true;
  }
  const member = interaction.member;
  if (settings.djRoleId) {
    const hasRole = member?.roles?.cache?.has?.(settings.djRoleId)
      ?? member?.roles?.includes?.(settings.djRoleId)
      ?? false;
    if (hasRole) {
      return true;
    }
  }
  return database.isController(interaction.guildId, interaction.user.id);
}

export function authorizeMusicAction(interaction, { database, music, ownerIds = [], action = "play", needsVoice = true, requireSharedVoice = true, allowDM = false } = {}) {
  if (!interaction.inGuild?.() && !interaction.guildId) {
    return allowDM ? { ok: true } : { ok: false, message: "This music action is available in a server only." };
  }
  const guildId = interaction.guildId;
  const settings = database.getGuildSettings(guildId);
  const userId = interaction.user.id;

  if (settings.allowedTextChannelIds.length > 0 && interaction.channelId && !settings.allowedTextChannelIds.includes(interaction.channelId)) {
    return { ok: false, message: "Music commands are restricted to the server's configured music text channel(s)." };
  }

  const isAdmin = isAdministrator(interaction) || isBotOwner(userId, ownerIds);
  const dj = isDJ(interaction, settings, database, ownerIds);
  if (settings.djRequiredActions.includes(action) && !dj) {
    return { ok: false, message: "This action is DJ-only. Ask a server administrator to configure DJ access." };
  }
  if (action === "settings" && !isAdmin) {
    return { ok: false, message: "Only a server administrator or the configured bot owner can change server music settings." };
  }
  if (needsVoice) {
    const voiceChannelId = interaction.member?.voice?.channelId
      ?? interaction.member?.voice?.channel?.id
      ?? music?.client?.guilds?.cache?.get(guildId)?.members?.cache?.get(userId)?.voice?.channelId
      ?? null;
    if (!voiceChannelId) {
      return { ok: false, message: "Join a voice channel first." };
    }
    if (settings.allowedVoiceChannelIds.length > 0 && !settings.allowedVoiceChannelIds.includes(voiceChannelId)) {
      return { ok: false, message: "That voice channel is not enabled for music in this server." };
    }
    const botChannelId = music?.getVoiceChannelId(guildId);
    if (requireSharedVoice && botChannelId && botChannelId !== voiceChannelId) {
      return { ok: false, message: "Join the voice channel where the bot is currently playing." };
    }
  }
  return { ok: true, settings, isAdmin, isDJ: dj };
}
