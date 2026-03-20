"""WebSocket event handlers for real-time room communication."""

import time
import logging
from flask import session
from flask_socketio import SocketIO, emit, join_room, leave_room
import room_manager
import spotify_service

logger = logging.getLogger(__name__)

socketio = None


def init_socketio(sio):
    """Register socket event handlers."""
    global socketio
    socketio = sio

    @sio.on('connect')
    def on_connect():
        user = session.get('user')
        if not user:
            logger.error("WebSocket connect rejected: no session user")
            return False
        logger.info("User %s connected via WebSocket", user['spotify_user_id'])

    @sio.on('disconnect')
    def on_disconnect():
        user = session.get('user')
        if user:
            logger.info("User %s disconnected", user['spotify_user_id'])

    @sio.on('join_room')
    def on_join_room(data):
        user = session.get('user')
        if not user:
            return
        room_id = data.get('room_id')
        if not room_id:
            return

        state = room_manager.get_room(room_id)
        if not state:
            emit('error', {'message': 'Room not found'})
            return

        join_room(room_id)
        room_manager.add_participant(room_id, user['spotify_user_id'], user['display_name'])
        room_manager.store_user_token(room_id, user['spotify_user_id'], {
            'access_token': user['access_token'],
            'refresh_token': user['refresh_token'],
            'expires_at': user['expires_at'],
        })

        participants = room_manager.get_participants(room_id)
        sio.emit('room_state', {**state, 'participants': participants}, room=room_id)

        # Auto-sync: if room is playing, sync this user's Spotify to the current track
        if state.get('is_playing') and state.get('current_track'):
            user_id = user['spotify_user_id']
            token_data = room_manager.get_user_token(room_id, user_id)
            if token_data:
                refreshed = spotify_service.get_valid_token(token_data)
                if refreshed:
                    if refreshed is not token_data:
                        room_manager.store_user_token(room_id, user_id, refreshed)
                    expected_ms = state['position_ms'] + (time.time() - state['last_update']) * 1000
                    result = spotify_service.play_track(
                        refreshed['access_token'],
                        state['current_track'],
                        position_ms=max(0, int(expected_ms)),
                    )
                    if result.get('error'):
                        logger.error("Auto-sync failed for user %s on join: %s", user_id, result.get('message', result['error']))
                else:
                    logger.error("Could not get valid token for auto-sync, user %s", user_id)

    @sio.on('leave_room')
    def on_leave_room(data):
        user = session.get('user')
        if not user:
            return
        room_id = data.get('room_id')
        if not room_id:
            return

        leave_room(room_id)
        room_manager.remove_participant(room_id, user['spotify_user_id'])
        participants = room_manager.get_participants(room_id)

        # Auto-delete room if no participants remain
        if not participants:
            logger.info("Room %s is empty after last participant left, deleting", room_id)
            room_manager.delete_room(room_id)
            return

        state = room_manager.get_room(room_id)
        if state:
            sio.emit('room_state', {**state, 'participants': participants}, room=room_id)

    @sio.on('add_track')
    def on_add_track(data):
        user = session.get('user')
        if not user:
            return
        room_id = data.get('room_id')
        track = data.get('track')
        if not room_id or not track:
            return

        state = room_manager.add_to_queue(room_id, track)
        if state:
            participants = room_manager.get_participants(room_id)
            sio.emit('queue_updated', {**state, 'participants': participants}, room=room_id)

    @sio.on('skip_track')
    def on_skip_track(data):
        user = session.get('user')
        if not user:
            return
        room_id = data.get('room_id')
        if not room_id:
            return

        state = room_manager.get_room(room_id)
        if not state:
            return

        updated = room_manager.skip_track(room_id)
        if updated:
            participants = room_manager.get_participants(room_id)
            sio.emit('playback_sync', {**updated, 'participants': participants}, room=room_id)


def broadcast_sync(room_id, state):
    """Broadcast a playback sync event to all users in a room."""
    if socketio:
        participants = room_manager.get_participants(room_id)
        socketio.emit('playback_sync', {**state, 'participants': participants}, room=room_id)


def broadcast_queue(room_id, state):
    """Broadcast a queue update to all users in a room."""
    if socketio:
        participants = room_manager.get_participants(room_id)
        socketio.emit('queue_updated', {**state, 'participants': participants}, room=room_id)


def broadcast_room_state(room_id, state):
    """Broadcast a full room state update (settings, host change, etc.)."""
    if socketio:
        participants = room_manager.get_participants(room_id)
        socketio.emit('room_state', {**state, 'participants': participants}, room=room_id)
