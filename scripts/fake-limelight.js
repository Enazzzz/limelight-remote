#!/usr/bin/env node
/**
 * Fake Limelight server for testing without a robot. Serves a test "camera" page
 * on port 5800 so the bridge can proxy to it (set LIMELIGHT_ORIGIN=http://127.0.0.1:5800).
 *
 * Usage: npm run test:fake
 * Then in another terminal: LIMELIGHT_ORIGIN=http://127.0.0.1:5800 npm run bridge
 * Or: LIMELIGHT_ORIGIN=http://127.0.0.1:5800 npm start
 */

const http = require("http");

const PORT = Number(process.env.FAKE_LIMELIGHT_PORT) || 5800;

const FAKE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>Fake Limelight</title>
	<style>
		* { box-sizing: border-box; }
		body { margin: 0; font-family: system-ui, sans-serif; background: #111; color: #eee; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
		.wrap { text-align: center; padding: 2rem; }
		.badge { display: inline-block; background: #333; padding: 0.5rem 1rem; border-radius: 8px; margin-bottom: 1rem; font-size: 0.875rem; color: #0f0; }
		h1 { font-size: 1.5rem; margin: 0 0 1rem 0; }
		.canvas-wrap { background: #000; border: 2px solid #333; border-radius: 8px; overflow: hidden; max-width: 640px; margin: 0 auto; }
		#feed { display: block; width: 100%; height: auto; }
		.p { font-size: 0.75rem; color: #666; margin-top: 1rem; }
	</style>
</head>
<body>
	<div class="wrap">
		<div class="badge">Fake Limelight — test feed</div>
		<h1>No robot connected</h1>
		<p class="p">This page is served by <code>npm run test:fake</code> so you can test the app without hardware.</p>
		<div class="canvas-wrap">
			<canvas id="feed" width="640" height="480"></canvas>
		</div>
		<p class="p">Controller input from the viewer is sent to the bridge (see bridge stdout or BRIDGE_CONTROLLER_LOG).</p>
	</div>
	<script>
		var canvas = document.getElementById("feed");
		var ctx = canvas.getContext("2d");
		var t = 0;
		function draw() {
			var w = canvas.width, h = canvas.height;
			ctx.fillStyle = "hsl(" + (t % 360) + ", 40%, 8%)";
			ctx.fillRect(0, 0, w, h);
			ctx.strokeStyle = "hsl(" + (t % 360) + ", 60%, 50%)";
			ctx.lineWidth = 4;
			ctx.strokeRect(40, 40, w - 80, h - 80);
			ctx.fillStyle = "rgba(255,255,255,0.9)";
			ctx.font = "24px monospace";
			ctx.textAlign = "center";
			ctx.fillText("Fake Limelight — " + new Date().toISOString().slice(11, 19), w / 2, h / 2);
			ctx.font = "14px monospace";
			ctx.fillText("test feed (no buh)", w / 2, h / 2 + 32);
			t += 0.5;
			requestAnimationFrame(draw);
		}
		draw();
	</script>
</body>
</html>
`;

const server = http.createServer((req, res) => {
	const pathname = (req.url || "/").split("?")[0];
	if (pathname === "/" || pathname === "/index.html") {
		res.writeHead(200, { "Content-Type": "text/html" });
		res.end(FAKE_HTML);
		return;
	}
	res.writeHead(404, { "Content-Type": "text/plain" });
	res.end("Not found");
});

server.listen(PORT, "127.0.0.1", () => {
	console.log("");
	console.log("  Fake Limelight listening on http://127.0.0.1:" + PORT);
	console.log("  Point the bridge at it:");
	console.log("    set LIMELIGHT_ORIGIN=http://127.0.0.1:" + PORT + "   (Windows)");
	console.log("    export LIMELIGHT_ORIGIN=http://127.0.0.1:" + PORT + "   (bash)");
	console.log("  Then run: npm run bridge   or   npm start");
	console.log("  Press Ctrl+C to stop.");
	console.log("");
});
