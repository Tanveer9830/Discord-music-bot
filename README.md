# TANVEER PRIME MUSIC

**Made by Tanveer** · **Discord: Tanveer5637**

A music-only Discord bot using Discord.js v14, Shoukaku, your existing Lavalink v4 server, and a persistent single-instance SQLite database. The player, queue, filters, playlist controls, and search interactions all live in Discord; **there is no external web dashboard**.

The permanent branding is centralized in `src/config/branding.js` and used by embeds, the Discord music panel, help/status responses, and the terminal startup banner. Normal server commands cannot remove the creator credit; someone who modifies the source can, as with any open-source project.

## Supported runtime

- Node.js **22.13 or newer** (Node 22/24 LTS) and npm **10 or newer**.
- Discord.js 14 and maintained Shoukaku 4.x for Lavalink v4.
- Ubuntu/Debian VPS, PM2, Docker Compose, and Pterodactyl.
- SQLite for one bot process. Do not run multiple bot instances against the same SQLite file. A PostgreSQL adapter is not included.
- An existing, reachable Lavalink v4 server. This project never installs Lavalink.

## One-command Ubuntu/VPS installation

The active authorized repository and branch for this delivery are:

- Repository: <https://github.com/Tanveer9830/Discord-music-bot>
- Install branch: `arena/9fd50881-discord-music-bot`

On Ubuntu/Debian with Node.js 22.13+ and npm 10+ already installed, run:

```bash
curl -fsSL 'https://raw.githubusercontent.com/Tanveer9830/Discord-music-bot/arena/9fd50881-discord-music-bot/install.sh' | bash
```

The installer checks Linux/architecture and Node/npm versions, verifies the hard-coded GitHub origin and selected branch, preserves an existing `.env` and data, installs the locked production dependencies, initializes SQLite migrations, offers a masked first-run setup when a TTY is available, and deploys slash commands if Discord credentials are present. Dependency installation uses `npm ci --ignore-scripts`: the pinned `better-sqlite3` package ships Linux x64/arm64 prebuilt binaries, so installs do not need to fetch Node headers or execute third-party lifecycle scripts. It does **not** install a new Lavalink server. It does not claim the bot is online unless a selected process manager starts it successfully.

The default install directory is `~/tanveer-prime-music`. To install into a different empty directory, set `TANVEER_INSTALL_DIR`. The installer does not silently update a previous checkout; use the safe update procedure below. If changes are merged into `main`, the equivalent main-branch URL is `https://raw.githubusercontent.com/Tanveer9830/Discord-music-bot/main/install.sh`.

### Safer inspect-before-run method

A shell installer executes code from the repository. Download and inspect it first if you prefer:

```bash
curl -fL 'https://raw.githubusercontent.com/Tanveer9830/Discord-music-bot/arena/9fd50881-discord-music-bot/install.sh' -o install.sh
less install.sh
bash install.sh
```

The installer prompts before privileged `apt` package installation, a global PM2 installation, or a recursive Docker data-directory ownership change. Review each prompt before approving. It does not disable system security, expose Lavalink ports, or remove files. In restricted Pterodactyl containers it does not attempt `apt`, `sudo`, `systemd`, or Lavalink installation.

## Manual installation

```bash
git clone --branch arena/9fd50881-discord-music-bot --depth 1 \
  https://github.com/Tanveer9830/Discord-music-bot.git tanveer-prime-music
cd tanveer-prime-music
npm ci --ignore-scripts
cp .env.example .env
chmod 600 .env
npm run setup
npm run db:init
npm run commands:deploy
npm start
```

If `npm run setup` has no terminal, it leaves `.env` unchanged. Edit `.env` locally and keep it private. The SQLite file, backups, logs, and populated environment files are ignored by Git.

## Configure Discord

