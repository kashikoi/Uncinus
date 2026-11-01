// Integration test: boots the relay with `wrangler dev` and drives it with real WebSocket clients.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const PORT = 8790 + Math.floor(Math.random() * 100);
const BASE = `ws://127.0.0.1:${PORT}`;
let dev;

before(async () => {
	dev = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--ip", "127.0.0.1"], {
		cwd: new URL("..", import.meta.url).pathname,
		stdio: ["ignore", "pipe", "pipe"],
		env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
	});
	let log = "";
	dev.stdout.on("data", (b) => (log += b));
	dev.stderr.on("data", (b) => (log += b));
	const deadline = Date.now() + 60000;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`http://127.0.0.1:${PORT}/`);
			if (res.ok) return;
		} catch {
			// not up yet
		}
		await new Promise((r) => setTimeout(r, 300));
	}
	throw new Error(`wrangler dev did not start:\n${log}`);
});

after(() => dev?.kill());

function open(path) {
	const ws = new WebSocket(BASE + path);
	const inbox = [];
	const waiters = [];
	ws.closed = new Promise((resolve) => ws.addEventListener("close", (e) => resolve({ code: e.code, reason: e.reason })));
	ws.addEventListener("message", (e) => {
		const msg = JSON.parse(e.data);
		const i = waiters.findIndex((w) => w.match(msg));
		if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
		else inbox.push(msg);
	});
	ws.next = (match = () => true, ms = 5000) => {
		const i = inbox.findIndex(match);
		if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("timed out waiting for message")), ms);
			waiters.push({ match, resolve: (m) => (clearTimeout(timer), resolve(m)) });
		});
	};
	ws.ready = new Promise((resolve, reject) => {
		ws.addEventListener("open", resolve);
		ws.addEventListener("error", reject);
	});
	return ws;
}

const t = (type) => (m) => m.t === type;

test("health check", async () => {
	const res = await fetch(`http://127.0.0.1:${PORT}/`);
	assert.deepEqual(await res.json(), { app: "Uncinus Relay", ok: true });
});

test("rejects bad room codes and non-websocket requests", async () => {
	assert.equal((await fetch(`http://127.0.0.1:${PORT}/room/AB1D`)).status, 404);
	assert.equal((await fetch(`http://127.0.0.1:${PORT}/room/ABIO`)).status, 400);
	assert.equal((await fetch(`http://127.0.0.1:${PORT}/room/ABCD`)).status, 426);
});

test("player cannot join a room with no host", async () => {
	const p = open("/room/QQQQ?role=player&id=abcdef12&name=Ann");
	assert.equal((await p.next(t("bye"))).code, 4004);
});

test("host and players exchange messages", async () => {
	const host = open("/room/WXYZ?role=host");
	assert.deepEqual(await host.next(t("welcome")), { t: "welcome", role: "host", players: [] });

	const ann = open("/room/WXYZ?role=player&id=ann00001&name=%3CAnn%3E");
	assert.equal((await ann.next(t("welcome"))).id, "ann00001");
	assert.deepEqual(await host.next(t("join")), { t: "join", id: "ann00001", name: "Ann" });

	ann.send(JSON.stringify({ t: "in", x: 0.5, y: -1, rain: true }));
	assert.deepEqual(await host.next(t("msg")), { t: "msg", from: "ann00001", d: { t: "in", x: 0.5, y: -1, rain: true } });

	const bob = open("/room/WXYZ?role=player&id=bob00001&name=Bob");
	await bob.next(t("welcome"));
	await host.next(t("join"));

	host.send(JSON.stringify({ to: "bob00001", d: { t: "you", color: "#fff" } }));
	assert.deepEqual(await bob.next(t("you")), { t: "you", color: "#fff" });

	host.send(JSON.stringify({ to: "*", d: { t: "round" } }));
	await ann.next(t("round"));
	await bob.next(t("round"));

	bob.close();
	assert.deepEqual(await host.next(t("leave")), { t: "leave", id: "bob00001" });

	// A reloaded host replaces the old one and gets the current roster.
	const host2 = open("/room/WXYZ?role=host");
	const welcome = await host2.next(t("welcome"));
	assert.deepEqual(welcome.players, [{ id: "ann00001", name: "Ann" }]);
	assert.equal((await host.next(t("bye"))).code, 4001);
	await ann.next(t("host-back"));

	host2.close();
	await ann.next(t("host-left"));
	ann.close();
});

test("rejoining with the same id replaces the old socket without a leave", async () => {
	const host = open("/room/RJRJ?role=host");
	await host.next(t("welcome"));
	const a1 = open("/room/RJRJ?role=player&id=same0001&name=A");
	await a1.next(t("welcome"));
	await host.next(t("join"));
	const a2 = open("/room/RJRJ?role=player&id=same0001&name=A");
	await a2.next(t("welcome"));
	assert.equal((await a1.next(t("bye"))).code, 4001);
	await host.next(t("join"));
	await assert.rejects(host.next(t("leave"), 500));
	host.close();
	a2.close();
});

test("caps a room at 12 players", async () => {
	const host = open("/room/FULL?role=host");
	await host.next(t("welcome"));
	const players = [];
	for (let i = 0; i < 12; i++) {
		const p = open(`/room/FULL?role=player&id=player${String(i).padStart(2, "0")}&name=P${i}`);
		await p.next(t("welcome"));
		players.push(p);
	}
	const extra = open("/room/FULL?role=player&id=player99&name=X");
	assert.equal((await extra.next(t("bye"))).code, 4009);
	players.forEach((p) => p.close());
	host.close();
});
