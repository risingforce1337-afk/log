# Webhook Site

Public form → your custom backend → Discord webhook. The webhook URL stays
**server-side** (in an env var), so it's never exposed to visitors and can't be
scraped and spammed from the browser.

## Stack
- Node + Express (single server: serves the page *and* the API)
- Zero-config frontend (plain HTML/CSS/JS in `public/`)
- Spam protection: honeypot field + per-IP rate limit (5/min)

## Run locally
```bash
npm install
npm start        # -> http://localhost:3000
```
`.env` already holds your webhook URL for local dev.

## Deploy (Render — free)
1. Push this folder to a GitHub repo (`.env` and `node_modules` are gitignored).
2. On https://render.com → **New → Web Service** → pick the repo.
   `render.yaml` sets build/start commands automatically.
3. In the service's **Environment** tab, add:
   `DISCORD_WEBHOOK_URL = <your webhook>`
4. Deploy. You get a public `https://<name>.onrender.com` URL.

> Free tier sleeps after ~15 min idle; first hit after that takes a few seconds
> to wake. Fine for a form.

## Customize the fields
- Edit the form in `public/index.html`.
- Mirror the field names in the `str(...)` reads + embed in `server.js`.
