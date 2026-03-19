/**
 * Client-side Spotify playback control.
 * Each user calls the Spotify API directly to sync their own playback.
 * The backend is the source of truth — this just executes commands locally.
 */

const DRIFT_THRESHOLD_MS = 500;

export async function syncPlayback(accessToken, state) {
  if (!accessToken || !state.current_track) return;

  const headers = { Authorization: `Bearer ${accessToken}` };

  if (!state.is_playing) {
    try {
      await fetch('https://api.spotify.com/v1/me/player/pause', {
        method: 'PUT',
        headers,
      });
    } catch (e) {
      console.error('Failed to pause local playback:', e);
    }
    return;
  }

  const expectedMs = state.position_ms + (Date.now() - state.last_update * 1000);

  try {
    await fetch('https://api.spotify.com/v1/me/player/play', {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        uris: [state.current_track],
        position_ms: Math.max(0, Math.round(expectedMs)),
      }),
    });
  } catch (e) {
    console.error('Failed to sync playback:', e);
  }
}

export async function checkDrift(accessToken, state) {
  if (!accessToken || !state.is_playing || !state.current_track) return;

  const headers = { Authorization: `Bearer ${accessToken}` };

  try {
    const res = await fetch('https://api.spotify.com/v1/me/player', { headers });
    if (res.status === 204) return;
    const playback = await res.json();

    if (!playback.is_playing || playback.item?.uri !== state.current_track) {
      await syncPlayback(accessToken, state);
      return;
    }

    const expectedMs = state.position_ms + (Date.now() - state.last_update * 1000);
    const drift = Math.abs(playback.progress_ms - expectedMs);

    if (drift > DRIFT_THRESHOLD_MS) {
      console.log(`Drift detected: ${Math.round(drift)}ms, resyncing`);
      await syncPlayback(accessToken, state);
    }
  } catch (e) {
    console.error('Failed to check playback drift:', e);
  }
}
