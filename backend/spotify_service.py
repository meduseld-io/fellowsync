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


def refresh_token(refresh_tok, client_id=None, client_secret=None):
    """Exchange a refresh token for a new access token.

    If client_id/client_secret are provided, uses those (BYOK group credentials).
    Otherwise falls back to the default app credentials from config.
    """
    cid = client_id or Config.SPOTIFY_CLIENT_ID
    csecret = client_secret or Config.SPOTIFY_CLIENT_SECRET
    try:
        resp = requests.post(TOKEN_URL, data={
            'grant_type': 'refresh_token',
            'refresh_token': refresh_tok,
            'client_id': cid,
            'client_secret': csecret,
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


def get_valid_token(token_data, client_id=None, client_secret=None):
    """Return a valid access token, refreshing if expired. Returns updated token_data dict or None.

    If client_id/client_secret are provided, uses those for refresh (BYOK group credentials).
    """
    if not token_data:
        return None
    if time.time() >= token_data.get('expires_at', 0) - 60:
        refreshed = refresh_token(token_data['refresh_token'], client_id=client_id, client_secret=client_secret)
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


def search_playlists(access_token, query, limit=10):
    """Search Spotify for playlists."""
    try:
        resp = requests.get(
            f'{API_BASE}/search',
            headers=_headers(access_token),
            params={'q': query, 'type': 'playlist', 'limit': limit},
            timeout=10,
        )
        resp.raise_for_status()
        items = resp.json().get('playlists', {}).get('items', [])
        return [
            {
                'id': p['id'],
                'name': p['name'],
                'owner': p['owner']['display_name'] if p.get('owner') else 'Unknown',
                'image': p['images'][0]['url'] if p.get('images') else None,
                'track_count': p.get('tracks', {}).get('total', 0),
            }
            for p in items if p
        ]
    except Exception as e:
        logger.error("Failed to search playlists: %s", e)
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


def _get_client_token(client_id=None, client_secret=None):
    """Get a client credentials token (no user auth). Can access public playlist data."""
    cid = client_id or Config.SPOTIFY_CLIENT_ID
    csecret = client_secret or Config.SPOTIFY_CLIENT_SECRET
    try:
        resp = requests.post(TOKEN_URL, data={
            'grant_type': 'client_credentials',
            'client_id': cid,
            'client_secret': csecret,
        }, timeout=10)
        resp.raise_for_status()
        return resp.json().get('access_token')
    except Exception as e:
        logger.error("Failed to get client credentials token: %s", e)
        return None


def get_playlist_tracks(access_token, playlist_id, limit=100, client_id=None, client_secret=None):
    """Fetch tracks from a Spotify playlist. Returns (tracks_list, playlist_name) or ([], None).

    Uses /playlists/{id}/items (the current Spotify endpoint for playlist tracks).
    Falls back to the full playlist object if /items fails.
    """
    try:
        name = ''

        # Primary: /playlists/{id}/items — the correct endpoint per Spotify docs
        try:
            resp = requests.get(
                f'{API_BASE}/playlists/{playlist_id}/items',
                headers=_headers(access_token),
                params={'market': 'US', 'limit': limit, 'additional_types': 'track'},
                timeout=15,
            )
            if resp.status_code == 200:
                data = resp.json()
                items = data.get('items', [])
                logger.info("Playlist %s /items: got %d items", playlist_id, len(items))
                if items:
                    # Get name separately
                    try:
                        meta = requests.get(
                            f'{API_BASE}/playlists/{playlist_id}',
                            headers=_headers(access_token),
                            params={'fields': 'name'},
                            timeout=10,
                        )
                        if meta.status_code == 200:
                            name = meta.json().get('name', '')
                    except Exception:
                        pass
                    tracks = _parse_track_items(items, limit)
                    if tracks:
                        logger.info("Playlist %s: parsed %d tracks via /items", playlist_id, len(tracks))
                        return tracks, name
            elif resp.status_code == 403:
                logger.warning("Playlist %s /items returned 403", playlist_id)
            else:
                logger.warning("Playlist %s /items returned %s", playlist_id, resp.status_code)
        except Exception as e:
            logger.error("Playlist %s /items request failed: %s", playlist_id, e)

        # Fallback: full playlist object (inline tracks)
        try:
            resp = requests.get(
                f'{API_BASE}/playlists/{playlist_id}',
                headers=_headers(access_token),
                params={'market': 'US'},
                timeout=15,
            )
            if resp.status_code == 200:
                data = resp.json()
                name = data.get('name', '') or name
                tracks_obj = data.get('tracks', {})
                items = tracks_obj.get('items', [])
                total = tracks_obj.get('total')
                logger.info("Playlist %s (%s): total=%s, items=%d (full object)",
                            playlist_id, name, total, len(items))
                if items:
                    tracks = _parse_track_items(items, limit)
                    if tracks:
                        logger.info("Playlist %s: parsed %d tracks via full object", playlist_id, len(tracks))
                        return tracks, name
            else:
                logger.warning("Playlist %s full object returned %s", playlist_id, resp.status_code)
        except Exception as e:
            logger.error("Playlist %s full object request failed: %s", playlist_id, e)

        logger.error("All attempts returned 0 tracks for playlist %s", playlist_id)
        return [], name or None
    except Exception as e:
        logger.error("Failed to fetch playlist %s: %s", playlist_id, e)
        return [], None


def _parse_track_items(items, limit=100):
    """Parse Spotify playlist items into track dicts."""
    tracks = []
    for item in items[:limit]:
        # /items endpoint nests track data under 'item' key (with 'track' as a boolean)
        # Legacy /tracks endpoint nests it under 'track' key (as an object)
        t = item.get('item') if isinstance(item.get('item'), dict) else item.get('track') if isinstance(item.get('track'), dict) else None
        if not t or not t.get('uri'):
            continue
        # Skip episodes or other non-track types
        if t.get('type') and t['type'] != 'track':
            continue
        tracks.append({
            'uri': t['uri'],
            'name': t['name'],
            'artist': ', '.join(a['name'] for a in t.get('artists', [])),
            'album': t.get('album', {}).get('name', ''),
            'album_art': t['album']['images'][0]['url'] if t.get('album', {}).get('images') else None,
            'duration_ms': t.get('duration_ms', 0),
            'spotify_url': t.get('external_urls', {}).get('spotify', ''),
        })
    return tracks
