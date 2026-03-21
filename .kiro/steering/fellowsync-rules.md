# FellowSync Development Rules

## After Making Changes

When features, modes, settings, UI flows, or behavioral changes are introduced:

1. Update `README.md` features list if a new user-facing feature was added
2. Update `frontend/src/components/HelpModal.jsx` if the change affects how users interact with the app (new settings, changed flows, new UI elements)
3. Do NOT update meduseld or meduseld-site steering files — FellowSync is a separate project

## Deployment

```
cd /srv/apps/fellowsync && git pull && cd frontend && npm run build && sudo systemctl restart fellowsync
```

## Key Facts

- FellowSync is a standalone workspace folder — not inside meduseld or meduseld-site
- No Bootstrap — this is a React app, do not use Bootstrap tooltips or conventions
- Redis on server uses DB 1 (`redis://localhost:6379/1`)
- Admin Spotify user ID: `fs96zb0sif93rl5pfdgbniqig`
- Repo: `git@github.com:meduseld-io/fellowsync.git` (private, `meduseld-io` org)
- Always commit and push before telling the user how to deploy
