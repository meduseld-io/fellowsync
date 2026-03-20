<p align="center">
  <img src="fellowsync.png" alt="FellowSync" width="250">
</p>

# FellowSync — Spotify Jam Rooms

A self-hosted Spotify listening party app. Create a room, invite friends, and listen to music together in sync. Everyone queues tracks, the host controls playback, and FellowSync keeps everyone's Spotify playing the same song at the same position.

Built with Flask, React, Redis, and the Spotify Web API.

## Features

- **Spotify OAuth** — login with your Spotify Premium account
- **Room system** — create or join rooms with a 6-character code
- **Shared queue** — everyone can search and add tracks
- **Play next** — add a track to the front of the queue instead of the back
- **Remove from queue** — remove your own tracks, or any track if you're the host
- **Synced playback** — host controls play/pause/skip, all listeners stay in sync
- **Re-sync button** — fell out of sync? One click to catch back up
- **Vote to skip** — non-host listeners can vote to skip (50% threshold)
- **Track attribution** — see who queued each song
- **Last played** — see what track just finished playing
- **Auto-advance** — queue automatically moves to the next track when a song ends
- **Room modes** — Normal (free-for-all) or Hear Me Out (round-robin turns)
- **Max consecutive limit** — optionally limit how many songs one person can queue in a row (1/2/3/unlimited)
- **In-room settings** — host can change mode and consecutive limit while the room is active
- **Promote to host** — host can transfer control to another listener
- **Character avatars** — each user gets a deterministic "fella" avatar based on their Spotify ID
- **Random favicon** — a random fella is picked as the browser tab icon on each page load
- **Rate limiting** — per-user rate limits on queue, skip, play, pause, and sync actions
- **Room cleanup** — empty rooms are automatically deleted after 5 minutes

## Requirements

- Python 3.10+
- Node.js 18+
- Redis
- A [Spotify Developer Application](https://developer.spotify.com/dashboard) with OAuth2 configured
  - Redirect URI: `http://127.0.0.1:5173/callback` (local dev)

## Quick Start

1. Clone the repo:
   ```bash
   git clone https://github.com/meduseld-io/fellowsync.git
   cd fellowsync
   ```

2. Set up the backend:
   ```bash
   cd backend
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

3. Set up the frontend:
   ```bash
   cd ../frontend
   npm install
   ```

4. Configure environment variables:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your Spotify app credentials:
   ```
   SPOTIFY_CLIENT_ID=your_client_id
   SPOTIFY_CLIENT_SECRET=your_client_secret
   ```

5. Start Redis (if not already running):
   ```bash
   redis-server
   ```

6. Run the backend:
   ```bash
   cd backend
   source venv/bin/activate
   python app.py
   ```

7. Run the frontend (separate terminal):
   ```bash
   cd frontend
   npm run dev
   ```

8. Open `http://127.0.0.1:5173` in your browser.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SPOTIFY_CLIENT_ID` | Yes | — | Spotify app client ID |
| `SPOTIFY_CLIENT_SECRET` | Yes | — | Spotify app client secret |
| `SPOTIFY_REDIRECT_URI` | No | `http://127.0.0.1:5173/callback` | OAuth callback URL |
| `REDIS_URL` | No | `redis://localhost:6379/0` | Redis connection string |
| `SECRET_KEY` | No | `dev-secret-key` | Flask session secret |
| `FRONTEND_URL` | No | `http://localhost:5173` | Frontend origin for CORS |
| `FELLOWSYNC_ENV` | No | `development` | Set to `production` to disable debug mode |

## Production Deployment

FellowSync can serve the built React frontend directly from Flask — no separate web server needed.

1. Build the frontend:
   ```bash
   cd frontend
   npm run build
   ```

2. Update `.env` for production:
   ```
   SPOTIFY_REDIRECT_URI=https://your-domain.com/callback
   FRONTEND_URL=https://your-domain.com
   FELLOWSYNC_ENV=production
   SECRET_KEY=generate-a-strong-random-key
   ```

3. Run with a process manager (e.g. systemd) pointing to `backend/app.py`.

The app serves the frontend from `frontend/dist/` and handles API routes — everything on a single port.

## How It Works

1. Users log in with Spotify OAuth (Authorization Code Flow)
2. A host creates a room and gets a 6-character code to share
3. Friends join with the code — their Spotify tokens are stored in Redis
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

## Contributing

FellowSync is open source and maintained by [Meduseld](https://github.com/meduseld-io). Issues and pull requests are welcome.

## License

MIT — see [LICENSE](LICENSE).
