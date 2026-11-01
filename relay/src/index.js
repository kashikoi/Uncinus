import { DurableObject } from "cloudflare:workers";

// Uncinus relay: one Durable Object per room. The Mac ("host") runs the match; phones ("players")
// send controller input. The relay only routes messages — it holds no game state.

const ROOM_RE = /^[A-HJ-NP-Z]{4}$/;
const ID_RE = /^[a-z0-9]{6,16}$/;
const MAX_PLAYERS = 12;
const MAX_PLAYER_MSG = 2048;
const MAX_HOST_MSG = 16384;

export const CLOSE = {
	REPLACED: 4001,
	NO_HOST: 4004,
	FULL: 4009,
	BAD_REQUEST: 4400,
};

const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
};

function json(body, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
	});
}

export function cleanName(value) {
	const name = String(value || "")
		.replace(/[\u0000-\u001f\u007f<>]/g, "")
		.trim()
		.slice(0, 16);
	return name || "Cloud";
}

export default {
	async fetch(request, env) {
		if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });

		const url = new URL(request.url);
		if (url.pathname === "/") return json({ app: "Uncinus Relay", ok: true });

		const match = url.pathname.match(/^\/room\/([A-Za-z]{4})$/);
		if (!match) return json({ error: "Use /room/<CODE>." }, 404);
		const code = match[1].toUpperCase();
		if (!ROOM_RE.test(code)) return json({ error: "Invalid room code." }, 400);

		if (request.headers.get("Upgrade") !== "websocket") {
			return json({ error: "Expected a WebSocket upgrade." }, 426);
		}

		const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
		return stub.fetch(request);
	},
};

export class Room extends DurableObject {
	async fetch(request) {
		const url = new URL(request.url);
		const role = url.searchParams.get("role");
		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair);

		if (role === "host") {
			for (const old of this.ctx.getWebSockets("host")) this.retire(old, CLOSE.REPLACED, "Another screen took over this room.");
			this.ctx.acceptWebSocket(server, ["host"]);
			server.serializeAttachment({ role: "host" });
			server.send(JSON.stringify({ t: "welcome", role: "host", players: this.players() }));
			this.toPlayers({ t: "host-back" });
			return new Response(null, { status: 101, webSocket: client });
		}

		const id = url.searchParams.get("id") || "";
		if (role !== "player" || !ID_RE.test(id)) {
			return this.reject(server, client, CLOSE.BAD_REQUEST, "Bad join request.");
		}

		if (!this.host()) {
			return this.reject(server, client, CLOSE.NO_HOST, "No screen is hosting this room.");
		}

		const existing = this.ctx.getWebSockets(`p:${id}`);
		for (const old of existing) this.retire(old, CLOSE.REPLACED, "Joined from another tab.");
		if (!existing.length && this.players().length >= MAX_PLAYERS) {
			return this.reject(server, client, CLOSE.FULL, "This match is full.");
		}

		const name = cleanName(url.searchParams.get("name"));
		this.ctx.acceptWebSocket(server, ["player", `p:${id}`]);
		server.serializeAttachment({ role: "player", id, name });
		server.send(JSON.stringify({ t: "welcome", role: "player", id }));
		this.toHost({ t: "join", id, name });
		return new Response(null, { status: 101, webSocket: client });
	}

	async webSocketMessage(ws, message) {
		const att = ws.deserializeAttachment();
		if (!att || att.retired || typeof message !== "string") return;

		if (att.role === "player") {
			if (message.length > MAX_PLAYER_MSG) return;
			let data;
			try {
				data = JSON.parse(message);
			} catch {
				return;
			}
			if (!data || typeof data !== "object") return;
			this.toHost({ t: "msg", from: att.id, d: data });
			return;
		}

		if (att.role === "host") {
			if (message.length > MAX_HOST_MSG) return;
			let data;
			try {
				data = JSON.parse(message);
			} catch {
				return;
			}
			if (!data || typeof data !== "object" || !data.d || typeof data.d !== "object") return;
			const payload = JSON.stringify(data.d);
			const targets = data.to === "*" ? this.ctx.getWebSockets("player") : this.ctx.getWebSockets(`p:${data.to}`);
			for (const target of targets) this.safeSend(target, payload);
		}
	}

	async webSocketClose(ws) {
		this.handleGone(ws);
	}

	async webSocketError(ws) {
		this.handleGone(ws);
	}

	handleGone(ws) {
		const att = ws.deserializeAttachment();
		if (!att || att.retired) return;
		ws.serializeAttachment({ ...att, retired: true });
		if (att.role === "player") this.toHost({ t: "leave", id: att.id });
		if (att.role === "host" && !this.host(ws)) this.toPlayers({ t: "host-left" });
	}

	// A "bye" message precedes every server-initiated close so clients can react without waiting
	// for the close handshake.
	reject(server, client, code, reason) {
		this.ctx.acceptWebSocket(server, ["rejected"]);
		server.send(JSON.stringify({ t: "bye", code, reason }));
		server.close(code, reason);
		return new Response(null, { status: 101, webSocket: client });
	}

	retire(ws, code, reason) {
		const att = ws.deserializeAttachment() || {};
		ws.serializeAttachment({ ...att, retired: true });
		this.safeSend(ws, JSON.stringify({ t: "bye", code, reason }));
		try {
			ws.close(code, reason);
		} catch {
			// Already closing.
		}
	}

	host(except) {
		return this.ctx.getWebSockets("host").find((ws) => ws !== except && !ws.deserializeAttachment()?.retired);
	}

	players() {
		return this.ctx
			.getWebSockets("player")
			.map((ws) => ws.deserializeAttachment())
			.filter((att) => att && !att.retired)
			.map(({ id, name }) => ({ id, name }));
	}

	toHost(obj) {
		const host = this.host();
		if (host) this.safeSend(host, JSON.stringify(obj));
	}

	toPlayers(obj) {
		const payload = JSON.stringify(obj);
		for (const ws of this.ctx.getWebSockets("player")) {
			if (!ws.deserializeAttachment()?.retired) this.safeSend(ws, payload);
		}
	}

	safeSend(ws, payload) {
		try {
			ws.send(payload);
		} catch {
			// Socket is closing; its close handler will clean up.
		}
	}
}
