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
- Classic scripts on `window.Uncinus`, no ES modules. Host load order: util → qr → net → face → match → cup → bots → render → sound → host.
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
  gives `p.flower = FLOWER_POWER`; goals by the holder (not own goals) add `m.flowerPoints` (Settings picker of `FLOWER_CHOICES` 2/3/5, default `FLOWER_POINTS` 2, saved in `uncinus_flower_points`, `M.setFlowerPoints`); `goal` events carry `points`.
  Brick (`ITEMS.brick`, field `p.brick = BRICK_POWER` 10 s): the holder's team's goal mouth shrinks to
  `BRICK_SHRINK`× and the other goal grows to `BRICK_GROW`×. Goal mouths are per end in `m.mouth` (eased by `stepMouths`
  toward `mouthTarget`); posts, net walls, `checkGoal`, the renderer and bots must use `M.mouthAt(m, end)`, never bare
  `GOAL_HALF`. The renderer fills the closed-off part of a shrunken net with a brick wall. Events `brick-spawn/get/end`;
  host→player `brick{on,secs}`; sound `S.bricks()`.
  Each power can be switched off: `m.powers` (keys `M.POWERS` star/shroom/flower/brick/turkey, all on by default), `M.setPower`
  (switching off removes it from the pitch and emits `<kind>-gone`), Settings chips `#powerPicker`, saved as JSON in
  `uncinus_powers`; spawners are gated on `m.powers[kind]`. Turkey (`m.turkey`, `stepTurkey`, own `TURKEY_GAP_MIN..MAX` timer,
  `TURKEY_LIFE` s) flees nearby players and flutter-hops (`turkey-hop`) when one is within `TURKEY_HOP_NEAR`; catching it
  (`turkey-get{id,name,team,victims}`) sets `p.coma = COMA_POWER` on every opponent: run speed × `COMA_SLOW`, kicks
  ignored; `coma-end` when it wears off. Host→catcher `turkey{secs}`, →victims `coma{on,secs}`. Bots chase it like an item.
- Team sides must stay obvious (players got confused): goals/end lines use the defending team's colour, chevrons
  point the attack direction; phones show the `attack-bar` (Defend / Score). Teams have no displayed names — colour
  only (`team-chip`); `TEAMS[].name` ("Blue"/"Orange") is just for aria labels and the `you.teamName` field.
- Timed games (`uncinus_length`, default 10, 0 = no limit): `m.period` free | pre | first | second | golden | full,
  `m.clock` counts down (paused during goal celebrations). `pre` waits for the first player. When the 1st half ends
  `m.swapped` flips ends only if `m.swapEnds` (Settings rule `uncinus_swap_ends`, default off; `period` messages carry
  `swapped`) and the 2nd half kicks off immediately (no halftime break — owner removed the halftime show).
  Level after the 2nd half → `golden` (next goal wins, no clock; `checkGoal` ends the game). No penalty shootouts
  (owner abandoned them). Full time shows `FULLTIME_SHOW` s then `resetMatch` (new game). Ends are never hard-coded: use `M.defends(m, team)` /
  `M.teamAt(m, end)` (goals, formation, renderer colours). Events `period{period,clock,score}`; host→player
  `period{…}`, `clock{period,clock}` once per second, and `you.sides` (end each colour defends) is re-sent before
  each period message so phones never show a stale direction.
- Room codes: 4 letters from `ROOM_ALPHABET` (no I/O); `util.roomCode` re-rolls any code containing a
  `BLOCKED_ROOM_WORDS` entry (`isCleanRoomCode`; the host also refuses to reuse a saved unclean code) — it's on an office TV.
- Relay: one Durable Object per room code, max 48 phones (`MAX_PLAYERS`; keep it a plain `const` — workerd refuses
  to start if the entry module exports anything but handlers/classes), `bye` before every server close
  (4001/4004/4009/4400). Normal games still put at most `M.MAX_PLAYERS` (12) on the pitch; the host sends `full` to the rest.
