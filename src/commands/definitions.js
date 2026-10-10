import { ChannelType, SlashCommandBuilder } from "discord.js";

const builders = [];
const add = (builder) => builders.push(builder);
const text = (option, name, description, required = true, maxLength = 200) => option.setName(name).setDescription(description).setRequired(required).setMaxLength(maxLength);
const integer = (option, name, description, required = true, min = 1, max = 1000) => option.setName(name).setDescription(description).setRequired(required).setMinValue(min).setMaxValue(max);
const number = (option, name, description, required = true, min = 0, max = 1000) => option.setName(name).setDescription(description).setRequired(required).setMinValue(min).setMaxValue(max);
const bool = (option, name, description, required = true) => option.setName(name).setDescription(description).setRequired(required);
const choice = (option, name, description, options, required = true) => {
  option.setName(name).setDescription(description).setRequired(required);
  for (const [label, value] of options) {
    option.addChoices({ name: label, value });
  }
  return option;
};
const make = (name, description) => new SlashCommandBuilder().setName(name).setDescription(description).setDMPermission(false);

add(make("play", "Play a supported music URL or search for a track")
  .addStringOption((o) => text(o, "query", "Song name, artist, or supported URL")));
add(make("playnext", "Add a track at the front of the upcoming queue")
  .addStringOption((o) => text(o, "query", "Song name, artist, or supported URL")));
add(make("playskip", "Start a track now and keep the previous track queued")
  .addStringOption((o) => text(o, "query", "Song name, artist, or supported URL")));
add(make("playtop", "Put a track at the front of the upcoming queue")
  .addStringOption((o) => text(o, "query", "Song name, artist, or supported URL")));
add(make("pause", "Pause the current track"));
add(make("resume", "Resume the paused track"));
add(make("skip", "Skip the current track"));
add(make("previous", "Play the previous track from this player session"));
add(make("stop", "Stop playback and clear the upcoming queue"));
add(make("seek", "Seek to a position in the current track")
  .addNumberOption((o) => number(o, "seconds", "Position in seconds", true, 0, 21600)));
add(make("forward", "Move forward in the current track")
  .addIntegerOption((o) => integer(o, "seconds", "Seconds to move", false, 1, 300)));
add(make("rewind", "Move backward in the current track")
  .addIntegerOption((o) => integer(o, "seconds", "Seconds to move", false, 1, 300)));
add(make("restart", "Restart the current track from the beginning"));
add(make("nowplaying", "Show the branded interactive music player"));
add(make("panel", "Create or refresh the Discord music control panel"));
add(make("join", "Join your current voice channel"));
add(make("leave", "Stop music and leave voice"));
add(make("disconnect", "Disconnect the bot from voice"));

add(make("queue", "View the upcoming queue with pagination")
  .addIntegerOption((o) => integer(o, "page", "Queue page number", false, 1, 100)));
add(make("remove", "Remove one upcoming track by position")
  .addIntegerOption((o) => integer(o, "position", "1-based upcoming queue position")));
add(make("move", "Move one upcoming track to a new position")
  .addIntegerOption((o) => integer(o, "from", "Current 1-based position"))
  .addIntegerOption((o) => integer(o, "to", "New 1-based position")));
add(make("swap", "Swap two upcoming queue positions")
  .addIntegerOption((o) => integer(o, "first", "First 1-based position"))
  .addIntegerOption((o) => integer(o, "second", "Second 1-based position")));
add(make("clear", "Clear the upcoming queue"));
add(make("shuffle", "Shuffle upcoming tracks"));
add(make("unshuffle", "Restore the pre-shuffle queue order"));
add(make("skipto", "Jump to an upcoming track by position")
  .addIntegerOption((o) => integer(o, "position", "1-based upcoming queue position")));
add(make("queueinfo", "Show queue length, duration, and playback status"));
add(make("history", "Show your recently played tracks"));
add(make("deduplicate", "Remove duplicate tracks from the upcoming queue"));
add(make("reversequeue", "Reverse the order of upcoming tracks"));
add(make("savequeue", "Save the current and upcoming tracks privately")
  .addStringOption((o) => text(o, "name", "Name for your saved queue", true, 50)));
add(make("loadqueue", "Append one of your saved queues")
  .addStringOption((o) => text(o, "name", "Name of your saved queue", true, 50)));

add(make("volume", "Set playback volume within the server limit")
  .addIntegerOption((o) => integer(o, "value", "Volume percentage", true, 0, 1000)));
add(make("equalizer", "Set a built-in Lavalink equalizer preset")
  .addStringOption((o) => choice(o, "preset", "Equalizer preset", [["Flat", "flat"], ["Rock", "rock"], ["Pop", "pop"], ["Jazz", "jazz"], ["Classical", "classical"], ["Bass boost", "bassboost"]])));
