/**
 * Local bridge: run on your PC. Proxies Limelight stream and accepts one WebSocket
 * client for controller input. Expose this server via ngrok/cloudflared for remote access.
 */

const http = require("http");
const { WebSocketServer } = require("ws");

const BRIDGE_PORT = Number(process.env.BRIDGE_PORT) || 3999;
const LIMELIGHT_ORIGIN = process.env.LIMELIGHT_ORIGIN || "http://limelight-one.local:5800";

let currentClient = null;

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
			// Emit to your local app: print to stdout so you can pipe to another process, or add a TCP forward here.
			console.log("[controller]", JSON.stringify(msg));
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
	console.log("Expose with: ngrok http " + BRIDGE_PORT);
});
