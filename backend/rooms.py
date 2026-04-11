"""Room REST API routes."""

import re
import time
import logging
from flask import Blueprint, request, jsonify, session
from config import Config
import room_manager
import spotify_service
import groups
from socket_events import broadcast_sync, broadcast_queue, broadcast_room_state, broadcast_reaction

logger = logging.getLogger(__name__)
rooms_bp = Blueprint('rooms', __name__)

# Simple per-user rate limiting
_rate_limits = {}  # key: (user_id, action) -> last_request_time
RATE_LIMIT_SECONDS = {
    'add_to_queue': 1,
    'skip': 2,
    'play': 2,
    'pause': 2,
    'sync': 3,
    'settings': 1,
    'promote': 2,
    'remove': 1,
    'reorder': 1,
}


def _check_rate_limit(user_id, action):
    """Return True if the request is allowed, False if rate-limited."""
    key = (user_id, action)
    now = time.time()
    limit = RATE_LIMIT_SECONDS.get(action, 1)
    last = _rate_limits.get(key, 0)
    if now - last < limit:
        return False
    _rate_limits[key] = now
    return True


def _with_participants(room_id, state):
    """Attach participants, avatars, and badges to a room state dict."""
    participants = room_manager.get_participants(room_id)
    avatars = room_manager.get_participant_avatars(room_id)
    badges = room_manager.get_participant_badges(room_id)
    return {**state, 'participants': participants, 'participant_avatars': avatars, 'participant_badges': badges}


def _extract_playlist_id(url):
    """Extract a Spotify playlist ID from a URL or URI."""
    # spotify:playlist:XXXXX
    m = re.search(r'spotify:playlist:([a-zA-Z0-9]+)', url)
    if m:
        return m.group(1)
    # https://open.spotify.com/playlist/XXXXX?si=...
    m = re.search(r'open\.spotify\.com/playlist/([a-zA-Z0-9]+)', url)
    if m:
        return m.group(1)
    return None


def _is_spotify_track_url(url):
    """Check if a URL is a Spotify track link (not a playlist)."""
    return bool(re.search(r'spotify:track:|open\.spotify\.com/track/', url))


def _get_group_creds(token_data):
    """Extract group credentials from token data if a group_id is present."""
    group_id = token_data.get('group_id')
    if not group_id:
        return None, None
    creds = groups.get_group_credentials(group_id)
    if not creds:
        return None, None
    return creds


def _trigger_playback_for_room(room_id, state):
    """Tell all users' Spotify clients to play the current track. Returns list of errors."""
    if not state.get('current_track') or not state.get('is_playing'):
        return []
    tokens = room_manager.get_all_tokens(room_id)
    expected_ms = state['position_ms'] + (time.time() - state['last_update']) * 1000
    errors = []
    for user_id, token_data in tokens.items():
        cid, csecret = _get_group_creds(token_data)
        refreshed = spotify_service.get_valid_token(token_data, client_id=cid, client_secret=csecret)
        if not refreshed:
            logger.error("Could not get valid token for user %s in room %s", user_id, room_id)
            errors.append({'user_id': user_id, 'error': 'token_expired'})
            continue
        if refreshed is not token_data:
            room_manager.store_user_token(room_id, user_id, refreshed)
        result = spotify_service.play_track(
            refreshed['access_token'],
            state['current_track'],
            position_ms=max(0, int(expected_ms)),
        )
        if result.get('error'):
            logger.error("Playback failed for user %s: %s", user_id, result.get('message', result['error']))
            errors.append({'user_id': user_id, 'error': result['error'], 'message': result.get('message', '')})
    return errors


def _pause_playback_for_room(room_id):
    """Pause playback on all users' Spotify clients."""
    tokens = room_manager.get_all_tokens(room_id)
    for user_id, token_data in tokens.items():
        cid, csecret = _get_group_creds(token_data)
        refreshed = spotify_service.get_valid_token(token_data, client_id=cid, client_secret=csecret)
        if not refreshed:
            logger.error("Could not get valid token for user %s in room %s", user_id, room_id)
            continue
        if refreshed is not token_data:
            room_manager.store_user_token(room_id, user_id, refreshed)
        spotify_service.pause_playback(refreshed['access_token'])


def _get_user():
    """Get current user from session or return None."""
    return session.get('user')


def _token_group_id(user):
    """Get the group_id to use for token storage/refresh.

    If the user authenticated via the default Spotify app (e.g. 'I already have access'),
    returns None so token refresh uses default credentials even though the user belongs to a group.
    """
    if user.get('_default_app_token'):
        return None
    return user.get('group_id')


def _require_auth(f):
    """Decorator to require authentication."""
    from functools import wraps

    @wraps(f)
    def wrapper(*args, **kwargs):
        user = _get_user()
        if not user:
            return jsonify({'error': 'Not authenticated'}), 401
        return f(*args, **kwargs)
    return wrapper