add(make("bassboost", "Enable or clear a genuine Lavalink equalizer bass preset")
  .addBooleanOption((o) => bool(o, "enabled", "Enable bass boost")));
add(make("filter", "Choose a supported native Lavalink filter preset")
  .addStringOption((o) => choice(o, "preset", "Filter preset", [["Off", "off"], ["Flat", "flat"], ["Rock", "rock"], ["Pop", "pop"], ["Jazz", "jazz"], ["Classical", "classical"], ["Bass boost", "bassboost"], ["Nightcore", "nightcore"], ["Vaporwave", "vaporwave"], ["Karaoke", "karaoke"], ["8D rotation", "8d"], ["Low-pass", "lowpass"]])));
add(make("clearfilters", "Clear all active Lavalink filters"));
add(make("nightcore", "Toggle the native Lavalink nightcore timescale")
  .addBooleanOption((o) => bool(o, "enabled", "Enable nightcore")));
add(make("vaporwave", "Toggle the native Lavalink vaporwave timescale")
  .addBooleanOption((o) => bool(o, "enabled", "Enable vaporwave")));
add(make("karaoke", "Toggle the native Lavalink karaoke filter")
  .addBooleanOption((o) => bool(o, "enabled", "Enable karaoke filter")));
add(make("timescale", "Set native Lavalink playback speed and pitch")
  .addNumberOption((o) => number(o, "speed", "Playback speed (0.5–2.0)", false, 0.5, 2))
  .addNumberOption((o) => number(o, "pitch", "Pitch (0.5–2.0)", false, 0.5, 2))
  .addNumberOption((o) => number(o, "rate", "Rate (0.5–2.0)", false, 0.5, 2)));
add(make("8d", "Toggle the native Lavalink rotating 8D filter")
  .addBooleanOption((o) => bool(o, "enabled", "Enable 8D rotation")));
add(make("lowpass", "Apply a native Lavalink low-pass filter")
  .addIntegerOption((o) => integer(o, "smoothing", "Smoothing value (1–1000)", true, 1, 1000)));
add(make("rotation", "Set native Lavalink audio rotation speed")
  .addNumberOption((o) => number(o, "rate", "Rotation Hz (0.1–5.0)", true, 0.1, 5)));
add(make("distortion", "Set native Lavalink distortion amount")
  .addNumberOption((o) => number(o, "amount", "Distortion amount (0–1)", true, 0, 1)));
add(make("channelmix", "Set native Lavalink stereo-to-mono mix")
  .addNumberOption((o) => number(o, "amount", "Cross-channel mix (0–1)", true, 0, 1)));

add(make("search", "Search a configured Lavalink source and choose a track")
  .addStringOption((o) => text(o, "query", "Song name, artist, or supported URL"))
  .addStringOption((o) => choice(o, "source", "Search source", [["Default source", "default"], ["YouTube", "ytsearch"], ["SoundCloud", "scsearch"]], false)));
add(make("lyrics", "Look up lyrics for the current track using a public provider"));
add(make("artist", "Look up real artist metadata from MusicBrainz")
  .addStringOption((o) => text(o, "name", "Artist name", true, 100)));
add(make("album", "Look up real release metadata from MusicBrainz")
  .addStringOption((o) => text(o, "name", "Album or release name", true, 150)));
add(make("similar", "Search Lavalink for tracks related to a query (provider search, not a recommendation feed)")
  .addStringOption((o) => text(o, "query", "Artist or track to search around", false, 150)));
add(make("recommend", "Search Lavalink using a music recommendation-style seed")
  .addStringOption((o) => text(o, "seed", "Artist, genre, or track seed", true, 150)));
add(make("radio", "Queue matching Lavalink search results for a music seed")
  .addStringOption((o) => text(o, "seed", "Artist, genre, or track seed", true, 150)));
add(make("random", "Play a random real result from a music genre search")
  .addStringOption((o) => choice(o, "genre", "Genre", [["Ambient", "ambient music"], ["Classical", "classical music"], ["Electronic", "electronic music"], ["Hip hop", "hip hop music"], ["Jazz", "jazz music"], ["Pop", "pop music"], ["Rock", "rock music"], ["Soundtrack", "film soundtrack"]], false)));
add(make("favorites", "View your saved favorite tracks"));
add(make("favorite", "Save the current track to your favorites"));
add(make("unfavorite", "Remove a favorite by title or URL")
  .addStringOption((o) => text(o, "track", "Track title or URL; omit to use the current track", false, 200)));
