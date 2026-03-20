"""Room REST API routes."""

import time
import logging
from flask import Blueprint, request, jsonify, session
from config import Config
import room_manager
import spotify_service

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
    """Attach participants to a room state dict."""
    participants = room_manager.get_participants(room_id)
    return {**state, 'participants': participants}


def _trigger_playback_for_room(room_id, state):
    """Tell all users' Spotify clients to play the current track. Returns list of errors."""
    if not state.get('current_track') or not state.get('is_playing'):
        return []
    tokens = room_manager.get_all_tokens(room_id)
    expected_ms = state['position_ms'] + (time.time() - state['last_update']) * 1000
    errors = []
    for user_id, token_data in tokens.items():
        refreshed = spotify_service.get_valid_token(token_data)
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
        refreshed = spotify_service.get_valid_token(token_data)
        if not refreshed:
            logger.error("Could not get valid token for user %s in room %s", user_id, room_id)
            continue
        if refreshed is not token_data:
            room_manager.store_user_token(room_id, user_id, refreshed)
        spotify_service.pause_playback(refreshed['access_token'])


def _get_user():
    """Get current user from session or return None."""
    return session.get('user')


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

    # Validate
    try:
        max_consecutive = int(max_consecutive)
        if max_consecutive < 0:
            max_consecutive = 0
    except (TypeError, ValueError):
        max_consecutive = 0

    state = room_manager.create_room(
        user['spotify_user_id'], user['display_name'],
        max_consecutive=max_consecutive, hear_me_out=bool(hear_me_out),
    )
    # Store host's token
    room_manager.store_user_token(state['room_id'], user['spotify_user_id'], {
        'access_token': user['access_token'],
        'refresh_token': user['refresh_token'],
        'expires_at': user['expires_at'],
    })
    return jsonify(state)


@rooms_bp.route('/api/rooms/<room_id>')
@_require_auth
def get_room(room_id):
    """Get room state + participants."""
    state = room_manager.get_room(room_id)
    if not state:
        return jsonify({'error': 'Room not found'}), 404
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

    updated, skipped = room_manager.vote_skip(room_id, user['spotify_user_id'])
    if not updated:
        return jsonify({'error': 'Room not found'}), 404

    if skipped:
        _trigger_playback_for_room(room_id, updated)

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
        except (TypeError, ValueError):
            pass

    if 'hear_me_out' in data:
        state['hear_me_out'] = bool(data['hear_me_out'])
        # Re-sort queue if enabling hear_me_out
        if state['hear_me_out'] and state['queue']:
            state['queue'] = room_manager._round_robin_queue(state['queue'])

    room_manager.save_room(room_id, state)
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

    refreshed = spotify_service.get_valid_token(token_data)
    if not refreshed:
        return jsonify({'error': 'Token expired'}), 401
    if refreshed is not token_data:
        room_manager.store_user_token(room_id, user_id, refreshed)

    expected_ms = state['position_ms'] + (time.time() - state['last_update']) * 1000
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
    return jsonify(_with_participants(room_id, state))


@rooms_bp.route('/api/search')
@_require_auth
def search():
    """Search Spotify for tracks."""
    q = request.args.get('q', '').strip()
    if not q:
        return jsonify({'tracks': []})
    user = _get_user()
    token_data = spotify_service.get_valid_token(user)
    if not token_data:
        return jsonify({'error': 'Token expired'}), 401
    session['user'] = token_data
    tracks = spotify_service.search_tracks(token_data['access_token'], q)
    return jsonify({'tracks': tracks})
