"""BYOK Group REST API routes."""

import logging
from flask import Blueprint, request, jsonify, session
from config import Config
import groups

logger = logging.getLogger(__name__)
groups_bp = Blueprint('groups', __name__)


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


@groups_bp.route('/api/groups', methods=['POST'])
def create_group():
    """Create a new BYOK group.

    Works both pre-auth (from login page) and post-auth (from lobby).
    If authenticated, the current user becomes leader. Otherwise, leader is set
    to a placeholder and updated on first login through the group.
    """
    user = _get_user()
    data = request.json or {}

    name = str(data.get('name', '')).strip()
    client_id = str(data.get('client_id', '')).strip()
    client_secret = str(data.get('client_secret', '')).strip()

    if not name:
        return jsonify({'error': 'Sync name is required'}), 400
    if not client_id or not client_secret:
        return jsonify({'error': 'Spotify Client ID and Client Secret are required'}), 400

    leader_id = user['spotify_user_id'] if user else '__pending__'
    leader_name = user['display_name'] if user else name

    group = groups.create_group(
        name=name,
        leader_id=leader_id,
        leader_name=leader_name,
        client_id=client_id,
        client_secret=client_secret,
    )
    return jsonify({'group': group})


@groups_bp.route('/api/groups/me')
@_require_auth
def my_group():
    """Get the current user's group, or null."""
    user = _get_user()
    group = groups.get_user_group(user['spotify_user_id'])
    if not group:
        return jsonify({'group': None})
    members = groups.get_group_members(group['id'])
    return jsonify({'group': group, 'members': members})


@groups_bp.route('/api/groups/<group_id>/join', methods=['POST'])
def join_group(group_id):
    """Join an existing group.

    Works both pre-auth (from login page) and post-auth (from lobby).
    Pre-auth joins use a placeholder user ID that gets updated on first login.
    """
    user = _get_user()
    user_id = user['spotify_user_id'] if user else '__pending__'
    display_name = user['display_name'] if user else 'Pending'

    result = groups.join_group(group_id, user_id, display_name)
    if result == 'full':
        return jsonify({'error': 'Sync is full (max 6 members)'}), 400
    if not result:
        return jsonify({'error': 'Sync not found'}), 404
    members = groups.get_group_members(group_id)
    return jsonify({'group': result, 'members': members})


@groups_bp.route('/api/groups/<group_id>/leave', methods=['POST'])
@_require_auth
def leave_group(group_id):
    """Leave a group. If no members remain, the group is deleted."""
    user = _get_user()
    success = groups.leave_group(group_id, user['spotify_user_id'])
    if not success:
        return jsonify({'error': 'Sync not found'}), 404
    return jsonify({'ok': True})


@groups_bp.route('/api/groups/<group_id>/credentials', methods=['PUT'])
@_require_auth
def update_credentials(group_id):
    """Update group Spotify credentials (leader only)."""
    user = _get_user()
    data = request.json or {}

    client_id = str(data.get('client_id', '')).strip()
    client_secret = str(data.get('client_secret', '')).strip()

    if not client_id or not client_secret:
        return jsonify({'error': 'Client ID and Client Secret are required'}), 400

    result = groups.update_group_credentials(group_id, user['spotify_user_id'], client_id, client_secret)
    if result == 'not_leader':
        return jsonify({'error': 'Only the sync leader can update credentials'}), 403
    if not result:
        return jsonify({'error': 'Sync not found'}), 404
    return jsonify({'group': result})


@groups_bp.route('/api/groups/<group_id>/members')
@_require_auth
def get_members(group_id):
    """Get group members."""
    group = groups.get_group(group_id)
    if not group:
        return jsonify({'error': 'Sync not found'}), 404
    members = groups.get_group_members(group_id)
    return jsonify({'members': members})


@groups_bp.route('/api/groups/<group_id>/kick/<user_id>', methods=['POST'])
@_require_auth
def kick_group_member(group_id, user_id):
    """Kick a member from a group. Leader or admin only."""
    caller = _get_user()
    caller_id = caller['spotify_user_id']

    group = groups.get_group(group_id)
    if not group:
        return jsonify({'error': 'Sync not found'}), 404

    is_leader = caller_id == group.get('leader_id')
    is_admin = caller_id in Config.ADMIN_USER_IDS
    if not is_leader and not is_admin:
        return jsonify({'error': 'Only the sync leader or an admin can kick members'}), 403

    if user_id == caller_id:
        return jsonify({'error': 'Cannot kick yourself'}), 400

    members = groups.get_group_members(group_id)
    if user_id not in members:
        return jsonify({'error': 'User not in this sync'}), 404

    groups.leave_group(group_id, user_id)
    updated_group = groups.get_user_group(caller_id) if groups.get_user_group_id(caller_id) == group_id else None
    updated_members = groups.get_group_members(group_id)
    return jsonify({'ok': True, 'group': updated_group, 'members': updated_members})


# --- Admin endpoints ---

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


@groups_bp.route('/api/admin/groups')
@_require_admin
def admin_list_groups():
    """List all BYOK groups."""
    all_groups = groups.list_all_groups()
    return jsonify({'groups': all_groups})


@groups_bp.route('/api/admin/groups/<group_id>', methods=['DELETE'])
@_require_admin
def admin_delete_group(group_id):
    """Force-delete a group."""
    group = groups.get_group(group_id)
    if not group:
        return jsonify({'error': 'Sync not found'}), 404
    groups._delete_group(group_id)
    return jsonify({'ok': True})
