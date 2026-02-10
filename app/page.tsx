"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const BRIDGE_STORAGE_KEY = "remote-limelight-bridge-url";
const MACROS_STORAGE_KEY = "remote-limelight-macros";
const DEFAULT_BRIDGE_URL = process.env.NEXT_PUBLIC_BRIDGE_URL || "";
const STREAM_PATH = "/";

type MacroFrame = { axes: number[]; buttons: number[]; timestamp: number };
type SavedMacro = { id: string; name: string; frames: MacroFrame[] };

/** Button labels by controller type (standard gamepad order: face 0–3, bumpers 4–5, back/start 6–7, stick 8–9) */
const XBOX_BUTTON_LABELS = ["A", "B", "X", "Y", "LB", "RB", "Back", "Start", "L3", "R3"];
const PS_BUTTON_LABELS = ["✕", "○", "□", "△", "L1", "R1", "Share", "Options", "L3", "R3"]; // Cross, Circle, Square, Triangle

/** Tiny SVG icons for face buttons (0–3) in friendly mode */
function FaceButtonIcon({ type, index, pressed }: { type: "xbox" | "playstation"; index: number; pressed: boolean }) {
	const size = 20;
	const stroke = pressed ? "var(--accent)" : "var(--text)";
	const fill = pressed ? "var(--accent)" : "transparent";
	if (type === "playstation") {
		// 0=Cross, 1=Circle, 2=Square, 3=Triangle
		const icons = [
			<path key="x" d="M6 6l8 8M14 6l-8 8" stroke={stroke} strokeWidth="2" fill="none" />,
			<circle key="o" cx="10" cy="10" r="6" stroke={stroke} strokeWidth="2" fill={fill} />,
			<rect key="s" x="4" y="4" width="12" height="12" stroke={stroke} strokeWidth="2" fill={fill} rx="1" />,
			<path key="t" d="M10 4l6 12H4l6-12z" stroke={stroke} strokeWidth="2" fill={fill} />,
		];
		return (
			<svg width={size} height={size} viewBox="0 0 20 20" className="face-icon">
				{icons[index]}
			</svg>
		);
	}
	// Xbox: A=0, B=1, X=2, Y=3 — show letter in circle
	const letters = ["A", "B", "X", "Y"];
	return (
		<svg width={size} height={size} viewBox="0 0 20 20" className="face-icon">
			<circle cx="10" cy="10" r="8" stroke={stroke} strokeWidth="2" fill={fill} />
			<text x="10" y="14" textAnchor="middle" fill={stroke} fontSize="10" fontWeight="bold" fontFamily="inherit">
				{letters[index]}
			</text>
		</svg>
	);
}

