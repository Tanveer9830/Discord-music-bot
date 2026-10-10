import { once } from "node:events";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Events } from "discord.js";
import { loadConfig, validateRequiredConfig } from "./config/env.js";
import { printRuntimeStatus, printStartupBanner } from "./config/branding.js";
import { createServices } from "./client.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageData = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const version = packageData.version;
const startedAt = new Date();

export async function startApplication() {
  const config = loadConfig();
  printStartupBanner({
    version,
    startedAt,
    environment: config.environment,
    deployment: config.deployment,
  });
  const errors = validateRequiredConfig(config);
  if (errors.length > 0) {
    console.error(`[TANVEER PRIME MUSIC] Configuration is incomplete or invalid:\n${errors.map((error) => `- ${error}`).join("\n")}\nSecrets belong in the private .env file only.`);
    process.exitCode = 1;
    return null;
  }

  if (!isNodeSupported(process.versions.node)) {
    console.error(`[TANVEER PRIME MUSIC] Node.js ${process.versions.node} is too old. Node.js 22.13 or newer is required.`);
    process.exitCode = 1;
    return null;
  }

  let services;
  let shutdownPromise = null;
  const shutdown = async (signal = "shutdown", preserveLavalinkPlayers = true) => {
    if (shutdownPromise) {
      return shutdownPromise;
    }
    shutdownPromise = (async () => {
      services?.logger.info("Graceful shutdown started", { signal });
      await services?.music.shutdown({ preserveLavalinkPlayers }).catch((error) => {
        services?.logger.warn("Could not persist all music state during shutdown", { error: error?.message });
      });
      await services?.panels.close().catch(() => {});
      for (const node of services?.shoukaku.nodes.values() ?? []) {
        node.disconnect(1000, "TANVEER PRIME MUSIC graceful shutdown");
      }
      services?.client.destroy();
      services?.database.close();
      services?.logger.info("Shutdown complete");
    })();
    return shutdownPromise;
  };

  try {
    services = createServices(config);
    const ready = once(services.client, Events.ClientReady);
    process.once("SIGINT", () => {
      void shutdown("SIGINT").finally(() => {
        process.exitCode = 0;
      });
    });
    process.once("SIGTERM", () => {
      void shutdown("SIGTERM").finally(() => {
        process.exitCode = 0;
      });
    });
    process.on("unhandledRejection", (reason) => {
      services.logger.error("Unhandled promise rejection", { error: reason instanceof Error ? reason.message : String(reason) });
    });
    process.once("uncaughtException", (error) => {
      services.logger.error("Uncaught exception", { error: error?.message ?? "unknown error" });
      void shutdown("uncaughtException", false).finally(() => {
        process.exitCode = 1;
      });
    });

    services.logger.info("Application initialized", {
      version,
      database: "SQLite",
      configuredLavalinkNodes: config.nodes.length,
      commandRegistration: config.commandRegistration,
    });
    await services.client.login(config.token);
    let readyTimeout;
    try {
      await Promise.race([
        ready,
        new Promise((_, reject) => {
          readyTimeout = setTimeout(() => reject(new Error("Discord did not become ready within 30 seconds.")), 30000);
        }),
      ]);
    } finally {
      clearTimeout(readyTimeout);
    }
    const nodeStatuses = services.music.getNodeStatuses();
    const connectedNodes = nodeStatuses.filter((node) => node.connected);
    printRuntimeStatus({
      version,
      startedAt,
      environment: config.environment,
      deployment: config.deployment,
      discordStatus: "connected (ready)",
      lavalinkStatus: nodeStatuses.length
        ? `${connectedNodes.length}/${nodeStatuses.length} connected${connectedNodes.length ? ` — ${connectedNodes.map((node) => node.name).join(", ")}` : " — reconnect attempts continue"}`
        : "not configured",
      guilds: services.client.guilds.cache.size,
      players: services.music.getActivePlayerCount(),
    });
    services.logger.info("TANVEER PRIME MUSIC is online", {
      guilds: services.client.guilds.cache.size,
      lavalinkConnectedNodes: connectedNodes.length,
      activePlayers: services.music.getActivePlayerCount(),
    });
    return { ...services, shutdown };
  } catch (error) {
    services?.logger.error("Application startup failed", { error: error?.message ?? "unknown error" });
    if (!services) {
      console.error(`[TANVEER PRIME MUSIC] Startup failed: ${error?.message ?? "unknown error"}`);
    }
    await shutdown("startup failure", false).catch(() => {});
    process.exitCode = 1;
    return null;
  }
}

function isNodeSupported(versionValue) {
  const [major, minor] = versionValue.split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 13);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await startApplication();
}
