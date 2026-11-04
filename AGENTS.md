# Uncinus — agent context / project memory

Checked-in snapshot of working context for Uncinus. If you're an agent picking this up, read this first.

## What this is
- **Party sky-soccer**: the Mac shows the pitch (index.html), each phone is a controller (play.html) for one blocky
  player. Part of the kashikoi cloud-themed suite; sibling of **Volutus** (same pairing/relay architecture — keep
  shared files `js/qr.js`, `js/net.js`, `js/util.js`, `relay/src/index.js` in sync when fixing bugs in either).
  Repo: github.com/kashikoi/Uncinus. Pages: https://kashikoi.github.io/Uncinus/ (served from `main` /).
- Player-facing name is **Sky Soccer** (titles, brand, manifest, settings footer); "Uncinus" stays for the repo,
  URLs, `window.Uncinus`, storage keys and the relay.
- Vanilla HTML/CSS/JS, no build step, no external JS dependencies. Themes Day (default) / Twilight / Night / Random.
- **Floaty, slightly unruly controls are a design goal** (owner: "the lack of complete control … makes the game
  unpredictable and fun with a lot of players"). Don't "fix" `RESPONSE`/dash momentum into tight controls.

## Architecture rules (keep these)
- Classic scripts on `window.Uncinus`, no ES modules. Host load order: util → qr → net → face → match → render → host.
  Controller: util → net → face → controller.
- **The host is authoritative.** All match state lives in `js/match.js` (pure, no DOM, unit-tested); the host steps it
  at fixed 1/120 s substeps. Phones send `{t:"in", x, y, k}` (`sanitizeInput` clamps to the unit disc) and face photos.
- Face photos (`js/face.js`, pure, unit-tested): phone crops the square framing the oval guide (84% of the square
  camera view), mirrors it, saves a 96 px JPEG data URL in `uncinus_face`, and sends it as `{t:"face", s, i, n, d}`
  chunks (relay caps phone messages at 2 KB; `n: 0` clears) after every `you`, so a reloaded host gets it again.
  Host validates with `isFaceDataUrl` (jpeg/png/webp base64 only, ≤ `FACE_MAX`) before drawing or putting it in the roster.
  A face player renders as only a team-colour frame (`FRAME`, faded during kick cooldown) around the oval-cut face,
  transparent inside — no block body or number badge (owner wants the face to be the player).
- Kick is a **press counter** `k` (not a held bool) so taps between network ticks aren't lost; the first `k` seen
  only syncs. `kick()` = dash impulse + `KICK_COOLDOWN`; touching the ball during a dash adds `KICK_POWER` once.
- Players are AABB blocks (`HALF`) vs a circle ball; player–player is circle push + velocity exchange. The ball is
  substepped to avoid tunnelling; constrain walls/net/posts after player–ball contact so shoves cannot escape the pitch.
  Posts are circles. Goal = ball fully past the line and fully within the net perimeter; credit uses
  `ball.lastTouch` (own goal if the toucher is on the other team). `phase` "goal" lasts `GOAL_PAUSE`, then kickoff.
- Teams: new players join the smaller team (`left` = Sky, attacks right; `right` = Ember). Kickoff spots fill the
  middle row first. Match emits events (`dash`, `kick`, `goal`, `reset`) drained by the host each frame for fx,
  banners and phone messages.
- Rules (host Settings, saved in `uncinus_team_pick` / `uncinus_mayhem`): team pick → every `you` carries `pick` +
  `counts`; the phone shows the picker once per `join()` (not on reconnect blips) and lets players re-open it by
  tapping the attack bar; it answers `{t:"team", team}`, host calls `M.setTeam` and re-sends `you`. Toggling the
  rule re-sends `you` to everyone. Mayhem → `M.setMayhem`;
  the star (`m.star`, spawned every `STAR_GAP_MIN..MAX` s using `m.rand`, only while nobody is powered) gives
  `p.star = STAR_POWER`: star players skip player–player collision entirely (ghosts), and while `m.powered` only
  they collide with the ball. Events `star-spawn/get/gone/end`; host→player `star{on}`. The mushroom (`m.shroom`,
  stationary, own `SHROOM_GAP` timer, one big player at a time) gives `p.big = BIG_POWER`; `p.scale` eases to
  `BIG_SCALE`. Player size is per-player (`half(p)`, mass = scale²) in walls/ball/push — never use bare `HALF` for a
  player. Renderer draws players scaled about their centre. Events `shroom-spawn/get/gone/end`; host→player `big{on}`.
  Mushroom and flower share `ITEMS` + `stepItem` (stationary pick-up, own gap timer, one holder per kind). Flower
  gives `p.flower = FLOWER_POWER`; goals by the holder (not own goals) add `FLOWER_POINTS`; `goal` events carry `points`.
- Team sides must stay obvious (players got confused): goals/end lines use the defending team's colour, chevrons
  point the attack direction; phones show the `attack-bar` (Defend / Score). Teams have no displayed names — colour
  only (`team-chip`); `TEAMS[].name` ("Blue"/"Orange") is just for aria labels and the `you.teamName` field.
- Timed games (`uncinus_length`, default 10, 0 = no limit): `m.period` free | pre | first | second | golden | full,
  `m.clock` counts down (paused during goal celebrations). `pre` waits for the first player. When the 1st half ends
  `m.swapped` flips ends and the 2nd half kicks off immediately (no halftime break — owner removed the halftime show).
  Level after the 2nd half → `golden` (next goal wins, no clock; `checkGoal` ends the game). No penalty shootouts
  (owner abandoned them). Full time shows `FULLTIME_SHOW` s then `resetMatch` (new game). Ends are never hard-coded: use `M.defends(m, team)` /
  `M.teamAt(m, end)` (goals, formation, renderer colours). Events `period{period,clock,score}`; host→player
  `period{…}`, `clock{period,clock}` once per second, and `you.sides` (end each colour defends) is re-sent before
  each period message so phones never show a stale direction.
- Relay: one Durable Object per room code, max 12 players, `bye` before every server close (4001/4004/4009/4400).
- Protocol: host→player `you{name,team,teamName,color,number,pick,counts,sides}`, `period`, `clock`, `score{left,right}`, `goal{team,scorerId,
  scorerName,ownGoal,score}`, `star{on,secs}`, `big{on,secs}`, `flower{on,secs,points}`, `full`; `goal` also has `points`; relay→player `welcome`, `host-left`, `host-back`.
- `[hidden] { display:none !important }` is required.

## Testing
- `node --test tests/*.test.js` (match physics, QR, util); `cd relay && npm test` (boots wrangler dev).
- UI verified with headless Chrome + playwright-core (host + four phone contexts; not checked in).

## Release flow
Work on `develop` → bump `APP_VERSION` in `js/util.js` and every `?v=` in index.html and play.html → run tests →
`rm -rf build && mkdir build && cp -R index.html play.html styles.css icon.svg manifest.webmanifest js build/` →
commit "Release Uncinus <version>: <summary>" → push `develop` → `git checkout main && git merge develop -m "Merge develop for Uncinus <version>"`
→ push `main` → back to `develop`. Deploy relay changes with `cd relay && npm run deploy`.