1. Create a Discord application in the [Discord Developer Portal](https://discord.com/developers/applications), add a Bot user, and copy the **bot token** privately.
2. Copy the **Application ID** to `DISCORD_CLIENT_ID`.
3. Invite the bot with OAuth2 scopes `bot` and `applications.commands`. Grant at least View Channel, Send Messages, Embed Links, Read Message History, Connect, and Speak. Do not grant Administrator unless your own server policy requires it.
4. The bot uses `Guilds` and `GuildVoiceStates` intents only. It does not need Message Content or privileged member intents.
5. Set `DISCORD_TOKEN` and `DISCORD_CLIENT_ID` in `.env` or private Pterodactyl variables. Never put a real token in a commit, issue, terminal transcript, or chat.
6. For development, set `DEV_GUILD_ID` to your test server and run `npm run commands:deploy`. Guild commands update quickly. Clear `DEV_GUILD_ID` for global registration; global changes can take time to propagate.

## Connect to your existing Lavalink server

Set these private `.env` values:

```dotenv
LAVALINK_HOST=127.0.0.1
LAVALINK_PORT=2333
LAVALINK_PASSWORD=your-existing-lavalink-password
LAVALINK_TLS=false
LAVALINK_NODE_NAME=primary
LAVALINK_SEARCH_PREFIX=ytsearch
```

Use the actual host, port, password, and TLS setting from your existing Lavalink v4 configuration. `LAVALINK_NODES` may alternatively contain a JSON array of up to ten nodes, each with `name`, `host`, `port`, `password`, and optional `secure`/`group` fields.

**`localhost` means the current network namespace.** Inside Docker or Pterodactyl, `127.0.0.1` is the bot container, not the VPS host or another container. Use a reachable private IP, private DNS name, or container/service hostname. Restrict Lavalink network access to the bot host; do not expose its port publicly without a firewall or other suitable access control.

The node's configured source managers determine what can play. The default text-search prefix is `ytsearch`; `scsearch` can be selected in `/search` if SoundCloud is enabled. YouTube/SoundCloud URL availability depends on Lavalink's current source support. Spotify URLs are **metadata links, not audio streams**; use a supported audio source or search by track name. The bot does not claim that Spotify metadata can be streamed.

Check the current live configuration without starting the bot:

```bash
npm run diagnostics
```

That command contacts Discord and each configured Lavalink node, reports only status/version/capability summaries, and never prints the token or password. To validate the environment without network checks while credentials are incomplete:

```bash
node scripts/diagnostics.js --config-only --allow-missing
```

## Hosting modes

### Ubuntu VPS — foreground Node.js

```bash
cd ~/tanveer-prime-music
npm start
```

This stays in the foreground; use a process manager for automatic restarts. The application prints the branded ASCII banner on each real start, followed by its version, UTC startup time, environment/deployment mode, and live Discord/Lavalink/guild/player status. Secrets are not printed.

### PM2

Choose `pm2` during setup or set `DEPLOYMENT_MODE=pm2`. The installer can install PM2 globally after an explicit privileged-install prompt and start `ecosystem.config.cjs`:

```bash
pm2 status
pm2 logs tanveer-prime-music
pm2 restart tanveer-prime-music --update-env
```

For reboot persistence, run `pm2 startup`, follow the exact command PM2 prints for your host, then run `pm2 save`. The ecosystem config uses one forked process, automatic restart delay, and a memory restart limit.

### Docker Compose

Configure `.env`, ensure Docker Engine and Compose v2 are installed, then:

```bash
docker compose up -d --build
docker compose logs -f tanveer-prime-music
docker compose down
```

Compose uses persistent `./data`, `./logs`, and `./backups` bind mounts, a non-root UID/GID, a read-only container root filesystem, and no published ports. The installer sets the bind-mount UID/GID; when run as root it asks before recursively reassigning ownership of those existing data directories. For a manual install, set `DOCKER_UID`/`DOCKER_GID` in `.env` to the non-root IDs that can write the bind mounts (including an existing SQLite file). Do not run the container as root just to bypass ownership. Lavalink must be reachable from inside the container. `docker compose down` preserves these host data directories.

### Pterodactyl

Use `npm start` as the server startup command and let the panel control process restarts. Set the environment variables from [PTERODACTYL.md](PTERODACTYL.md); use a persistent server directory for `DATABASE_PATH`. Do not run `systemd` or `apt` inside a restricted container. The panel is the process manager and restart authority.

## Music commands

All registered slash commands have implementations; they are not placeholder registrations.

- **Playback:** `/play`, `/playnext`, `/playskip`, `/playtop`, `/pause`, `/resume`, `/skip`, `/previous`, `/stop`, `/seek`, `/forward`, `/rewind`, `/restart`, `/join`, `/leave`, `/disconnect`, `/nowplaying`, `/panel`.
- **Queue:** `/queue` (paged), `/remove`, `/move`, `/swap`, `/clear`, `/shuffle`, `/unshuffle`, `/skipto`, `/queueinfo`, `/history`, `/deduplicate`, `/reversequeue`, `/savequeue`, `/loadqueue`.
- **Audio:** `/volume`, `/equalizer`, `/bassboost`, `/filter`, `/clearfilters`, `/nightcore`, `/vaporwave`, `/karaoke`, `/timescale`, `/8d`, `/lowpass`, `/rotation`, `/distortion`, `/channelmix`.
- **Discovery:** `/search`, `/lyrics`, `/artist`, `/album`, `/similar`, `/recommend`, `/radio`, `/random`, `/favorites`, `/favorite`, `/unfavorite`, `/recentlyplayed`.
- **Playlists:** `/playlist create`, `add`, `remove`, `delete`, `rename`, `view`, `play`, `import`, `export`, `share`, and `duplicate`.
- **Session/server controls:** `/loop`, `/autoplay`, `/247`, `/stay`, `/voteskip`, `/announce`, `/dj`, `/musicsettings`, `/musicreset`.
- **Status/help:** `/health`, `/help`, `/info`, `/stats`.

Equalizer, 8D, karaoke, timescale, low-pass, rotation, distortion, and channel-mix call native Lavalink filters. If a node does not advertise or accept a filter, the bot reports the unsupported capability instead of pretending it worked. `/lyrics` uses a best-effort public lyrics lookup; `/artist` and `/album` query MusicBrainz and can fail gracefully when that service is unavailable. `/similar`, `/recommend`, and `/radio` transparently use real Lavalink source-search results; Lavalink has no standard personalized radio/recommendation endpoint in this integration. These are not fabricated recommendation feeds or provider radio streams.

## Discord player panel and permissions

`/panel` or `/nowplaying` creates a branded in-Discord panel with track/artwork, requester, position/progress, queue, volume, filters, playback status, and controls for previous, rewind, pause/resume, skip, stop, forward, loop, shuffle, queue, favorite, and volume changes. It also offers upcoming-track and saved-playlist selectors when available. Search, queue, filter, and loop flows include select menus. Components are permission-checked, rate-limited, and expire safely; stale panels cannot control a disconnected player.

Server administrators can configure a DJ role with `/dj role`, authorize controller users with `/dj authorize`, and choose which actions are DJ-only with `/dj action`. The same checks apply to buttons and select menus as to commands. `/musicsettings` persists per-server volume/queue/channel/vote-skip/idle/autoplay/loop/history/announcement/24/7 defaults; `/musicreset` resets those settings and DJ controllers but preserves playlists, favorites, saved queues, history, and credentials.

24/7 stay/reconnect is a best-effort policy, not an uptime guarantee. Discord, Lavalink, the host, network maintenance, and panel/container lifecycle can interrupt playback or voice. Lavalink may resume a player when the server supports it; the bot cannot guarantee an exact point-in-track recovery after every crash.

## Playlists and imports

Playlists, favorites, server settings, DJ controllers, listening history, saved queues, and session recovery data are stored in the local SQLite database. Playlist import accepts JSON with 1–100 supported source URLs, for example:

```json
{
  "name": "Road trip",
  "tracks": [
    { "title": "Track title", "artist": "Artist", "url": "https://www.youtube.com/watch?v=..." }
  ]
}
```

Import URLs are validated before storage and re-resolved through Lavalink when played. Playlists are private by default; `/playlist share` creates a read-only share code, which should be treated as access to that playlist. User history is per-server/per-user and can be disabled by an administrator. Database backups contain user-created music data; protect them like private data.

## Data, logs, and recovery

- SQLite default: `./data/music.sqlite` (WAL mode, foreign keys, versioned migrations, owner-only file permissions where supported).
- Backups are stored under `./backups` and excluded from Git.
- `.env`, database files, logs, and backups are excluded from Git.
- The bot persists active track/queue/session metadata so a restart can restore queued tracks where the source still resolves. Exact position recovery depends on Lavalink/source seek support.
- Keep one bot process per SQLite file. Use regular host-level encrypted/off-host backups according to your retention policy.

Safe update from a Git checkout:

```bash
npm run update
```

The updater refuses dirty source trees, fetches only the current trusted branch, requires a fast-forward, backs up SQLite, installs dependencies, runs syntax/lint/tests and migrations, and attempts a local code rollback if a check fails. It restarts PM2/systemd/Docker only after successful checks; direct Node and Pterodactyl modes require a manual restart through their process controller. Inspect the backup path printed by the updater. Local `.env` and data are not part of Git updates.

## Development and tests

```bash
npm ci --ignore-scripts
npm run check
npm run lint
npm test
```

CI runs these checks on Node 22 and 24 with least-privilege read-only GitHub permissions. No production secrets are required in CI. Live Discord login, a reachable Lavalink instance, actual Discord voice playback, provider availability, Docker host privileges, and Pterodactyl lifecycle tests require a configured deployment and cannot be simulated by the unit suite.

## Branding and license

Official project name: **TANVEER PRIME MUSIC**

Permanent creator watermark: **Made by Tanveer**

Official Discord username: **Tanveer5637**

MIT License — see [LICENSE](LICENSE).
