"""BYOK Groups — each group brings their own Spotify app credentials.

Groups are stored in Redis with encrypted client secrets.
Each group has a leader (creator), members, and Spotify app credentials.
"""

import json
import time
import string
import random
import logging
import redis
from config import Config
import crypto

logger = logging.getLogger(__name__)

_redis = redis.from_url(Config.REDIS_URL, decode_responses=True)

GROUP_PREFIX = 'group:'
GROUP_MEMBERS_PREFIX = 'group_members:'
USER_GROUP_KEY = 'user_group:'


def _group_key(group_id):
    return f'{GROUP_PREFIX}{group_id}'


def _members_key(group_id):
    return f'{GROUP_MEMBERS_PREFIX}{group_id}'


def _generate_group_id():
    """Generate a short unique group ID."""
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=8))


def create_group(name, leader_id, leader_name, client_id, client_secret):
    """Create a new BYOK group. Returns group dict."""
    group_id = _generate_group_id()
    while _redis.exists(_group_key(group_id)):
        group_id = _generate_group_id()

    group = {
        'id': group_id,
        'name': name.strip()[:50],
        'leader_id': leader_id,
        'leader_name': leader_name,
        'client_id': client_id.strip(),
        'client_secret_encrypted': crypto.encrypt(client_secret.strip()),
        'created_at': time.time(),
        'member_count': 1,
    }
    _redis.set(_group_key(group_id), json.dumps(group))
    _redis.hset(_members_key(group_id), leader_id, leader_name)
    _redis.set(f'{USER_GROUP_KEY}{leader_id}', group_id)
    return _safe_group(group)


def get_group(group_id):
    """Get group by ID. Returns group dict or None."""
    raw = _redis.get(_group_key(group_id))
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception as e:
        logger.error("Failed to parse group %s: %s", group_id, e)
        return None


def get_group_credentials(group_id):
    """Get decrypted Spotify credentials for a group. Returns (client_id, client_secret) or None."""
    group = get_group(group_id)
    if not group:
        return None
    client_id = group.get('client_id')
    client_secret = crypto.decrypt(group.get('client_secret_encrypted', ''))
    if not client_id or not client_secret:
        return None
    return client_id, client_secret


def join_group(group_id, user_id, display_name):
    """Add a user to a group. Returns safe group dict or None."""
    group = get_group(group_id)
    if not group:
        return None

    members = _redis.hgetall(_members_key(group_id))
    if len(members) >= 5:
        return 'full'

    # Remove from previous group if any
    leave_current_group(user_id)

    _redis.hset(_members_key(group_id), user_id, display_name)
    _redis.set(f'{USER_GROUP_KEY}{user_id}', group_id)

    # Update member count
    group['member_count'] = len(_redis.hgetall(_members_key(group_id)))
    _redis.set(_group_key(group_id), json.dumps(group))

    return _safe_group(group)


def leave_group(group_id, user_id):
    """Remove a user from a group. Deletes group if no members remain.

    If the leader leaves but others remain, leadership transfers to the next member.
    """
    group = get_group(group_id)
    if not group:
        return False

    _redis.hdel(_members_key(group_id), user_id)
    _redis.delete(f'{USER_GROUP_KEY}{user_id}')

    members = _redis.hgetall(_members_key(group_id))

    # No members left — delete the group
    if not members:
        _delete_group(group_id)
        return True

    # If leader left, transfer to next member
    if user_id == group.get('leader_id'):
        new_leader_id, new_leader_name = next(iter(members.items()))
        group['leader_id'] = new_leader_id
        group['leader_name'] = new_leader_name

    group['member_count'] = len(members)
    _redis.set(_group_key(group_id), json.dumps(group))
    return True


def leave_current_group(user_id):
    """Leave whatever group the user is currently in."""
    current = get_user_group_id(user_id)
    if current:
        leave_group(current, user_id)


def _delete_group(group_id):
    """Delete a group and clean up all member references."""
    members = _redis.hgetall(_members_key(group_id))
    for uid in members:
        _redis.delete(f'{USER_GROUP_KEY}{uid}')
    _redis.delete(_group_key(group_id), _members_key(group_id))