@rooms_bp.route('/api/rooms', methods=['POST'])
@_require_auth
def create_room():
    """Create a new room. Current user becomes host."""
    user = _get_user()
    data = request.json or {}
    max_consecutive = data.get('max_consecutive', 0)
    hear_me_out = data.get('hear_me_out', False)
    vibe = data.get('vibe', '')
    dj_mode = data.get('dj_mode', False)
    blind_mode = data.get('blind_mode', False)
    skip_threshold = data.get('skip_threshold', 0.5)
    reactions_enabled = data.get('reactions_enabled', False)
    stats_enabled = data.get('stats_enabled', False)

    # Validate
    try:
        max_consecutive = int(max_consecutive)
        if max_consecutive < 0:
            max_consecutive = 0
    except (TypeError, ValueError):
        max_consecutive = 0

    try:
        skip_threshold = float(skip_threshold)
        if skip_threshold not in (0.25, 0.5, 0.75, 1.0):
            skip_threshold = 0.5
    except (TypeError, ValueError):
        skip_threshold = 0.5

    state = room_manager.create_room(
        user['spotify_user_id'], user['display_name'],
        max_consecutive=max_consecutive, hear_me_out=bool(hear_me_out),
        vibe=vibe, dj_mode=bool(dj_mode), blind_mode=bool(blind_mode),
        skip_threshold=skip_threshold,
        reactions_enabled=bool(reactions_enabled), stats_enabled=bool(stats_enabled),
    )
    # Store host's token (include group_id for BYOK credential lookup)
    room_manager.store_user_token(state['room_id'], user['spotify_user_id'], {
        'access_token': user['access_token'],
        'refresh_token': user['refresh_token'],
        'expires_at': user['expires_at'],
        'group_id': _token_group_id(user),
    })

    # Handle auto-playlist if provided — fail room creation if playlist is invalid
    auto_playlist_url = str(data.get('auto_playlist_url', '') or '').strip()
    if auto_playlist_url:
        playlist_id = _extract_playlist_id(auto_playlist_url)
        if not playlist_id:
            # Delete the room we just created
            room_manager.delete_room(state['room_id'])
            msg = 'That\'s a track link, not a playlist. Paste a Spotify playlist URL.' if _is_spotify_track_url(auto_playlist_url) else 'Invalid playlist URL. Use a Spotify playlist link or URI.'
            return jsonify({'error': msg}), 400

        _cid, _csecret = None, None
        _gid = _token_group_id(user)
        if _gid:
            _creds = groups.get_group_credentials(_gid)
            if _creds:
                _cid, _csecret = _creds
        token_data = spotify_service.get_valid_token(user, client_id=_cid, client_secret=_csecret)
        if not token_data:
            room_manager.delete_room(state['room_id'])
            return jsonify({'error': 'Spotify token expired. Try refreshing the page.'}), 401

        tracks, name = spotify_service.get_playlist_tracks(token_data['access_token'], playlist_id, client_id=_cid, client_secret=_csecret)
        if not tracks:
            room_manager.delete_room(state['room_id'])
            logger.error("Failed to load auto-playlist %s during room creation — no tracks returned", playlist_id)
            return jsonify({'error': 'Could not load playlist. It may be private or empty.'}), 400

        state['auto_playlist'] = tracks
        state['auto_playlist_index'] = 0
        state['auto_playlist_name'] = name or 'Playlist'

        # Auto-play first track if nothing is queued
        if not state['queue'] and not state.get('current_track') and tracks:
            first = dict(tracks[0])
            first['queued_by'] = 'Auto-playlist'
            first['queued_by_id'] = '__auto__'
            state['queue'].append(first)
            state['auto_playlist_index'] = 1

        room_manager.save_room(state['room_id'], state)
        room_manager.log_activity(state['room_id'], user['display_name'], 'set auto-playlist', name or playlist_id)

    room_manager.log_activity(state['room_id'], user['display_name'], 'created room')
    return jsonify(state)


@rooms_bp.route('/api/rooms/<room_id>')
@_require_auth
def get_room(room_id):
    """Get room state + participants."""
    state = room_manager.get_room(room_id)
    if not state:
        return jsonify({'error': 'Room not found'}), 404
    # Snapshot current position so the client progress bar is accurate
    if state.get('is_playing') and state.get('last_update'):
        now = time.time()
        elapsed = (now - state['last_update']) * 1000
        state['position_ms'] = int(state['position_ms'] + elapsed)
        state['last_update'] = now
        room_manager.save_room(room_id, state)
    participants = room_manager.get_participants(room_id)
    return jsonify({**state, 'participants': participants})


@rooms_bp.route('/api/rooms/<room_id>/join', methods=['POST'])
@_require_auth
def join_room(room_id):
    """Join an existing room."""
    state = room_manager.get_room(room_id)
    if not state:
        return jsonify({'error': 'Room not found'}), 404
    user = _get_user()
    room_manager.add_participant(room_id, user['spotify_user_id'], user['display_name'])
    room_manager.store_user_token(room_id, user['spotify_user_id'], {
        'access_token': user['access_token'],
        'refresh_token': user['refresh_token'],
        'expires_at': user['expires_at'],
        'group_id': _token_group_id(user),
    })
    participants = room_manager.get_participants(room_id)
    return jsonify({**state, 'participants': participants})


