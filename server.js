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

app.set("trust proxy", 1); // so req.ip is the real visitor IP behind Render/proxies

// ---- de-dupe: don't re-notify for the same IP within this window ----
const DEDUPE_MS = 60_000;
const lastSeen = new Map(); // ip -> timestamp
setInterval(() => {
  const now = Date.now();
  for (const [ip, t] of lastSeen) if (now - t > DEDUPE_MS) lastSeen.delete(ip);
}, 5 * DEDUPE_MS).unref();

function cleanIp(ip) {
  return (ip || "").replace("::ffff:", "");
}

function isLocal(ip) {
  const c = cleanIp(ip);
  return !c || c === "::1" || c.startsWith("127.");
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

  const ip = cleanIp(req.ip);
  const now = Date.now();
  if (lastSeen.get(ip) && now - lastSeen.get(ip) < DEDUPE_MS) return; // recently logged
  lastSeen.set(ip, now);

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
