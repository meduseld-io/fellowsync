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

ROOM_TTL = 300  # 5 minutes


def _room_key(room_id):
    return f'room:{room_id}'


def _participants_key(room_id):
    return f'room:{room_id}:participants'


def _tokens_key(room_id):
    return f'room:{room_id}:tokens'


def _activity_key(room_id):
    return f'room:{room_id}:activity'


def _stats_key(room_id):
    return f'room:{room_id}:stats'


def generate_room_code():
    """Generate a 6-character alphanumeric room code."""
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))


def create_room(host_id, host_name, max_consecutive=0, hear_me_out=False, vibe='', dj_mode=False, blind_mode=False, skip_threshold=0.5, reactions_enabled=False, stats_enabled=False):
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
        'vibe': str(vibe or '').strip()[:50],
        'dj_mode': dj_mode,
        'blind_mode': blind_mode,
        'skip_threshold': skip_threshold,
        'auto_playlist': [],
        'auto_playlist_index': 0,
        'auto_playlist_name': '',
        'reactions_enabled': reactions_enabled,
        'reactions': {},
        'stats_enabled': stats_enabled,
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
    _redis.expire(_activity_key(room_id), ROOM_TTL)
    _redis.expire(_stats_key(room_id), ROOM_TTL)


def delete_room(room_id):
    """Remove a room entirely."""
    _redis.delete(_room_key(room_id), _participants_key(room_id), _tokens_key(room_id), _activity_key(room_id), _stats_key(room_id))


def add_participant(room_id, user_id, display_name):
    """Add a user to the room's participant list."""
    _redis.hset(_participants_key(room_id), user_id, display_name)


def remove_participant(room_id, user_id):
    """Remove a user from the room and clean up their token."""
    _redis.hdel(_participants_key(room_id), user_id)
    _redis.hdel(_tokens_key(room_id), user_id)


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

    # Reset reactions on track change
    state['reactions'] = {}

    if state['queue']:
        idx = 0
        next_track = state['queue'].pop(idx)
        state['current_track'] = next_track['uri']
        state['current_track_info'] = next_track
        state['position_ms'] = 0
        state['is_playing'] = True
        state['last_update'] = time.time()
        state['skip_votes'] = []
        # Record stats
        record_track_played(room_id, next_track)
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
        record_skip(room_id, skipped_by_vote=False)
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
    threshold = state.get('skip_threshold', SKIP_THRESHOLD)
    if vote_ratio >= threshold:
        record_skip(room_id, skipped_by_vote=True)
        updated = skip_track(room_id)
        return updated, True

    return state, False


REACTION_EMOJIS = ['🔥', '❤️', '😴', '💀', '😂']


def react_track(room_id, user_id, emoji):
    """Toggle a reaction on the current track. Returns updated state or None."""
    if emoji not in REACTION_EMOJIS:
        return None
    state = get_room(room_id)
    if not state or not state.get('reactions_enabled'):
        return None

    reactions = state.get('reactions', {})
    if emoji not in reactions:
        reactions[emoji] = []

    if user_id in reactions[emoji]:
        reactions[emoji].remove(user_id)
    else:
        # Remove user from any other reaction first (one reaction per user)
        for e in REACTION_EMOJIS:
            if e in reactions and user_id in reactions[e]:
                reactions[e].remove(user_id)
        reactions[emoji].append(user_id)

        # Record reaction in stats if stats are enabled
        if state.get('stats_enabled'):
            _record_reaction(room_id, emoji)

    state['reactions'] = reactions
    save_room(room_id, state)
    return state


def _record_reaction(room_id, emoji):
    """Record a reaction in stats."""
    key = _stats_key(room_id)
    raw = _redis.get(key)
    try:
        stats = json.loads(raw) if raw else _empty_stats()
    except Exception as e:
        logger.error("Failed to parse stats for reaction in room %s: %s", room_id, e)
        stats = _empty_stats()

    if 'reaction_counts' not in stats:
        stats['reaction_counts'] = {}
    stats['reaction_counts'][emoji] = stats['reaction_counts'].get(emoji, 0) + 1

    _redis.set(key, json.dumps(stats), ex=ROOM_TTL)


def shuffle_queue(room_id):
    """Randomize the order of the queue. Returns updated state."""
    state = get_room(room_id)
    if not state or len(state['queue']) <= 1:
        return state
    random.shuffle(state['queue'])
    save_room(room_id, state)
    return state


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


# --- Activity log ---

MAX_ACTIVITY_ENTRIES = 50


def log_activity(room_id, user_name, action, detail=''):
    """Append an activity entry to the room's log."""
    entry = json.dumps({
        'user': user_name,
        'action': action,
        'detail': detail,
        'ts': time.time(),
    })
    key = _activity_key(room_id)
    _redis.rpush(key, entry)
    _redis.ltrim(key, -MAX_ACTIVITY_ENTRIES, -1)
    _redis.expire(key, ROOM_TTL)


def get_activity(room_id):
    """Return the activity log as a list of dicts."""
    raw = _redis.lrange(_activity_key(room_id), 0, -1)
    entries = []
    for item in raw:
        try:
            entries.append(json.loads(item))
        except Exception as e:
            logger.error("Failed to parse activity entry in room %s: %s", room_id, e)
    return entries


# --- Listening stats ---

def record_track_played(room_id, track_info):
    """Record a track being played for stats. Only records if stats_enabled."""
    state = get_room(room_id)
    if not state or not state.get('stats_enabled'):
        return

    key = _stats_key(room_id)
    raw = _redis.get(key)
    try:
        stats = json.loads(raw) if raw else _empty_stats()
    except Exception as e:
        logger.error("Failed to parse stats for room %s: %s", room_id, e)
        stats = _empty_stats()

    queued_by = track_info.get('queued_by', 'Unknown')
    queued_by_id = track_info.get('queued_by_id', 'unknown')

    stats['tracks_played'] += 1
    stats['queued_by_count'][queued_by_id] = stats['queued_by_count'].get(queued_by_id, 0) + 1
    stats['user_names'][queued_by_id] = queued_by

    _redis.set(key, json.dumps(stats), ex=ROOM_TTL)


def record_skip(room_id, skipped_by_vote=False):
    """Record a skip event for stats."""
    state = get_room(room_id)
    if not state or not state.get('stats_enabled'):
        return

    key = _stats_key(room_id)
    raw = _redis.get(key)
    try:
        stats = json.loads(raw) if raw else _empty_stats()
    except Exception as e:
        logger.error("Failed to parse stats for room %s: %s", room_id, e)
        stats = _empty_stats()

    stats['skips'] += 1
    if skipped_by_vote:
        stats['vote_skips'] += 1

    _redis.set(key, json.dumps(stats), ex=ROOM_TTL)


def get_stats(room_id):
    """Return the listening stats for a room."""
    key = _stats_key(room_id)
    raw = _redis.get(key)
    if not raw:
        return _empty_stats()
    try:
        return json.loads(raw)
    except Exception as e:
        logger.error("Failed to parse stats for room %s: %s", room_id, e)
        return _empty_stats()


def _empty_stats():
    return {
        'tracks_played': 0,
        'skips': 0,
        'vote_skips': 0,
        'queued_by_count': {},
        'user_names': {},
        'started_at': time.time(),
        'reaction_counts': {},
    }
