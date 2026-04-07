<p align="center">
  <img src="frontend/public/logo.png" alt="FellowSync" width="250">
</p>

# FellowSync - Spotify Jam Rooms

> ⚠️ **Early Release** - FellowSync is under active development. Expect bugs, rough edges, and breaking changes between versions. If you run into issues, please [open a GitHub issue](https://github.com/meduseld-io/fellowsync/issues) or email [admin@meduseld.io](mailto:admin@meduseld.io).

A self-hosted Spotify listening party app. Create a room, invite friends, and listen to music together in sync. Everyone queues tracks, the host controls playback, and FellowSync keeps everyone's Spotify playing the same song at the same position.

Built with Flask, React, Redis, and the Spotify Web API.

## Getting Started

FellowSync uses BYOS (Bring Your Own Sync) - each friend group registers a free Spotify app and uses those credentials to log in. One person creates a Sync, shares the Sync ID, and up to 5 others join. This is necessary because Spotify limits developer apps to 6 total users unless you apply for an extended quota, so each friend group needs their own app.

### 1. Create a Spotify App

Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and create a new app.

Set the redirect URI to match your FellowSync instance (e.g. `https://fellowsync.example.com/callback`).

Note your Client ID and Client Secret from the app settings page.

Spotify apps in Development Mode support up to 6 users (the developer + 5 others). Add each user's Spotify email to the allowlist in the dashboard.

### 2. Create a Sync

On the FellowSync login page, click "Create a Sync". Enter a name for your group, then paste in the Client ID and Client Secret from your Spotify app.

### 3. Share the Sync ID

After creating, you'll see your Sync ID on the lobby page. Click it to copy, then share it with your friends.

### 4. Friends Join

Friends visit FellowSync, click "Join a Sync", paste the Sync ID, and log in. Everyone authenticates through your Spotify app.

### 5. Listen Together

Create a room, share the 6-character room code, and start queuing tracks. The host controls playback and everyone stays in sync.

## Features

### Rooms & Playback
- **Room system** - create or join rooms with a 6-character code
- **Synced playback** - host controls play/pause/skip, all listeners stay in sync
- **Re-sync button** - fell out of sync? One click to catch back up
- **Restart track** - host can restart the currently playing track from the beginning
- **Auto-advance** - queue automatically moves to the next track when a song ends
- **Playback progress bar** - live progress bar with elapsed/total time below the now-playing card
- **Now playing link** - click the current track name to open it in Spotify
- **Smart device targeting** - prefers your phone or computer over ambient devices (TVs, speakers) when syncing playback

### Queue

- **Shared queue** - everyone can search and add tracks
- **Play next** - add a track to the front of the queue instead of the back
- **Remove from queue** - remove your own tracks, or any track if you're the host
- **Drag-to-reorder** - host can drag queue items to rearrange the play order
- **Shuffle queue** - host can shuffle the queue order
- **Track attribution** - see who queued each song
- **Last played** - see what track just finished playing
- **Search filters** - search by track, artist, or album name
- **Playlist search** - browse and filter tracks from any Spotify playlist directly in the search panel
- **Auto-playlist** - host pastes a Spotify playlist URL and tracks auto-queue when the manual queue empties
- **Auto-playlist reorder** - host can drag to rearrange upcoming auto-playlist tracks
- **Auto-playlist shuffle** - host can shuffle the remaining auto-playlist tracks
- **Upcoming playlist tracks** - the next 10 auto-playlist tracks are shown below the queue so everyone can see what's coming

### Room Modes & Settings

- **Normal mode** - free-for-all queue, anyone can add as many tracks as they want
- **Hear Me Out mode** - alternates songs between users so everyone gets a turn
- **DJ Mode** - only the host can add songs, everyone else just listens
- **Blind Mode** - toggle that hides upcoming songs from listeners until they play (combinable with any mode)
- **Max consecutive limit** - optionally limit how many songs one person can queue in a row (1/2/3/unlimited)
- **Configurable skip threshold** - host sets the vote-to-skip percentage (25%, 50%, 75%, or unanimous)
- **Vibe label** - host can set a vibe for the room (e.g. "Chill indie", "90s hip-hop")
- **In-room settings** - host can change all settings from a popup modal while the room is active

### Social

- **Vote to skip** - non-host listeners can vote to skip, with a live vote tally on the now-playing card
- **Emoji reactions** - toggleable reaction buttons (🔥 ❤️ 😴 💩 😂) with floating animations
- **Session stats** - toggleable panel showing tracks played, skips, session duration, top queuers, and most-skipped-user leaderboard
- **Share room link** - copy a direct join URL to share with friends
- **Activity log** - host and admin can view a timestamped log of all room actions

### Host Controls

- **Promote to host** - transfer host control to another listener
- **Kick from room** - host can remove listeners from the room
- **Host transfer on leave** - if the host leaves with others still in the room, they're prompted to pick a new host

### Identity & Personalization

- **Character avatars** - each user gets a deterministic "fella" avatar with 15+ color options
- **Avatar picker** - change your fella color from the lobby or the in-room listeners panel
- **Custom display name** - click your name to set a custom display name that persists across rooms
- **Custom badges** - admin-assignable badges shown next to usernames, users can toggle their active badge
- **Personalized theme** - UI accent color matches your selected fella

### BYOS (Bring Your Own Sync)

- **Sync groups** - friend groups bring their own Spotify app credentials for independent auth
- **Encrypted secrets** - Client Secrets are encrypted at rest with Fernet
- **Sync ID sharing** - create a Sync, share the ID, friends join and re-login through the Sync's app
- **Sync member management** - admin can view sync members and kick users from syncs
- **Daily cleanup** - empty syncs are automatically cleaned up

### Infrastructure

- **Spotify OAuth** - Authorization Code Flow, Premium required for playback
- **Rate limiting** - per-user rate limits on queue, skip, play, pause, and sync actions
- **Room cleanup** - empty rooms are automatically deleted after 5 minutes
- **PWA support** - installable as a standalone app on mobile and desktop
- **iOS install banner** - prompts iPhone Safari users to add FellowSync to their home screen
- **Admin panel** - admin users can view, join, and delete all active rooms, manage syncs, and assign badges
- **Toast notifications** - slide-in notifications for joins, leaves, and queue changes

## Self-Hosting

If you want to run your own FellowSync instance, follow the steps below. Platform-specific guides with detailed instructions are also available:

- [Linux](docs/self-hosting-linux.md)
- [macOS](docs/self-hosting-macos.md)
- [Windows](docs/self-hosting-windows.md)

### Prerequisites

- Python 3.10+
- Node.js 18+
- Redis
- A Spotify Premium account (required for playback control)

### 1. Clone and Install

```bash
git clone https://github.com/meduseld-io/fellowsync.git
cd fellowsync

# Backend
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Frontend
cd ../frontend
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your settings:

| Variable | Required | Default | Description |
|---|---|---|---|
| `SPOTIFY_CLIENT_ID` | Yes | - | From your Spotify app dashboard |
| `SPOTIFY_CLIENT_SECRET` | Yes | - | From your Spotify app dashboard |
| `SPOTIFY_REDIRECT_URI` | No | `http://127.0.0.1:5173/callback` | Must match what you set in the Spotify dashboard |
| `REDIS_URL` | No | `redis://localhost:6379/0` | Redis connection string |
| `SECRET_KEY` | No | `dev-secret-key` | Flask session secret - change this in production |
| `FRONTEND_URL` | No | `http://localhost:5173` | Frontend origin for CORS |
| `FELLOWSYNC_ENV` | No | `development` | Set to `production` for production mode |
| `ADMIN_USER_IDS` | No | - | Comma-separated Spotify user IDs for admin panel access |
| `ENCRYPTION_KEY` | No | - | Fernet key for encrypting BYOS sync secrets at rest. Generate with: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` |
| `REQUIRE_BYOK` | No | `true` | When true, non-admin users must create or join a BYOS sync before logging in. Set to `false` to allow direct login with the default Spotify app. |

### 3. Run Locally

Start Redis, then run the backend and frontend in separate terminals:

```bash
# Terminal 1 - Redis
redis-server

# Terminal 2 - Backend
cd backend
source venv/bin/activate
python app.py

# Terminal 3 - Frontend (dev server with hot reload)
cd frontend
npm run dev
```

Open `http://127.0.0.1:5173` and log in with Spotify.

## Production Deployment

In production, Flask serves the built React frontend directly - no separate web server needed. Everything runs on a single port (5050).

### 1. Build the Frontend

```bash
cd frontend
npm run build
```

This creates `frontend/dist/` which Flask serves automatically.

### 2. Update `.env` for Production

```
SPOTIFY_REDIRECT_URI=https://your-domain.com/callback
FRONTEND_URL=https://your-domain.com
FELLOWSYNC_ENV=production
SECRET_KEY=generate-a-strong-random-secret
ENCRYPTION_KEY=generate-a-fernet-key
```

Make sure to add `https://your-domain.com/callback` as a redirect URI in your Spotify app dashboard.

### 3. Run the Backend

```bash
cd backend
source venv/bin/activate
python app.py
```

For a persistent setup, use a process manager like systemd:

```ini
[Unit]
Description=FellowSync
After=network.target redis.service

[Service]
WorkingDirectory=/path/to/fellowsync/backend
ExecStart=/path/to/fellowsync/backend/venv/bin/python app.py
Restart=always
EnvironmentFile=/path/to/fellowsync/.env

[Install]
WantedBy=multi-user.target
```

### 4. Reverse Proxy (Optional)

If you're putting this behind nginx or Cloudflare, make sure WebSocket connections are proxied correctly. FellowSync uses Socket.IO on the same port as the HTTP server.

## How It Works

1. Users log in with Spotify OAuth (Authorization Code Flow)
2. A host creates a room and gets a 6-character code to share
3. Friends join with the code - their Spotify tokens are stored in Redis
4. When the host hits play, the backend calls the Spotify API for each listener to start the same track at the same position
5. A background worker monitors track progress and auto-advances the queue when songs end
6. WebSocket events keep all clients updated in real time (room state, queue changes, playback sync)

## Architecture

```
Frontend (React + Vite)          Backend (Flask + SocketIO)
┌─────────────────────┐         ┌──────────────────────────┐
│  Login / Lobby / Room│ ──────▶│  /api/auth/*  (OAuth)    │
│  pages with socket.io│ ──────▶│  /api/rooms/* (REST)     │
│  client              │ ◀─────▶│  /socket.io   (WebSocket)│
└─────────────────────┘         └──────────┬───────────────┘
                                           │
                                    ┌──────▼──────┐
                                    │    Redis     │
                                    │ (room state) │
                                    └──────┬──────┘
                                           │
                                    ┌──────▼──────┐
                                    │ Spotify API  │
                                    │ (per-user)   │
                                    └─────────────┘
```

## Important Notes

- All listeners need **Spotify Premium** - the Spotify Web API does not support playback control on free accounts.

## Contributing

FellowSync is open source under the [GNU Affero General Public License v3.0](LICENSE). This means any modified version you deploy as a network service must also make its source code available to users.

Contributions are welcome - feel free to open issues or submit pull requests on [GitHub](https://github.com/meduseld-io/fellowsync).

FellowSync is developed and maintained by [@quietarcade](https://github.com/quietarcade) as part of [Meduseld](https://github.com/meduseld-io).

## License

AGPL-3.0 - see [LICENSE](LICENSE).
