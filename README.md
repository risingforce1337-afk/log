# Visit Logger Site

An image page that logs each visit — IP address + approximate location — to a
Discord webhook, **with a visible on-page notice telling visitors it does so.**
The webhook URL stays **server-side** (env var), never exposed to the browser.

## How it works
- `GET /` serves `public/index.html` (an image + a disclosure notice) and, in the
  background, sends a "New visit" embed to Discord with the visitor's IP,
  approximate location (via the free ipwho.is lookup), and user-agent.
- Repeat visits from the same IP within 60s are de-duped so refreshes don't spam.

## Stack
- Node + Express (single server serves the page and does the logging)
- Only dep is express; uses Node 24 built-in `fetch` + `--env-file-if-exists`

## Run locally
```bash
npm install
npm start        # -> http://localhost:3000
```
Locally your IP is `::1`, so the embed shows "local / private network". Real
locations only appear once it's deployed and hit from the public internet.

## Deploy (Render — free)
1. Push this folder to a GitHub repo (`.env` and `node_modules` are gitignored).
2. render.com → **New → Web Service** → pick the repo (`render.yaml` auto-fills).
3. In the service's **Environment** tab add `DISCORD_WEBHOOK_URL = <your webhook>`.
4. Deploy → public `https://<name>.onrender.com`.

## Customize
- Swap the image: drop a file in `public/` and change the `src` in `index.html`.
- Keep the notice visible — that on-page disclosure is what keeps this a legit
  visit logger rather than a covert grabber.
