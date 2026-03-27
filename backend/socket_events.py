"""WebSocket event handlers for real-time room communication."""

import time
import logging
from flask import session
from flask_socketio import SocketIO, emit, join_room, leave_room
import room_manager
import spotify_service
import groups

logger = logging.getLogger(__name__)

socketio = None
_sid_rooms = {}  # Maps socket session ID → (room_id, user_id) for disconnect cleanup


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
        from flask import request as flask_request
        user = session.get('user')
        sid = flask_request.sid
        mapping = _sid_rooms.pop(sid, None)
        if mapping:
            room_id, user_id = mapping
            room_manager.remove_participant(room_id, user_id)
            room_manager.remove_user_token(room_id, user_id)
            display_name = user['display_name'] if user else user_id
            room_manager.log_activity(room_id, display_name, 'left')
            logger.info("User %s removed from room %s on disconnect", user_id, room_id)

            participants = room_manager.get_participants(room_id)
            if not participants:
                logger.info("Room %s is empty after disconnect cleanup, deleting", room_id)
                room_manager.delete_room(room_id)
            else:
                state = room_manager.get_room(room_id)
                if state:
                    sio.emit('room_state', _room_payload(room_id, state), room=room_id)
        elif user:
            logger.info("User %s disconnected (no room mapping)", user['spotify_user_id'])

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
        from flask import request as flask_request
        _sid_rooms[flask_request.sid] = (room_id, user['spotify_user_id'])
        room_manager.add_participant(room_id, user['spotify_user_id'], user['display_name'])
        room_manager.log_activity(room_id, user['display_name'], 'joined')
        room_manager.store_user_token(room_id, user['spotify_user_id'], {
            'access_token': user['access_token'],
            'refresh_token': user['refresh_token'],
            'expires_at': user['expires_at'],
            'group_id': user.get('group_id'),
        })

        # Snapshot current position so clients get an accurate progress bar
        if state.get('is_playing') and state.get('last_update'):
            now = time.time()
            elapsed = (now - state['last_update']) * 1000
            state['position_ms'] = int(state['position_ms'] + elapsed)
            state['last_update'] = now
            room_manager.save_room(room_id, state)

        sio.emit('room_state', _room_payload(room_id, state), room=room_id)

        # Auto-sync: if room is playing, sync this user's Spotify to the current track
        if state.get('is_playing') and state.get('current_track'):
            user_id = user['spotify_user_id']
            token_data = room_manager.get_user_token(room_id, user_id)
            if token_data:
                _cid, _csecret = None, None
                _gid = token_data.get('group_id')
                if _gid:
                    _creds = groups.get_group_credentials(_gid)
                    if _creds:
                        _cid, _csecret = _creds
                refreshed = spotify_service.get_valid_token(token_data, client_id=_cid, client_secret=_csecret)
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
        from flask import request as flask_request
        _sid_rooms.pop(flask_request.sid, None)
        room_manager.remove_participant(room_id, user['spotify_user_id'])
        room_manager.remove_user_token(room_id, user['spotify_user_id'])
        room_manager.log_activity(room_id, user['display_name'], 'left')
        participants = room_manager.get_participants(room_id)

        # Auto-delete room if no participants remain
        if not participants:
            logger.info("Room %s is empty after last participant left, deleting", room_id)
            room_manager.delete_room(room_id)
            return

        state = room_manager.get_room(room_id)
        if state:
            sio.emit('room_state', _room_payload(room_id, state), room=room_id)

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
            sio.emit('queue_updated', _room_payload(room_id, state), room=room_id)

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
            sio.emit('playback_sync', _room_payload(room_id, updated), room=room_id)

    @sio.on('kick_user')
    def on_kick_user(data):
        user = session.get('user')
        if not user:
            return
        room_id = data.get('room_id')
        target_id = data.get('user_id')
        if not room_id or not target_id:
            return

        state = room_manager.get_room(room_id)
        if not state:
            return

        # Only the host can kick
        if user['spotify_user_id'] != state['host_id']:
            emit('error', {'message': 'Only the host can kick users'})
            return

        # Can't kick yourself
        if target_id == user['spotify_user_id']:
            return

        participants = room_manager.get_participants(room_id)
        target_name = participants.get(target_id, target_id)

        room_manager.remove_participant(room_id, target_id)
        room_manager.remove_user_token(room_id, target_id)
        room_manager.log_activity(room_id, user['display_name'], 'kicked', target_name)

        # Notify the kicked user (broadcast to room, client filters by user_id)
        sio.emit('kicked', {'room_id': room_id, 'user_id': target_id, 'reason': 'You were kicked by the host'}, room=room_id)

        # Broadcast updated room state
        updated = room_manager.get_room(room_id)
        if updated:
            sio.emit('room_state', _room_payload(room_id, updated), room=room_id)


def _room_payload(room_id, state):
    """Build a room state payload with participants and avatars."""
    participants = room_manager.get_participants(room_id)
    avatars = room_manager.get_participant_avatars(room_id)
    return {**state, 'participants': participants, 'participant_avatars': avatars}


def broadcast_sync(room_id, state):
    """Broadcast a playback sync event to all users in a room."""
    if socketio:
        socketio.emit('playback_sync', _room_payload(room_id, state), room=room_id)


def broadcast_queue(room_id, state):
    """Broadcast a queue update to all users in a room."""
    if socketio:
        socketio.emit('queue_updated', _room_payload(room_id, state), room=room_id)


def broadcast_room_state(room_id, state):
    """Broadcast a full room state update (settings, host change, etc.)."""
    if socketio:
        socketio.emit('room_state', _room_payload(room_id, state), room=room_id)


def broadcast_reaction(room_id, emoji):
    """Broadcast a reaction animation to all users in a room."""
    if socketio:
        socketio.emit('reaction', {'emoji': emoji}, room=room_id)