def get_user_group_id(user_id):
    """Get the group ID a user belongs to, or None."""
    return _redis.get(f'{USER_GROUP_KEY}{user_id}')


def get_user_group(user_id):
    """Get the full group dict for a user, or None."""
    group_id = get_user_group_id(user_id)
    if not group_id:
        return None
    group = get_group(group_id)
    if not group:
        return None
    return _safe_group(group)


def get_group_members(group_id):
    """Get dict of {user_id: display_name} for a group."""
    return _redis.hgetall(_members_key(group_id))


def update_group_credentials(group_id, user_id, client_id, client_secret):
    """Update group Spotify credentials (leader only). Returns safe group dict or None."""
    group = get_group(group_id)
    if not group:
        return None
    if group.get('leader_id') != user_id:
        return 'not_leader'

    group['client_id'] = client_id.strip()
    group['client_secret_encrypted'] = crypto.encrypt(client_secret.strip())
    _redis.set(_group_key(group_id), json.dumps(group))
    return _safe_group(group)


def list_all_groups():
    """List all groups (admin). Returns list of safe group dicts."""
    keys = _redis.keys(f'{GROUP_PREFIX}*')
    groups = []
    for key in keys:
        raw = _redis.get(key)
        if not raw:
            continue
        try:
            group = json.loads(raw)
            members = _redis.hgetall(_members_key(group['id']))
            group['member_count'] = len(members)
            groups.append(_safe_group(group))
        except Exception as e:
            logger.error("Failed to parse group from key %s: %s", key, e)
    return groups


def claim_pending_membership(group_id, real_user_id, display_name):
    """Replace a __pending__ placeholder with the real user after OAuth login.

    Updates both the member list and the leader_id if the leader was pending.
    Also sets the user→group mapping for the real user ID.
    """
    group = get_group(group_id)
    if not group:
        return

    members_key = _members_key(group_id)
    members = _redis.hgetall(members_key)

    # If real user is already a member, just update their name
    if real_user_id in members:
        _redis.hset(members_key, real_user_id, display_name)
        _redis.set(f'{USER_GROUP_KEY}{real_user_id}', group_id)
        return

    # Replace __pending__ placeholder with real user
    if '__pending__' in members:
        _redis.hdel(members_key, '__pending__')
        _redis.delete(f'{USER_GROUP_KEY}__pending__')
        _redis.hset(members_key, real_user_id, display_name)
        _redis.set(f'{USER_GROUP_KEY}{real_user_id}', group_id)

        # If leader was pending, update leader to real user
        if group.get('leader_id') == '__pending__':
            group['leader_id'] = real_user_id
            group['leader_name'] = display_name
            _redis.set(_group_key(group_id), json.dumps(group))
    else:
        # No pending slot — just add them as a new member
        _redis.hset(members_key, real_user_id, display_name)
        _redis.set(f'{USER_GROUP_KEY}{real_user_id}', group_id)
        group['member_count'] = len(_redis.hgetall(members_key))
        _redis.set(_group_key(group_id), json.dumps(group))


def _safe_group(group):
    """Return group dict without encrypted secret."""
    return {
        'id': group['id'],
        'name': group['name'],
        'leader_id': group['leader_id'],
        'leader_name': group.get('leader_name', ''),
        'client_id': group.get('client_id', ''),
        'member_count': group.get('member_count', 0),
        'created_at': group.get('created_at', 0),
    }


def cleanup_empty_groups():
    """Delete groups with no members. Intended to run once daily."""
    keys = _redis.keys(f'{GROUP_PREFIX}*')
    cleaned = 0
    for key in keys:
        raw = _redis.get(key)
        if not raw:
            continue
        try:
            group = json.loads(raw)
            group_id = group['id']
            members = _redis.hgetall(_members_key(group_id))
            if not members:
                logger.info("Cleaning up empty group %s (%s)", group_id, group.get('name', ''))
                _delete_group(group_id)
                cleaned += 1
        except Exception as e:
            logger.error("Failed to check group %s for cleanup: %s", key, e)
    if cleaned:
        logger.info("Cleaned up %d empty group(s)", cleaned)
