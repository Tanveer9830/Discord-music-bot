# Pterodactyl deployment

TANVEER PRIME MUSIC does not need root privileges, systemd, a web server, or an inbound game port. Pterodactyl owns process startup and restart behavior.

## Startup command

Use this startup command in the server's Startup tab:

```sh
npm start
```

Set the server's working directory to the project root. The required runtime is Node.js **22.13 or newer** with npm **10 or newer**. Use a Node 22/24 image with build support if the `better-sqlite3` native prebuilt binary is unavailable.

## Required environment variables

Add these privately in the Pterodactyl Startup variables (or use the private `.env` file if your egg preserves it):

| Variable | Required | Example / meaning |
|---|---:|---|
| `DISCORD_TOKEN` | yes | Bot token from the Discord Developer Portal; secret. |
| `DISCORD_CLIENT_ID` | yes | Discord application ID. |
| `DEV_GUILD_ID` | no | Development server ID for fast guild-scoped command registration. |
| `LAVALINK_HOST` | yes | Reachable hostname/IP for the existing Lavalink v4 service. |
| `LAVALINK_PORT` | yes | Lavalink port, commonly `2333`. |
| `LAVALINK_PASSWORD` | yes | The matching Lavalink server password; secret. |
| `LAVALINK_TLS` | no | `true` when the Lavalink endpoint uses TLS, otherwise `false`. |
| `LAVALINK_NODE_NAME` | no | Friendly node label, such as `primary`. |
| `LAVALINK_SEARCH_PREFIX` | no | `ytsearch` by default; source manager must be enabled in Lavalink. |
| `DATABASE_PATH` | no | Persistent path, e.g. `/home/container/data/music.sqlite`. |
| `DEPLOYMENT_MODE` | recommended | Set to `pterodactyl` for diagnostics. |
| `NODE_ENV` | recommended | Set to `production`. |
| `COMMAND_REGISTRATION` | no | `manual` is recommended; deploy with `npm run commands:deploy`. |

Do not put secrets in an egg's public description, a GitHub issue, a startup log, or source control. Keep Pterodactyl variables hidden from users who should not see them.

## Lavalink networking

`localhost` and `127.0.0.1` refer to the Pterodactyl container itself. If Lavalink is hosted on the same physical VPS but in a different container, use the private container/service hostname or a private host address reachable from this server. If Lavalink is on another machine, use its private DNS name or IP and firewall its port so only the bot host can reach it. Do not expose Lavalink publicly without suitable network restrictions.

Do not install or start Lavalink through this project. It connects to your existing server. Verify Lavalink's configured password, port, TLS setting, v4 API, source managers, and filter support.

## Installing / updating in a panel

If the panel permits Git and npm in the container, clone the repository into the server's persistent working directory and run `npm ci --ignore-scripts --omit=dev`. The locked `better-sqlite3` package includes prebuilt binaries for supported Linux x64/arm64 targets, so dependency lifecycle scripts are deliberately disabled. Select a supported Node 22/24 Linux image. If system packages are unavailable, do not try to use `apt` or `systemd` inside the container.

After setting variables, initialize storage and register commands once:

```sh
npm run db:init
npm run commands:deploy
```

For guild-scoped development commands, set `DEV_GUILD_ID` before deployment. Global command changes may take time to propagate.

To update safely, stop the server in the panel, make sure the working tree is clean, back up `data/music.sqlite`, update from the trusted branch, run `npm ci --ignore-scripts`, `npm test`, and `npm run db:init`, then start it again in the panel. The built-in `npm run update` can fast-forward a clean Git checkout, back up SQLite, run checks/migrations, and preserve `.env`/data, but it cannot restart a Pterodactyl server itself; use the panel to stop/start the process.

24/7 voice reconnection is best effort. Discord, Lavalink, panel scheduling, container restarts, or a changed voice channel can interrupt it; no continuous-uptime guarantee is made.
