"""FellowSync — Spotify Jam Room backend."""

import os
import logging
from flask import Flask, send_from_directory
from flask_cors import CORS
from flask_socketio import SocketIO
from config import Config
from auth import auth_bp
from rooms import rooms_bp
from group_routes import groups_bp
from socket_events import init_socketio
from sync_worker import run_sync_loop

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(name)s] %(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

DIST_DIR = os.path.join(os.path.dirname(__file__), '..', 'frontend', 'dist')

app = Flask(__name__, static_folder=None)
app.secret_key = Config.SECRET_KEY
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'

cors_origins = [Config.FRONTEND_URL]
if Config.FRONTEND_URL != 'http://localhost:5173':
    cors_origins.append('http://localhost:5173')

CORS(app, supports_credentials=True, origins=cors_origins)

socketio = SocketIO(
    app,
    cors_allowed_origins=cors_origins,
    manage_session=False,
    async_mode='threading',
)

app.register_blueprint(auth_bp)
app.register_blueprint(rooms_bp)
app.register_blueprint(groups_bp)
init_socketio(socketio)


@app.route('/health')
def health():
    return {'status': 'ok'}


@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_frontend(path):
    """Serve the built React frontend. Falls back to index.html for client-side routing."""
    if path and os.path.isfile(os.path.join(DIST_DIR, path)):
        return send_from_directory(DIST_DIR, path)
    return send_from_directory(DIST_DIR, 'index.html')


# Start background sync worker
socketio.start_background_task(run_sync_loop, socketio)

if __name__ == '__main__':
    is_dev = os.getenv('FELLOWSYNC_ENV', 'development') == 'development'
    logger.info("Starting FellowSync backend on port 5050 (debug=%s)", is_dev)
    socketio.run(app, host='0.0.0.0', port=5050, debug=is_dev, allow_unsafe_werkzeug=True)
