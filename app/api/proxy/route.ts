import { NextRequest, NextResponse } from "next/server";

/**
 * Proxies GET requests to the bridge URL with ngrok-skip-browser-warning so the
 * iframe loads the stream instead of ngrok's interstitial page.
 */
export async function GET(request: NextRequest) {
	const url = request.nextUrl.searchParams.get("url");
	if (!url || typeof url !== "string") {
		return NextResponse.json({ error: "Missing url" }, { status: 400 });
	}
	let target: URL;
	try {
		target = new URL(url);
	} catch {
		return NextResponse.json({ error: "Invalid url" }, { status: 400 });
	}
	if (target.protocol !== "https:" && target.protocol !== "http:") {
		return NextResponse.json({ error: "Invalid url" }, { status: 400 });
	}

	const res = await fetch(target.href, {
		method: "GET",
		headers: {
			"ngrok-skip-browser-warning": "true",
			"User-Agent": "RemoteLimelight/1.0",
		},
	});

	const headers = new Headers();
	const passHeaders = ["content-type", "content-length", "cache-control"];
	res.headers.forEach((value, key) => {
		if (passHeaders.includes(key.toLowerCase())) headers.set(key, value);
	});

	return new NextResponse(res.body, {
		status: res.status,
		headers,
	});
}