@rooms_bp.route('/api/rooms/<room_id>/queue', methods=['POST'])
@_require_auth
def add_to_queue(room_id):
    """Add a track to the room queue."""
    user = _get_user()
    if not _check_rate_limit(user['spotify_user_id'], 'add_to_queue'):
        return jsonify({'error': 'Too fast, slow down'}), 429

    state = room_manager.get_room(room_id)
    if not state:
        return jsonify({'error': 'Room not found'}), 404

    # DJ mode: only the host can add tracks
    if state.get('dj_mode') and user['spotify_user_id'] != state['host_id']:
        return jsonify({'error': 'DJ mode is on — only the host can add tracks.'}), 403

    data = request.json
    track_info = data.get('track')
    if not track_info or not track_info.get('uri'):
        return jsonify({'error': 'Missing track data'}), 400

    user = _get_user()
    track_info['queued_by'] = user['display_name']
    track_info['queued_by_id'] = user['spotify_user_id']

    play_next = data.get('play_next', False)
    if play_next:
        track_info['play_next'] = True

    updated = room_manager.add_to_queue(room_id, track_info, play_next=play_next)
    if updated == 'consecutive_limit':
        return jsonify({'error': 'You have reached the maximum consecutive songs limit. Let someone else queue a track.'}), 429
    if not updated:
        return jsonify({'error': 'Room not found'}), 404

    # If nothing is playing, immediately start the queued track
    if not updated.get('current_track') and updated['queue']:
        updated = room_manager.skip_track(room_id)
        if updated:
            _trigger_playback_for_room(room_id, updated)
            broadcast_sync(room_id, updated)

    room_manager.log_activity(room_id, user['display_name'], 'queued', track_info.get('name', ''))
    broadcast_queue(room_id, updated)
    return jsonify(_with_participants(room_id, updated))


@rooms_bp.route('/api/rooms/<room_id>/queue/<int:index>', methods=['DELETE'])
@_require_auth
def remove_from_queue(room_id, index):
    """Remove a track from the queue. Users can remove their own tracks, host can remove any."""
    user = _get_user()
    if not _check_rate_limit(user['spotify_user_id'], 'remove'):
        return jsonify({'error': 'Too fast, slow down'}), 429

    state = room_manager.get_room(room_id)
    if not state:
        return jsonify({'error': 'Room not found'}), 404

    queue = state.get('queue', [])
    if index < 0 or index >= len(queue):
        return jsonify({'error': 'Invalid queue index'}), 400

    track = queue[index]
    is_host = user['spotify_user_id'] == state['host_id']
    is_owner = track.get('queued_by_id') == user['spotify_user_id']

    if not is_host and not is_owner:
        return jsonify({'error': 'You can only remove your own tracks'}), 403

    queue.pop(index)
    state['queue'] = queue
    room_manager.save_room(room_id, state)
    room_manager.log_activity(room_id, user['display_name'], 'removed', track.get('name', ''))
    broadcast_queue(room_id, state)
    return jsonify(_with_participants(room_id, state))


@rooms_bp.route('/api/rooms/<room_id>/queue/reorder', methods=['PUT'])
@_require_auth
def reorder_queue(room_id):
    """Reorder the queue (host only). Expects {from_index, to_index}."""
    user = _get_user()
    if not _check_rate_limit(user['spotify_user_id'], 'reorder'):
        return jsonify({'error': 'Too fast, slow down'}), 429

    state = room_manager.get_room(room_id)
    if not state:
        return jsonify({'error': 'Room not found'}), 404

    if user['spotify_user_id'] != state['host_id']:
        return jsonify({'error': 'Only the host can reorder the queue'}), 403

    data = request.json or {}
    from_idx = data.get('from_index')
    to_idx = data.get('to_index')

    if from_idx is None or to_idx is None:
        return jsonify({'error': 'Missing from_index or to_index'}), 400

    queue = state.get('queue', [])
    if from_idx < 0 or from_idx >= len(queue) or to_idx < 0 or to_idx >= len(queue):
        return jsonify({'error': 'Invalid index'}), 400

    track = queue.pop(from_idx)
    queue.insert(to_idx, track)
    state['queue'] = queue
    room_manager.save_room(room_id, state)
    broadcast_queue(room_id, state)
    return jsonify(_with_participants(room_id, state))


@rooms_bp.route('/api/rooms/<room_id>/queue', methods=['DELETE'])
@_require_auth
def clear_queue(room_id):
    """Clear the entire queue (host only)."""
    user = _get_user()
    if not _check_rate_limit(user['spotify_user_id'], 'remove'):
        return jsonify({'error': 'Too fast, slow down'}), 429

    state = room_manager.get_room(room_id)
    if not state:
        return jsonify({'error': 'Room not found'}), 404

    if user['spotify_user_id'] != state['host_id']:
        return jsonify({'error': 'Only the host can clear the queue'}), 403

    state['queue'] = []
    room_manager.save_room(room_id, state)
    room_manager.log_activity(room_id, user['display_name'], 'cleared queue')
    broadcast_queue(room_id, state)
    return jsonify(_with_participants(room_id, state))


@rooms_bp.route('/api/rooms/<room_id>/queue/shuffle', methods=['POST'])
@_require_auth
def shuffle_queue(room_id):
    """Shuffle the queue order (host only)."""
    user = _get_user()
    if not _check_rate_limit(user['spotify_user_id'], 'reorder'):
        return jsonify({'error': 'Too fast, slow down'}), 429

    state = room_manager.get_room(room_id)
    if not state:
        return jsonify({'error': 'Room not found'}), 404

    if user['spotify_user_id'] != state['host_id']:
        return jsonify({'error': 'Only the host can shuffle the queue'}), 403

    updated = room_manager.shuffle_queue(room_id)
    if not updated:
        return jsonify({'error': 'Room not found'}), 404

    room_manager.log_activity(room_id, user['display_name'], 'shuffled queue')
    broadcast_queue(room_id, updated)
    return jsonify(_with_participants(room_id, updated))


