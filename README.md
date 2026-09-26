# 🎨 Our Canvas

One private infinite canvas for two — no rooms, no codes. Just you two, one shared password, one endless board.
Built with **Node + Express + Socket.IO**, mobile-first, Apple-inspired UI.

## How it works

1. Set the password once as an env var:
   ```bash
   export CANVAS_PASSWORD="your-strong-password"  # 8-digit number
   npm install
   npm start
   # → http://localhost:3000
   ```
2. Open the link on both phones, enter the password.
3. Enter your name **once** — it's remembered from then on.
4. Draw together. 💕

## Persistence (survives redeploys)

By default everything lives in `./data` as JSON files — fine for local dev, but
**Render's free filesystem is wiped on every redeploy**. For permanent storage:

1. Create a free [Neon](https://neon.tech) account → new project → copy the connection string.
2. In Render: **Dashboard → your service → Environment** → add `DATABASE_URL` = that string.
3. Redeploy. The server logs `🎨 loaded N strokes via postgres` on boot.

That's it — canvas, sessions and bans move to one tiny Postgres table (`kv_store`).
Neon's free tier is 0.5 GB (your canvas is a few MB — effectively infinite for two
people), needs no credit card, and never deletes idle projects. If `DATABASE_URL`
is set but unreachable, the app refuses to boot rather than silently writing to
disk that gets wiped.

## Security

- The password lives only in the `CANVAS_PASSWORD` env var (never in code or the client) and is verified with scrypt + constant-time comparison.
- Login issues a random session token in an **HttpOnly + Secure + SameSite=Strict** cookie. WebSocket connections require a valid session.
- **3 wrong passwords from one IP → that IP is banned for 24h.** IP, user-agent and timestamps of every failed attempt are logged to `data/bans.json`.
- Sessions persist across restarts (`data/sessions.json`).

> Notes: bans are per-IP, so if you're both on the same Wi-Fi, 3 mistypes lock you both out for 24h (successful login resets the counter). A determined attacker can rotate IPs — for a two-person canvas this is plenty, but pick a strong password.

## Features

- **Infinite canvas** — pan with two fingers (or the ✋ tool), pinch to zoom, dot grid for orientation
- **Apple-style UI** — frosted-glass toolbars, SF system type, springy tap feedback
- **Dark & light mode** — toggle in the top bar, follows your system theme by default, remembered per device
- **Persistent memory** — every stroke is saved to `data/canvas.json` and restored on reopen
- **Live cursors** — see your partner's brush moving with their name on it 💞
- **Full paint kit**:
  - 🖊️ Pen · ✏️ Pencil · 🖍️ Marker · 🖌️ Highlighter · 💡 Neon glow · 🧽 Eraser
  - 📏 Line · ▢ Rectangle · ○ Circle · T Text · ✋ Pan
  - 12-color palette + custom color picker, brush size slider
- **Undo / redo** (your own strokes — survives reconnects), clear canvas (password-gated)

## Deploy to Render

`render.yaml` is included — or manually: **New + → Web Service** → connect the repo →
Runtime **Node**, Build `npm install`, **Start `node server.js`**, plan **Free**,
then add the `CANVAS_PASSWORD` env var in **Dashboard → Environment** (8-digit number).
For permanent storage also add `DATABASE_URL` (see Persistence above) — otherwise
drawings are wiped on redeploy.

## Test it

```bash
TEST_PORT=3456 node scripts/simulate.js   # 27 checks: auth, bans, sessions, sync, undo, persistence
```
