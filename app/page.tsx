"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const BRIDGE_STORAGE_KEY = "remote-limelight-bridge-url";
const DEFAULT_BRIDGE_URL = process.env.NEXT_PUBLIC_BRIDGE_URL || "";
const STREAM_PATH = "/";

function getBridgeFromQuery(): string | null {
	if (typeof window === "undefined") return null;
	const params = new URLSearchParams(window.location.search);
	const raw = params.get("bridge");
	const bridge = raw ? raw.trim() : "";
	if (!bridge) return null;
	const withProtocol = bridge.startsWith("http") ? bridge : "https://" + bridge;
	try {
		const u = new URL(withProtocol);
		if (u.protocol === "https:") return u.origin;
		if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return u.origin;
		if (window.location.protocol === "https:" && u.protocol === "http:") return null;
		return u.origin;
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
	const [lastInput, setLastInput] = useState<{ axes: number[]; buttons: number[] } | null>(null);
	const [showInputBar, setShowInputBar] = useState(false);
	const wsRef = useRef<WebSocket | null>(null);
	const [connectionId, setConnectionId] = useState(0);
	const pollRef = useRef<number>(0);
	const autoConnectDoneRef = useRef(false);
	const connectRef = useRef<() => void>(() => {});
	const bridgeFromQueryRef = useRef<string | null>(null);

	if (typeof window !== "undefined" && bridgeFromQueryRef.current === null) {
		bridgeFromQueryRef.current = getBridgeFromQuery();
	}

	useEffect(() => {
		if (typeof window === "undefined") return;
		const fromQuery = bridgeFromQueryRef.current;
		if (fromQuery) {
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
		if (typeof window !== "undefined" && window.location.protocol === "https:" && base.startsWith("http://") && !base.startsWith("http://localhost")) {
			setConnectionError("Use an https bridge URL for remote access (e.g. from ngrok).");
			return;
		}
		setConnectionError(null);
		saveBridgeUrl(base);
		const wsProtocol = base.startsWith("https") ? "wss" : "ws";
		const wsUrl = `${wsProtocol}://${base.replace(/^https?:\/\//, "")}/ws`;
		const ws = new WebSocket(wsUrl);
		ws.onopen = () => {
			wsRef.current = ws;
			setConnectionId((c) => c + 1);
			setConnected(true);
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

	connectRef.current = connect;

	useEffect(() => {
		if (autoConnecting && bridgeInput && !autoConnectDoneRef.current) {
			autoConnectDoneRef.current = true;
			setAutoConnecting(false);
			connectRef.current();
			if (bridgeFromQueryRef.current) {
				window.history.replaceState({}, "", window.location.pathname);
			}
		}
	}, [autoConnecting, bridgeInput]);

	const disconnect = useCallback(() => {
		if (wsRef.current) {
			wsRef.current.close(1000);
			wsRef.current = null;
		}
		setConnected(false);
	}, []);

	// Restart gamepad polling whenever we get a new connection (connectionId) so reconnect works
	useEffect(() => {
		if (!connected) return;
		const sendController = () => {
			if (wsRef.current?.readyState !== WebSocket.OPEN) return;
			const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
			const pad = gamepads[0];
			if (!pad) {
				setControllerActive(false);
				return;
			}
			setControllerActive(true);
			const axes = Array.from(pad.axes);
			const buttons = pad.buttons.map((b) => (typeof b === "object" ? b.value : b));
			setLastInput({ axes, buttons });
			const state = { axes, buttons, id: pad.id, timestamp: Date.now() };
			try {
				wsRef.current?.send(JSON.stringify(state));
			} catch {
				// ignore
			}
		};
		pollRef.current = window.setInterval(sendController, 50);
		return () => {
			if (pollRef.current) clearInterval(pollRef.current);
		};
	}, [connected, connectionId]);

	// Use proxy so ngrok's free-tier interstitial is skipped (server sends ngrok-skip-browser-warning)
	const streamUrl = bridgeUrl ? `${bridgeUrl}${STREAM_PATH}` : "";
	const iframeSrc = streamUrl ? `/api/proxy?url=${encodeURIComponent(streamUrl)}` : "";
	const theaterMode = connected && iframeSrc;

	return (
		<main className={theaterMode ? "container theater" : "container"}>
			{!theaterMode && (
				<>
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
						{connectionError && <p className="error">{connectionError}</p>}
					</section>
				</>
			)}

			{iframeSrc && (
				<section className={"stream-section" + (theaterMode ? " stream-full" : "")}>
					{theaterMode && (
						<div className="top-bar">
							<span className="top-bar-title">Remote Limelight</span>
							<span className={`top-bar-badge ${controllerActive ? "active" : ""}`}>
								{controllerActive ? "Gamepad" : "No gamepad"}
							</span>
							<button type="button" onClick={() => setShowInputBar((v) => !v)} className="btn btn-ghost">
								{showInputBar ? "Hide inputs" : "Show inputs"}
							</button>
							<button type="button" onClick={disconnect} className="btn btn-danger btn-sm">
								Disconnect
							</button>
						</div>
					)}
					{!theaterMode && (
						<div className="stream-header">
							<span>Live feed</span>
							{connected && (
								<span className={`badge ${controllerActive ? "active" : ""}`}>
									{controllerActive ? "Controller connected" : "Connect a gamepad (Xbox, PS5, etc.)"}
								</span>
							)}
						</div>
					)}
					<div className="stream-wrap">
						<iframe title="Limelight stream" src={iframeSrc} className="stream-iframe" allow="autoplay" />
					</div>
				</section>
			)}

			{theaterMode && showInputBar && (
				<div className="input-bar">
					<div className="input-bar-row">
						<span className="input-bar-label">Axes</span>
						<div className="input-bar-axes">
							{lastInput ? lastInput.axes.map((a, i) => (
								<span key={i} className="input-bar-pill" title={`Axis ${i}: ${a.toFixed(2)}`}>
									{i}:{a.toFixed(1)}
								</span>
							)) : "—"}
						</div>
					</div>
					<div className="input-bar-row">
						<span className="input-bar-label">Buttons</span>
						<div className="input-bar-buttons">
							{lastInput ? lastInput.buttons.map((b, i) => (
								<span key={i} className={"input-bar-pill " + (Number(b) > 0.5 ? "on" : "")} title={`Button ${i}`}>
									{i}
								</span>
							)) : "—"}
						</div>
					</div>
				</div>
			)}

			{!theaterMode && (
				<footer className="footer">
					<p>
						<strong>Host:</strong> Run <code>npm start</code> on your PC (set <code>NGROK_AUTHTOKEN</code> in <code>.env</code> once). Share the printed link with the viewer — they open it and connect automatically, or paste the bridge URL above. <strong>Viewer:</strong> Use the link from the host or paste the bridge URL and click Connect.
					</p>
				</footer>
			)}

			<style jsx>{`
				.container {
					max-width: 960px;
					margin: 0 auto;
					padding: 1.5rem;
					min-height: 100vh;
					display: flex;
					flex-direction: column;
				}
				.container.theater {
					max-width: none;
					padding: 0;
					height: 100vh;
					overflow: hidden;
				}
				.stream-section.stream-full {
					flex: 1;
					display: flex;
					flex-direction: column;
					min-height: 0;
					height: 100%;
				}
				.stream-section.stream-full .stream-wrap {
					flex: 1;
					min-height: 0;
					aspect-ratio: unset;
					max-height: none;
					border-radius: 0;
					border: none;
				}
				.stream-section.stream-full .stream-iframe {
					width: 100%;
					height: 100%;
				}
				.top-bar {
					display: flex;
					align-items: center;
					gap: 0.75rem;
					padding: 0.5rem 1rem;
					background: rgba(15, 15, 18, 0.92);
					border-bottom: 1px solid var(--border);
					flex-shrink: 0;
				}
				.top-bar-title {
					font-size: 0.875rem;
					font-weight: 600;
					margin-right: auto;
				}
				.top-bar-badge {
					font-size: 0.7rem;
					padding: 0.2rem 0.5rem;
					background: var(--surface);
					border-radius: 4px;
					color: var(--muted);
				}
				.top-bar-badge.active {
					background: rgba(34, 197, 94, 0.2);
					color: var(--accent);
				}
				.btn-ghost {
					background: transparent;
					color: var(--muted);
					border: 1px solid var(--border);
				}
				.btn-ghost:hover {
					background: var(--surface);
					color: var(--text);
				}
				.btn-sm {
					padding: 0.35rem 0.75rem;
					font-size: 0.8rem;
				}
				.input-bar {
					flex-shrink: 0;
					padding: 0.5rem 1rem;
					background: rgba(15, 15, 18, 0.95);
					border-top: 1px solid var(--border);
					font-size: 0.75rem;
					color: var(--muted);
				}
				.input-bar-row {
					display: flex;
					align-items: center;
					gap: 0.5rem;
					margin-bottom: 0.25rem;
				}
				.input-bar-row:last-child {
					margin-bottom: 0;
				}
				.input-bar-label {
					min-width: 3rem;
				}
				.input-bar-axes,
				.input-bar-buttons {
					display: flex;
					flex-wrap: wrap;
					gap: 0.25rem;
				}
				.input-bar-pill {
					display: inline-block;
					padding: 0.15rem 0.4rem;
					background: var(--surface);
					border-radius: 4px;
					color: var(--text);
				}
				.input-bar-pill.on {
					background: var(--accent);
					color: var(--bg);
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
				.connecting {
					color: var(--muted);
					font-weight: normal;
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
				.error {
					color: var(--error);
					font-size: 0.875rem;
					margin: 0.5rem 0 0 0;
				}
				.stream-section {
					flex: 1 1 auto;
					display: flex;
					flex-direction: column;
					min-height: 0;
				}
				.stream-header {
					display: flex;
					align-items: center;
					justify-content: space-between;
					margin-bottom: 0.5rem;
					font-size: 0.875rem;
					color: var(--muted);
					flex-shrink: 0;
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
					flex: 1 1 auto;
					background: var(--surface);
					border: 1px solid var(--border);
					border-radius: var(--radius);
					overflow: hidden;
					aspect-ratio: 16 / 9;
					width: 100%;
					max-height: min(70vh, 540px);
					contain: layout;
				}
				.stream-iframe {
					width: 100%;
					height: 100%;
					border: none;
					display: block;
					background: var(--surface);
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