add(make("recentlyplayed", "Show your recently played tracks"));

const playlist = make("playlist", "Create and manage persistent music playlists");
playlist.addSubcommand((s) => s.setName("create").setDescription("Create a private playlist")
  .addStringOption((o) => text(o, "name", "Playlist name", true, 50)));
playlist.addSubcommand((s) => s.setName("add").setDescription("Add a supported URL or search result to a playlist")
  .addStringOption((o) => text(o, "name", "Playlist name", true, 50))
  .addStringOption((o) => text(o, "query", "Track title or supported URL")));
playlist.addSubcommand((s) => s.setName("remove").setDescription("Remove a playlist track by position")
  .addStringOption((o) => text(o, "name", "Playlist name", true, 50))
  .addIntegerOption((o) => integer(o, "position", "1-based playlist position", true, 1, 100)));
playlist.addSubcommand((s) => s.setName("delete").setDescription("Delete one of your playlists")
  .addStringOption((o) => text(o, "name", "Playlist name", true, 50)));
playlist.addSubcommand((s) => s.setName("rename").setDescription("Rename one of your playlists")
  .addStringOption((o) => text(o, "name", "Current playlist name", true, 50))
  .addStringOption((o) => text(o, "new_name", "New playlist name", true, 50)));
playlist.addSubcommand((s) => s.setName("view").setDescription("View a playlist or list your saved playlists")
  .addStringOption((o) => text(o, "name", "Playlist name (omit to list playlists)", false, 50)));
playlist.addSubcommand((s) => s.setName("play").setDescription("Play a saved playlist or shared access code")
  .addStringOption((o) => text(o, "name", "Playlist name or shared access code", true, 50)));
playlist.addSubcommand((s) => s.setName("import").setDescription("Import a JSON playlist with supported track URLs")
  .addStringOption((o) => text(o, "name", "New playlist name", true, 50))
  .addStringOption((o) => text(o, "json", "JSON object with tracks [{title, artist, url}]", true, 4000)));
playlist.addSubcommand((s) => s.setName("export").setDescription("Export a playlist as a JSON attachment")
  .addStringOption((o) => text(o, "name", "Playlist name", true, 50)));
playlist.addSubcommand((s) => s.setName("share").setDescription("Create a read-only share code for your playlist")
  .addStringOption((o) => text(o, "name", "Playlist name", true, 50)));
playlist.addSubcommand((s) => s.setName("duplicate").setDescription("Copy one of your playlists")
  .addStringOption((o) => text(o, "name", "Playlist to copy", true, 50))
  .addStringOption((o) => text(o, "new_name", "Name for the copy", true, 50)));
add(playlist);

add(make("loop", "Set the current player's loop mode")
  .addStringOption((o) => choice(o, "mode", "Loop mode", [["Off", "off"], ["Track", "track"], ["Queue", "queue"]])));
add(make("autoplay", "Toggle source-search autoplay when the queue ends")
  .addBooleanOption((o) => bool(o, "enabled", "Enable autoplay")));
add(make("247", "Enable or disable best-effort 24/7 voice reconnection")
  .addBooleanOption((o) => bool(o, "enabled", "Enable 24/7 mode")));
add(make("stay", "Keep the bot in your voice channel when idle")
  .addBooleanOption((o) => bool(o, "enabled", "Enable stay mode")));
add(make("voteskip", "Vote to skip the current track"));
add(make("announce", "Toggle now-playing announcements for this server")
  .addBooleanOption((o) => bool(o, "enabled", "Enable track announcements")));

const dj = make("dj", "Manage music DJ roles, controllers, and protected actions");
dj.addSubcommand((s) => s.setName("role").setDescription("Set the DJ role (administrator only)")
  .addRoleOption((o) => o.setName("role").setDescription("Role allowed to use DJ controls").setRequired(true)));
dj.addSubcommand((s) => s.setName("authorize").setDescription("Authorize a music controller (administrator only)")
  .addUserOption((o) => o.setName("user").setDescription("User allowed to use protected music controls").setRequired(true)));
dj.addSubcommand((s) => s.setName("deauthorize").setDescription("Remove a music controller authorization")
  .addUserOption((o) => o.setName("user").setDescription("User to deauthorize").setRequired(true)));
