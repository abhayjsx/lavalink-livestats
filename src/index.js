/**
 * Lavalink Live Stats — Discord Bot
 *
 * Connects to a Lavalink v4 node via the REST API and maintains
 * a live-updating embed in a designated Discord channel.
 *
 * Features:
 *  - Polls /v4/stats, /v4/info, and active players every N seconds
 *  - Posts a new embed on startup, then edits it in-place
 *  - Gracefully handles node downtime (shows offline state in embed)
 *  - Cleans up old stat messages on start so the channel stays tidy
 */

import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  ActivityType,
} from 'discord.js';
import { LavalinkClient } from './lavalinkClient.js';
import { buildStatsEmbed }  from './embedBuilder.js';

// ── Validate environment ───────────────────────────────────────────────────────
const REQUIRED_ENV = [
  'DISCORD_TOKEN',
  'STATS_CHANNEL_ID',
  'LAVALINK_HOST',
  'LAVALINK_PORT',
  'LAVALINK_PASSWORD',
];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`❌ Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

// ── Configuration ──────────────────────────────────────────────────────────────
const CONFIG = {
  discord: {
    token:     process.env.DISCORD_TOKEN,
    channelId: process.env.STATS_CHANNEL_ID,
  },
  lavalink: {
    host:     process.env.LAVALINK_HOST,
    port:     parseInt(process.env.LAVALINK_PORT, 10),
    password: process.env.LAVALINK_PASSWORD,
    secure:   process.env.LAVALINK_SECURE === 'true',
  },
  updateInterval: parseInt(process.env.UPDATE_INTERVAL ?? '5000', 10),
  nodeName:       process.env.NODE_NAME ?? 'Lavalink Node',
};

const HOST_LABEL = `${CONFIG.lavalink.host}:${CONFIG.lavalink.port}`;

// ── Discord client ─────────────────────────────────────────────────────────────
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// ── Lavalink client ────────────────────────────────────────────────────────────
const lavalink = new LavalinkClient(CONFIG.lavalink);

// ── State ──────────────────────────────────────────────────────────────────────
let statsMessage    = null;   // The Discord message being edited
let updateTimer     = null;   // setInterval handle
let cachedInfo      = null;   // Cache /v4/info (rarely changes)
let consecutiveErrs = 0;      // Track how many times in a row we failed
let lastSessionId   = null;   // Track the Lavalink session ID

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Log with timestamp prefix
 */
function log(level, ...args) {
  const ts = new Date().toISOString();
  const prefix = { INFO: '📘', WARN: '⚠️', ERR: '❌' }[level] ?? '  ';
  console.log(`[${ts}] ${prefix} ${level}:`, ...args);
}

/**
 * Update the bot's Discord presence to reflect current player count
 */
function updatePresence(playingPlayers) {
  const label = playingPlayers === 0
    ? 'No active players'
    : `${playingPlayers} player${playingPlayers === 1 ? '' : 's'}`;

  client.user?.setPresence({
    status: 'online',
    activities: [{
      name: label,
      type: ActivityType.Watching,
    }],
  });
}

/**
 * Fetch all live stats from Lavalink in parallel where possible
 */
async function fetchAllStats() {
  // Always fetch stats; fetch info only once or when cache is empty
  const [stats, info] = await Promise.all([
    lavalink.getStats(),
    cachedInfo ? Promise.resolve(cachedInfo) : lavalink.getInfo(),
  ]);

  if (!cachedInfo) {
    cachedInfo = info;
    log('INFO', `Lavalink version: ${info?.version?.semver ?? 'Unknown'}`);
  }

  // Try to get player list if we have a session ID
  // Lavalink v4 stats endpoint returns a "frameStats" key only when players are active
  // We attempt to grab players from a known session if available
  let players = [];
  if (lastSessionId) {
    try {
      players = await lavalink.getPlayers(lastSessionId);
    } catch {
      // Not critical — just means we can't show per-player info
    }
  }

  return { stats, info: cachedInfo, players };
}

/**
 * Build the embed and either post or edit the stats message
 */
async function refreshStatsEmbed() {
  const channel = client.channels.cache.get(CONFIG.discord.channelId);
  if (!channel?.isTextBased()) {
    log('WARN', `Channel ${CONFIG.discord.channelId} not found or not text-based`);
    return;
  }

  let online  = true;
  let error   = null;
  let stats   = null;
  let info    = cachedInfo;
  let players = [];

  try {
    const result = await fetchAllStats();
    stats   = result.stats;
    info    = result.info;
    players = result.players;
    consecutiveErrs = 0;
  } catch (err) {
    online = false;
    error  = err.message;
    consecutiveErrs++;
    log('WARN', `Failed to fetch stats (${consecutiveErrs} consecutive): ${err.message}`);
  }

  // Build the embed
  const embed = buildStatsEmbed({
    stats,
    info,
    players,
    online,
    nodeName: CONFIG.nodeName,
    host:     HOST_LABEL,
    error,
  });

  try {
    if (statsMessage) {
      // Edit in place — this is what creates the "live" effect
      await statsMessage.edit({ embeds: [embed] });
    } else {
      // First run — send a fresh message
      statsMessage = await channel.send({
        content: '',
        embeds:  [embed],
      });
      log('INFO', `Stats message posted: ${statsMessage.id}`);
    }

    // Update bot presence
    if (online) {
      updatePresence(stats?.playingPlayers ?? 0);
    } else {
      client.user?.setPresence({ status: 'dnd', activities: [{ name: 'Node Offline', type: ActivityType.Watching }] });
    }
  } catch (err) {
    log('ERR', `Failed to send/edit stats message: ${err.message}`);

    // If the message was deleted, reset so we post a fresh one next cycle
    if (err.code === 10008) {
      log('INFO', 'Stats message was deleted — will create a new one next cycle');
      statsMessage = null;
    }
  }
}

/**
 * Find and delete old bot stat messages in the channel to keep it clean.
 * Fetches the last 20 messages and deletes any posted by this bot.
 */
async function cleanOldMessages(channel) {
  try {
    const messages = await channel.messages.fetch({ limit: 20 });
    const ownMessages = messages.filter(m => m.author.id === client.user.id);

    if (ownMessages.size === 0) return;

    log('INFO', `Cleaning ${ownMessages.size} old stats message(s)…`);
    for (const msg of ownMessages.values()) {
      await msg.delete().catch(() => null);
    }
  } catch (err) {
    log('WARN', `Could not clean old messages: ${err.message}`);
  }
}

// ── Discord event handlers ─────────────────────────────────────────────────────

client.once('ready', async () => {
  log('INFO', `Logged in as ${client.user.tag}`);
  log('INFO', `Targeting channel: ${CONFIG.discord.channelId}`);
  log('INFO', `Lavalink node: ${HOST_LABEL}`);
  log('INFO', `Update interval: ${CONFIG.updateInterval}ms`);

  const channel = client.channels.cache.get(CONFIG.discord.channelId);
  if (!channel?.isTextBased()) {
    log('ERR', `Channel ${CONFIG.discord.channelId} not found. Check your STATS_CHANNEL_ID.`);
    process.exit(1);
  }

  // Clean up any previous stats messages from this bot
  await cleanOldMessages(channel);

  // Fetch initial info/version
  try {
    cachedInfo = await lavalink.getInfo();
    log('INFO', `Connected to Lavalink v${cachedInfo?.version?.semver ?? '?'}`);
  } catch (err) {
    log('WARN', `Could not fetch initial Lavalink info: ${err.message}`);
  }

  // Initial update
  await refreshStatsEmbed();

  // Start the live-update loop
  updateTimer = setInterval(refreshStatsEmbed, CONFIG.updateInterval);
  log('INFO', '✅ Live stats loop started');
});

client.on('error', err => {
  log('ERR', `Discord client error: ${err.message}`);
});

// ── Graceful shutdown ──────────────────────────────────────────────────────────
async function shutdown(signal) {
  log('INFO', `Received ${signal} — shutting down…`);

  if (updateTimer) clearInterval(updateTimer);

  // Post a final "offline" embed
  if (statsMessage) {
    const offlineEmbed = buildStatsEmbed({
      stats: null,
      info: cachedInfo,
      players: [],
      online: false,
      nodeName: CONFIG.nodeName,
      host: HOST_LABEL,
      error: 'Bot is shutting down',
    });
    await statsMessage.edit({ embeds: [offlineEmbed] }).catch(() => null);
  }

  await client.destroy();
  process.exit(0);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ── Start ──────────────────────────────────────────────────────────────────────
log('INFO', '🚀 Starting Lavalink Live Stats Bot…');
client.login(CONFIG.discord.token).catch(err => {
  log('ERR', `Failed to login: ${err.message}`);
  process.exit(1);
});
