import { loadConfig, validateRequiredConfig } from "../src/config/env.js";
import { deployApplicationCommands } from "../src/client.js";
import { createLogger } from "../src/utils/logger.js";

const config = loadConfig();
const errors = validateRequiredConfig(config, { discord: true, lavalink: false });
if (errors.length > 0) {
  console.error(`Slash command registration cannot start:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  process.exitCode = 1;
} else {
  const logger = createLogger(config.logLevel);
  try {
    const result = await deployApplicationCommands(config, config.token, logger);
    console.log(`Registered ${result.count} slash commands to ${result.scope}.`);
    if (!config.devGuildId) {
      console.log("Global command propagation can take time. Set DEV_GUILD_ID during development for fast updates.");
    }
  } catch (error) {
    logger.error("Slash command registration failed", { error: error?.message ?? "unknown error" });
    console.error("Command registration failed. Verify the bot token, application ID, and application permissions; no credential was printed.");
    process.exitCode = 1;
  }
}