dj.addSubcommand((s) => s.setName("action").setDescription("Configure whether an action is DJ-only (administrator only)")
  .addStringOption((o) => choice(o, "action", "Music action", [["Stop playback", "stop"], ["Clear queue", "clear"], ["Remove queue items", "remove"], ["Move queue items", "move"], ["Swap queue items", "swap"], ["Skip to a queue position", "skipto"], ["Shuffle queue", "shuffle"], ["Reverse queue", "reversequeue"], ["Deduplicate queue", "deduplicate"], ["Skip tracks / vote skip", "skip"], ["Pause/resume playback", "pause"], ["Loop mode", "loop"], ["Autoplay", "autoplay"], ["Server music settings", "settings"], ["Audio filters", "filter"], ["Volume", "volume"], ["Play favorites / save tracks", "favorite"], ["Delete playlists", "playlist-delete"]]))
  .addBooleanOption((o) => bool(o, "dj_only", "Require DJ for this action")));
dj.addSubcommand((s) => s.setName("list").setDescription("Show the DJ role and authorized music controllers"));
add(dj);

const settings = make("musicsettings", "Configure server-specific music policy and defaults");
settings.addSubcommand((s) => s.setName("show").setDescription("Show the effective music settings"));
settings.addSubcommand((s) => s.setName("default-volume").setDescription("Set the default player volume")
  .addIntegerOption((o) => integer(o, "value", "Default volume percentage", true, 0, 1000)));
settings.addSubcommand((s) => s.setName("max-volume").setDescription("Set the server's maximum player volume")
  .addIntegerOption((o) => integer(o, "value", "Maximum volume percentage", true, 1, 1000)));
settings.addSubcommand((s) => s.setName("queue-limit").setDescription("Set the maximum upcoming queue size")
  .addIntegerOption((o) => integer(o, "value", "Maximum tracks", true, 1, 1000)));
settings.addSubcommand((s) => s.setName("idle-timeout").setDescription("Set idle voice disconnect timeout; zero disables it")
  .addIntegerOption((o) => integer(o, "seconds", "Timeout in seconds", true, 0, 86400)));
settings.addSubcommand((s) => s.setName("default-loop").setDescription("Set the default loop mode")
  .addStringOption((o) => choice(o, "mode", "Default loop", [["Off", "off"], ["Track", "track"], ["Queue", "queue"]])));
settings.addSubcommand((s) => s.setName("default-autoplay").setDescription("Set whether source-search autoplay starts enabled")
  .addBooleanOption((o) => bool(o, "enabled", "Default autoplay")));
settings.addSubcommand((s) => s.setName("channels").setDescription("Add, remove, or clear allowed music channels")
  .addStringOption((o) => choice(o, "scope", "Channel type", [["Voice", "voice"], ["Text", "text"]]))
  .addStringOption((o) => choice(o, "action", "Change", [["Add restriction", "add"], ["Remove restriction", "remove"], ["Clear restrictions", "clear"]]))
  .addChannelOption((o) => o.setName("channel").setDescription("Voice or text channel; omit only when clearing").setRequired(false)
    .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildText, ChannelType.GuildAnnouncement)));
settings.addSubcommand((s) => s.setName("vote-skip").setDescription("Set the minimum vote count and voter percentage")
  .addIntegerOption((o) => integer(o, "minimum", "Minimum votes", true, 1, 100))
  .addNumberOption((o) => number(o, "percentage", "Share of non-bot voice listeners (0.1–1)", true, 0.1, 1)));
settings.addSubcommand((s) => s.setName("stay-247").setDescription("Set the default 24/7 mode for this server")
  .addBooleanOption((o) => bool(o, "enabled", "Default stay mode")));
settings.addSubcommand((s) => s.setName("announcement-channel").setDescription("Choose where now-playing announcements are sent")
  .addChannelOption((o) => o.setName("channel").setDescription("Text channel for announcements").setRequired(false).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
  .addBooleanOption((o) => bool(o, "clear", "Clear the configured announcement channel", false)));
settings.addSubcommand((s) => s.setName("history").setDescription("Enable or disable private per-user listening history")
  .addBooleanOption((o) => bool(o, "enabled", "Store recent track history")));
settings.addSubcommand((s) => s.setName("default-preset").setDescription("Set the default preset for new player sessions")
  .addStringOption((o) => choice(o, "preset", "Preset", [["Flat", "flat"], ["Rock", "rock"], ["Pop", "pop"], ["Jazz", "jazz"], ["Classical", "classical"], ["Bass boost", "bassboost"]])));
add(settings);
add(make("musicreset", "Reset music settings and DJ controllers (keeps playlists and listening data)"));

add(make("health", "Show genuine Discord, Lavalink, and storage health"));
add(make("help", "Show music commands and the branded control panel guide"));
add(make("info", "Show project identity and live service status"));
add(make("stats", "Show live bot and Lavalink music statistics"));

export const commandDefinitions = builders.map((builder) => builder.toJSON());
export const commandBuilders = builders;