@rooms_bp.route('/api/rooms/<room_id>/auto-playlist/reorder', methods=['PUT'])
@_require_auth
def reorder_auto_playlist(room_id):
    """Reorder the auto-playlist (host only). Expects {from_index, to_index} relative to unplayed tracks."""
    user = _get_user()
    if not _check_rate_limit(user['spotify_user_id'], 'reorder'):
        return jsonify({'error': 'Too fast, slow down'}), 429

    state = room_manager.get_room(room_id)
    if not state:
        return jsonify({'error': 'Room not found'}), 404

    if user['spotify_user_id'] != state['host_id'] and user['spotify_user_id'] not in Config.ADMIN_USER_IDS:
        return jsonify({'error': 'Only the host can reorder the auto-playlist'}), 403

    data = request.json or {}
    from_idx = data.get('from_index')
    to_idx = data.get('to_index')

    if from_idx is None or to_idx is None:
        return jsonify({'error': 'Missing from_index or to_index'}), 400

    updated = room_manager.reorder_auto_playlist(room_id, from_idx, to_idx)
    if not updated:
        return jsonify({'error': 'Invalid index or room not found'}), 400

    broadcast_queue(room_id, updated)
    return jsonify(_with_participants(room_id, updated))


@rooms_bp.route('/api/rooms/<room_id>/auto-playlist/shuffle', methods=['POST'])
@_require_auth
def shuffle_auto_playlist(room_id):
    """Shuffle the unplayed auto-playlist tracks (host only)."""
    user = _get_user()
    if not _check_rate_limit(user['spotify_user_id'], 'reorder'):
        return jsonify({'error': 'Too fast, slow down'}), 429

    state = room_manager.get_room(room_id)
    if not state:
        return jsonify({'error': 'Room not found'}), 404

    if user['spotify_user_id'] != state['host_id'] and user['spotify_user_id'] not in Config.ADMIN_USER_IDS:
        return jsonify({'error': 'Only the host can shuffle the auto-playlist'}), 403

    updated = room_manager.shuffle_auto_playlist(room_id)
    if not updated:
        return jsonify({'error': 'Room not found'}), 404

    room_manager.log_activity(room_id, user['display_name'], 'shuffled auto-playlist')
    broadcast_queue(room_id, updated)
    return jsonify(_with_participants(room_id, updated))


@rooms_bp.route('/api/rooms/<room_id>/auto-playlist/add-to-queue', methods=['POST'])
@_require_auth
def add_auto_playlist_to_queue(room_id):
    """Add a track from the auto-playlist to the queue."""
    user = _get_user()
    if not _check_rate_limit(user['spotify_user_id'], 'add_to_queue'):
        return jsonify({'error': 'Too fast, slow down'}), 429

    state = room_manager.get_room(room_id)
    if not state:
        return jsonify({'error': 'Room not found'}), 404

    data = request.json or {}
    playlist_index = data.get('playlist_index')
    if playlist_index is None:
        return jsonify({'error': 'Missing playlist_index'}), 400

    playlist = state.get('auto_playlist', [])
    offset = state.get('auto_playlist_index', 0)
    remaining = playlist[offset:]

    if playlist_index < 0 or playlist_index >= len(remaining):
        return jsonify({'error': 'Invalid playlist index'}), 400

    track = dict(remaining[playlist_index])
    track['queued_by'] = user['display_name']
    track['queued_by_id'] = user['spotify_user_id']

    # Remove from auto-playlist remaining
    abs_index = offset + playlist_index
    state['auto_playlist'].pop(abs_index)

    # Add to queue
    updated = room_manager.add_to_queue(room_id, track)
    if updated == 'consecutive_limit':
        # Put it back
        state['auto_playlist'].insert(abs_index, remaining[playlist_index])
        room_manager.save_room(room_id, state)
        return jsonify({'error': 'You have reached the maximum consecutive songs limit.'}), 429
    if not updated:
        return jsonify({'error': 'Room not found'}), 404

    # Sync the auto-playlist changes into the updated state
    updated['auto_playlist'] = state['auto_playlist']
    room_manager.save_room(room_id, updated)

    # If nothing is playing, start playback
    if not updated.get('current_track') and updated['queue']:
        updated = room_manager.skip_track(room_id)
        if updated:
            _trigger_playback_for_room(room_id, updated)
            broadcast_sync(room_id, updated)

    room_manager.log_activity(room_id, user['display_name'], 'queued from playlist', track.get('name', ''))
    broadcast_queue(room_id, updated)
    return jsonify(_with_participants(room_id, updated))


