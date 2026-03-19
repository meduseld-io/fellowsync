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

  createRoom: () => request('/api/rooms', { method: 'POST' }),
  getRoom: (roomId) => request(`/api/rooms/${roomId}`),
  joinRoom: (roomId) => request(`/api/rooms/${roomId}/join`, { method: 'POST' }),
  addToQueue: (roomId, track) => request(`/api/rooms/${roomId}/queue`, { method: 'POST', body: JSON.stringify({ track }) }),
  skipTrack: (roomId) => request(`/api/rooms/${roomId}/skip`, { method: 'POST' }),
  play: (roomId) => request(`/api/rooms/${roomId}/play`, { method: 'POST' }),
  pause: (roomId) => request(`/api/rooms/${roomId}/pause`, { method: 'POST' }),
  sync: (roomId) => request(`/api/rooms/${roomId}/sync`, { method: 'POST' }),
  search: (q) => request(`/api/search?q=${encodeURIComponent(q)}`),
};
