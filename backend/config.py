import os
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))


class Config:
    SECRET_KEY = os.getenv('SECRET_KEY', 'dev-secret-key')
    SPOTIFY_CLIENT_ID = os.getenv('SPOTIFY_CLIENT_ID')
    SPOTIFY_CLIENT_SECRET = os.getenv('SPOTIFY_CLIENT_SECRET')
    SPOTIFY_REDIRECT_URI = os.getenv('SPOTIFY_REDIRECT_URI', 'http://127.0.0.1:5173/callback')
    REDIS_URL = os.getenv('REDIS_URL', 'redis://localhost:6379/0')
    FRONTEND_URL = os.getenv('FRONTEND_URL', 'http://localhost:5173')
    SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize'
    SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token'
    SPOTIFY_API_BASE = 'https://api.spotify.com/v1'
    SPOTIFY_SCOPES = 'user-read-playback-state user-modify-playback-state'
    ADMIN_USER_IDS = [x.strip() for x in os.getenv('ADMIN_USER_IDS', '').split(',') if x.strip()]
    ENCRYPTION_KEY = os.getenv('ENCRYPTION_KEY', '')
    REQUIRE_BYOK = os.getenv('REQUIRE_BYOK', 'true').lower() in ('true', '1', 'yes')