@rooms_bp.route('/api/rooms/<room_id>/skip', methods=['POST'])
@_require_auth
def skip_track(room_id):
    """Vote to skip the current track. Host skip is instant, others need 50% votes."""
    user = _get_user()
    if not _check_rate_limit(user['spotify_user_id'], 'skip'):
        return jsonify({'error': 'Too fast, slow down'}), 429

    state = room_manager.get_room(room_id)
    if not state:
        return jsonify({'error': 'Room not found'}), 404

    updated, skipped = room_manager.vote_skip(room_id, user['spotify_user_id'], user_name=user['display_name'])
    if not updated:
        return jsonify({'error': 'Room not found'}), 404

    if skipped:
        track_name = updated.get('current_track_info', {}).get('name', '') if updated.get('current_track_info') else ''
        if user['spotify_user_id'] == state['host_id']:
            room_manager.log_activity(room_id, user['display_name'], 'skipped', track_name)
        else:
            room_manager.log_activity(room_id, user['display_name'], 'vote skip passed', track_name)
        _trigger_playback_for_room(room_id, updated)
    else:
        room_manager.log_activity(room_id, user['display_name'], 'vote skip')

    broadcast_sync(room_id, updated)
    resp = _with_participants(room_id, updated)
    resp['skipped'] = skipped
    return jsonify(resp)


@rooms_bp.route('/api/rooms/<room_id>/settings', methods=['PUT'])
@_require_auth
def update_settings(room_id):
    """Update room settings (host only)."""
    user = _get_user()
    if not _check_rate_limit(user['spotify_user_id'], 'settings'):
        return jsonify({'error': 'Too fast, slow down'}), 429

    state = room_manager.get_room(room_id)
    if not state:
        return jsonify({'error': 'Room not found'}), 404

    if user['spotify_user_id'] != state['host_id']:
        return jsonify({'error': 'Only the host can change settings'}), 403

    data = request.json or {}

    if 'max_consecutive' in data:
        try:
            val = int(data['max_consecutive'])
            state['max_consecutive'] = max(0, val)
        except (TypeError, ValueError) as e:
            logger.error("Invalid max_consecutive value %r: %s", data['max_consecutive'], e)

    if 'hear_me_out' in data:
        state['hear_me_out'] = bool(data['hear_me_out'])
        # Re-sort queue if enabling hear_me_out
        if state['hear_me_out'] and state['queue']:
            now_playing_by = state.get('current_track_info', {}).get('queued_by_id') if state.get('current_track_info') else None
            state['queue'] = room_manager._round_robin_queue(state['queue'], current_queued_by_id=now_playing_by)

    if 'vibe' in data:
        vibe = str(data['vibe'] or '').strip()[:50]
        state['vibe'] = vibe

    if 'dj_mode' in data:
        state['dj_mode'] = bool(data['dj_mode'])

    if 'blind_mode' in data:
        state['blind_mode'] = bool(data['blind_mode'])

    # Enforce mutual exclusivity: only one mode flag can be true
    mode_flags = ['hear_me_out', 'dj_mode']
    active = [f for f in mode_flags if state.get(f)]
    if len(active) > 1:
        # Keep the most recently set one (last in the request)
        for f in mode_flags:
            if f in data and bool(data[f]):
                winner = f
        for f in mode_flags:
            state[f] = (f == winner)
        if winner == 'hear_me_out' and state['queue']:
            now_playing_by = state.get('current_track_info', {}).get('queued_by_id') if state.get('current_track_info') else None
            state['queue'] = room_manager._round_robin_queue(state['queue'], current_queued_by_id=now_playing_by)

    if 'reactions_enabled' in data:
        state['reactions_enabled'] = bool(data['reactions_enabled'])
        if not state['reactions_enabled']:
            state['reactions'] = {}

    if 'stats_enabled' in data:
        state['stats_enabled'] = bool(data['stats_enabled'])

    if 'skip_threshold' in data:
        try:
            val = float(data['skip_threshold'])
            if val in (0.25, 0.5, 0.75, 1.0):
                state['skip_threshold'] = val
        except (TypeError, ValueError) as e:
            logger.error("Invalid skip_threshold value %r: %s", data['skip_threshold'], e)

    if 'auto_playlist_url' in data:
        url = str(data['auto_playlist_url'] or '').strip()
        if not url:
            # Clear auto-playlist
            state['auto_playlist'] = []
            state['auto_playlist_index'] = 0
            state['auto_playlist_name'] = ''
        else:
            # Extract playlist ID from URL or URI
            playlist_id = _extract_playlist_id(url)
            logger.info("Auto-playlist: URL=%s, extracted ID=%s", url, playlist_id)
            if not playlist_id:
                msg = 'That\'s a track link, not a playlist. Paste a Spotify playlist URL.' if _is_spotify_track_url(url) else 'Invalid playlist URL. Use a Spotify playlist link or URI.'
                room_manager.save_room(room_id, state)
                return jsonify({'error': msg}), 400
            _cid, _csecret = None, None
            _gid = _token_group_id(user)
            if _gid:
                _creds = groups.get_group_credentials(_gid)
                if _creds:
                    _cid, _csecret = _creds
            token_data = spotify_service.get_valid_token(user, client_id=_cid, client_secret=_csecret)
            if not token_data:
                room_manager.save_room(room_id, state)
                return jsonify({'error': 'Spotify token expired. Try refreshing the page.'}), 401
            tracks, name = spotify_service.get_playlist_tracks(token_data['access_token'], playlist_id, client_id=_cid, client_secret=_csecret)
            if not tracks:
                logger.error("Failed to load playlist %s for room %s — no tracks returned", playlist_id, room_id)
                room_manager.save_room(room_id, state)
                return jsonify({'error': 'Could not load playlist. It may be private or empty.'}), 400
            state['auto_playlist'] = tracks
            state['auto_playlist_index'] = 0
            state['auto_playlist_name'] = name or 'Playlist'
            room_manager.log_activity(room_id, user['display_name'], 'set auto-playlist', name or playlist_id)

            # Auto-play first track if nothing is queued or playing
            if not state['queue'] and not state.get('current_track') and tracks:
                first = dict(tracks[0])
                first['queued_by'] = 'Auto-playlist'
                first['queued_by_id'] = '__auto__'
                state['queue'].append(first)
                state['auto_playlist_index'] = 1

    room_manager.save_room(room_id, state)
    room_manager.log_activity(room_id, user['display_name'], 'updated settings')

    # If we just queued an auto-playlist track and nothing is playing, start it
    if state['queue'] and not state.get('current_track'):
        state = room_manager.skip_track(room_id)
        if state:
            _trigger_playback_for_room(room_id, state)
            broadcast_sync(room_id, state)

    broadcast_room_state(room_id, state)
    return jsonify(_with_participants(room_id, state))


