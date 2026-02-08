#!/usr/bin/env node
/**
 * One-command script: starts the bridge and exposes it with ngrok so the app is online.
 * Requires NGROK_AUTHTOKEN (free at https://dashboard.ngrok.com/get-started/your-authtoken).
 *
 * Usage: npm run go
 * Or:    set NGROK_AUTHTOKEN=your_token && node scripts/start-with-ngrok.js
 */

const { spawn } = require("child_process");
const path = require("path");
const net = require("net");

const PROJECT_ROOT = path.resolve(__dirname, "..");
// Load .env from project root so NGROK_AUTHTOKEN can be set there
try {
	require("dotenv").config({ path: path.join(PROJECT_ROOT, ".env") });
} catch {
	// dotenv optional
}

const BRIDGE_PORT = Number(process.env.BRIDGE_PORT) || 3999;
const BRIDGE_SCRIPT = path.join(PROJECT_ROOT, "bridge", "index.js");

function waitForPort(port, timeoutMs = 10000) {
	const start = Date.now();
	return new Promise((resolve, reject) => {
		function tryConnect() {
			const socket = new net.Socket();
			socket.setTimeout(500);
			socket.on("connect", () => {
				socket.destroy();
				resolve();
			});
			socket.on("error", () => {
				if (Date.now() - start > timeoutMs) {
					reject(new Error("Bridge did not start in time"));
					return;
				}
				setTimeout(tryConnect, 300);
			});
			socket.on("timeout", () => {
				socket.destroy();
				if (Date.now() - start > timeoutMs) {
					reject(new Error("Bridge did not start in time"));
					return;
				}
				setTimeout(tryConnect, 300);
			});
			socket.connect(port, "127.0.0.1");
		}
		tryConnect();
	});
}

async function main() {
	if (!process.env.NGROK_AUTHTOKEN) {
		console.error("");
		console.error("  NGROK_AUTHTOKEN is not set.");
		console.error("  Get a free token at: https://dashboard.ngrok.com/get-started/your-authtoken");
		console.error("  Then either:");
		console.error("    - Add it to a .env file:  NGROK_AUTHTOKEN=your_token");
		console.error("    - Or set in shell, then:  npm run go");
		console.error("  (PowerShell: $env:NGROK_AUTHTOKEN=\"token\"  |  CMD: set NGROK_AUTHTOKEN=token  |  Bash: export NGROK_AUTHTOKEN=token)");
		console.error("");
		process.exit(1);
	}

	// Start bridge as child process
	const bridge = spawn(process.execPath, [BRIDGE_SCRIPT], {
		cwd: PROJECT_ROOT,
		stdio: ["ignore", "pipe", "pipe"],
		env: { ...process.env, BRIDGE_PORT: String(BRIDGE_PORT) },
	});

	bridge.stdout.on("data", (chunk) => process.stdout.write(chunk));
	bridge.stderr.on("data", (chunk) => process.stderr.write(chunk));
	bridge.on("error", (err) => {
		console.error("Failed to start bridge:", err);
		process.exit(1);
	});
	bridge.on("exit", (code, signal) => {
		if (code !== null && code !== 0) process.exit(code);
		if (signal) process.kill(process.pid, signal);
	});

	await waitForPort(BRIDGE_PORT);

	// Expose with ngrok
	const ngrok = require("@ngrok/ngrok");
	let listener;
	try {
		listener = await ngrok.forward({
			addr: BRIDGE_PORT,
			authtoken_from_env: true,
		});
	} catch (err) {
		console.error("ngrok failed:", err.message);
		bridge.kill();
		process.exit(1);
	}

	const url = listener.url();
	const appUrl = process.env.REMOTE_LIMELIGHT_APP_URL;
	const shareLink = appUrl ? `${appUrl.replace(/\/+$/, "")}?bridge=${encodeURIComponent(url)}` : null;

	console.log("");
	console.log("  >>> Remote Limelight is ONLINE <<<");
	if (shareLink) {
		console.log("  Share this link — viewer opens it and connects automatically (no paste):");
		console.log("");
		console.log("      " + shareLink);
		console.log("");
	} else {
		console.log("  Bridge URL (viewer pastes this into the app):");
		console.log("");
		console.log("      " + url);
		console.log("");
		console.log("  Tip: set REMOTE_LIMELIGHT_APP_URL in .env to your Vercel app URL to get a one-click share link.");
	}
	console.log("  Press Ctrl+C to stop the bridge and tunnel.");
	console.log("");

	// Keep process alive and clean up on exit
	const cleanup = async () => {
		try {
			await listener.close();
		} catch (e) {
			// ignore
		}
		bridge.kill();
		process.exit(0);
	};
	process.on("SIGINT", cleanup);
	process.on("SIGTERM", cleanup);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
