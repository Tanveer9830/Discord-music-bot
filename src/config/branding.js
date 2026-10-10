import { EmbedBuilder } from "discord.js";

export const BRANDING = Object.freeze({
  project: "TANVEER PRIME MUSIC",
  creator: "Made by Tanveer",
  discord: "Tanveer5637",
  footer: "Made by Tanveer • Discord: Tanveer5637",
  repository: "https://github.com/Tanveer9830/Discord-music-bot",
});

export const BRAND_FOOTER = BRANDING.footer;

export function createBrandEmbed(options = {}) {
  const embed = new EmbedBuilder(options);
  embed.setFooter({ text: BRAND_FOOTER });
  return embed;
}

function center(text, width) {
  const remaining = Math.max(0, width - text.length);
  const left = Math.floor(remaining / 2);
  return `${" ".repeat(left)}${text}${" ".repeat(remaining - left)}`;
}

export function buildStartupBanner({ version = "unknown", startedAt = new Date(), environment = "production", deployment = "node" } = {}) {
  const art = [
    "████████╗ █████╗ ███╗   ██╗██╗   ██╗███████╗██████╗",
    "╚══██╔══╝██╔══██╗████╗  ██║██║   ██║██╔════╝██╔══██╗",
    "   ██║   ███████║██╔██╗ ██║██║   ██║█████╗  ██████╔╝",
    "   ██║   ██╔══██║██║╚██╗██║╚██╗ ██╔╝██╔══╝  ██╔══██╗",
    "   ██║   ██║  ██║██║ ╚████║ ╚████╔╝ ███████╗██║  ██║",
    "   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═══╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝",
  ];
  const width = Math.max(68, ...art.map((line) => line.length + 4), BRANDING.project.length + 8);
  const inside = width - 4;
  const blank = `║${" ".repeat(width - 2)}║`;
  const framed = (text) => `║ ${center(text, inside)} ║`;
  const artLines = art.map((line) => `║ ${center(line, inside)} ║`);
  const horizontal = `╔${"═".repeat(width - 2)}╗`;
  const bottom = `╚${"═".repeat(width - 2)}╝`;
  const details = [
    `Version: ${version}`,
    `Startup UTC: ${startedAt.toISOString()}`,
    `Environment: ${environment} | Deployment: ${deployment}`,
    "Discord: initializing | Lavalink: initializing",
    "Connected guilds: pending | Active music players: 0",
  ];
  return [
    horizontal,
    blank,
    ...artLines,
    blank,
    framed(BRANDING.project),
    framed(BRANDING.creator),
    framed(`Discord: ${BRANDING.discord}`),
    blank,
    bottom,
    ...details,
  ].join("\n");
}

export function printStartupBanner(options) {
  console.log(buildStartupBanner(options));
}

export function printRuntimeStatus({ version, startedAt, environment, deployment, discordStatus, lavalinkStatus, guilds = 0, players = 0 }) {
  console.log([
    `[${BRANDING.project}] Runtime status`,
    `Version: ${version}`,
    `Startup UTC: ${startedAt.toISOString()}`,
    `Environment: ${environment} | Deployment: ${deployment}`,
    `Discord: ${discordStatus}`,
    `Lavalink: ${lavalinkStatus}`,
    `Connected guilds: ${guilds} | Active music players: ${players}`,
    BRAND_FOOTER,
  ].join("\n"));
}