- Protocol: host→player `you{name,team,teamName,color,number,pick,counts,sides}`, `period`, `clock`, `score{left,right}`, `goal{team,scorerId,
  scorerName,ownGoal,score}`, `star{on,secs}`, `big{on,secs}`, `flower{on,secs,points}`, `brick{on,secs}`, `turkey{secs}`, `coma{on,secs}`, `full`; `goal` also has `points`; relay→player `welcome`, `host-left`, `host-back`.
  Championship: host→player `cup{on:true, phase, size, timer, merge, teams[{id,name,emoji,color,out,into,names}], tie, bracket, score,
  champion, boot, need, missing, players, mine, side, note, moved}` (per phone; never broadcast player ids) and `cup{on:false}`
  (sent on every normal-mode greet, so a phone that last saw a championship goes back to the pad); player→host `cup-pick{team}`,
  `cheer` (spectators only, `CHEER_GAP`). Phones can't move the championship along — only the big screen can.
- **Championship mode** (Settings toggle `uncinus_cup_on`; settings `uncinus_cup_settings` {size 4|8, length 2–5, theme feast|sky,
  merge}; the championship itself is saved in `uncinus_cup` and its room code in `uncinus_cup_room`, so a reload — or a TV that
  restarts with fresh sessionStorage — resumes it in the same room and waiting phones reconnect on their own). `js/cup.js` is pure and unit-tested:
  members by phone id (`team`, `home`, `seq` join order, `pickSeq`), phases lobby → draw → next (warm-up) → match → result → … →
  champion, timers `DRAW_SHOW`/`NEXT_SHOW`/`RESULT_SHOW` stepped by the host, `start` (needs a connected player per team) evens teams
  (earliest pickers stay; late pickers and the undecided fill gaps) and draws `rounds`; `finish` records a tie (coin toss if level —
  only by walkover/reset). `step` holds the warm-up countdown (at ≥ `WAIT_BACK`) while `missing` lists a team with nobody connected —
  never forfeit on the clock; a forced kickoff (`skip`) gives the present team a walkover. `merge` moves beaten members to the winner;
  `note` is each phone's one-line status. Team names/emoji/colours
  live in `THEMES` (Thanksgiving by default in November). Host: `state.cup`; only the current tie's connected members are on the
  pitch (`setupPitch`/`fillPitch`, tie `a` = left/blue, `b` = right/orange, `state.cupPitch` guards kickoff); `m.manual` makes `pre`
  wait for `M.startGame` and `full` hold; `m.maxPlayers` = 48; `C.finish` runs on the `full` period event and the cup's `result`
  phase shows the winner (the normal FULL TIME banner is skipped); `cupEvents` applies the latest phase once per drain;
  `cupGo()` = the big-screen buttons (lobby Start, board Skip/Kick off now; trophy New championship → `restartCup`); presses
  within `GO_GAP` of a phase change are ignored (double clicks / repeated OK);
  `syncCup` sends every phone its `cup` message (debounced 150 ms) and saves. `M.clearPlayers` ends power-ups first (phones get
  `star/big/flower{on:false}`). The phone's `you` handler marks it on the pitch (`cup.side`) and `applyYou` restores the pitch
  colour/number whenever the pad shows. Settings "New game" becomes "Replay this match"
  (`C.replay`); the keyboard player is off in championship mode. Phone: `watching()` (cup on and not on the pitch, or the
  trophy) → `body.cup-watch` hides the pad and shows `#cupScreen` (team picks, status card with live score, bracket, Cheer); on the pitch the normal pad plus `#cupBar`. Big overlays avoid `backdrop-filter` (costly over the canvas on TVs).