@rooms_bp.route('/api/rooms/<room_id>/promote', methods=['POST'])
@_require_auth
def promote_host(room_id):
    """Transfer host role to another participant (host only)."""
    user = _get_user()
    if not _check_rate_limit(user['spotify_user_id'], 'promote'):
        return jsonify({'error': 'Too fast, slow down'}), 429

    state = room_manager.get_room(room_id)
    if not state:
        return jsonify({'error': 'Room not found'}), 404

    if user['spotify_user_id'] != state['host_id']:
        return jsonify({'error': 'Only the host can transfer host'}), 403

    data = request.json or {}
    new_host_id = data.get('user_id')
    if not new_host_id:
        return jsonify({'error': 'Missing user_id'}), 400

    participants = room_manager.get_participants(room_id)
    if new_host_id not in participants:
        return jsonify({'error': 'User is not in this room'}), 400

    if new_host_id == state['host_id']:
        return jsonify({'error': 'User is already the host'}), 400

    state['host_id'] = new_host_id
    room_manager.save_room(room_id, state)
    room_manager.log_activity(room_id, user['display_name'], 'transferred host to', participants.get(new_host_id, new_host_id))
    broadcast_room_state(room_id, state)
    return jsonify(_with_participants(room_id, state))


@rooms_bp.route('/api/rooms/<room_id>/play', methods=['POST'])
@_require_auth
def play(room_id):
    """Start or resume playback (host only)."""
    user = _get_user()
    if not _check_rate_limit(user['spotify_user_id'], 'play'):
        return jsonify({'error': 'Too fast, slow down'}), 429

    state = room_manager.get_room(room_id)
    if not state:
        return jsonify({'error': 'Room not found'}), 404

    if user['spotify_user_id'] != state['host_id']:
        return jsonify({'error': 'Only the host can control playback'}), 403

    if not state['current_track'] and not state['queue']:
        return jsonify({'error': 'Nothing to play'}), 400

    # If no current track, pop from queue
    if not state['current_track'] and state['queue']:
        state = room_manager.skip_track(room_id)
    else:
        state['is_playing'] = True
        state['last_update'] = time.time()
        room_manager.save_room(room_id, state)

    playback_errors = _trigger_playback_for_room(room_id, state)
    room_manager.log_activity(room_id, user['display_name'], 'played')
    broadcast_sync(room_id, state)
    resp = _with_participants(room_id, state)
    if playback_errors:
        resp['playback_errors'] = playback_errors
    return jsonify(resp)


@rooms_bp.route('/api/rooms/<room_id>/sync', methods=['POST'])
@_require_auth
def sync_playback(room_id):
    """Re-sync the requesting user's Spotify to the room's current playback."""
    user = _get_user()
    if not _check_rate_limit(user['spotify_user_id'], 'sync'):
        return jsonify({'error': 'Too fast, slow down'}), 429

    state = room_manager.get_room(room_id)
    if not state:
        return jsonify({'error': 'Room not found'}), 404

    if not state.get('current_track') or not state.get('is_playing'):
        return jsonify({'error': 'Nothing is playing'}), 400

    user = _get_user()
    user_id = user['spotify_user_id']
    token_data = room_manager.get_user_token(room_id, user_id)
    if not token_data:
        return jsonify({'error': 'No token found for user'}), 400

    cid, csecret = _get_group_creds(token_data)
    refreshed = spotify_service.get_valid_token(token_data, client_id=cid, client_secret=csecret)
    if not refreshed:
        return jsonify({'error': 'Token expired'}), 401
    if refreshed is not token_data:
        room_manager.store_user_token(room_id, user_id, refreshed)

    # Snapshot current position so the client progress bar is accurate
    now = time.time()
    expected_ms = state['position_ms'] + (now - state['last_update']) * 1000
    state['position_ms'] = int(expected_ms)
    state['last_update'] = now
    room_manager.save_room(room_id, state)

    result = spotify_service.play_track(
        refreshed['access_token'],
        state['current_track'],
        position_ms=max(0, int(expected_ms)),
    )

    resp = _with_participants(room_id, state)
    if result.get('error'):
        logger.error("Sync playback failed for user %s: %s", user_id, result.get('message', result['error']))
        resp['sync_error'] = result
    return jsonify(resp)


