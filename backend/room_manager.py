"""Room state management backed by Redis."""

import json
import time
import string
import random
import logging
import redis
from config import Config

logger = logging.getLogger(__name__)

_redis = redis.from_url(Config.REDIS_URL, decode_responses=True)

ROOM_TTL = 86400  # 24 hours


def _room_key(room_id):
    return f'room:{room_id}'


def _participants_key(room_id):
    return f'room:{room_id}:participants'


def _tokens_key(room_id):
    return f'room:{room_id}:tokens'


def generate_room_code():
    """Generate a 6-character alphanumeric room code."""
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))


def create_room(host_id, host_name, max_consecutive=0, hear_me_out=False):
    """Create a new room and return its state."""
    room_id = generate_room_code()
    while _redis.exists(_room_key(room_id)):
        room_id = generate_room_code()

    state = {
        'room_id': room_id,
        'host_id': host_id,
        'queue': [],
        'current_track': None,
        'current_track_info': None,
        'last_track_info': None,
        'position_ms': 0,
        'is_playing': False,
        'last_update': time.time(),
        'skip_votes': [],
        'max_consecutive': max_consecutive,
        'hear_me_out': hear_me_out,
        'vibe': '',
    }
    _redis.set(_room_key(room_id), json.dumps(state), ex=ROOM_TTL)
    _redis.hset(_participants_key(room_id), host_id, host_name)
    _redis.expire(_participants_key(room_id), ROOM_TTL)
    _redis.expire(_tokens_key(room_id), ROOM_TTL)
    return state


def get_room(room_id):
    """Get room state or None."""
    raw = _redis.get(_room_key(room_id))
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception as e:
        logger.error("Failed to parse room state for %s: %s", room_id, e)
        return None


def save_room(room_id, state):
    """Persist room state to Redis and refresh TTL."""
    _redis.set(_room_key(room_id), json.dumps(state), ex=ROOM_TTL)
    _redis.expire(_participants_key(room_id), ROOM_TTL)
    _redis.expire(_tokens_key(room_id), ROOM_TTL)


def delete_room(room_id):
    """Remove a room entirely."""
    _redis.delete(_room_key(room_id), _participants_key(room_id), _tokens_key(room_id))


def add_participant(room_id, user_id, display_name):
    """Add a user to the room's participant list."""
    _redis.hset(_participants_key(room_id), user_id, display_name)


def remove_participant(room_id, user_id):
    """Remove a user from the room."""
    _redis.hdel(_participants_key(room_id), user_id)


def get_participants(room_id):
    """Return dict of {user_id: display_name}."""
    return _redis.hgetall(_participants_key(room_id))


def get_participant_avatars(room_id):
    """Return dict of {user_id: avatar_color} for all participants in a room."""
    participants = _redis.hgetall(_participants_key(room_id))
    avatars = {}
    for uid in participants:
        avatar = _redis.get(f'user_avatar:{uid}')
        if avatar:
            avatars[uid] = avatar
    return avatars


def store_user_token(room_id, user_id, token_data):
    """Store a user's Spotify token data for this room."""
    _redis.hset(_tokens_key(room_id), user_id, json.dumps(token_data))


def get_user_token(room_id, user_id):
    """Get a user's stored token data."""
    raw = _redis.hget(_tokens_key(room_id), user_id)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception as e:
        logger.error("Failed to parse token for user %s in room %s: %s", user_id, room_id, e)
        return None


def get_all_tokens(room_id):
    """Get all user tokens for a room. Returns dict of {user_id: token_data}."""
    raw = _redis.hgetall(_tokens_key(room_id))
    tokens = {}
    for uid, data in raw.items():
        try:
            tokens[uid] = json.loads(data)
        except Exception as e:
            logger.error("Failed to parse token for user %s in room %s: %s", uid, room_id, e)
    return tokens


