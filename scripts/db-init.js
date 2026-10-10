import { loadConfig } from "../src/config/env.js";
import { MusicDatabase } from "../src/database/database.js";

const config = loadConfig();
if (config.errors.length > 0) {
  console.error(`Configuration error: ${config.errors.join("; ")}`);
  process.exitCode = 1;
} else {
  const database = new MusicDatabase(config.databasePath);
  console.log(`SQLite database initialized; schema version ${database.getMigrationVersion()}.`);
  database.close();
}
