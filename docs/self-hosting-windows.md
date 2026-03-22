# Self-Hosting FellowSync on Windows

## Prerequisites

- Python 3.10+
- Node.js 18+
- Redis (via Memurai or WSL)
- A Spotify Developer app ([create one here](https://developer.spotify.com/dashboard))

## 1. Install Dependencies

### Using winget

```powershell
winget install Python.Python.3.12
winget install OpenJS.NodeJS.LTS
```

### Redis on Windows

Redis doesn't officially support Windows. Two options:

**Option A - Memurai (recommended):** A Redis-compatible Windows service. Download from [memurai.com](https://www.memurai.com/) and install. It runs as a Windows service automatically.

**Option B - WSL:** If you have Windows Subsystem for Linux:

```powershell
wsl --install
```

Then inside WSL:

```bash
sudo apt update
sudo apt install redis-server
sudo service redis-server start
```

Redis will be accessible from Windows at `localhost:6379`.

## 2. Clone and Set Up

Open PowerShell:

```powershell
git clone https://github.com/meduseld-io/fellowsync.git
cd fellowsync

# Backend
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt

# Frontend
cd ..\frontend
npm install
```

## 3. Configure Environment

```powershell
copy .env.example .env
```

Edit `.env` with your editor:

```
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
SPOTIFY_REDIRECT_URI=http://127.0.0.1:5173/callback
FRONTEND_URL=http://localhost:5173
SECRET_KEY=generate-a-random-string
```

Generate an encryption key for BYOS sync secrets:

```powershell
cd backend
.\venv\Scripts\Activate.ps1
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Add the output as `ENCRYPTION_KEY` in `.env`.

## 4. Run (Development)

In separate PowerShell windows:

```powershell
# Window 1 - Backend
cd backend
.\venv\Scripts\Activate.ps1
python app.py

# Window 2 - Frontend (hot reload)
cd frontend
npm run dev
```

Open `http://127.0.0.1:5173`.

## 5. Production Deployment

Build the frontend - Flask serves it directly on port 5050:

```powershell
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

### Run as a Windows Service (Optional)

You can use [NSSM](https://nssm.cc/) (Non-Sucking Service Manager) to run FellowSync as a Windows service:

1. Download NSSM from [nssm.cc](https://nssm.cc/download)
2. Open an admin PowerShell:

```powershell
nssm install FellowSync "C:\path\to\fellowsync\backend\venv\Scripts\python.exe" "app.py"
nssm set FellowSync AppDirectory "C:\path\to\fellowsync\backend"
nssm set FellowSync AppEnvironmentExtra "SPOTIFY_CLIENT_ID=your_client_id" "SPOTIFY_CLIENT_SECRET=your_client_secret" "FELLOWSYNC_ENV=production" "SECRET_KEY=a-strong-random-secret" "ENCRYPTION_KEY=your-fernet-key" "SPOTIFY_REDIRECT_URI=https://your-domain.com/callback" "FRONTEND_URL=https://your-domain.com"
nssm start FellowSync
```

To manage the service:

```powershell
nssm stop FellowSync
nssm restart FellowSync
nssm remove FellowSync confirm
```

### Task Scheduler Alternative

If you prefer not to install NSSM, you can use Task Scheduler:

1. Open Task Scheduler
2. Create a new task with "Run whether user is logged on or not"
3. Set the action to start `C:\path\to\fellowsync\backend\venv\Scripts\python.exe` with argument `app.py` and start-in directory `C:\path\to\fellowsync\backend`
4. Set the trigger to "At startup"

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