@rooms_bp.route('/api/rooms/<room_id>/pause', methods=['POST'])
@_require_auth
def pause(room_id):
    """Pause playback (host only)."""
    user = _get_user()
    if not _check_rate_limit(user['spotify_user_id'], 'pause'):
        return jsonify({'error': 'Too fast, slow down'}), 429

    state = room_manager.get_room(room_id)
    if not state:
        return jsonify({'error': 'Room not found'}), 404

    if user['spotify_user_id'] != state['host_id']:
        return jsonify({'error': 'Only the host can control playback'}), 403

    elapsed = (time.time() - state['last_update']) * 1000
    state['position_ms'] = int(state['position_ms'] + elapsed)
    state['is_playing'] = False
    state['last_update'] = time.time()
    room_manager.save_room(room_id, state)
    _pause_playback_for_room(room_id)
    room_manager.log_activity(room_id, user['display_name'], 'paused')
    broadcast_sync(room_id, state)
    return jsonify(_with_participants(room_id, state))


@rooms_bp.route('/api/rooms/<room_id>/restart', methods=['POST'])
@_require_auth
def restart_track(room_id):
    """Restart the current track from the beginning (host only)."""
    user = _get_user()
    if not _check_rate_limit(user['spotify_user_id'], 'play'):
        return jsonify({'error': 'Too fast, slow down'}), 429

    state = room_manager.get_room(room_id)
    if not state:
        return jsonify({'error': 'Room not found'}), 404

    if user['spotify_user_id'] != state['host_id']:
        return jsonify({'error': 'Only the host can control playback'}), 403

    if not state.get('current_track'):
        return jsonify({'error': 'Nothing is playing'}), 400

    state['position_ms'] = 0
    state['is_playing'] = True
    state['last_update'] = time.time()
    room_manager.save_room(room_id, state)
    _trigger_playback_for_room(room_id, state)
    room_manager.log_activity(room_id, user['display_name'], 'restarted track')
    broadcast_sync(room_id, state)
    return jsonify(_with_participants(room_id, state))


@rooms_bp.route('/api/search')
@_require_auth
def search():
    """Search Spotify for tracks. Supports ?type=track|artist|album|playlist to filter."""
    q = request.args.get('q', '').strip()
    if not q:
        return jsonify({'tracks': []})
    search_type = request.args.get('type', 'track')
    if search_type not in ('track', 'artist', 'album', 'playlist'):
        search_type = 'track'
    user = _get_user()
    cid, csecret = None, None
    _gid = _token_group_id(user)
    if _gid:
        creds = groups.get_group_credentials(_gid)
        if creds:
            cid, csecret = creds
    token_data = spotify_service.get_valid_token(user, client_id=cid, client_secret=csecret)
    if not token_data:
        return jsonify({'error': 'Token expired'}), 401
    session['user'] = token_data

    if search_type == 'track':
        tracks = spotify_service.search_tracks(token_data['access_token'], q)
        return jsonify({'tracks': tracks})
    elif search_type == 'artist':
        tracks = spotify_service.search_tracks(token_data['access_token'], f'artist:{q}')
        return jsonify({'tracks': tracks})
    elif search_type == 'album':
        tracks = spotify_service.search_tracks(token_data['access_token'], f'album:{q}')
        return jsonify({'tracks': tracks})
    elif search_type == 'playlist':
        playlists = spotify_service.search_playlists(token_data['access_token'], q)
        return jsonify({'playlists': playlists})

    return jsonify({'tracks': []})


@rooms_bp.route('/api/playlist/<playlist_id>/tracks')
@_require_auth
def get_playlist_tracks_list(playlist_id):
    """Get tracks from a Spotify playlist."""
    user = _get_user()
    cid, csecret = None, None
    _gid = _token_group_id(user)
    if _gid:
        creds = groups.get_group_credentials(_gid)
        if creds:
            cid, csecret = creds
    token_data = spotify_service.get_valid_token(user, client_id=cid, client_secret=csecret)
    if not token_data:
        return jsonify({'error': 'Token expired'}), 401
    session['user'] = token_data
    tracks, name = spotify_service.get_playlist_tracks(token_data['access_token'], playlist_id, client_id=cid, client_secret=csecret)
    return jsonify({'tracks': tracks or [], 'name': name or ''})


@rooms_bp.route('/api/rooms/<room_id>/activity')
@_require_auth
def get_activity(room_id):
    """Get the activity log for a room (host or admin only)."""
    user = _get_user()
    state = room_manager.get_room(room_id)
    if not state:
        return jsonify({'error': 'Room not found'}), 404

    is_host = user['spotify_user_id'] == state['host_id']
    is_admin_user = user.get('spotify_user_id') in Config.ADMIN_USER_IDS
    if not is_host and not is_admin_user:
        return jsonify({'error': 'Only the host or admin can view activity'}), 403

    entries = room_manager.get_activity(room_id)
    return jsonify({'activity': entries})


