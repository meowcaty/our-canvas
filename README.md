# 🎨 Our Canvas

An infinite collaborative drawing canvas for two — one endless board, two brushes, zero distance.
Built with **Node + Express + Socket.IO**, mobile-first.

## How to play

1. Start the server:
   ```bash
   npm install
   npm start
   # → http://localhost:3000
   ```
2. **Create a room**: enter your name, set a password (min 4 chars) → you get a 4-letter code.
3. Share the code + password (or tap the 🏠 chip in-app to copy an invite link).
4. Your person joins with the code + password. Draw together!

## Features

- **Infinite canvas** — pan with two fingers (or the ✋ tool), pinch to zoom, dot grid for orientation
- **Password-protected rooms** — passwords are salted + hashed (scrypt), wrong guesses are slowed down
- **Persistent memory** — every stroke is saved to `data/<CODE>.json` and restored when the room reopens
- **Live cursors** — see your partner's brush moving with their name on it 💞
- **Full paint kit**:
  - 🖊️ Pen · ✏️ Pencil · 🖍️ Marker · 🖌️ Highlighter · 💡 Neon glow · 🧽 Eraser
  - 📏 Line · ⬛ Rectangle · ⭕ Circle · 🔤 Text · ✋ Pan
  - 12-color palette + custom color picker, brush size slider
- **Undo / redo** (your own strokes), clear canvas (with confirm)
- Dark cozy theme so the neon really pops ✨

## Deploy to Render

`render.yaml` is included. Or manually: **New + → Web Service** → connect the repo →
Runtime **Node**, Build `npm install`, **Start `node server.js`**, plan **Free**.

> ⚠️ Render's free tier has an ephemeral filesystem — drawings persist across sleeps but are
> wiped on redeploys. For truly permanent storage, back `data/` up or wire the store up to Postgres.

## Test it

```bash
# terminal 1: PORT=3456 node server.js
# terminal 2:
TEST_PORT=3456 node scripts/simulate.js
```
