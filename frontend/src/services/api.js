const BASE = '';

async function request(path, options = {}) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  } catch (e) {
    console.error(`API request failed [${path}]:`, e);
    throw e;
  }
}

export const api = {
  getLoginUrl: () => request('/api/auth/login'),
  exchangeCode: (code) => request('/api/auth/callback', { method: 'POST', body: JSON.stringify({ code }) }),
  getMe: () => request('/api/auth/me'),
  logout: () => request('/api/auth/logout', { method: 'POST' }),

  createRoom: (options = {}) => request('/api/rooms', { method: 'POST', body: JSON.stringify(options) }),
  getRoom: (roomId) => request(`/api/rooms/${roomId}`),
  joinRoom: (roomId) => request(`/api/rooms/${roomId}/join`, { method: 'POST' }),
  addToQueue: (roomId, track, playNext = false) => request(`/api/rooms/${roomId}/queue`, { method: 'POST', body: JSON.stringify({ track, play_next: playNext }) }),
  removeFromQueue: (roomId, index) => request(`/api/rooms/${roomId}/queue/${index}`, { method: 'DELETE' }),
  reorderQueue: (roomId, fromIndex, toIndex) => request(`/api/rooms/${roomId}/queue/reorder`, { method: 'PUT', body: JSON.stringify({ from_index: fromIndex, to_index: toIndex }) }),
  skipTrack: (roomId) => request(`/api/rooms/${roomId}/skip`, { method: 'POST' }),
  play: (roomId) => request(`/api/rooms/${roomId}/play`, { method: 'POST' }),
  pause: (roomId) => request(`/api/rooms/${roomId}/pause`, { method: 'POST' }),
  sync: (roomId) => request(`/api/rooms/${roomId}/sync`, { method: 'POST' }),
  updateSettings: (roomId, settings) => request(`/api/rooms/${roomId}/settings`, { method: 'PUT', body: JSON.stringify(settings) }),
  promoteHost: (roomId, userId) => request(`/api/rooms/${roomId}/promote`, { method: 'POST', body: JSON.stringify({ user_id: userId }) }),
  search: (q, type = 'track') => request(`/api/search?q=${encodeURIComponent(q)}&type=${type}`),

  // Admin
  adminListRooms: () => request('/api/admin/rooms'),
  adminDeleteRoom: (roomId) => request(`/api/admin/rooms/${roomId}`, { method: 'DELETE' }),
};
