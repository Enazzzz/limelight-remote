/**
 * Local bridge: run on your PC. Proxies Limelight stream and accepts one WebSocket
 * client for controller input. Expose this server via ngrok/cloudflared for remote access.
 */

const http = require("http");
const { WebSocketServer } = require("ws");

const fs = require("fs");

const BRIDGE_PORT = Number(process.env.BRIDGE_PORT) || 3999;
const LIMELIGHT_ORIGIN = process.env.LIMELIGHT_ORIGIN || "http://limelight-one.local:5800";
/** Optional: append each controller JSON line to this file (e.g. for testing or robot input). */
const CONTROLLER_LOG_PATH = process.env.BRIDGE_CONTROLLER_LOG || "";

let currentClient = null;

const LOG_TO_CONSOLE = process.env.BRIDGE_LOG_CONTROLLER === "1" || process.env.BRIDGE_LOG_CONTROLLER === "true";

function onControllerMessage(msg) {
	if (LOG_TO_CONSOLE) console.log("[controller]", JSON.stringify(msg));
	if (CONTROLLER_LOG_PATH) {
		try {
			fs.appendFileSync(CONTROLLER_LOG_PATH, JSON.stringify(msg) + "\n");
		} catch (err) {
			console.error("[controller log]", err.message);
		}
	}
}

const server = http.createServer((req, res) => {
	// Do not proxy WebSocket path; let WebSocketServer handle it
	const pathname = (req.url || "/").split("?")[0];
	if (pathname === "/ws" || pathname === "/ws/") {
		res.writeHead(400, { "Content-Type": "text/plain" });
		res.end("Use WebSocket to connect to /ws");
		return;
	}
	// Proxy all other requests to Limelight (stream, UI, etc.)
	const url = new URL(req.url || "/", `http://localhost`);
	const target = new URL(url.pathname + url.search, LIMELIGHT_ORIGIN);

	const opts = {
		hostname: target.hostname,
		port: target.port || 80,
		path: target.pathname + target.search,
		method: req.method,
		headers: { ...req.headers, host: target.host },
	};

	const proxy = http.request(opts, (proxyRes) => {
		res.writeHead(proxyRes.statusCode, proxyRes.headers);
		proxyRes.pipe(res, { end: true });
	});
	proxy.on("error", (err) => {
		console.error("[proxy]", err.message);
		res.writeHead(502, { "Content-Type": "text/plain" });
		res.end("Bridge could not reach Limelight at " + LIMELIGHT_ORIGIN);
	});
	req.pipe(proxy, { end: true });
});

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
	if (currentClient) {
		ws.close(1008, "Only one viewer allowed at a time.");
		return;
	}
	currentClient = ws;
	console.log("[ws] Viewer connected from", req.socket.remoteAddress);

	ws.on("message", (data) => {
		try {
			const msg = JSON.parse(data.toString());
			onControllerMessage(msg);
		} catch {
			// ignore non-JSON
		}
	});

	ws.on("close", () => {
		if (currentClient === ws) currentClient = null;
		console.log("[ws] Viewer disconnected");
	});
});

server.listen(BRIDGE_PORT, "0.0.0.0", () => {
	console.log("Bridge listening on http://0.0.0.0:" + BRIDGE_PORT);
	console.log("  Limelight proxy -> " + LIMELIGHT_ORIGIN);
	console.log("  WebSocket /ws   -> one controller client");
	if (CONTROLLER_LOG_PATH) console.log("  Controller log   -> " + CONTROLLER_LOG_PATH);
	console.log("Expose with: ngrok http " + BRIDGE_PORT);
});
