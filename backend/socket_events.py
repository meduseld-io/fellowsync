"""WebSocket event handlers for real-time room communication."""

import time
import logging
from flask import session
from flask_socketio import emit, join_room, leave_room
import room_manager
import spotify_service
import groups
from config import Config

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
        return True

    @sio.on('disconnect')
    def on_disconnect():
        from flask import request as flask_request
        user = session.get('user')
        sid = flask_request.sid
        mapping = _sid_rooms.pop(sid, None)
        if mapping:
            room_id, user_id = mapping

            # Check if this user still has another active connection to the same room
            still_connected = any(
                uid == user_id and rid == room_id
                for other_sid, (rid, uid) in _sid_rooms.items()
            )
            if still_connected:
                logger.info("User %s disconnected sid=%s but still has another connection to room %s", user_id, sid, room_id)
                return

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

        user_id = user['spotify_user_id']

        # Check if this user already has an active connection to this room
        # If so, clean up the old SID mapping to prevent ghost participants
        from flask import request as flask_request
        old_sids = [sid for sid, (rid, uid) in _sid_rooms.items() if uid == user_id and rid == room_id and sid != flask_request.sid]
        for old_sid in old_sids:
            _sid_rooms.pop(old_sid, None)
            try:
                leave_room(room_id, sid=old_sid)
            except Exception as e:
                logger.error("Failed to leave_room for old sid %s in room %s: %s", old_sid, room_id, e)

        already_in = room_manager.get_participants(room_id).get(user_id)

        join_room(room_id)
        _sid_rooms[flask_request.sid] = (room_id, user_id)
        room_manager.add_participant(room_id, user_id, user['display_name'])
        _tok_gid = None if user.get('_default_app_token') else user.get('group_id')
        room_manager.store_user_token(room_id, user_id, {
            'access_token': user['access_token'],
            'refresh_token': user['refresh_token'],
            'expires_at': user['expires_at'],
            'group_id': _tok_gid,
        })

        # Only log "joined" if they weren't already a participant
        if not already_in:
            room_manager.log_activity(room_id, user['display_name'], 'joined')
        room_manager.store_user_token(room_id, user['spotify_user_id'], {
            'access_token': user['access_token'],
            'refresh_token': user['refresh_token'],
            'expires_at': user['expires_at'],
            'group_id': _tok_gid,
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

        # Only the host or an admin can kick
        is_host = user['spotify_user_id'] == state['host_id']
        is_admin = user['spotify_user_id'] in Config.ADMIN_USER_IDS
        if not is_host and not is_admin:
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

        # Clean up all SID mappings for the kicked user
        kicked_sids = [sid for sid, (rid, uid) in _sid_rooms.items() if uid == target_id and rid == room_id]
        for sid in kicked_sids:
            _sid_rooms.pop(sid, None)
            try:
                leave_room(room_id, sid=sid)
            except Exception as e:
                logger.error("Failed to leave_room for kicked sid %s in room %s: %s", sid, room_id, e)

        # Notify the kicked user (broadcast to room, client filters by user_id)
        sio.emit('kicked', {'room_id': room_id, 'user_id': target_id, 'reason': 'You were kicked by the host'}, room=room_id)

        # Broadcast updated room state
        updated = room_manager.get_room(room_id)
        if updated:
            sio.emit('room_state', _room_payload(room_id, updated), room=room_id)

    @sio.on('avatar_changed')
    def on_avatar_changed(data):
        user = session.get('user')
        if not user:
            return
        room_id = data.get('room_id')
        if not room_id:
            return
        state = room_manager.get_room(room_id)
        if state:
            sio.emit('room_state', _room_payload(room_id, state), room=room_id)

    @sio.on('name_changed')
    def on_name_changed(data):
        user = session.get('user')
        if not user:
            return
        room_id = data.get('room_id')
        new_name = (data.get('name') or '').strip()
        if not room_id or not new_name:
            return
        room_manager.update_participant_name(room_id, user['spotify_user_id'], new_name)
        state = room_manager.get_room(room_id)
        if state:
            sio.emit('room_state', _room_payload(room_id, state), room=room_id)


def _room_payload(room_id, state):
    """Build a room state payload with participants, avatars, and badges."""
    participants = room_manager.get_participants(room_id)
    avatars = room_manager.get_participant_avatars(room_id)
    badges = room_manager.get_participant_badges(room_id)
    return {**state, 'participants': participants, 'participant_avatars': avatars, 'participant_badges': badges}


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
