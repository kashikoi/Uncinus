/* Uncinus — relay connection with automatic reconnect. */
(function (root) {
  "use strict";

  // Close codes the relay uses when it refuses or replaces a connection; these don't auto-retry.
  const FINAL = { 4001: "replaced", 4004: "no-host", 4009: "full", 4400: "bad-request" };

  class Link {
    constructor({ url, onMessage, onStatus }) {
      this.url = url;
      this.onMessage = onMessage || (() => {});
      this.onStatus = onStatus || (() => {});
      this.ws = null;
      this.attempt = 0;
      this.stopped = false;
      this.timer = null;
      this.status = "idle";
    }

    connect() {
      this.stopped = false;
      clearTimeout(this.timer);
      if (this.ws && this.ws.readyState <= 1) return;
      this.setStatus("connecting");
      let ws;
      try {
        ws = new WebSocket(this.url);
      } catch (err) {
        this.setStatus("error", String(err.message || err));
        this.retry();
        return;
      }
      this.ws = ws;
      let finalReason = null;
      ws.addEventListener("open", () => {
        this.attempt = 0;
        this.setStatus("open");
      });
      ws.addEventListener("message", (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (msg && msg.t === "bye" && FINAL[msg.code]) {
          finalReason = FINAL[msg.code];
          this.stopped = true;
          this.setStatus(finalReason, msg.reason);
          try {
            ws.close();
          } catch {
            // ignore
          }
          return;
        }
        this.onMessage(msg);
      });
      ws.addEventListener("close", (event) => {
        if (this.ws !== ws) return;
        this.ws = null;
        if (finalReason) return;
        if (FINAL[event.code]) {
          this.stopped = true;
          this.setStatus(FINAL[event.code], event.reason);
          return;
        }
        if (!this.stopped) this.retry();
        else this.setStatus("closed");
      });
    }

    retry() {
      if (this.stopped) return;
      const delay = Math.min(8000, 400 * 2 ** this.attempt++) + Math.random() * 300;
      this.setStatus("reconnecting", Math.round(delay / 1000));
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.connect(), delay);
    }

    send(obj) {
      if (this.ws && this.ws.readyState === 1) {
        this.ws.send(JSON.stringify(obj));
        return true;
      }
      return false;
    }

    close() {
      this.stopped = true;
      clearTimeout(this.timer);
      if (this.ws) {
        const ws = this.ws;
        this.ws = null;
        try {
          ws.close(1000);
        } catch {
          // ignore
        }
      }
      this.setStatus("closed");
    }

    setStatus(status, detail) {
      this.status = status;
      this.onStatus(status, detail);
    }
  }

  root.Uncinus = root.Uncinus || {};
  root.Uncinus.Link = Link;
})(typeof window !== "undefined" ? window : globalThis);
