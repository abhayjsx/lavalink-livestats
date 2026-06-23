import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  ActivityType,
} from 'discord.js';
import { LavalinkClient } from './lavalinkClient.js';
import { buildStatsEmbed } from './embedBuilder.js';

function log(level, ...args) {
  const ts = new Date().toISOString();
  const prefix = { INFO: '📘', WARN: '⚠️', ERR: '❌' }[level] ?? '  ';
  console.log(`[${ts}] ${prefix} ${level}:`, ...args);
}

class LavalinkNode {
  constructor(index, config) {
    this.index = index;
    this.config = config;
    this.client = new LavalinkClient(config);
    this.cachedInfo = null;
    this.consecutiveErrs = 0;
    this.lastSessionId = null;
    this.hostLabel = `${config.host}:${config.port}`;
    this.online = false;
    this.error = null;
    this.stats = null;
    this.players = [];
  }

  async fetchStats() {
    try {
      const [stats, info] = await Promise.all([
        this.client.getStats(),
        this.cachedInfo ? Promise.resolve(this.cachedInfo) : this.client.getInfo(),
      ]);

      if (!this.cachedInfo) {
        this.cachedInfo = info;
        log('INFO', `[Node ${this.index}] Lavalink version: ${info?.version?.semver ?? 'Unknown'}`);
      }

      let players = [];
      if (this.lastSessionId) {
        try {
          players = await this.client.getPlayers(this.lastSessionId);
        } catch {
          // ignore
        }
      }

      this.stats = stats;
      this.online = true;
      this.error = null;
      this.players = players;
      this.consecutiveErrs = 0;
    } catch (err) {
      this.online = false;
      this.error = err.message;
      this.consecutiveErrs++;
      log('WARN', `[Node ${this.index}] Failed to fetch stats (${this.consecutiveErrs} consecutive): ${err.message}`);
    }
  }
}

// Validate required general discord variables
const REQUIRED_DISCORD_ENV = ['DISCORD_TOKEN', 'STATS_CHANNEL_ID'];
for (const key of REQUIRED_DISCORD_ENV) {
  if (!process.env[key]) {
    console.error(`❌ Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

// Build node configs
const nodesConfig = [];

// Parse Node 1 (accepts LAVALINK_1_... or fallback to original legacy variables)
const node1Host = process.env.LAVALINK_1_HOST ?? process.env.LAVALINK_HOST;
const node1Port = process.env.LAVALINK_1_PORT ?? process.env.LAVALINK_PORT;
const node1Password = process.env.LAVALINK_1_PASSWORD ?? process.env.LAVALINK_PASSWORD;
const node1Secure = (process.env.LAVALINK_1_SECURE ?? process.env.LAVALINK_SECURE) === 'true';
const node1Name = process.env.NODE_1_NAME ?? process.env.NODE_NAME ?? 'Lavalink Node 1';

if (node1Host && node1Port && node1Password) {
  nodesConfig.push({
    host: node1Host,
    port: parseInt(node1Port, 10),
    password: node1Password,
    secure: node1Secure,
    name: node1Name,
  });
}

// Parse Node 2
const node2Host = process.env.LAVALINK_2_HOST;
const node2Port = process.env.LAVALINK_2_PORT;
const node2Password = process.env.LAVALINK_2_PASSWORD;
const node2Secure = process.env.LAVALINK_2_SECURE === 'true';
const node2Name = process.env.NODE_2_NAME ?? 'Lavalink Node 2';

if (node2Host && node2Port && node2Password) {
  nodesConfig.push({
    host: node2Host,
    port: parseInt(node2Port, 10),
    password: node2Password,
    secure: node2Secure,
    name: node2Name,
  });
}

if (nodesConfig.length === 0) {
  console.error('❌ No Lavalink nodes configured. Please specify at least one node in your environment variables.');
  process.exit(1);
}

const CONFIG = {
  discord: {
    token: process.env.DISCORD_TOKEN,
    channelId: process.env.STATS_CHANNEL_ID,
  },
  updateInterval: parseInt(process.env.UPDATE_INTERVAL ?? '5000', 10),
};

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const nodes = nodesConfig.map((cfg, idx) => new LavalinkNode(idx + 1, cfg));

let statsMessage = null;
let updateTimer = null;

function updatePresence(nodesList) {
  const totalPlayingPlayers = nodesList.reduce((sum, n) => sum + (n.stats?.playingPlayers ?? 0), 0);
  const totalOnline = nodesList.filter(n => n.online).length;

  let label = '';
  let status = 'online';

  if (totalOnline === 0) {
    status = 'dnd';
    label = 'Nodes Offline';
  } else {
    label = totalPlayingPlayers === 0
      ? 'No active players'
      : `${totalPlayingPlayers} player${totalPlayingPlayers === 1 ? '' : 's'}`;
  }

  client.user?.setPresence({
    status: status,
    activities: [{
      name: label,
      type: ActivityType.Watching,
    }],
  });
}

async function refreshStatsEmbed() {
  const channel = client.channels.cache.get(CONFIG.discord.channelId);
  if (!channel?.isTextBased()) {
    log('WARN', `Channel ${CONFIG.discord.channelId} not found or not text-based`);
    return;
  }

  // Fetch stats for all nodes in parallel
  await Promise.all(nodes.map(node => node.fetchStats()));

  const embeds = nodes.map(node => buildStatsEmbed({
    stats: node.stats,
    info: node.cachedInfo,
    players: node.players,
    online: node.online,
    nodeName: node.config.name,
    host: node.hostLabel,
    error: node.error,
    updateInterval: CONFIG.updateInterval,
  }));

  try {
    if (statsMessage) {
      await statsMessage.edit({ embeds });
    } else {
      statsMessage = await channel.send({
        content: '',
        embeds,
      });
      log('INFO', `Stats message posted: ${statsMessage.id}`);
    }

    updatePresence(nodes);
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
  for (const node of nodes) {
    log('INFO', `Lavalink node [${node.index}]: ${node.hostLabel} (${node.config.name})`);
  }
  log('INFO', `Update interval: ${CONFIG.updateInterval}ms`);

  const channel = client.channels.cache.get(CONFIG.discord.channelId);
  if (!channel?.isTextBased()) {
    log('ERR', `Channel ${CONFIG.discord.channelId} not found. Check your STATS_CHANNEL_ID.`);
    process.exit(1);
  }

  await cleanOldMessages(channel);

  // Fetch initial info for all nodes in parallel
  await Promise.all(nodes.map(async node => {
    try {
      node.cachedInfo = await node.client.getInfo();
      log('INFO', `[Node ${node.index}] Connected to Lavalink v${node.cachedInfo?.version?.semver ?? '?'}`);
    } catch (err) {
      log('WARN', `[Node ${node.index}] Could not fetch initial Lavalink info: ${err.message}`);
    }
  }));

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
    const offlineEmbeds = nodes.map(node => buildStatsEmbed({
      stats: null,
      info: node.cachedInfo,
      players: [],
      online: false,
      nodeName: node.config.name,
      host: node.hostLabel,
      error: 'Bot is shutting down',
      updateInterval: CONFIG.updateInterval,
    }));
    await statsMessage.edit({ embeds: offlineEmbeds }).catch(() => null);
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
