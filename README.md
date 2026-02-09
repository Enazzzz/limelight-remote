# Remote Limelight

Stream your Limelight camera feed over the web and send controller input from a single remote viewer back to your PC. The site deploys on Vercel; your computer runs a small bridge that proxies the Limelight stream and receives controller data.

**Remote viewers can connect from a different WiFi network or from anywhere** — as long as you expose the bridge to the internet (e.g. with ngrok) and share that URL with them.

## Architecture

- **Vercel (this repo)** – Static site: the **remote viewer** opens your deployed URL, enters the **bridge URL you share with them**, and gets the stream + sends gamepad input. Only one viewer at a time.
- **Your PC** – Runs the **bridge** (`npm run bridge`). It proxies `http://limelight-one.local:5800/` and exposes a WebSocket at `/ws` for controller input. You expose the bridge with **ngrok** (or similar) so anyone on the internet can reach it.

## Deploy to Vercel

1. Push this repo to GitHub and import the project in [Vercel](https://vercel.com).
2. Deploy; no environment variables required for the basic flow.

Live app: **[https://limelight-remote.vercel.app](https://limelight-remote.vercel.app)**

## One command to get online (bridge + ngrok)

From your PC, one script starts the bridge and exposes it with ngrok so a viewer can connect from anywhere:

1. **Get a free ngrok auth token:** [dashboard.ngrok.com/get-started/your-authtoken](https://dashboard.ngrok.com/get-started/your-authtoken)
2. **Set it once** (then run `npm run go` anytime):
   - **Option A — .env file:** Copy `.env.example` to `.env` and set `NGROK_AUTHTOKEN=your_token_here`
   - **Option B — shell:** PowerShell `$env:NGROK_AUTHTOKEN="your_token_here"` · CMD `set NGROK_AUTHTOKEN=...` · Bash `export NGROK_AUTHTOKEN=...`
3. **Optional — one-click link:** In `.env` set `REMOTE_LIMELIGHT_APP_URL=https://limelight-remote.vercel.app`. Then `npm run go` prints a **share link**; the viewer opens that link and the app **auto-connects** (no paste).
4. **Run:** `npm install` then `npm run go`
5. Share the printed URL with the viewer:
   - **With REMOTE_LIMELIGHT_APP_URL set:** Share the full link — viewer opens it and connects automatically.
   - **Otherwise:** Share the bridge URL; viewer pastes it into the app and clicks Connect.

Press **Ctrl+C** to stop the bridge and tunnel.

## Run one script alongside Driver Station (FRC)

**One command** that starts everything you need in parallel with the Driver Station: bridge, ngrok, controller log, and (optionally) fake Limelight + NetworkTables publisher so the robot gets remote controller input.

1. **One-time setup**
   - In `.env`: `NGROK_AUTHTOKEN=...` (required). Optional: `REMOTE_LIMELIGHT_APP_URL=https://limelight-remote.vercel.app`, `TEAM=1234` (your FRC team number for NetworkTables).
   - Optional: `pip install pynetworktables` so the script can publish controller data to the robot.
2. **At the field or at your desk**
   - Open **Driver Station** as usual.
   - In a second terminal: `npm run driver-station` (or `node scripts/start-with-driver-station.js`).
   - Leave that window open. It starts the bridge, ngrok, writes controller input to `controller.log`, and (if `TEAM` or `NT_SERVER` is set) runs the NetworkTables publisher so the robot can read `RemoteLimelight/axes` and `RemoteLimelight/buttons`.
3. **Share the printed link** with the remote operator; they open it and control as usual. Press **Ctrl+C** in the script window to stop everything.

**Optional env for the single script:**

| Env | Purpose |
|-----|--------|
| `USE_FAKE_LIMELIGHT=1` | No real camera: run a fake Limelight for testing (e.g. at home without robot). |
| `TEAM=1234` | Publish controller to robot NetworkTables (roboRIO-1234.local). |
| `NT_SERVER=10.0.0.2` | Publish to a specific NetworkTables server instead of team number. |

## Run the bridge only (no tunnel)

1. Install dependencies: `npm install`
2. Start the bridge: `npm run bridge`
3. The bridge listens on **http://0.0.0.0:3999** and proxies the Limelight at **http://limelight-one.local:5800**. To change port or Limelight URL:
   - `BRIDGE_PORT=4000 npm run bridge`
   - `LIMELIGHT_ORIGIN=http://192.168.1.50:5800 npm run bridge`

## Expose the bridge manually (alternative to `npm run go`)

If you prefer not to use the script, you can run the bridge and ngrok separately:

1. **Start the bridge:** `npm run bridge`
2. **Expose it:** Install [ngrok](https://ngrok.com) (or use [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)), then run `ngrok http 3999`. Copy the **https** URL.
3. **Share that URL** with the remote viewer. They open your Vercel site, paste the URL as **Bridge URL**, and click **Connect**.

Use **https** for the bridge URL when using the deployed Vercel site (browsers block mixed content). ngrok provides https by default.

## Where do controller inputs go?

Controller input flows: **viewer’s gamepad → Vercel app (WebSocket) → your bridge (on your PC)**.

- **By default:** The bridge **prints each update to stdout** as one JSON line per update, e.g.  
  `[controller] {"axes":[...],"buttons":[...],"id":"...","timestamp":...}`
- **Optional log file:** Set `BRIDGE_CONTROLLER_LOG` to a file path; the bridge will **append** each JSON line to that file (handy for testing or feeding another process).
- **Using the data:** To drive a robot or other app you can:
  - **Pipe stdout:** Run the bridge and parse stdout from a script (e.g. `npm run bridge 2>/dev/null | your-robot-reader`).
  - **Log file:** Run with `BRIDGE_CONTROLLER_LOG=controller.log` and have your robot code tail or read that file.
  - **Code:** Add a TCP/WebSocket or UDP forward in `bridge/index.js` inside `onControllerMessage()` to send JSON to your robot stack.

Each message is an object with `axes` (array of float), `buttons` (array of 0–1), `id` (gamepad name), and `timestamp`.

## WPILib compatibility

Remote Limelight is compatible with [WPILib](https://docs.wpilib.org/) (FRC) robot code. Controller data uses the same semantics:

- **Axis values:** Each axis is a **float from -1.0 to 1.0**, same as WPILib’s `GenericHID.getRawAxis()` / `XboxController` axes.
- **Button values:** Each button is **0 or 1** (or 0–1 for analog); WPILib uses booleans — treat &gt; 0.5 as pressed.
- **Index mapping (browser → WPILib):**  
  Standard gamepad (browser) order: `axes[0]=Left X`, `axes[1]=Left Y`, `axes[2]=Right X`, `axes[3]=Right Y`; triggers may appear as later axes on some gamepads.  
  WPILib `XboxController` order: axis 0=Left X, 1=Left Y, 2=Left Trigger, 3=Right Trigger, 4=Right X, 5=Right Y; buttons 1=A, 2=B, 3=X, 4=Y, 5=Left Bumper, 6=Right Bumper, 7=Back, 8=Start, 9=Left Stick, 10=Right Stick (WPILib uses 1-based button indices).  
  In robot code, map our `axes`/`buttons` arrays to your WPILib controller indices as needed (e.g. use our `axes[0]` as left X, `axes[1]` as left Y, then map triggers if your gamepad sends them in axes 2–5).

**Ways to get remote input into WPILib:**

1. **Log file + robot:** Run the bridge with `BRIDGE_CONTROLLER_LOG=controller.log`. Have robot code (or a coprocessor) read/tail that file and parse JSON lines, then feed axes/buttons into your drive or a custom `GenericHID`-style wrapper.
2. **NetworkTables:** Use the optional **Python script** in this repo that reads controller JSON (from the log file or stdin) and **publishes to NetworkTables** so your robot can subscribe. See [Script: Publish controller to NetworkTables](#script-publish-controller-to-networktables) below.
3. **Custom bridge:** In `bridge/index.js`, inside `onControllerMessage()`, add a TCP or UDP send to your robot/coprocessor in the format your WPILib code expects.

### Script: Publish controller to NetworkTables

A Python script can read the controller log and publish to **NetworkTables** so your WPILib robot subscribes like a normal joystick:

1. **Bridge writes to log:** `set BRIDGE_CONTROLLER_LOG=controller.log` then run the bridge (or `npm run go`).
2. **Install Python NT client:** `pip install pynetworktables` (RobotPy; for FRC NT3).
3. **Run the script:** `set TEAM=1234` then `python scripts/controller_to_networktables.py controller.log` (replace 1234 with your team number; or set `NT_SERVER=10.0.0.2` for a specific host).
4. **Robot code:** Subscribe to `RemoteLimelight/axes` (double array) and `RemoteLimelight/buttons` (boolean array). Example (Java):  
   `NetworkTable table = NetworkTables.getTable("RemoteLimelight");`  
   `DoubleArrayEntry axesEntry = table.getDoubleArrayTopic("axes").subscribe(new double[6]);`  
   `BooleanArrayEntry buttonsEntry = table.getBooleanArrayTopic("buttons").subscribe(new boolean[10]);`  
   then in periodic: `double[] axes = axesEntry.get(); boolean[] buttons = buttonsEntry.get();` and use them for drive or other logic.

For **NT4 (2024+)** the topic API is slightly different; the script uses NT3. You can adapt it to ntcore (NT4) if needed.

## One viewer at a time

The bridge accepts only one WebSocket client. If someone else is already connected, new connections are rejected with a “Only one viewer allowed” message.

## Testing without a robot (fake Limelight)

To test the full flow without a real Limelight or robot:

1. **Terminal 1 — fake Limelight:**  
   `npm run test:fake`  
   Serves a test “camera” page at http://127.0.0.1:5800 (animated placeholder).

2. **Terminal 2 — bridge pointed at fake:**  
   - Windows: `set LIMELIGHT_ORIGIN=http://127.0.0.1:5800` then `npm run bridge` (or `npm run go`).  
   - Bash: `LIMELIGHT_ORIGIN=http://127.0.0.1:5800 npm run bridge` (or `npm run go`).

3. Open the app (local or [limelight-remote.vercel.app](https://limelight-remote.vercel.app)), connect to your bridge URL. You’ll see the fake feed and can test gamepad input; the bridge will print controller JSON to stdout (or to a file if you set `BRIDGE_CONTROLLER_LOG`).

To use a different port for the fake: `FAKE_LIMELIGHT_PORT=5801 npm run test:fake`, then set `LIMELIGHT_ORIGIN=http://127.0.0.1:5801` for the bridge.

## Local development

- **Site:** `npm run dev` → http://localhost:3000. Use your ngrok URL as the bridge URL so the dev server can talk to your local bridge.
- **Bridge:** `npm run bridge` (in another terminal). Use ngrok to expose it if testing from another device.
