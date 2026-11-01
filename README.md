# Uncinus

**Sky soccer. The Mac is the pitch. Every phone is a blocky player.**

Uncinus (after *cirrus uncinus* — the hooked "mares' tails" cloud) is a party soccer game for the kashikoi cloud
suite. Put the match up on a Mac, scan the QR code with your phones, and everyone becomes a chunky block on a pitch
floating in the clouds. Steering is deliberately a little floaty — with a crowd of players it turns into glorious
chaos.

It is a plain HTML, CSS, and JavaScript app with no build step, plus one tiny Cloudflare Worker that relays phone
input to the big screen in real time. It shares its pairing, QR and relay code with its sibling **Volutus**.

## Play

1. Open **https://kashikoi.github.io/Uncinus/** on the Mac (full screen with the ⤢ button).
2. Scan the QR code with each phone — or open `kashikoi.github.io/Uncinus/play.html` and type the 4-letter room code.
3. Players are dealt onto **Sky** (blue, attacks →) and **Ember** (orange, attacks ←) to keep the teams even.
4. **Drag** anywhere on the pad to run (or tap **Tilt**), and tap **Kick** to dash — dash into the ball to boot it.
   Kick recharges in under a second. Shoulder-barge opponents freely.

Goals pop confetti on the big screen and flash every phone ("YOU SCORED!" / "Conceded"). Own goals count for the
other team. After each goal everyone resets to kickoff. Settings has **Reset score** and **New room**.

No phone handy? Press <kbd>K</kbd> on the Mac to play with the arrow keys / WASD and Space to kick.

Up to 12 players. If a phone locks or drops, its player stands faded ("away") for 20 seconds before leaving;
reopening the page picks the same player back up.

## How it works

```
iPhone (play.html) ──wss──▶ uncinus-relay (Durable Object per room) ──wss──▶ Mac (index.html)
      input {x, y, k}                     routes only, no game state           simulates + renders
```

- **index.html** (host) owns the match: physics in `js/match.js` (pure, unit-tested), drawing in `js/render.js`.
- **play.html** (controller) sends a run vector and a kick press counter `k`, ~20×/s and only when changed.
- **relay/** is a Cloudflare Worker with one Durable Object per room code (WebSocket Hibernation API).

## Relay

```sh
cd relay
npm install
npx wrangler login      # once
npm run deploy          # → wss://uncinus-relay.nimbus-sync.workers.dev
npm test                # boots wrangler dev and drives it with real WebSocket clients
```

## Local development

```sh
(cd relay && npm run dev)                      # relay on ws://<mac-ip>:8787
python3 -m http.server 5173 --bind 0.0.0.0     # app on http://<mac-ip>:5173
```

Open `http://<mac-ip>:5173/index.html?relay=ws://<mac-ip>:8787` on the Mac. The override is remembered and passed
to phones via the QR link; `?relay=default` resets it. Over plain `http://` iOS won't expose tilt; drag works.

## Tests

```sh
node --test tests/*.test.js     # match physics, QR encoder, helpers
(cd relay && npm test)          # relay integration
```

## Ideas

- Match timer and "first to 5" mode
- Power-ups that drift down on little clouds (giant ball, speed boots)
- Goalkeeper role for the last player in your half
