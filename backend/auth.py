"""Spotify OAuth routes with BYOK group support."""

import time
import logging
import urllib.parse
import requests
from flask import Blueprint, request, jsonify, session
from config import Config
import room_manager
import groups

logger = logging.getLogger(__name__)
auth_bp = Blueprint('auth', __name__)


def _get_credentials(group_id=None):
    """Get Spotify client credentials. Uses group credentials if group_id provided, else default."""
    if group_id:
        creds = groups.get_group_credentials(group_id)
        if creds:
            return creds
        logger.warning("Group %s credentials not found, falling back to default", group_id)
    return Config.SPOTIFY_CLIENT_ID, Config.SPOTIFY_CLIENT_SECRET


@auth_bp.route('/api/auth/login')
def login():
    """Redirect user to Spotify authorization page.

    Optional query param: ?group_id=xxx to use that group's Spotify app.
    """
    group_id = request.args.get('group_id', '').strip()
    client_id, _ = _get_credentials(group_id or None)

    # Store group_id in session so callback knows which credentials to use
    if group_id:
        session['pending_group_id'] = group_id
    else:
        session.pop('pending_group_id', None)

    params = {
        'client_id': client_id,
        'response_type': 'code',
        'redirect_uri': Config.SPOTIFY_REDIRECT_URI,
        'scope': Config.SPOTIFY_SCOPES,
        'show_dialog': 'true',
    }
    url = f'{Config.SPOTIFY_AUTH_URL}?{urllib.parse.urlencode(params)}'
    return jsonify({'url': url})


@auth_bp.route('/api/auth/callback', methods=['POST'])
def callback():
    """Exchange authorization code for tokens. Uses group credentials if set during login."""
    code = request.json.get('code')
    if not code:
        return jsonify({'error': 'Missing authorization code'}), 400

    group_id = session.get('pending_group_id')
    client_id, client_secret = _get_credentials(group_id)

    try:
        resp = requests.post(Config.SPOTIFY_TOKEN_URL, data={
            'grant_type': 'authorization_code',
            'code': code,
            'redirect_uri': Config.SPOTIFY_REDIRECT_URI,
            'client_id': client_id,
            'client_secret': client_secret,
        }, timeout=10)
        resp.raise_for_status()
        token_data = resp.json()
    except Exception as e:
        logger.error("Spotify token exchange failed: %s", e)
        return jsonify({'error': 'Token exchange failed'}), 500

    access_token = token_data['access_token']
    refresh_token = token_data.get('refresh_token')
    logger.info("Token exchange success. Scope granted: %s | refresh_token present: %s",
                token_data.get('scope', 'NOT RETURNED'), bool(refresh_token))

    # Fetch user profile
    try:
        profile_resp = requests.get(
            f'{Config.SPOTIFY_API_BASE}/me',
            headers={'Authorization': f'Bearer {access_token}'},
            timeout=10,
        )
        profile_resp.raise_for_status()
        profile = profile_resp.json()
    except Exception as e:
        logger.error("Failed to fetch Spotify profile: %s", e)
        return jsonify({'error': 'Failed to fetch profile'}), 500

    user_data = {
        'spotify_user_id': profile['id'],
        'display_name': profile.get('display_name', profile['id']),
        'avatar': profile['images'][0]['url'] if profile.get('images') else None,
        'access_token': access_token,
        'refresh_token': refresh_token,
        'expires_at': time.time() + token_data.get('expires_in', 3600),
        'group_id': group_id or None,
    }

    if not refresh_token:
        logger.warning("No refresh_token returned for user %s — token refresh will fail", profile['id'])

    # Enforce BYOK: non-admin users must authenticate through a group
    if Config.REQUIRE_BYOK and not group_id:
        is_admin = profile['id'] in Config.ADMIN_USER_IDS
        if not is_admin:
            # Check if user already belongs to a group from a previous session
            existing_group = groups.get_user_group_id(profile['id'])
            if existing_group:
                # User belongs to a group but authenticated with default credentials.
                # The token was issued by the default app, so refresh must use default
                # credentials. Store group_id on the session for UI but mark that the
                # token uses default credentials so room token storage can handle it.
                group_id = existing_group
                user_data['group_id'] = group_id
                user_data['_default_app_token'] = True
                logger.info("User %s re-authenticated via default app, restored group %s", profile['id'], existing_group)
            else:
                session.pop('pending_group_id', None)
                return jsonify({'error': 'A BYOS sync is required. Create or join a sync before logging in.'}), 403

    # If user logged in through a group, claim any pending placeholder membership
    if group_id:
        groups.claim_pending_membership(group_id, profile['id'], profile.get('display_name', profile['id']))

    # Apply saved custom display name if one exists
    saved_name = room_manager.get_user_display_name(profile['id'])
    if saved_name:
        user_data['display_name'] = saved_name

    session['user'] = user_data
    session.pop('pending_group_id', None)

    return jsonify({
        'user': {
            'spotify_user_id': user_data['spotify_user_id'],
            'display_name': user_data['display_name'],
            'avatar': user_data['avatar'],
            'group_id': user_data['group_id'],
        }
    })


@auth_bp.route('/api/auth/me')
def me():
    """Return current session user."""
    user = session.get('user')
    if not user:
        return jsonify({'authenticated': False}), 401
    return jsonify({
        'authenticated': True,
        'user': {
            'spotify_user_id': user['spotify_user_id'],
            'display_name': user['display_name'],
            'avatar': user['avatar'],
            'group_id': user.get('group_id'),
        }
    })


@auth_bp.route('/api/auth/logout', methods=['POST'])
def logout():
    """Clear session."""
    session.clear()
    return jsonify({'ok': True})


@auth_bp.route('/api/auth/config')
def auth_config():
    """Return public auth configuration for the frontend."""
    return jsonify({'require_byok': Config.REQUIRE_BYOK})


@auth_bp.route('/api/auth/avatar')
def get_avatar():
    """Return the user's saved avatar color."""
    user = session.get('user')
    if not user:
        return jsonify({'error': 'Not authenticated'}), 401
    color = room_manager.get_user_avatar(user['spotify_user_id'])
    return jsonify({'avatar': color})


@auth_bp.route('/api/auth/avatar', methods=['PUT'])
def set_avatar():
    """Save the user's avatar color choice."""
    user = session.get('user')
    if not user:
        return jsonify({'error': 'Not authenticated'}), 401
    data = request.json or {}
    color = data.get('color')
    if not color:
        return jsonify({'error': 'Missing color'}), 400
    room_manager.set_user_avatar(user['spotify_user_id'], color)
    return jsonify({'ok': True, 'avatar': color})


@auth_bp.route('/api/auth/display-name')
def get_display_name():
    """Return the user's saved custom display name."""
    user = session.get('user')
    if not user:
        return jsonify({'error': 'Not authenticated'}), 401
    name = room_manager.get_user_display_name(user['spotify_user_id'])
    return jsonify({'display_name': name})


@auth_bp.route('/api/auth/display-name', methods=['PUT'])
def set_display_name():
    """Save the user's custom display name."""
    user = session.get('user')
    if not user:
        return jsonify({'error': 'Not authenticated'}), 401
    data = request.json or {}
    name = (data.get('display_name') or '').strip()
    if not name:
        return jsonify({'error': 'Missing display_name'}), 400
    if len(name) > 32:
        return jsonify({'error': 'Display name too long (max 32 characters)'}), 400
    room_manager.set_user_display_name(user['spotify_user_id'], name)
    user['display_name'] = name
    session['user'] = user
    return jsonify({'ok': True, 'display_name': name})