@rooms_bp.route('/api/rooms/<room_id>/react', methods=['POST'])
@_require_auth
def react(room_id):
    """Toggle a reaction on the current track."""
    user = _get_user()
    data = request.json or {}
    emoji = data.get('emoji', '')

    updated = room_manager.react_track(room_id, user['spotify_user_id'], emoji)
    if not updated:
        return jsonify({'error': 'Invalid reaction or reactions disabled'}), 400

    broadcast_room_state(room_id, updated)
    broadcast_reaction(room_id, emoji)
    return jsonify(_with_participants(room_id, updated))


@rooms_bp.route('/api/rooms/<room_id>/stats', methods=['GET'])
@_require_auth
def get_stats(room_id):
    """Get listening stats for a room."""
    state = room_manager.get_room(room_id)
    if not state:
        return jsonify({'error': 'Room not found'}), 404
    stats = room_manager.get_stats(room_id)
    return jsonify({'stats': stats})


@rooms_bp.route('/api/rooms/active')
def public_active_rooms():
    """Public endpoint returning active room count and basic info (no auth)."""
    room_ids = room_manager.get_all_active_rooms()
    rooms = []
    for rid in room_ids:
        state = room_manager.get_room(rid)
        if not state:
            continue
        participants = room_manager.get_participants(rid)
        host_id = state.get('host_id')
        host_name = participants.get(host_id, 'Someone')
        track_info = state.get('current_track_info') or {}
        group_id = groups.get_user_group_id(host_id) if host_id else None
        rooms.append({
            'room_id': rid,
            'host_name': host_name,
            'participant_count': len(participants),
            'current_track': track_info.get('name'),
            'current_artist': ', '.join(a.get('name', '') for a in track_info.get('artists', [])) if track_info.get('artists') else None,
            'is_playing': state.get('is_playing', False),
            'group_id': group_id,
        })
    return jsonify({'rooms': rooms, 'count': len(rooms)})


def _require_admin(f):
    """Decorator to require admin authentication."""
    from functools import wraps

    @wraps(f)
    def wrapper(*args, **kwargs):
        user = _get_user()
        if not user:
            return jsonify({'error': 'Not authenticated'}), 401
        if user.get('spotify_user_id') not in Config.ADMIN_USER_IDS:
            return jsonify({'error': 'Forbidden'}), 403
        return f(*args, **kwargs)
    return wrapper


@rooms_bp.route('/api/admin/rooms')
@_require_admin
def admin_list_rooms():
    """List all active rooms with details."""
    room_ids = room_manager.get_all_active_rooms()
    rooms = []
    for rid in room_ids:
        state = room_manager.get_room(rid)
        if not state:
            continue
        participants = room_manager.get_participants(rid)
        rooms.append({
            'room_id': rid,
            'host_id': state.get('host_id'),
            'participant_count': len(participants),
            'participants': participants,
            'queue_length': len(state.get('queue', [])),
            'current_track': state.get('current_track_info', {}).get('name') if state.get('current_track_info') else None,
            'is_playing': state.get('is_playing', False),
            'hear_me_out': state.get('hear_me_out', False),
            'max_consecutive': state.get('max_consecutive', 0),
        })
    return jsonify({'rooms': rooms})


@rooms_bp.route('/api/admin/rooms/<room_id>', methods=['DELETE'])
@_require_admin
def admin_delete_room(room_id):
    """Force-delete a room."""
    state = room_manager.get_room(room_id)
    if not state:
        return jsonify({'error': 'Room not found'}), 404
    room_manager.delete_room(room_id)
    return jsonify({'success': True})


@rooms_bp.route('/api/admin/rooms', methods=['DELETE'])
@_require_admin
def admin_delete_all_rooms():
    """Delete all active rooms."""
    room_ids = room_manager.get_all_active_rooms()
    count = 0
    for rid in room_ids:
        room_manager.delete_room(rid)
        count += 1
    return jsonify({'success': True, 'deleted': count})


@rooms_bp.route('/api/me/badge', methods=['PUT'])
@_require_auth
def set_own_badge():
    """Let a user set their own badge."""
    user = _get_user()
    data = request.json or {}
    text = str(data.get('text', '')).strip()[:20]
    color = str(data.get('color', '#1db954')).strip()
    if not text:
        return jsonify({'error': 'Badge text is required'}), 400
    room_manager.set_user_badge(user['spotify_user_id'], text, color)
    return jsonify({'success': True, 'badge': {'text': text, 'color': color}})


@rooms_bp.route('/api/me/badge', methods=['DELETE'])
@_require_auth
def remove_own_badge():
    """Let a user remove their own badge."""
    user = _get_user()
    room_manager.remove_user_badge(user['spotify_user_id'])
    return jsonify({'success': True})


@rooms_bp.route('/api/admin/badges/<user_id>', methods=['PUT'])
@_require_admin
def admin_set_badge(user_id):
    """Set a custom badge for a user."""
    data = request.json or {}
    text = str(data.get('text', '')).strip()[:20]
    color = str(data.get('color', '#1db954')).strip()
    if not text:
        return jsonify({'error': 'Badge text is required'}), 400
    room_manager.set_user_badge(user_id, text, color)
    return jsonify({'success': True, 'badge': {'text': text, 'color': color}})


@rooms_bp.route('/api/admin/badges/<user_id>', methods=['DELETE'])
@_require_admin
def admin_remove_badge(user_id):
    """Remove a user's badge."""
    room_manager.remove_user_badge(user_id)
    return jsonify({'success': True})
