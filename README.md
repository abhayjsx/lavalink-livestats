# Made with ❤️ by dev @karma.ly

# 🎵 Lavalink Live Stats Bot

A **Discord.js v14** bot that posts and continuously updates a rich embed with live statistics from your **Lavalink v4** node — including CPU, memory, player counts, frame stats, and version info.

---

## Preview

The embed automatically updates every **5 seconds** (configurable) and shows:

| Field | Description |
|---|---|
| 🎵 Players | Total / Playing / Idle player counts |
| ⏱️ Uptime | Node uptime (formatted as Xd Xh Xm Xs) |
| ⚙️ CPU | System & Lavalink CPU load with visual bar |
| 💾 Memory | Used / Allocated / Free / Reservable with bar |
| 🎞️ Frame Stats | Sent / Nulled / Deficit frames per minute |
| 🔧 Build Info | Lavalink version, JVM version, Lavaplayer version |
| 🎶 Now Playing | Live list of currently playing tracks (up to 5) |

---

## Setup

### 1. Prerequisites

- **Node.js 18+**
- A **Discord Bot** with the `bot` scope and `Send Messages` + `Embed Links` permissions in your stats channel
- A running **Lavalink v4** node

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

```env
DISCORD_TOKEN=your_bot_token_here
STATS_CHANNEL_ID=your_channel_id_here

LAVALINK_HOST=pro.visionhost.cloud
LAVALINK_PORT=6108
LAVALINK_PASSWORD=your_lavalink_password_here
LAVALINK_SECURE=false

UPDATE_INTERVAL=5000
NODE_NAME=K4rma's Lavalink
```

> **Important:** The `LAVALINK_PASSWORD` must match the `lavalink.server.password` in your Lavalink `application.yml`.

### 3. Install & Run

```bash
# Install dependencies
npm install

# Start the bot
npm start

# Or run in dev mode with auto-restart on file changes
npm run dev
```

---

## Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application → **Bot** tab → **Reset Token** → copy token
3. Under **Privileged Gateway Intents**, enable nothing (this bot needs no privileged intents)
4. **OAuth2** → **URL Generator** → scopes: `bot` → permissions: `Send Messages`, `Read Message History`, `Embed Links`
5. Invite the bot to your server using the generated URL
6. Copy the **Channel ID** of the channel you want stats in (enable Developer Mode → right-click channel → Copy Channel ID)

---

## Configuration Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `DISCORD_TOKEN` | ✅ | — | Your Discord bot token |
| `STATS_CHANNEL_ID` | ✅ | — | Channel ID for the stats embed |
| `LAVALINK_HOST` | ✅ | — | Lavalink hostname |
| `LAVALINK_PORT` | ✅ | — | Lavalink port |
| `LAVALINK_PASSWORD` | ✅ | — | Lavalink server password |
| `LAVALINK_SECURE` | ❌ | `false` | Use HTTPS/WSS (`true`/`false`) |
| `UPDATE_INTERVAL` | ❌ | `5000` | Update interval in milliseconds |
| `NODE_NAME` | ❌ | `Lavalink Node` | Friendly name shown in the embed |

> ⚠️ **Rate Limits:** Discord allows ~5 edits/5s per message. Setting `UPDATE_INTERVAL` below `5000` may hit rate limits and cause temporary delays.

---

## File Structure

```
lavalink-livestats/
├── src/
│   ├── index.js           # Bot entry point, polling loop, lifecycle
│   ├── lavalinkClient.js  # REST API client for Lavalink v4
│   └── embedBuilder.js    # Embed construction and formatting
├── .env.example           # Environment variable template
├── .gitignore
├── package.json
└── README.md
```

---
Made with ❤️ by dev @karma.ly
