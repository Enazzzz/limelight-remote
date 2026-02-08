# Remote Limelight

Stream your Limelight camera feed over the web and send controller input from a single remote viewer back to your PC. The site deploys on Vercel; your computer runs a small bridge that proxies the Limelight stream and receives controller data.

**Remote viewers can connect from a different WiFi network or from anywhere** — as long as you expose the bridge to the internet (e.g. with ngrok) and share that URL with them.

## Architecture

- **Vercel (this repo)** – Static site: the **remote viewer** opens your deployed URL, enters the **bridge URL you share with them**, and gets the stream + sends gamepad input. Only one viewer at a time.
- **Your PC** – Runs the **bridge** (`npm run bridge`). It proxies `http://limelight-one.local:5800/` and exposes a WebSocket at `/ws` for controller input. You expose the bridge with **ngrok** (or similar) so anyone on the internet can reach it.

## Deploy to Vercel

1. Push this repo to GitHub and import the project in [Vercel](https://vercel.com).
2. Deploy; no environment variables required for the basic flow.

## One command to get online (bridge + ngrok)

From your PC, one script starts the bridge and exposes it with ngrok so a viewer can connect from anywhere:

1. **Get a free ngrok auth token:** [dashboard.ngrok.com/get-started/your-authtoken](https://dashboard.ngrok.com/get-started/your-authtoken)
2. **Set it once** (then run `npm run go` anytime):
   - **Option A — .env file:** Copy `.env.example` to `.env` and set `NGROK_AUTHTOKEN=your_token_here`
   - **Option B — shell:** PowerShell `$env:NGROK_AUTHTOKEN="your_token_here"` · CMD `set NGROK_AUTHTOKEN=...` · Bash `export NGROK_AUTHTOKEN=...`
3. **Run:** `npm install` then `npm run go`
4. The script prints a **public URL**. Share that URL with the viewer; they paste it into the Vercel site and click Connect.

Press **Ctrl+C** to stop the bridge and tunnel.

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

## Controller input

- The remote viewer connects a gamepad (or compatible controller). The site uses the browser Gamepad API and sends state to the bridge over WebSocket.
- The bridge prints each controller update to **stdout** as JSON. To drive a robot or another app, pipe the bridge output or add a small TCP/WebSocket forward in `bridge/index.js` to your existing code.

## One viewer at a time

The bridge accepts only one WebSocket client. If someone else is already connected, new connections are rejected with a “Only one viewer allowed” message.

## Local development

- **Site:** `npm run dev` → http://localhost:3000. Use your ngrok URL as the bridge URL so the dev server can talk to your local bridge.
- **Bridge:** `npm run bridge` (in another terminal). Use ngrok to expose it if testing from another device.
