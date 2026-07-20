import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

// The webhook lives ONLY on the server. Never shipped to the browser.
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
if (!WEBHOOK_URL) {
  console.warn(
    "[warn] DISCORD_WEBHOOK_URL is not set. Visit logging will be skipped until you set it (see .env)."
  );
}

app.set("trust proxy", true); // behind Render's proxy; getClientIp() parses XFF for the real client

// ---- de-dupe: don't re-notify for the same IP within this window ----
// Set to 0 to disable (log every load). Any value > 0 = cooldown in ms.
const DEDUPE_MS = 0;
const lastSeen = new Map(); // ip -> timestamp
if (DEDUPE_MS > 0) {
  setInterval(() => {
    const now = Date.now();
    for (const [ip, t] of lastSeen) if (now - t > DEDUPE_MS) lastSeen.delete(ip);
  }, 5 * DEDUPE_MS).unref();
}

function cleanIp(ip) {
  return (ip || "").replace("::ffff:", "").trim();
}

// Private / non-routable ranges — these can't be geolocated and are never the
// real visitor (they're proxy/LAN addresses like Render's internal 10.x hop).
function isLocal(ip) {
  const c = cleanIp(ip);
  if (!c) return true;
  if (c === "::1" || c.startsWith("127.") || c.startsWith("169.254.")) return true;
  if (c.startsWith("10.") || c.startsWith("192.168.")) return true;
  const m = c.match(/^172\.(\d+)\./);
  if (m && +m[1] >= 16 && +m[1] <= 31) return true;
  if (/^(fc|fd|fe80)/i.test(c)) return true; // IPv6 ULA / link-local
  return false;
}

// The real client IP: walk X-Forwarded-For left→right and take the first PUBLIC
// address. Falls back to the socket peer. This skips Render's internal proxy hops.
function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) {
    for (const part of xff.split(",")) {
      const ip = cleanIp(part);
      if (ip && !isLocal(ip)) return ip;
    }
  }
  return cleanIp(req.ip || req.socket?.remoteAddress || "");
}

// Approx geolocation from IP via a free, no-key, HTTPS endpoint.
async function geoLookup(ip) {
  if (isLocal(ip)) return null;
  try {
    const r = await fetch(`https://ipwho.is/${encodeURIComponent(cleanIp(ip))}`, {
      signal: AbortSignal.timeout(4000),
    });
    const j = await r.json();
    if (!j || j.success === false) return null;
    return j;
  } catch {
    return null;
  }
}

async function notifyVisit(req) {
  if (!WEBHOOK_URL) return;

  const ip = getClientIp(req);
  if (DEDUPE_MS > 0) {
    const now = Date.now();
    if (lastSeen.get(ip) && now - lastSeen.get(ip) < DEDUPE_MS) return; // recently logged
    lastSeen.set(ip, now);
  }

  const ua = (req.headers["user-agent"] || "unknown").slice(0, 300);
  const geo = await geoLookup(ip);

  const location = geo
    ? [geo.city, geo.region, geo.country].filter(Boolean).join(", ") || "unknown"
    : isLocal(ip)
      ? "local / private network"
      : "unavailable";
  const isp = geo?.connection?.isp || geo?.connection?.org || "—";

  const embed = {
    title: "👀 New visit",
    color: 0x5865f2,
    fields: [
      { name: "IP", value: ip || "unknown", inline: true },
      { name: "Location", value: location, inline: true },
      { name: "ISP / Org", value: isp, inline: false },
      { name: "User-Agent", value: ua, inline: false },
    ],
    timestamp: new Date().toISOString(),
  };

  try {
    const dc = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Visit Logger",
        embeds: [embed],
        allowed_mentions: { parse: [] },
      }),
    });
    if (!dc.ok && dc.status !== 204) {
      console.error("[discord] non-ok:", dc.status, await dc.text());
    }
  } catch (err) {
    console.error("[discord] fetch failed:", err);
  }
}

// Log the visit when the page itself is loaded (not for every asset).
// Fire-and-forget so the page still serves instantly.
app.get("/", (req, res) => {
  notifyVisit(req);
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Server up on http://localhost:${PORT}`);
});
