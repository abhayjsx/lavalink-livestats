/**
 * Embed Builder for Lavalink Live Stats
 * Creates and formats the rich Discord embed with all node statistics
 */

import { EmbedBuilder } from 'discord.js';

// ── Colour palette ────────────────────────────────────────────────────────────
const COLORS = {
  online:      0x5865f2, // Discord blurple
  degraded:    0xf0a232, // amber
  offline:     0xed4245, // red
};

// ── Helper utilities ──────────────────────────────────────────────────────────

/**
 * Format bytes into a human-readable string (MiB / GiB)
 */
function formatBytes(bytes) {
  if (bytes == null) return 'N/A';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MiB`;
  return `${bytes} B`;
}

/**
 * Format milliseconds into a readable uptime string (e.g. 50d 21h 34m 10s)
 */
function formatUptime(ms) {
  if (ms == null) return 'N/A';
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

/**
 * Format a CPU percentage value
 */
function formatCpu(value) {
  if (value == null) return 'N/A';
  return `${(value * 100).toFixed(2)}%`;
}

/**
 * Build a visual bar representing a percentage (0–1)
 */
function buildBar(ratio, length = 10) {
  const filled = Math.round(Math.min(Math.max(ratio, 0), 1) * length);
  const empty  = length - filled;
  return `${'█'.repeat(filled)}${'░'.repeat(empty)}`;
}

/**
 * Status dot based on online state
 */
function statusDot(online) {
  return online ? '🟢' : '🔴';
}

// ── Main embed builder ────────────────────────────────────────────────────────

/**
 * Build the live stats embed
 *
 * @param {object} params
 * @param {object|null} params.stats     - /v4/stats response
 * @param {object|null} params.info      - /v4/info response
 * @param {Array}       params.players   - active player objects
 * @param {boolean}     params.online    - whether node is reachable
 * @param {string}      params.nodeName  - friendly node label
 * @param {string}      params.host      - node host:port
 * @param {string|null} params.error     - optional error message
 */
export function buildStatsEmbed({ stats, info, players, online, nodeName, host, error }) {
  const color = !online ? COLORS.offline : COLORS.online;
  const now   = new Date();

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTimestamp(now);

  // ── Title ──────────────────────────────────────────────────────────────────
  embed.setTitle(
    `${statusDot(online)} ${nodeName} — Live Stats`
  );

  // ── Description / error notice ─────────────────────────────────────────────
  if (!online) {
    embed.setDescription(
      `> ⚠️ **Node is unreachable**\n> \`${error ?? 'Unknown error'}\``
    );
    embed.addFields({
      name: '🌐 Address',
      value: `\`${host}\``,
      inline: true,
    });
    embed.setFooter({ text: `Last attempt • ${now.toUTCString()}` });
    return embed;
  }

  // ── Version info ───────────────────────────────────────────────────────────
  const version    = info?.version?.semver ?? 'Unknown';
  const jvmVersion = info?.jvm ?? 'Unknown';
  const lavaplayer = info?.lavaplayer ?? 'Unknown';

  embed.setDescription(
    `\`\`\`\n🌐 ${host}\n\`\`\``
  );

  // ── Players row ────────────────────────────────────────────────────────────
  const totalPlayers   = stats?.players ?? 0;
  const playingPlayers = stats?.playingPlayers ?? 0;
  const idlePlayers    = totalPlayers - playingPlayers;

  embed.addFields(
    {
      name: '🎵 Players',
      value: [
        `**Total:** \`${totalPlayers}\``,
        `**Playing:** \`${playingPlayers}\``,
        `**Idle:** \`${idlePlayers}\``,
      ].join('\n'),
      inline: true,
    },
    {
      name: '⏱️ Uptime',
      value: `\`${formatUptime(stats?.uptime)}\``,
      inline: true,
    },
    {
      name: '\u200b',
      value: '\u200b',
      inline: true,
    }
  );

  // ── CPU row ────────────────────────────────────────────────────────────────
  const systemLoad = stats?.cpu?.systemLoad ?? 0;
  const lavalinkLoad = stats?.cpu?.lavalinkLoad ?? 0;
  const cores = stats?.cpu?.cores ?? 1;

  const sysBar = buildBar(systemLoad);
  const llBar  = buildBar(lavalinkLoad);

  embed.addFields(
    {
      name: '⚙️ CPU',
      value: [
        `**Cores:** \`${cores}\``,
        `**System:**  ${sysBar} \`${formatCpu(systemLoad)}\``,
        `**Lavalink:** ${llBar} \`${formatCpu(lavalinkLoad)}\``,
      ].join('\n'),
      inline: true,
    },
    {
      name: '💾 Memory',
      value: (() => {
        const mem   = stats?.memory;
        const used  = mem?.used ?? 0;
        const alloc = mem?.allocated ?? 0;
        const free  = mem?.free ?? 0;
        const resv  = mem?.reservable ?? 0;
        const ratio = alloc > 0 ? used / alloc : 0;
        const bar   = buildBar(ratio);
        return [
          `${bar} \`${formatCpu(ratio)}\``,
          `**Used:** \`${formatBytes(used)}\`  **Alloc:** \`${formatBytes(alloc)}\``,
          `**Free:** \`${formatBytes(free)}\`  **Resv:** \`${formatBytes(resv)}\``,
        ].join('\n');
      })(),
      inline: true,
    },
    {
      name: '\u200b',
      value: '\u200b',
      inline: true,
    }
  );

  // ── Frame stats row ────────────────────────────────────────────────────────
  const frames     = stats?.frameStats;
  const hasFrStats = frames != null;

  embed.addFields(
    {
      name: '🎞️ Frame Stats',
      value: hasFrStats
        ? [
            `**Sent:** \`${frames.sent ?? 0}/min\``,
            `**Nulled:** \`${frames.nulled ?? 0}/min\``,
            `**Deficit:** \`${frames.deficit ?? 0}/min\``,
          ].join('\n')
        : '*No active players*',
      inline: true,
    },
    {
      name: '🔧 Build Info',
      value: [
        `**Lavalink:** \`v${version}\``,
        `**JVM:** \`${jvmVersion}\``,
        `**Lavaplayer:** \`${lavaplayer}\``,
      ].join('\n'),
      inline: true,
    },
    {
      name: '\u200b',
      value: '\u200b',
      inline: true,
    }
  );

  // ── Active players detail ──────────────────────────────────────────────────
  if (players.length > 0) {
    const playerLines = players
      .filter(p => p.track)
      .slice(0, 5) // cap at 5 to avoid embed size limits
      .map(p => {
        const guildId   = p.guildId;
        const trackName = p.track?.info?.title ?? 'Unknown';
        const author    = p.track?.info?.author ?? '';
        const paused    = p.paused ? '⏸' : '▶️';
        const vol       = p.volume != null ? ` 🔊${p.volume}%` : '';
        const display   = trackName.length > 30
          ? trackName.slice(0, 27) + '…'
          : trackName;
        return `${paused} **${display}** — ${author}${vol} *(${guildId})*`;
      });

    if (playerLines.length > 0) {
      embed.addFields({
        name: `🎶 Now Playing (${Math.min(players.filter(p => p.track).length, 5)} shown)`,
        value: playerLines.join('\n'),
        inline: false,
      });
    }
  }

  // ── Footer ─────────────────────────────────────────────────────────────────
  embed.setFooter({
    text: `🔄 Updates every 5s  •  Lavalink v4`,
  });

  return embed;
}
