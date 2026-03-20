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
            <h2>How to use Fellow<span style={{ color: '#4ade80' }}>Sync</span></h2>

            <h3>Getting Started</h3>
            <p>FellowSync lets you listen to music together with friends in real time. Everyone needs a Spotify Premium account and the Spotify app open on a device.</p>

            <h3>Creating or Joining a Room</h3>
            <p>Create a room to become the host, or enter a 6-character room code to join an existing one. Share your room code with friends so they can join.</p>

            <h3>Adding Tracks</h3>
            <p>Use the search bar to find songs on Spotify. Click "+ Add" to add a track to the queue. Everyone in the room can add tracks.</p>

            <h3>Playback</h3>
            <p>The host controls Play and Pause. When a track plays, FellowSync tells each person's Spotify app to play the same song at the same position — keeping everyone in sync.</p>
            <p>Make sure Spotify is open and active on one of your devices. If you see a "no device" warning, play any song briefly in Spotify first, then come back.</p>

            <h3>Skipping</h3>
            <p>The host can skip tracks instantly. Other listeners can vote to skip — once 50% of the room votes, the track is skipped automatically.</p>

            <h3>Room Code</h3>
            <p>Click the room code in the top-right corner to copy it to your clipboard.</p>

            <button className="btn-secondary close-btn" onClick={() => setOpen(false)}>Let's Sync!</button>
          </div>
        </div>
      )}
    </>
  );
}
