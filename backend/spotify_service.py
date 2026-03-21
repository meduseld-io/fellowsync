"""Spotify API service layer — handles all Spotify Web API calls and token refresh."""

import time
import logging
import requests
from config import Config

logger = logging.getLogger(__name__)

TOKEN_URL = Config.SPOTIFY_TOKEN_URL
API_BASE = Config.SPOTIFY_API_BASE


def _headers(access_token):
    return {'Authorization': f'Bearer {access_token}'}


def refresh_token(refresh_tok):
    """Exchange a refresh token for a new access token."""
    try:
        resp = requests.post(TOKEN_URL, data={
            'grant_type': 'refresh_token',
            'refresh_token': refresh_tok,
            'client_id': Config.SPOTIFY_CLIENT_ID,
            'client_secret': Config.SPOTIFY_CLIENT_SECRET,
        }, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        return {
            'access_token': data['access_token'],
            'expires_at': time.time() + data.get('expires_in', 3600),
            'refresh_token': data.get('refresh_token', refresh_tok),
        }
    except Exception as e:
        logger.error("Failed to refresh Spotify token: %s", e)
        return None


def get_valid_token(token_data):
    """Return a valid access token, refreshing if expired. Returns updated token_data dict or None."""
    if not token_data:
        return None
    if time.time() >= token_data.get('expires_at', 0) - 60:
        refreshed = refresh_token(token_data['refresh_token'])
        if not refreshed:
            return None
        token_data.update(refreshed)
    return token_data


def get_current_playback(access_token):
    """Get the user's current playback state."""
    try:
        resp = requests.get(f'{API_BASE}/me/player', headers=_headers(access_token), timeout=10)
        if resp.status_code == 204:
            return None
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        logger.error("Failed to get current playback: %s", e)
        return None


def get_active_device(access_token):
    """Return the user's active device id, or None.

    Only returns a device that is currently active. Prefers personal devices
    (Smartphone, Computer) over ambient ones (TV, Speaker, CastAudio) to avoid
    hijacking hotel TVs, smart speakers, etc.
    """
    try:
        resp = requests.get(f'{API_BASE}/me/player/devices', headers=_headers(access_token), timeout=10)
        resp.raise_for_status()
        devices = resp.json().get('devices', [])
        active = [d for d in devices if d.get('is_active')]
        if not active:
            return None
        # Prefer personal device types over ambient/shared ones
        preferred_types = {'Smartphone', 'Computer'}
        for d in active:
            if d.get('type') in preferred_types:
                return d['id']
        return active[0]['id']
    except Exception as e:
        logger.error("Failed to get active device: %s", e)
        return None


def play_track(access_token, uri, position_ms=0, device_id=None):
    """Start playback of a track on the user's device. Auto-discovers device if none specified."""
    if not device_id:
        device_id = get_active_device(access_token)
        if not device_id:
            return {'error': 'no_device', 'message': 'No active Spotify device found. Open Spotify on any device and play something briefly.'}

    try:
        body = {'uris': [uri], 'position_ms': position_ms}
        resp = requests.put(
            f'{API_BASE}/me/player/play',
            headers=_headers(access_token),
            params={'device_id': device_id},
            json=body,
            timeout=10,
        )
        if resp.status_code == 404:
            return {'error': 'no_device', 'message': 'No active Spotify device found. Open Spotify on any device and play something briefly.'}
        resp.raise_for_status()
        return {'ok': True}
    except Exception as e:
        logger.error("Failed to play track: %s", e)
        return {'error': 'play_failed', 'message': str(e)}


def pause_playback(access_token):
    """Pause the user's playback."""
    try:
        resp = requests.put(f'{API_BASE}/me/player/pause', headers=_headers(access_token), timeout=10)
        if resp.status_code == 404:
            return {'error': 'no_device'}
        resp.raise_for_status()
        return {'ok': True}
    except Exception as e:
        logger.error("Failed to pause playback: %s", e)
        return {'error': 'pause_failed', 'message': str(e)}


def search_tracks(access_token, query, limit=10):
    """Search Spotify for tracks."""
    try:
        resp = requests.get(
            f'{API_BASE}/search',
            headers=_headers(access_token),
            params={'q': query, 'type': 'track', 'limit': limit},
            timeout=10,
        )
        resp.raise_for_status()
        items = resp.json().get('tracks', {}).get('items', [])
        return [
            {
                'uri': t['uri'],
                'name': t['name'],
                'artist': ', '.join(a['name'] for a in t['artists']),
                'album': t['album']['name'],
                'album_art': t['album']['images'][0]['url'] if t['album']['images'] else None,
                'duration_ms': t['duration_ms'],
                'spotify_url': t['external_urls'].get('spotify', ''),
            }
            for t in items
        ]
    except Exception as e:
        logger.error("Failed to search tracks: %s", e)
        return []


def get_track_info(access_token, uri):
    """Get track metadata by URI."""
    track_id = uri.split(':')[-1]
    try:
        resp = requests.get(f'{API_BASE}/tracks/{track_id}', headers=_headers(access_token), timeout=10)
        resp.raise_for_status()
        t = resp.json()
        return {
            'uri': t['uri'],
            'name': t['name'],
            'artist': ', '.join(a['name'] for a in t['artists']),
            'album': t['album']['name'],
            'album_art': t['album']['images'][0]['url'] if t['album']['images'] else None,
            'duration_ms': t['duration_ms'],
            'spotify_url': t['external_urls'].get('spotify', ''),
        }
    except Exception as e:
        logger.error("Failed to get track info for %s: %s", uri, e)
        return None
