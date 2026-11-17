# Uncinus

> Shown to players as **Sky Soccer** (page titles, logo, app name). The repo, URLs and code keep the name Uncinus.

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
   Optionally tap **Take selfie**: the front camera opens with an oval face guide, and your face, cut to the oval to
   drop the background, becomes your player on the big screen: just your face inside a team-colour frame that
   glows when Kick is ready. The photo is remembered on your phone; tap your
   swatch during a match to retake it.
3. Players are dealt onto the **blue** team (attacks →) or the **orange** team (attacks ←) to keep the teams even —
   or, with **Settings → Players pick their team**, each player picks a colour on their phone when they join, and
   can tap the Defend/Score bar to switch later. Teams have no
   names in the game; colour is enough.
4. **Drag** anywhere on the pad to run (or tap **Tilt**), and tap **Kick** to dash — dash into the ball to boot it.
   Kick recharges in under a second. Shoulder-barge opponents freely.

Goals count only when the whole ball crosses the goal line inside the net perimeter; pushing against the end wall
outside the net does not score. Goals pop confetti on the big screen and flash every phone ("YOU SCORED!" /
"Conceded"). Own goals count for the other team. After each goal everyone resets to kickoff. Settings has
**Reset score** and **New room**.

**Timed games** (Settings → Game length: no limit, 5, 10, 15 or 30 min; default 10). The clock starts when the first
player joins and each half counts down; at half time the second half kicks off straight away (Settings → Rules → **Swap ends at half time** makes the teams switch ends too; off by default).
If it's level when time runs out, it's **next goal wins** with no time limit. At full time the result shows on the
big screen and every phone (won / lost), and a new game kicks off by itself 20 seconds later. Goals pause the clock.
Settings → **New game** restarts.

**Mayhem mode** (Settings → Rules): about once a minute a star drifts onto the pitch. Whoever grabs it is invincible
for 10 seconds — they ghost straight through other players and nobody else can touch the ball, so they can dribble
the length of the pitch uncontested. Now and then a mushroom sprouts too: eat it to grow 2.5× bigger (and heavier)
for 12 seconds and shove everyone around. Grab a power flower and, for 20 seconds, every goal you score counts double (Settings → Flower: ×2, ×3 or ×5).
And now and then a 🦃 turkey gets loose: it runs from anyone who comes near and flutters away when cornered — catch it
and the other team falls into a 😴 food coma for 8 seconds (slow, and they can't kick). Each power (⭐ 🍄 🌸 🦃) has its
own on/off switch under Mayhem in Settings; all are on by default.

Which way? Each goal (net, frame and end line) is painted in the colour of the team **defending** it, and big chevrons in each half point the way that team attacks. Each
phone also shows a mini pitch: your goal says *Defend*, the other one pulses *Score*.

Sound plays on the Mac: a whoosh on every kick, an "oof!" from each player in a crash, the crowd going wild on
goals, a growing warble for the mushroom, a hyper theme while the star lasts, a fanfare for the flower, a spoken
"10! 9! 8!…" countdown at the end of each half and an air horn when time's up. Browsers keep audio off until you
click or press a key on the page (the 🔊 button pulses until then); toggle it with that button or <kbd>M</kbd>.

No phone handy? Press <kbd>K</kbd> on the Mac to play with the arrow keys / WASD and Space to kick.

Up to 12 players on the pitch in a normal game (the room itself takes up to 48 phones — see Championship mode). If
a phone locks or drops, its player stands faded ("away") for 20 seconds before leaving; reopening the page picks the
same player back up.

## Championship mode (big groups)

**Settings → 🏆 Championship mode** turns a crowd into a knockout tournament, and the same switch takes you back
to normal play.

1. **Huddle up.** Everyone scans the QR code (up to 48 phones). The big screen shows the teams filling up — 4 (or 8)
   themed teams: 🦃 Turkeys, 🥧 Pies, 🎃 Pumpkins, 🌽 Corn… in November, sky names (🌞 Suns, 🌙 Moons…) otherwise.
   Each phone picks a team and can switch until kickoff.
2. **Kick it off.** Whoever's at the big screen clicks **Start the championship** (it needs at least one player per
   team). Teams are evened up — the earliest pickers keep their team, late pickers and the
   undecided fill the gaps — and drawn into a bracket: semi-finals, then the final (8 teams add quarter-finals).
3. **Take turns.** Before each tie the two teams walk onto the pitch for a 30-second warm-up (phones buzz "YOU'RE
   UP!") while the big screen shows who's playing and the bracket; **Kick off now** on the big screen skips the wait. Ties are
   short timed games (2–5 min, default 4) (ends swap at half time if that rule is on), and level at the end means next goal wins,
   so every tie has a winner. Everyone else's phone shows the live score, when they play next, and a 📣 **Cheer**
   button that floats emoji up the big screen.
4. **Crown the champions** — trophy screen, confetti, fanfare, and the ⚽ Golden Boot for the top scorer. Then
   **New championship** (same teams; anyone can switch) or **Back to normal play**.

Options (Settings): 4 or 8 teams, match length, Thanksgiving or sky names, and **Everyone plays the final** —
beaten teams join the team that knocked them out, so nobody sits out for long and the final is everybody.
Latecomers can join mid-championship and pick any team still in it. If a team has nobody connected when its tie is
due, the countdown waits for them ("Waiting for the 🥧 Pies to rejoin…"); **Kick off now** on the big screen starts it anyway,
which gives the other team a walkover. Turning the mode off pauses the championship (normal play resumes with up to
12 on the pitch); turning it back on carries on from the warm-up of the interrupted tie. It also survives a reload
or restart of the big screen: it reopens the same room and phones reconnect by themselves.
Settings → **Replay this match** restarts the tie being played from its warm-up.

## Bots

**Settings → 🤖 Bots** tops the teams up with computer players, so anyone can play — on your own against a bot, or a
few friends against a full team. Choose how many players each team should have (1–5) and how good the bots are
(**Easy** bots all chase the ball like kids; **Normal** and **Hard** bots spread out into a chaser, support and a
keeper, react faster and aim better). People always come first: when someone joins a team, one of its bots steps
off, and bots come back when people leave. Bots play by the same rules as everyone — they steer the same floaty
blocks through the same controls a phone sends (a run direction and kick presses) — and wear a 🤖 on their name
tag.

In a championship, bots fill every team in the lobby (pick your team and a bot makes room), play their matches, can
and win the Golden Boot; once it starts, the teams stay as they are. To try a
championship on your own: Bots → 2 per team, switch on Championship mode, join with your phone, pick a team and
press Start on the big screen.

### On a TV

Open `kashikoi.github.io/uncinus` (TV browsers that lowercase the address still land on the game) and press OK once
so sound can start. Older TV browsers are covered: rounded shapes fall back when the browser lacks `roundRect`, a
bad frame can't freeze the screen, and on a slow screen the game tries 1× pixel density and keeps it if that helps. In championship mode
the big-screen buttons (Start, Kick off now) take the remote's focus, so OK presses them. Turn off the TV's screen
saver / eco auto-off before a long session.

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
node --test tests/*.test.js     # match physics, championship, bots, QR encoder, helpers
(cd relay && npm test)          # relay integration
```

## Ideas

- Match timer and "first to 5" mode
- Power-ups that drift down on little clouds (giant ball, speed boots)
- Goalkeeper role for the last player in your half