- **Bots** (Settings → 🤖 Bots, saved in `uncinus_bots` {size 0–5 players per team, skill easy|normal|hard}). `js/bots.js` is
  pure and unit-tested: the host keeps `state.bots` (id → brain) and calls `AI.drive(m, brains, dt)` each frame before the
  physics; it steers through `M.setInput` exactly like a phone (run vector + kick counter), so bots obey the same floaty
  physics. Brains think every `SKILLS[skill].think` s; per team the bot nearest the ball chases, with 3+ bots one keeps
  goal and the rest support in lanes (Easy: everyone chases). The chaser picks the most open of `SHOT_OFFSETS` around the
  goal line (two bots running head-on into one ball squeeze it back through one of them), won't dash into an opponent
  pressed on the far side of the ball, boots a dead ball only if that isn't back toward its own goal, hesitates a moment
  at each kickoff (`hesitate`, keyed off `m.phaseTime` resetting), and stands still for goals and full time. Host: ids
  `bot-<random>`, names `🤖 <Name>` (`AI.pickName`); `isLocal(id)` (keyboard or bot) gets no messages and is never
  disconnected or cleared by `welcome`/New room; `realPlayers()` excludes them. `fillBots()` runs every 0.5 s: normal
  play tops each side up to `size` minus the people on it (bots step off when people join); in a championship it works
  only in the lobby, per team, with cup members flagged `bot` (`C.join(..., { bot: true })`, saved with the cup — `balance` moves bots before people, `C.remove` drops one). Bots belong to a mode: switching drops them, and
  a saved championship re-adopts its bot members.
- Ball–player contacts resolve in a rotating order (`m.turn`): otherwise whoever joined last wins every scrum (bots made
  it obvious; it affected people too).
- TV browsers (the office TV lowercases URLs and may run an old Chromium): `render.js` polyfills `ctx.roundRect`; the frame
  loop schedules the next frame before running and catches errors; `watchFrameRate` trials 1× pixel density when most frames
  are slow and reverts if frames didn't get faster (30 fps caps like Energy Saver aren't render cost). Keep host-loaded scripts
  free of `?.`/`??` and other post-2020 syntax.
- Sound (`js/sound.js`, host only, loaded after render): all effects are synthesised with WebAudio, no audio files;
  the 10…1 countdown uses `speechSynthesis`. `host.playSound` maps match events → sounds: `dash` whoosh, `bump` (new
  match event when two players hit at > `BUMP_SPEED`) → an "oof" per player (per-player pitch, `OOF_GAP` debounce),
  `goal` crowd, `shroom-get` grow, `star-get/end` star theme loop, `flower-get` fanfare, `brick-get` brick thuds, `turkey-get` gobble, `turkey-hop` flap, `period` second/golden/full
  air horn. Audio unlocks on the first click/key; the toolbar 🔊 button / `M` toggles it (`uncinus_sound`).
- **Goal replays** (Settings toggle `uncinus_replays`, default on): the renderer `record`s a snapshot per frame (~4 s
  ring buffer, `REPLAY.keep`); its goal `onEvent` queues a replay that starts `REPLAY.delay` s later (`onReplay(true)`
  hides the GOAL! banner). `renderReplay` interpolates snapshots, tracks the ball (leaning toward the scorer), zooms in,
  goes slow-mo near the goal, draws the scene through `drawScene(…, live=false)` onto a small offscreen canvas and blows
  it up unsmoothed (pixelated, dissolving in/out), plus scanlines/vignette/REPLAY tag. The host sets `m.goalPause`
  (match field, default `GOAL_PAUSE`) to `Renderer.REPLAY_TIME + 0.3` so kickoff waits; the clock is stopped anyway.
  Full-time/cup banners after a golden goal wait `celebration()`. A replay stops if the match leaves the goal phase.
- `[hidden] { display:none !important }` is required.

## Testing
- `node --test tests/*.test.js` (match physics, championship, bots, QR, util); `cd relay && npm test` (boots wrangler dev).
- UI verified with headless Chrome + playwright-core (host + phone contexts against a local relay; not checked in).
  Run it under `caffeinate` — a sleeping Mac stalls the headless browser and makes waits time out.

## Release flow
Work on `develop` → bump `APP_VERSION` in `js/util.js` and every `?v=` in index.html and play.html → run tests →
`rm -rf build && mkdir build && cp -R index.html play.html styles.css icon.svg manifest.webmanifest js build/` →
commit "Release Uncinus <version>: <summary>" → push `develop` → `git checkout main && git merge develop -m "Merge develop for Uncinus <version>"`
→ push `main` → back to `develop`. Deploy relay changes with `cd relay && npm run deploy`.
