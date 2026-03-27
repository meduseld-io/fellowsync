"""Background worker that monitors playback and auto-advances the queue when tracks end."""

import time
import logging
import room_manager
import spotify_service
import groups
from socket_events import broadcast_sync

logger = logging.getLogger(__name__)


def _trigger_playback_for_room(room_id, state):
    """Tell all participants' Spotify clients to play the current track."""
    if not state.get('current_track') or not state.get('is_playing'):
        return
    tokens = room_manager.get_all_tokens(room_id)
    expected_ms = state['position_ms'] + (time.time() - state['last_update']) * 1000
    for user_id, token_data in tokens.items():
        group_id = token_data.get('group_id')
        cid, csecret = None, None
        if group_id:
            creds = groups.get_group_credentials(group_id)
            if creds:
                cid, csecret = creds
        refreshed = spotify_service.get_valid_token(token_data, client_id=cid, client_secret=csecret)
        if not refreshed:
            logger.error("Could not get valid token for user %s in room %s during auto-advance", user_id, room_id)
            continue
        if refreshed is not token_data:
            room_manager.store_user_token(room_id, user_id, refreshed)
        result = spotify_service.play_track(
            refreshed['access_token'],
            state['current_track'],
            position_ms=max(0, int(expected_ms)),
        )
        if result.get('error'):
            logger.error("Auto-advance playback failed for user %s: %s", user_id, result.get('message', result['error']))


EMPTY_ROOM_TTL = 300  # Clean up empty rooms after 5 minutes


def run_sync_loop(socketio):
    """Run the sync loop in a background thread. Checks every 2 seconds."""
    logger.info("Sync worker started")
    cleanup_counter = 0
    while True:
        try:
            _tick()
        except Exception as e:
            logger.error("Sync worker tick error: %s", e)
        # Run cleanup every 30 ticks (~60 seconds)
        cleanup_counter += 1
        if cleanup_counter >= 30:
            cleanup_counter = 0
            try:
                _cleanup_empty_rooms()
            except Exception as e:
                logger.error("Room cleanup error: %s", e)
        socketio.sleep(2)


def _tick():
    """Check all active rooms and advance tracks that have ended."""
    room_ids = room_manager.get_all_active_rooms()
    for room_id in room_ids:
        try:
            _check_room(room_id)
        except Exception as e:
            logger.error("Error checking room %s: %s", room_id, e)


def _check_room(room_id):
    """Check if the current track in a room has ended and advance if so."""
    state = room_manager.get_room(room_id)
    if not state or not state['is_playing'] or not state['current_track']:
        return

    track_info = state.get('current_track_info')
    if not track_info or not track_info.get('duration_ms'):
        return

    elapsed_ms = state['position_ms'] + (time.time() - state['last_update']) * 1000
    duration_ms = track_info['duration_ms']

    # Track has ended (with 2s buffer for network latency)
    if elapsed_ms >= duration_ms - 2000:
        logger.info("Track ended in room %s, advancing queue", room_id)

        updated = room_manager.skip_track(room_id)
        if updated:
            _trigger_playback_for_room(room_id, updated)
            broadcast_sync(room_id, updated)


def _cleanup_empty_rooms():
    """Delete rooms with no participants and no active playback."""
    room_ids = room_manager.get_all_active_rooms()
    for room_id in room_ids:
        participants = room_manager.get_participants(room_id)
        if not participants:
            state = room_manager.get_room(room_id)
            if not state or not state.get('is_playing'):
                logger.info("Cleaning up empty room %s", room_id)
                room_manager.delete_room(room_id)