/** Detect controller type from Gamepad API id string */
function detectControllerType(id: string | undefined): "xbox" | "playstation" | "generic" {
	if (!id) return "generic";
	const lower = id.toLowerCase();
	if (lower.includes("xbox") || lower.includes("microsoft")) return "xbox";
	if (lower.includes("playstation") || lower.includes("dualsense") || lower.includes("dualshock") || lower.includes("sony")) return "playstation";
	return "generic";
}

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
	const [lastInput, setLastInput] = useState<{ axes: number[]; buttons: number[]; id?: string } | null>(null);
	const [showInputBar, setShowInputBar] = useState(false);
	const [inputDisplayMode, setInputDisplayMode] = useState<"raw" | "friendly">("friendly");
	const [recording, setRecording] = useState(false);
	const [recordedFrames, setRecordedFrames] = useState<MacroFrame[]>([]);
	const [macros, setMacros] = useState<SavedMacro[]>([]);
	const [playingMacroId, setPlayingMacroId] = useState<string | null>(null);
	const [selectedMacroId, setSelectedMacroId] = useState<string>("");
	const wsRef = useRef<WebSocket | null>(null);
	const [connectionId, setConnectionId] = useState(0);
	const pollRef = useRef<number>(0);
	const recordingRef = useRef(false);
	const recordedFramesRef = useRef<MacroFrame[]>([]);
	const playingMacroIdRef = useRef<string | null>(null);
	const autoConnectDoneRef = useRef(false);
	const connectRef = useRef<() => void>(() => {});
	const bridgeFromQueryRef = useRef<string | null>(null);

	if (typeof window !== "undefined" && bridgeFromQueryRef.current === null) {
		bridgeFromQueryRef.current = getBridgeFromQuery();
	}

	recordingRef.current = recording;
	playingMacroIdRef.current = playingMacroId;

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

	useEffect(() => {
		if (typeof window === "undefined") return;
		try {
			const raw = localStorage.getItem(MACROS_STORAGE_KEY);
			if (raw) setMacros(JSON.parse(raw));
		} catch {
			// ignore
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

	const startRecording = useCallback(() => {
		recordedFramesRef.current = [];
		setRecordedFrames([]);
		setRecording(true);
	}, []);

	const stopRecording = useCallback(() => {
		setRecording(false);
		setRecordedFrames([...recordedFramesRef.current]);
	}, []);

	const saveMacro = useCallback(() => {
		if (recordedFrames.length === 0) return;
		const name = window.prompt("Macro name", "Macro 1");
		if (!name?.trim()) return;
		const next: SavedMacro = { id: String(Date.now()), name: name.trim(), frames: recordedFrames };
		const nextMacros = [...macros, next];
		setMacros(nextMacros);
		try {
			localStorage.setItem(MACROS_STORAGE_KEY, JSON.stringify(nextMacros));
		} catch {
			// ignore
		}
		setRecordedFrames([]);
	}, [recordedFrames, macros]);

	const playMacro = useCallback((id: string) => {
		if (!connected) return;
		setPlayingMacroId(id);
	}, [connected]);

	const deleteMacro = useCallback((id: string) => {
		const next = macros.filter((m) => m.id !== id);
		setMacros(next);
		try {
			localStorage.setItem(MACROS_STORAGE_KEY, JSON.stringify(next));
		} catch {
			// ignore
		}
		if (playingMacroId === id) setPlayingMacroId(null);
		if (selectedMacroId === id) setSelectedMacroId("");
	}, [macros, playingMacroId, selectedMacroId]);

	// Restart gamepad polling whenever we get a new connection (connectionId) so reconnect works
	useEffect(() => {
		if (!connected) return;
		const sendController = () => {
			if (wsRef.current?.readyState !== WebSocket.OPEN) return;
			if (playingMacroIdRef.current) return; // don't send live input while playing a macro
			const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
			const pad = gamepads[0];
			if (!pad) {
				setControllerActive(false);
				return;
			}
			setControllerActive(true);
			const axes = Array.from(pad.axes);
			const buttons = pad.buttons.map((b) => (typeof b === "object" ? b.value : b));
			setLastInput({ axes, buttons, id: pad.id });
			const state = { axes, buttons, id: pad.id, timestamp: Date.now() };
			if (recordingRef.current) {
				recordedFramesRef.current.push({ axes, buttons, timestamp: state.timestamp });
			}
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

	// Play back a saved macro: send frames over WebSocket with original timing
	useEffect(() => {
		if (!playingMacroId || !connected || !wsRef.current) return;
		const macro = macros.find((m) => m.id === playingMacroId);
		if (!macro?.frames?.length) {
			setPlayingMacroId(null);
			return;
		}
		const baseTime = macro.frames[0].timestamp;
		const timeouts: number[] = [];
		for (let i = 0; i < macro.frames.length; i++) {
			const frame = macro.frames[i];
			const delay = frame.timestamp - baseTime;
			const t = window.setTimeout(() => {
				if (wsRef.current?.readyState !== WebSocket.OPEN) return;
				try {
					wsRef.current.send(JSON.stringify({ axes: frame.axes, buttons: frame.buttons, timestamp: Date.now() }));
				} catch {
					// ignore
				}
			}, delay);
			timeouts.push(t);
		}
		const endDelay = macro.frames[macro.frames.length - 1].timestamp - baseTime + 50;
		const cleanup = window.setTimeout(() => {
			setPlayingMacroId(null);
		}, endDelay);
		return () => {
			timeouts.forEach((id) => clearTimeout(id));
			clearTimeout(cleanup);
		};
	}, [playingMacroId, connected, macros]);

	// Use proxy so ngrok's free-tier interstitial is skipped (server sends ngrok-skip-browser-warning)
	const streamUrl = bridgeUrl ? `${bridgeUrl}${STREAM_PATH}` : "";
	const iframeSrc = streamUrl ? `/api/proxy?url=${encodeURIComponent(streamUrl)}` : "";
	// Fullscreen whenever we have a stream URL (stays fullscreen, no flicker)
	const theaterMode = !!iframeSrc;
	const controllerType = detectControllerType(lastInput?.id);
	const friendlyButtonLabels = controllerType === "playstation" ? PS_BUTTON_LABELS : XBOX_BUTTON_LABELS;

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
							{connected ? (
								<>
									<span className={`top-bar-badge ${controllerActive ? "active" : ""}`}>
										{controllerActive ? "Gamepad" : "No gamepad"}
									</span>
									<button type="button" onClick={() => setShowInputBar((v) => !v)} className="btn btn-ghost">
										{showInputBar ? "Hide inputs" : "Show inputs"}
									</button>
									<button type="button" onClick={disconnect} className="btn btn-danger btn-sm">
										Disconnect
									</button>
								</>
							) : (
								<>
									<input
										type="url"
										placeholder="https://xxxx.ngrok.io"
										value={bridgeInput}
										onChange={(e) => setBridgeInput(e.target.value)}
										onKeyDown={(e) => e.key === "Enter" && connect()}
										className="input input-topbar"
									/>
									<button type="button" onClick={connect} className="btn btn-primary btn-sm">
										Connect
									</button>
								</>
							)}
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
					<div className="input-bar-content">
						{inputDisplayMode === "raw" ? (
							<>
								<div className="input-bar-row">
									<span className="input-bar-label">Axes</span>
									<div className="input-bar-axes">
										{lastInput ? lastInput.axes.map((a, i) => (
											<span key={i} className="input-bar-pill" title={`Axis ${i}: ${a.toFixed(2)}`}>
												Axis {i}: {a.toFixed(2)}
											</span>
										)) : "—"}
									</div>
								</div>
								<div className="input-bar-row">
									<span className="input-bar-label">Buttons</span>
									<div className="input-bar-buttons">
										{lastInput ? lastInput.buttons.map((b, i) => (
											<span key={i} className={"input-bar-pill " + (Number(b) > 0.5 ? "on" : "")} title={`Button ${i}`}>
												Button {i}
											</span>
										)) : "—"}
									</div>
								</div>
							</>
						) : (
							<>
								<div className="input-bar-row input-bar-friendly">
									<span className="input-bar-label">Sticks</span>
									<div className="input-bar-sticks">
										<div className="stick-wrap" title="Left stick">
											<div className="stick-base">
												<div
													className="stick-dot"
													style={{
														left: lastInput && lastInput.axes[0] !== undefined ? `${50 + lastInput.axes[0] * 45}%` : "50%",
														top: lastInput && lastInput.axes[1] !== undefined ? `${50 - lastInput.axes[1] * 45}%` : "50%",
														transform: "translate(-50%, -50%)",
													}}
												/>
											</div>
											<span className="stick-label">L</span>
										</div>
										<div className="stick-wrap" title="Right stick">
											<div className="stick-base">
												<div
													className="stick-dot"
													style={{
														left: lastInput && lastInput.axes[2] !== undefined ? `${50 + lastInput.axes[2] * 45}%` : "50%",
														top: lastInput && lastInput.axes[3] !== undefined ? `${50 - lastInput.axes[3] * 45}%` : "50%",
														transform: "translate(-50%, -50%)",
													}}
												/>
											</div>
											<span className="stick-label">R</span>
										</div>
									</div>
								</div>
								<div className="input-bar-row">
									<span className="input-bar-label">Buttons</span>
									<div className="input-bar-buttons">
										{lastInput ? lastInput.buttons.slice(0, 10).map((b, i) => {
											const pressed = Number(b) > 0.5;
											const iconType = controllerType === "playstation" ? "playstation" : "xbox";
											return (
												<span
													key={i}
													className={"input-bar-pill " + (pressed ? "on" : "")}
													title={`Button ${i}: ${friendlyButtonLabels[i] ?? i}`}
												>
													{i < 4 ? (
														<FaceButtonIcon type={iconType} index={i} pressed={pressed} />
													) : (
														friendlyButtonLabels[i] ?? i
													)}
												</span>
											);
										}) : "—"}
									</div>
								</div>
							</>
						)}
						{connected && (
							<div className="input-bar-row input-bar-macros">
								<span className="input-bar-label">Macros</span>
								<div className="input-bar-macro-controls">
									{!recording ? (
										<button type="button" className="input-bar-toggle" onClick={startRecording} title="Record controller input">
											Record
										</button>
									) : (
										<button type="button" className="input-bar-toggle active" onClick={stopRecording} title="Stop recording">
											Stop
										</button>
									)}
									{recordedFrames.length > 0 && (
										<button type="button" className="input-bar-toggle" onClick={saveMacro} title="Save recorded input as macro">
											Save ({recordedFrames.length})
										</button>
									)}
									{macros.length > 0 && (
										<>
											<select
												className="input-bar-macro-select"
												title="Choose macro"
												value={selectedMacroId}
												onChange={(e) => setSelectedMacroId(e.target.value)}
											>
												<option value="">— Macro —</option>
												{macros.map((m) => (
													<option key={m.id} value={m.id}>
														{m.name} ({m.frames.length})
													</option>
												))}
											</select>
											<button
												type="button"
												className="input-bar-toggle"
												title="Play selected macro"
												onClick={() => selectedMacroId && playMacro(selectedMacroId)}
												disabled={!!playingMacroId || !selectedMacroId}
											>
												{playingMacroId ? "Playing…" : "Play"}
											</button>
											<button
												type="button"
												className="input-bar-toggle"
												title="Delete selected macro"
												onClick={() => selectedMacroId && deleteMacro(selectedMacroId)}
												disabled={!selectedMacroId || !!playingMacroId}
											>
												Delete
											</button>
										</>
									)}
								</div>
							</div>
						)}
					</div>
					<div className="input-bar-footer">
						<button
							type="button"
							className={"input-bar-toggle " + (inputDisplayMode === "raw" ? "active" : "")}
							onClick={() => setInputDisplayMode("raw")}
							title="Raw numbers"
						>
							Numbers
						</button>
						<button
							type="button"
							className={"input-bar-toggle " + (inputDisplayMode === "friendly" ? "active" : "")}
							onClick={() => setInputDisplayMode("friendly")}
							title={controllerType === "playstation" ? "PlayStation labels & stick icons" : "Xbox labels & stick icons"}
						>
							{controllerType === "playstation" ? "PlayStation" : "Xbox"}
						</button>
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
				.input-topbar {
					max-width: 280px;
					padding: 0.35rem 0.6rem;
					font-size: 0.8rem;
				}
				.input-bar {
					flex-shrink: 0;
					padding: 0.5rem 1rem;
					background: rgba(15, 15, 18, 0.95);
					border-top: 1px solid var(--border);
					font-size: 0.75rem;
					color: var(--muted);
					display: flex;
					flex-direction: column;
					gap: 0.25rem;
				}
				.input-bar-content {
					flex: 1;
				}
				.input-bar-footer {
					display: flex;
					justify-content: flex-end;
					margin-top: 0.25rem;
					padding-top: 0.25rem;
					border-top: 1px solid var(--border);
				}
				.input-bar-toggle {
					padding: 0.2rem 0.5rem;
					font-size: 0.7rem;
					background: var(--surface);
					border: 1px solid var(--border);
					border-radius: 4px;
					color: var(--muted);
					cursor: pointer;
					margin-left: 0.25rem;
				}
				.input-bar-toggle:hover {
					color: var(--text);
				}
				.input-bar-toggle.active {
					background: var(--accent);
					color: var(--bg);
					border-color: var(--accent);
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
				.input-bar-pill .face-icon {
					display: block;
					vertical-align: middle;
				}
				.input-bar-sticks {
					display: flex;
					gap: 1rem;
					align-items: center;
				}
				.input-bar-macros .input-bar-macro-controls {
					display: flex;
					flex-wrap: wrap;
					align-items: center;
					gap: 0.35rem;
				}
				.input-bar-macro-select {
					padding: 0.2rem 0.5rem;
					font-size: 0.7rem;
					background: var(--surface);
					border: 1px solid var(--border);
					border-radius: 4px;
					color: var(--text);
					cursor: pointer;
				}
				.stick-wrap {
					display: flex;
					align-items: center;
					gap: 0.35rem;
				}
				.stick-label {
					font-size: 0.7rem;
					color: var(--muted);
					min-width: 1rem;
				}
				.stick-base {
					width: 40px;
					height: 40px;
					border-radius: 50%;
					background: var(--surface);
					border: 1px solid var(--border);
					position: relative;
				}
				.stick-dot {
					position: absolute;
					width: 12px;
					height: 12px;
					border-radius: 50%;
					background: var(--accent);
					transition: left 0.05s, top 0.05s;
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
