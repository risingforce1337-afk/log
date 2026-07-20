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
    "[warn] DISCORD_WEBHOOK_URL is not set. Submissions will fail until you set it (see .env)."
  );
}

app.set("trust proxy", 1); // so req.ip is correct behind Render/other proxies
app.use(express.json({ limit: "16kb" }));
app.use(express.static(path.join(__dirname, "public")));

// ---- tiny in-memory rate limiter (no extra deps) ----
const WINDOW_MS = 60_000; // 1 minute
const MAX_HITS = 5; // 5 submissions per IP per minute
const hits = new Map(); // ip -> number[] (timestamps)

function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_HITS;
}

// occasional cleanup so the Map doesn't grow forever
setInterval(() => {
  const now = Date.now();
  for (const [ip, times] of hits) {
    const recent = times.filter((t) => now - t < WINDOW_MS);
    if (recent.length) hits.set(ip, recent);
    else hits.delete(ip);
  }
}, 5 * WINDOW_MS).unref();

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

app.post("/api/submit", async (req, res) => {
  if (!WEBHOOK_URL) {
    return res.status(500).json({ ok: false, error: "Server not configured." });
  }

  const ip = req.ip || "unknown";
  if (rateLimited(ip)) {
    return res
      .status(429)
      .json({ ok: false, error: "Slow down — too many submissions. Try again in a minute." });
  }

  const body = req.body || {};

  // Honeypot: real users never fill this hidden field. Bots do.
  if (str(body.website, 100)) {
    return res.json({ ok: true }); // pretend success, drop silently
  }

  const name = str(body.name, 100);
  const email = str(body.email, 200);
  const message = str(body.message, 2000);

  if (!name || !message) {
    return res
      .status(400)
      .json({ ok: false, error: "Name and message are required." });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: "That email looks off." });
  }

  const embed = {
    title: "📨 New submission",
    color: 0x5865f2,
    fields: [
      { name: "Name", value: name, inline: true },
      { name: "Email", value: email || "—", inline: true },
      { name: "Message", value: message },
    ],
    footer: { text: `IP ${ip}` },
    timestamp: new Date().toISOString(),
  };

  try {
    const dc = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Site Form",
        embeds: [embed],
        // don't let submitted text ping anyone
        allowed_mentions: { parse: [] },
      }),
    });

    if (!dc.ok && dc.status !== 204) {
      console.error("[discord] non-ok:", dc.status, await dc.text());
      return res
        .status(502)
        .json({ ok: false, error: "Couldn't deliver right now. Try again shortly." });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("[discord] fetch failed:", err);
    return res
      .status(502)
      .json({ ok: false, error: "Couldn't deliver right now. Try again shortly." });
  }
});

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Server up on http://localhost:${PORT}`);
});
