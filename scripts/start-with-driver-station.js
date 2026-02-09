#!/usr/bin/env node
/**
 * Single script to run alongside FRC Driver Station: bridge + ngrok + optional fake
 * Limelight + optional NetworkTables publisher. One command, leave it open.
 *
 * Requires: NGROK_AUTHTOKEN in .env or environment.
 * Optional: USE_FAKE_LIMELIGHT=1 (no real camera), TEAM=1234 or NT_SERVER=... (publish to robot NT).
 *
 * Usage: npm run driver-station
 * Or:    node scripts/start-with-driver-station.js
 */

const { spawn } = require("child_process");
const path = require("path");
const net = require("net");
const fs = require("fs");

const PROJECT_ROOT = path.resolve(__dirname, "..");
try {
	require("dotenv").config({ path: path.join(PROJECT_ROOT, ".env") });
} catch {}

const BRIDGE_PORT = Number(process.env.BRIDGE_PORT) || 3999;
const USE_FAKE = process.env.USE_FAKE_LIMELIGHT === "1" || process.env.USE_FAKE_LIMELIGHT === "true";
const LIMELIGHT_ORIGIN = USE_FAKE
	? "http://127.0.0.1:" + (Number(process.env.FAKE_LIMELIGHT_PORT) || 5800)
	: (process.env.LIMELIGHT_ORIGIN || "http://limelight-one.local:5800");
const CONTROLLER_LOG = path.join(PROJECT_ROOT, "controller.log");
const BRIDGE_SCRIPT = path.join(PROJECT_ROOT, "bridge", "index.js");
const FAKE_SCRIPT = path.join(PROJECT_ROOT, "scripts", "fake-limelight.js");
const NT_SCRIPT = path.join(PROJECT_ROOT, "scripts", "controller_to_networktables.py");
const TEAM = process.env.TEAM || process.env.TEAM_NUMBER || "";
const NT_SERVER = process.env.NT_SERVER;

const children = [];

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
				if (Date.now() - start > timeoutMs) reject(new Error("Port " + port + " did not open in time"));
				else setTimeout(tryConnect, 300);
			});
			socket.on("timeout", () => {
				socket.destroy();
				if (Date.now() - start > timeoutMs) reject(new Error("Port " + port + " did not open in time"));
				else setTimeout(tryConnect, 300);
			});
			socket.connect(port, "127.0.0.1");
		}
		tryConnect();
	});
}

function run(cmd, args, opts = {}) {
	const p = spawn(cmd, args, {
		cwd: PROJECT_ROOT,
		stdio: ["ignore", "pipe", "pipe"],
		env: { ...process.env, ...opts.env },
		...opts,
	});
	children.push(p);
	if (opts.silent !== true) {
		p.stdout.on("data", (c) => process.stdout.write(c));
		p.stderr.on("data", (c) => process.stderr.write(c));
	}
	p.on("error", (err) => {
		if (!opts.optional) console.error("[start]", cmd, args[0], err.message);
	});
	return p;
}

async function main() {
	if (!process.env.NGROK_AUTHTOKEN) {
		console.error("");
		console.error("  NGROK_AUTHTOKEN is not set. Add it to .env or set it in the shell.");
		console.error("  Get a free token: https://dashboard.ngrok.com/get-started/your-authtoken");
		console.error("");
		process.exit(1);
	}

	// Clear controller log so NT publisher starts from fresh data
	try {
		fs.writeFileSync(CONTROLLER_LOG, "");
	} catch (e) {}

	// 1) Optional: fake Limelight (testing without robot/camera)
	if (USE_FAKE) {
		const fakePort = Number(process.env.FAKE_LIMELIGHT_PORT) || 5800;
		run(process.execPath, [FAKE_SCRIPT], { env: { ...process.env, FAKE_LIMELIGHT_PORT: String(fakePort) } });
		await waitForPort(fakePort).catch(() => {
			console.error("Fake Limelight did not start on port", fakePort);
			process.exit(1);
		});
		console.log("[start] Fake Limelight running on port", fakePort);
	}

	// 2) Bridge (proxy Limelight + WebSocket for controller, write to log)
	const bridge = run(process.execPath, [BRIDGE_SCRIPT], {
		env: {
			...process.env,
			BRIDGE_PORT: String(BRIDGE_PORT),
			LIMELIGHT_ORIGIN: LIMELIGHT_ORIGIN,
			BRIDGE_CONTROLLER_LOG: CONTROLLER_LOG,
		},
	});
	await waitForPort(BRIDGE_PORT).catch(() => {
		console.error("Bridge did not start on port", BRIDGE_PORT);
		process.exit(1);
	});
	console.log("[start] Bridge running, controller log:", CONTROLLER_LOG);

	// 3) Ngrok (expose bridge to internet)
	let listener;
	try {
		const ngrok = require("@ngrok/ngrok");
		listener = await ngrok.forward({ addr: BRIDGE_PORT, authtoken_from_env: true });
	} catch (err) {
		console.error("ngrok failed:", err.message);
		process.exit(1);
	}
	const url = listener.url();
	const appUrl = process.env.REMOTE_LIMELIGHT_APP_URL;
	const shareLink = appUrl ? `${appUrl.replace(/\/+$/, "")}?bridge=${encodeURIComponent(url)}` : null;

	// 4) Optional: NetworkTables publisher (so robot can read remote controller)
	if (TEAM || NT_SERVER) {
		const pyCmd = process.platform === "win32" ? "py" : "python3";
		const pyArgs = process.platform === "win32" ? ["-3", NT_SCRIPT, CONTROLLER_LOG] : [NT_SCRIPT, CONTROLLER_LOG];
		const nt = run(pyCmd, pyArgs, {
			env: { ...process.env, TEAM: String(TEAM), NT_SERVER: NT_SERVER || "", TEAM_NUMBER: String(TEAM) },
			optional: true,
			silent: true,
		});
		nt.on("error", () => {});
		nt.stderr.on("data", (c) => process.stderr.write("[NT] " + c.toString()));
		if (fs.existsSync(NT_SCRIPT)) {
			console.log("[start] NetworkTables publisher running. Robot can read RemoteLimelight/axes and /buttons.");
		} else {
			console.log("[start] TEAM/NT_SERVER set but script not found. Install pynetworktables and ensure scripts/controller_to_networktables.py exists.");
		}
	}

	console.log("");
	console.log("  >>> Run this alongside Driver Station — leave this window open <<<");
	console.log("");
	if (shareLink) {
		console.log("  Share link (viewer auto-connects):");
		console.log("      " + shareLink);
	} else {
		console.log("  Bridge URL (viewer pastes in app):");
		console.log("      " + url);
	}
	console.log("");
	console.log("  Controller input -> bridge -> " + CONTROLLER_LOG + (TEAM || NT_SERVER ? " -> NetworkTables" : ""));
	console.log("  Press Ctrl+C to stop everything.");
	console.log("");

	const cleanup = async () => {
		try {
			await listener.close();
		} catch (e) {}
		children.forEach((p) => {
			try {
				p.kill();
			} catch (e) {}
		});
		process.exit(0);
	};
	process.on("SIGINT", cleanup);
	process.on("SIGTERM", cleanup);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
