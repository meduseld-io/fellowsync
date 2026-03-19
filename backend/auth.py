"""Spotify OAuth routes."""

import time
import logging
import urllib.parse
import requests
from flask import Blueprint, request, jsonify, redirect, session
from config import Config

logger = logging.getLogger(__name__)
auth_bp = Blueprint('auth', __name__)


@auth_bp.route('/api/auth/login')
def login():
    """Redirect user to Spotify authorization page."""
    params = {
        'client_id': Config.SPOTIFY_CLIENT_ID,
        'response_type': 'code',
        'redirect_uri': Config.SPOTIFY_REDIRECT_URI,
        'scope': Config.SPOTIFY_SCOPES,
        'show_dialog': 'true',
    }
    url = f'{Config.SPOTIFY_AUTH_URL}?{urllib.parse.urlencode(params)}'
    return jsonify({'url': url})


@auth_bp.route('/api/auth/callback', methods=['POST'])
def callback():
    """Exchange authorization code for tokens."""
    code = request.json.get('code')
    if not code:
        return jsonify({'error': 'Missing authorization code'}), 400

    try:
        resp = requests.post(Config.SPOTIFY_TOKEN_URL, data={
            'grant_type': 'authorization_code',
            'code': code,
            'redirect_uri': Config.SPOTIFY_REDIRECT_URI,
            'client_id': Config.SPOTIFY_CLIENT_ID,
            'client_secret': Config.SPOTIFY_CLIENT_SECRET,
        }, timeout=10)
        resp.raise_for_status()
        token_data = resp.json()
    except Exception as e:
        logger.error("Spotify token exchange failed: %s", e)
        return jsonify({'error': 'Token exchange failed'}), 500

    access_token = token_data['access_token']

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
        'refresh_token': token_data['refresh_token'],
        'expires_at': time.time() + token_data.get('expires_in', 3600),
    }

    session['user'] = user_data
    return jsonify({
        'user': {
            'spotify_user_id': user_data['spotify_user_id'],
            'display_name': user_data['display_name'],
            'avatar': user_data['avatar'],
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
        }
    })


@auth_bp.route('/api/auth/logout', methods=['POST'])
def logout():
    """Clear session."""
    session.clear()
    return jsonify({'ok': True})
