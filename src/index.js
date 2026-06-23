import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  ActivityType,
} from 'discord.js';
import { LavalinkClient } from './lavalinkClient.js';
import { buildStatsEmbed } from './embedBuilder.js';

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

const CONFIG = {
  discord: {
    token: process.env.DISCORD_TOKEN,
    channelId: process.env.STATS_CHANNEL_ID,
  },
  lavalink: {
    host: process.env.LAVALINK_HOST,
    port: parseInt(process.env.LAVALINK_PORT, 10),
    password: process.env.LAVALINK_PASSWORD,
    secure: process.env.LAVALINK_SECURE === 'true',
  },
  updateInterval: parseInt(process.env.UPDATE_INTERVAL ?? '5000', 10),
  nodeName: process.env.NODE_NAME ?? 'Lavalink Node',
};

const HOST_LABEL = `${CONFIG.lavalink.host}:${CONFIG.lavalink.port}`;

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const lavalink = new LavalinkClient(CONFIG.lavalink);

let statsMessage = null;
let updateTimer = null;
let cachedInfo = null;
let consecutiveErrs = 0;
let lastSessionId = null;

function log(level, ...args) {
  const ts = new Date().toISOString();
  const prefix = { INFO: '📘', WARN: '⚠️', ERR: '❌' }[level] ?? '  ';
  console.log(`[${ts}] ${prefix} ${level}:`, ...args);
}

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

async function fetchAllStats() {
  const [stats, info] = await Promise.all([
    lavalink.getStats(),
    cachedInfo ? Promise.resolve(cachedInfo) : lavalink.getInfo(),
  ]);

  if (!cachedInfo) {
    cachedInfo = info;
    log('INFO', `Lavalink version: ${info?.version?.semver ?? 'Unknown'}`);
  }

  let players = [];
  if (lastSessionId) {
    try {
      players = await lavalink.getPlayers(lastSessionId);
    } catch {
    }
  }

  return { stats, info: cachedInfo, players };
}

async function refreshStatsEmbed() {
  const channel = client.channels.cache.get(CONFIG.discord.channelId);
  if (!channel?.isTextBased()) {
    log('WARN', `Channel ${CONFIG.discord.channelId} not found or not text-based`);
    return;
  }

  let online = true;
  let error = null;
  let stats = null;
  let info = cachedInfo;
  let players = [];

  try {
    const result = await fetchAllStats();
    stats = result.stats;
    info = result.info;
    players = result.players;
    consecutiveErrs = 0;
  } catch (err) {
    online = false;
    error = err.message;
    consecutiveErrs++;
    log('WARN', `Failed to fetch stats (${consecutiveErrs} consecutive): ${err.message}`);
  }

  const embed = buildStatsEmbed({
    stats,
    info,
    players,
    online,
    nodeName: CONFIG.nodeName,
    host: HOST_LABEL,
    error,
  });

  try {
    if (statsMessage) {
      await statsMessage.edit({ embeds: [embed] });
    } else {
      statsMessage = await channel.send({
        content: '',
        embeds: [embed],
      });
      log('INFO', `Stats message posted: ${statsMessage.id}`);
    }

    if (online) {
      updatePresence(stats?.playingPlayers ?? 0);
    } else {
      client.user?.setPresence({ status: 'dnd', activities: [{ name: 'Node Offline', type: ActivityType.Watching }] });
    }
  } catch (err) {
    log('ERR', `Failed to send/edit stats message: ${err.message}`);

    if (err.code === 10008) {
      log('INFO', 'Stats message was deleted — will create a new one next cycle');
      statsMessage = null;
    }
  }
}

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

  await cleanOldMessages(channel);

  try {
    cachedInfo = await lavalink.getInfo();
    log('INFO', `Connected to Lavalink v${cachedInfo?.version?.semver ?? '?'}`);
  } catch (err) {
    log('WARN', `Could not fetch initial Lavalink info: ${err.message}`);
  }

  await refreshStatsEmbed();

  updateTimer = setInterval(refreshStatsEmbed, CONFIG.updateInterval);
  log('INFO', '✅ Live stats loop started');
});

client.on('error', err => {
  log('ERR', `Discord client error: ${err.message}`);
});

async function shutdown(signal) {
  log('INFO', `Received ${signal} — shutting down…`);

  if (updateTimer) clearInterval(updateTimer);

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

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

log('INFO', '🚀 Starting Lavalink Live Stats Bot…');
client.login(CONFIG.discord.token).catch(err => {
  log('ERR', `Failed to login: ${err.message}`);
  process.exit(1);
});

// Made with <3 by dev @karma.ly
