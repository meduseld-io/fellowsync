# Self-Hosting FellowSync on macOS

## Prerequisites

- Python 3.10+
- Node.js 18+
- Redis
- A Spotify Developer app ([create one here](https://developer.spotify.com/dashboard))

## 1. Install Dependencies

### Using Homebrew

```bash
brew install python node redis
```

Start Redis:

```bash
brew services start redis
```

If you don't have Homebrew, install it from [brew.sh](https://brew.sh).

## 2. Clone and Set Up

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

## 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:

```
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
SPOTIFY_REDIRECT_URI=http://127.0.0.1:5173/callback
FRONTEND_URL=http://localhost:5173
SECRET_KEY=generate-a-random-string
```

Generate an encryption key for BYOS sync secrets:

```bash
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Add the output as `ENCRYPTION_KEY` in `.env`.

## 4. Run (Development)

In separate terminals:

```bash
# Terminal 1 - Backend
cd backend
source venv/bin/activate
python app.py

# Terminal 2 - Frontend (hot reload)
cd frontend
npm run dev
```

Open `http://127.0.0.1:5173`.

## 5. Production Deployment

Build the frontend - Flask serves it directly on port 5050:

```bash
cd frontend
npm run build
```

Update `.env` for production:

```
SPOTIFY_REDIRECT_URI=https://your-domain.com/callback
FRONTEND_URL=https://your-domain.com
FELLOWSYNC_ENV=production
SECRET_KEY=a-strong-random-secret
```

Add `https://your-domain.com/callback` as a redirect URI in your Spotify app dashboard.

### launchd Service (Persistent)

Create `~/Library/LaunchAgents/com.fellowsync.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.fellowsync</string>
    <key>WorkingDirectory</key>
    <string>/path/to/fellowsync/backend</string>
    <key>ProgramArguments</key>
    <array>
        <string>/path/to/fellowsync/backend/venv/bin/python</string>
        <string>app.py</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>SPOTIFY_CLIENT_ID</key>
        <string>your_client_id</string>
        <key>SPOTIFY_CLIENT_SECRET</key>
        <string>your_client_secret</string>
        <key>SPOTIFY_REDIRECT_URI</key>
        <string>https://your-domain.com/callback</string>
        <key>FRONTEND_URL</key>
        <string>https://your-domain.com</string>
        <key>FELLOWSYNC_ENV</key>
        <string>production</string>
        <key>SECRET_KEY</key>
        <string>a-strong-random-secret</string>
        <key>ENCRYPTION_KEY</key>
        <string>your-fernet-key</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/fellowsync.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/fellowsync-error.log</string>
</dict>
</plist>
```

Load and start:

```bash
launchctl load ~/Library/LaunchAgents/com.fellowsync.plist
```

To stop:

```bash
launchctl unload ~/Library/LaunchAgents/com.fellowsync.plist
```

### Reverse Proxy (Optional)

If using nginx or Cloudflare, ensure WebSocket connections are proxied. FellowSync uses Socket.IO on the same port as HTTP.

Example nginx config:

```nginx
server {
    listen 80;
    server_name fellowsync.example.com;

    location / {
        proxy_pass http://127.0.0.1:5050;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```