def add_to_queue(room_id, track_info, play_next=False):
    """Add a track to the room's queue. Enforces max_consecutive and hear_me_out rules. Returns updated state or (None, error_string)."""
    state = get_room(room_id)
    if not state:
        return None

    max_consec = state.get('max_consecutive', 0)
    queued_by_id = track_info.get('queued_by_id')

    # Enforce max consecutive songs per user
    if max_consec > 0 and queued_by_id:
        # Count consecutive tracks by this user at the end of the queue
        consecutive = 0
        for t in reversed(state['queue']):
            if t.get('queued_by_id') == queued_by_id:
                consecutive += 1
            else:
                break
        # Also count the currently playing track if it's by the same user
        if state.get('current_track_info') and state['current_track_info'].get('queued_by_id') == queued_by_id and not state['queue']:
            consecutive += 1
        if consecutive >= max_consec:
            return 'consecutive_limit'

    if play_next:
        state['queue'].insert(0, track_info)
    else:
        state['queue'].append(track_info)

    # In hear-me-out mode, reorder queue to round-robin by user
    if state.get('hear_me_out'):
        state['queue'] = _round_robin_queue(state['queue'])

    save_room(room_id, state)
    return state


def _round_robin_queue(queue):
    """Reorder queue to alternate between users fairly (round-robin)."""
    if len(queue) <= 1:
        return queue

    # Group tracks by user, preserving order within each user's tracks
    from collections import OrderedDict
    user_queues = OrderedDict()
    for track in queue:
        uid = track.get('queued_by_id', 'unknown')
        if uid not in user_queues:
            user_queues[uid] = []
        user_queues[uid].append(track)

    # Interleave: take one from each user in rotation
    result = []
    while any(user_queues.values()):
        for uid in list(user_queues.keys()):
            if user_queues[uid]:
                result.append(user_queues[uid].pop(0))
            if not user_queues[uid]:
                del user_queues[uid]
    return result


def skip_track(room_id):
    """Pop the next track from queue and set it as current. Returns updated state."""
    state = get_room(room_id)
    if not state:
        return None
    # Save current track as last played before advancing
    if state.get('current_track_info'):
        state['last_track_info'] = state['current_track_info']

    if state['queue']:
        next_track = state['queue'].pop(0)
        state['current_track'] = next_track['uri']
        state['current_track_info'] = next_track
        state['position_ms'] = 0
        state['is_playing'] = True
        state['last_update'] = time.time()
        state['skip_votes'] = []
    else:
        state['current_track'] = None
        state['current_track_info'] = None
        state['is_playing'] = False
        state['position_ms'] = 0
        state['last_update'] = time.time()
        state['skip_votes'] = []
    save_room(room_id, state)
    return state


SKIP_THRESHOLD = 0.5  # 50% of listeners must vote to skip


def vote_skip(room_id, user_id):
    """Register a skip vote. Returns (updated_state, skipped: bool).
    Host votes always trigger an immediate skip.
    Otherwise, skip happens when votes reach the threshold."""
    state = get_room(room_id)
    if not state:
        return None, False

    # Host skip is instant
    if user_id == state['host_id']:
        updated = skip_track(room_id)
        return updated, True

    # Ensure skip_votes exists (backward compat)
    if 'skip_votes' not in state:
        state['skip_votes'] = []

    # Don't double-vote
    if user_id in state['skip_votes']:
        participants = get_participants(room_id)
        return state, False

    state['skip_votes'].append(user_id)
    save_room(room_id, state)

    # Check threshold
    participant_count = len(get_participants(room_id))
    if participant_count <= 0:
        return state, False

    vote_ratio = len(state['skip_votes']) / participant_count
    if vote_ratio >= SKIP_THRESHOLD:
        updated = skip_track(room_id)
        return updated, True

    return state, False


def get_all_active_rooms():
    """Return list of all active room IDs."""
    keys = _redis.keys('room:??????')
    room_ids = []
    for k in keys:
        parts = k.split(':')
        if len(parts) == 2 and len(parts[1]) == 6:
            room_ids.append(parts[1])
    return room_ids


# --- User avatar preferences (persisted across sessions) ---

def get_user_avatar(spotify_user_id):
    """Get a user's saved avatar color, or None."""
    return _redis.get(f'user_avatar:{spotify_user_id}')


def set_user_avatar(spotify_user_id, color):
    """Save a user's avatar color choice."""
    _redis.set(f'user_avatar:{spotify_user_id}', color)
