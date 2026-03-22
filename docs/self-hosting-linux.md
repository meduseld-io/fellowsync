# Self-Hosting FellowSync on Linux

## Prerequisites

- Python 3.10+
- Node.js 18+
- Redis
- A Spotify Developer app ([create one here](https://developer.spotify.com/dashboard))

## 1. Install Dependencies

### Ubuntu/Debian

```bash
sudo apt update
sudo apt install python3 python3-venv python3-pip nodejs npm redis-server
```

### Fedora

```bash
sudo dnf install python3 python3-pip nodejs npm redis
```

### Arch

```bash
sudo pacman -S python python-pip nodejs npm redis
```

Start Redis:

```bash
sudo systemctl enable --now redis
```

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

### systemd Service

Create `/etc/systemd/system/fellowsync.service`:

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

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now fellowsync
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
