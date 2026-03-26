import { useState } from 'react';
import './HelpModal.css';

export default function HelpModal() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="help-btn" onClick={() => setOpen(true)} aria-label="How to use FellowSync">Need Help?</button>

      {open && (
        <div className="help-overlay" onClick={() => setOpen(false)}>
          <div className="help-modal" onClick={(e) => e.stopPropagation()}>
            <h2>How to use Fellow<span style={{ color: 'var(--fella-color)' }}>Sync</span></h2>

            <h3>Getting Started</h3>
            <p>FellowSync lets you listen to music together with friends in real time. Everyone needs a Spotify Premium account and the Spotify app open on a device.</p>

            <h3>Creating or Joining a Room</h3>
            <p>Create a room to become the host, or enter a 6-character room code to join an existing one. Share your room code with friends so they can join.</p>

            <h3>Adding Tracks</h3>
            <p>Use the search bar to find songs on Spotify. You can search by track, artist, or album. Click "+ Add" to add to the end of the queue, or "▶ Next" to play it next. Everyone in the room can add tracks.</p>

            <h3>Room Modes & Settings</h3>
            <p>The host configures room settings when creating a room or from the ⚙ Settings button in-room. All settings open in a popup modal.</p>
            <p><strong>Normal</strong> - free-for-all queue, anyone can add as many tracks as they want.</p>
            <p><strong>Hear Me Out</strong> - alternates songs between users so everyone gets a turn.</p>
            <p><strong>DJ Mode</strong> - only the host can add songs. Everyone else just listens. Perfect for curated sessions or themed nights.</p>
            <p><strong>Blind Mode</strong> - a toggle that hides upcoming songs in the queue from listeners. You won't know what's next until it plays. The host can still see everything. Can be combined with any mode.</p>
            <p>Modes (Normal, Hear Me Out, DJ) are mutually exclusive - you can only have one active at a time. Blind Mode is a separate toggle.</p>
            <p><strong>Max in a row</strong> - limits how many songs one person can queue consecutively (1, 2, 3, or unlimited).</p>
            <p><strong>Vibe</strong> - the host can set a vibe label for the room (e.g. "Metal", "90s hip-hop") to set the mood.</p>
            <p><strong>Skip votes</strong> - sets the percentage of listeners that must vote to skip before a track is skipped (25%, 50%, 75%, or unanimous). The host can always skip instantly.</p>
            <p><strong>Auto-playlist</strong> - paste a Spotify playlist URL and when the queue runs empty, the next track from that playlist will automatically be queued. Keeps the music going when nobody's actively adding songs. The next 10 upcoming playlist tracks are shown below the queue so everyone can see what's coming.</p>
            <p><strong>Reactions</strong> - when enabled, emoji reaction buttons appear below the now-playing card. Click to react to the current track (🔥 ❤️ 😴 💀 😂). One reaction per person, resets when the track changes.</p>
            <p><strong>Stats</strong> - when enabled, a "Session Stats" panel appears showing tracks played, skips, session duration, and a leaderboard of who queued the most songs.</p>

            <h3>Playback</h3>
            <p>The host controls Play and Pause. When a track plays, FellowSync tells each person's Spotify app to play the same song at the same position - keeping everyone in sync.</p>
            <p>Make sure Spotify is open and active on one of your devices. If you see a "no device" warning, play any song briefly in Spotify first, then come back.</p>

            <h3>Sync & Skipping</h3>
            <p>Hit the "Sync!" button if your playback drifts out of position. The host can skip tracks instantly. Other listeners can vote to skip - once enough of the room votes (threshold set by the host), the track is skipped automatically.</p>

            <h3>Host Controls</h3>
            <p>The host can drag to reorder the queue, shuffle it with the 🔀 button, remove any track, promote another listener to host, and clear the entire queue. If the host leaves, they'll be asked to pick a new host first.</p>

            <h3>BYOS Syncs</h3>
            <p>Spotify limits each app to 6 users in dev mode. If your group is larger, or you want to self-manage your Spotify app credentials, use BYOS (Bring Your Own Sync). One person creates a Sync with their Spotify app's Client ID and Secret, then shares the Sync ID with friends. Members join the Sync and re-login to authenticate through the Sync's Spotify app instead of the default one.</p>
            <p>Create a Spotify app at <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--fella-color)' }}>developer.spotify.com</a>. Set the redirect URI to match your FellowSync instance.</p>

            <h3>Room Code</h3>
            <p>Click the room code in the top-right corner to copy it to your clipboard.</p>

            <h3>Contact</h3>
            <p>Questions, issues, or feedback? Reach out at <a href="mailto:admin@meduseld.io" style={{ color: 'var(--fella-color)' }}>admin@meduseld.io</a></p>

            <button className="btn-secondary close-btn" onClick={() => setOpen(false)}>Let's Sync!</button>
          </div>
        </div>
      )}
    </>
  );
}
