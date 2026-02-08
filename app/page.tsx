"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const BRIDGE_STORAGE_KEY = "remote-limelight-bridge-url";
/** Build-time default bridge URL (optional). Set NEXT_PUBLIC_BRIDGE_URL for a fixed tunnel. */
const DEFAULT_BRIDGE_URL = process.env.NEXT_PUBLIC_BRIDGE_URL || "";

/** Default stream path on many MJPEG cameras; bridge proxies this from Limelight. */
const STREAM_PATH = "/";

/** Parse bridge URL from ?bridge=... (valid https or http for localhost). */
function getBridgeFromQuery(): string | null {
	if (typeof window === "undefined") return null;
	const params = new URLSearchParams(window.location.search);
	const bridge = params.get("bridge");
	if (!bridge || !bridge.startsWith("http")) return null;
	try {
		const u = new URL(bridge);
		if (u.protocol === "https:") return bridge;
		if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return bridge;
		// On HTTPS site, only allow https bridge (no mixed content)
		if (window.location.protocol === "https:" && u.protocol === "http:") return null;
		return bridge;
	} catch {
		return null;
	}
}

export default function Home() {
	const [bridgeUrl, setBridgeUrl] = useState("");
	const [bridgeInput, setBridgeInput] = useState("");
	const [connected, setConnected] = useState(false);
	const [connectionError, setConnectionError] = useState<string | null>(null);
	const [controllerActive, setControllerActive] = useState(false);
	const [autoConnecting, setAutoConnecting] = useState(false);
	const wsRef = useRef<WebSocket | null>(null);
	const pollRef = useRef<number>(0);
	const autoConnectDoneRef = useRef(false);
	const connectRef = useRef<() => void>(() => {});

	// Load saved bridge URL or ?bridge= param or NEXT_PUBLIC_BRIDGE_URL; auto-connect when URL comes from link/env
	useEffect(() => {
		if (typeof window === "undefined") return;
		const fromQuery = getBridgeFromQuery();
		if (fromQuery) {
			// Share link: use bridge from URL and trigger auto-connect after state is set
			window.history.replaceState({}, "", window.location.pathname);
			setBridgeInput(fromQuery);
			setBridgeUrl(fromQuery);
			localStorage.setItem(BRIDGE_STORAGE_KEY, fromQuery.replace(/\/+$/, ""));
			setAutoConnecting(true);
			return;
		}
		const saved = localStorage.getItem(BRIDGE_STORAGE_KEY);
		const initial = saved || DEFAULT_BRIDGE_URL;
		if (initial) {
			setBridgeUrl(initial);
			setBridgeInput(initial);
			if (DEFAULT_BRIDGE_URL && !saved) setAutoConnecting(true);
		}
	}, []);

	const saveBridgeUrl = useCallback((url: string) => {
		const normalized = url.replace(/\/+$/, "");
		setBridgeUrl(normalized);
		localStorage.setItem(BRIDGE_STORAGE_KEY, normalized);
	}, []);

	const connect = useCallback(() => {
		const base = bridgeInput.replace(/\/+$/, "").trim();
		if (!base) {
			setConnectionError("Enter the bridge URL (e.g. https://xxxx.ngrok.io) the host shared with you.");
			return;
		}
		// When using the deployed site over HTTPS, bridge must be HTTPS/WSS (no mixed content)
		if (typeof window !== "undefined" && window.location.protocol === "https:" && (base.startsWith("http://") && !base.startsWith("http://localhost"))) {
			setConnectionError("Use an https bridge URL for remote access (e.g. from ngrok).");
			return;
		}
		setConnectionError(null);
		saveBridgeUrl(base);

		// WebSocket to bridge for controller input (ws or wss based on bridge URL)
		const wsProtocol = base.startsWith("https") ? "wss" : "ws";
		const wsUrl = `${wsProtocol}://${base.replace(/^https?:\/\//, "")}/ws`;
		const ws = new WebSocket(wsUrl);

		ws.onopen = () => {
			setConnected(true);
			wsRef.current = ws;
		};
		ws.onclose = (ev) => {
			setConnected(false);
			wsRef.current = null;
			if (ev.code !== 1000 && !ev.wasClean) {
				setConnectionError(ev.reason || "Connection closed. Only one viewer allowed at a time.");
			}
		};
		ws.onerror = () => {
			setConnectionError("WebSocket error. Is the bridge running and reachable?");
		};
	}, [bridgeInput, saveBridgeUrl]);

	// Keep ref pointing at latest connect for auto-connect effect
	connectRef.current = connect;

	// Auto-connect when we have a bridge URL from share link (?bridge=) or NEXT_PUBLIC_BRIDGE_URL
	useEffect(() => {
		if (autoConnecting && bridgeInput && !autoConnectDoneRef.current) {
			autoConnectDoneRef.current = true;
			setAutoConnecting(false);
			connectRef.current();
		}
	}, [autoConnecting, bridgeInput]);

	const disconnect = useCallback(() => {
		if (wsRef.current) {
			wsRef.current.close(1000);
			wsRef.current = null;
		}
		setConnected(false);
	}, []);

	// Poll gamepad and send state to bridge (limit one client; bridge enforces)
	useEffect(() => {
		if (!connected || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

		const sendController = () => {
			const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
			const pad = gamepads[0];
			if (!pad) {
				setControllerActive(false);
				return;
			}
			setControllerActive(true);
			// Compact state: axes and buttons only
			const state = {
				axes: Array.from(pad.axes),
				buttons: pad.buttons.map((b) => (typeof b === "object" ? b.value : b)),
				id: pad.id,
				timestamp: Date.now(),
			};
			try {
				wsRef.current?.send(JSON.stringify(state));
			} catch {
				// ignore send errors
			}
		};

		pollRef.current = window.setInterval(sendController, 50);
		return () => {
			if (pollRef.current) clearInterval(pollRef.current);
		};
	}, [connected]);

	// Stream URL: bridge proxies Limelight; iframe embeds the proxied page
	const streamUrl = bridgeUrl ? `${bridgeUrl}${STREAM_PATH}` : "";

	return (
		<main className="container">
			<header className="header">
				<h1>Remote Limelight</h1>
				<p className="muted">Stream from your PC · One viewer at a time</p>
			</header>

			<section className="bridge-section">
				<label className="label">
					Bridge URL (host shares this with you — works from any network)
					{autoConnecting && <span className="connecting"> Connecting…</span>}
				</label>
				<div className="row">
					<input
						type="url"
						placeholder="https://xxxx.ngrok.io"
						value={bridgeInput}
						onChange={(e) => setBridgeInput(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && connect()}
						disabled={connected}
						className="input"
					/>
					{connected ? (
						<button type="button" onClick={disconnect} className="btn btn-danger">
							Disconnect
						</button>
					) : (
						<button type="button" onClick={connect} className="btn btn-primary">
							Connect
						</button>
					)}
				</div>
				{connectionError && (
					<p className="error">{connectionError}</p>
				)}
			</section>

			{streamUrl && (
				<section className="stream-section">
					<div className="stream-header">
						<span>Live feed</span>
						{connected && (
							<span className={`badge ${controllerActive ? "active" : ""}`}>
								{controllerActive ? "Controller connected" : "Connect a gamepad"}
							</span>
						)}
					</div>
					<div className="stream-wrap">
						<iframe
							title="Limelight stream"
							src={streamUrl}
							className="stream-iframe"
							allow="autoplay"
						/>
					</div>
				</section>
			)}

			<footer className="footer">
				<p><strong>Host:</strong> Run <code>npm run bridge</code> on your PC, then <code>ngrok http 3999</code>. Share the ngrok https URL with the viewer. <strong>Viewer:</strong> Paste that URL above and Connect — works from any WiFi or location.</p>
			</footer>

			<style jsx>{`
				.container {
					max-width: 960px;
					margin: 0 auto;
					padding: 1.5rem;
					min-height: 100vh;
					display: flex;
					flex-direction: column;
				}
				.header {
					margin-bottom: 1.5rem;
				}
				.header h1 {
					font-size: 1.5rem;
					font-weight: 600;
					margin: 0 0 0.25rem 0;
				}
				.muted {
					color: var(--muted);
					font-size: 0.875rem;
					margin: 0;
				}
				.bridge-section {
					margin-bottom: 1.5rem;
				}
				.label {
					display: block;
					font-size: 0.75rem;
					color: var(--muted);
					margin-bottom: 0.5rem;
				}
				.row {
					display: flex;
					gap: 0.5rem;
					align-items: center;
				}
				.input {
					flex: 1;
					padding: 0.5rem 0.75rem;
					background: var(--surface);
					border: 1px solid var(--border);
					border-radius: var(--radius);
					color: var(--text);
					font-size: 0.875rem;
				}
				.input:focus {
					outline: none;
					border-color: var(--accent);
				}
				.btn {
					padding: 0.5rem 1rem;
					border-radius: var(--radius);
					font-size: 0.875rem;
					border: none;
					font-weight: 500;
				}
				.btn-primary {
					background: var(--accent);
					color: var(--bg);
				}
				.btn-primary:hover {
					background: var(--accent-dim);
				}
				.btn-danger {
					background: var(--error);
					color: white;
				}
				.btn-danger:hover {
					opacity: 0.9;
				}
				.connecting {
					color: var(--muted);
					font-weight: normal;
				}
				.error {
					color: var(--error);
					font-size: 0.875rem;
					margin: 0.5rem 0 0 0;
				}
				.stream-section {
					flex: 1;
					display: flex;
					flex-direction: column;
					min-height: 400px;
				}
				.stream-header {
					display: flex;
					align-items: center;
					justify-content: space-between;
					margin-bottom: 0.5rem;
					font-size: 0.875rem;
					color: var(--muted);
				}
				.badge {
					font-size: 0.75rem;
					padding: 0.25rem 0.5rem;
					background: var(--surface);
					border-radius: 4px;
					color: var(--muted);
				}
				.badge.active {
					background: rgba(34, 197, 94, 0.2);
					color: var(--accent);
				}
				.stream-wrap {
					flex: 1;
					background: var(--surface);
					border: 1px solid var(--border);
					border-radius: var(--radius);
					overflow: hidden;
					min-height: 360px;
				}
				.stream-iframe {
					width: 100%;
					height: 100%;
					min-height: 360px;
					border: none;
					display: block;
				}
				.footer {
					margin-top: 1.5rem;
					padding-top: 1rem;
					border-top: 1px solid var(--border);
					font-size: 0.75rem;
					color: var(--muted);
				}
				.footer code {
					background: var(--surface);
					padding: 0.125rem 0.375rem;
					border-radius: 4px;
				}
			`}</style>
		</main>
	);
}
