# Deploying Trader Journal to Vercel

This is the whole deploy, start to finish. Do it yourself — every step below is
something you perform in your own Vercel and Railway dashboards.

> ## Never paste a secret into a file in this repo
>
> Not into `.env.example`, not into `vercel.json`, not into a code comment, not
> "just temporarily". Your `DATABASE_URL`, `SESSION_SECRET` and `RESEND_API_KEY`
> belong in **Vercel → Settings → Environment Variables** and nowhere else.
> Anything committed to git is permanent — even after a later deletion it stays
> in the history, and this repo may become public.
>
> If a secret does land in a commit: rotate it first (Railway can regenerate the
> database password, Resend can revoke the key), then worry about the history.

---

## What changed

The app used to run on Railway as a PHP container. It now runs on Vercel as
serverless Node functions. **Your database does not move.** The same Railway
Postgres, the same rows, the same password hashes — the Vercel functions just
connect to it over its public URL.

- `trade_handler.php` and the `Dockerfile` are gone.
- `api/handler.js` serves all fifteen actions.
- `vercel.json` rewrites `/trade_handler.php?action=…` to that function, so the
  front-end is byte-for-byte unchanged.
- The backend runs **no** `CREATE`, `ALTER` or `DROP`. Your schema is untouched.

---

## Step 1 — Get the database URL out of Railway

1. Open your Railway project → the **Postgres** service → **Variables**.
2. Copy **`DATABASE_PUBLIC_URL`** (it looks like
   `postgresql://postgres:…@something.proxy.rlwy.net:PORT/railway`).

**Use the public URL, not `DATABASE_URL`.** Railway's internal `DATABASE_URL`
points at `*.railway.internal`, a hostname that only resolves inside Railway's
own network. A Vercel function is outside it and will fail with `ENOTFOUND`.

Keep that string in your clipboard or password manager. Do not put it in a file.

*(Optional, recommended:) if the Postgres service has no public networking
enabled yet, enable TCP proxy / public networking on it in Railway first.*

---

## Step 2 — Create the Vercel project

1. <https://vercel.com/new> → import this git repository.
2. **Framework Preset:** `Other`.
3. **Build Command:** leave empty. **Output Directory:** leave empty.
   **Install Command:** `npm install`.
4. **Do not deploy yet** — add the environment variables first (step 3), so the
   very first deployment already has a database.

Vercel reads `vercel.json` automatically; there is nothing to configure for
routing.

---

## Step 3 — Add the environment variables

**Settings → Environment Variables.** Tick **Production**, **Preview** and
**Development** for each one unless noted.

### Required

| Name | Value |
| --- | --- |
| `DATABASE_URL` | The Railway **public** URL from step 1. |

### Strongly recommended

| Name | Value |
| --- | --- |
| `SESSION_SECRET` | A long random string. Generate one locally with `openssl rand -hex 32` and paste the output. Without it the signing key is derived from `DATABASE_URL`, so rotating the database password would log everyone out. |
| `APP_URL` | Your production origin, e.g. `https://trader-journal.vercel.app`. Production scope only — leave it off Preview so preview deploys build reset links against their own URL. Used for password-reset links. |

### Optional

| Name | Value |
| --- | --- |
| `RESEND_API_KEY` | Resend API key. Without it, password reset creates a token but sends no email. |
| `MAIL_FROM` | e.g. `no-reply@your-domain.example`, on a domain verified in Resend. Required with `RESEND_API_KEY`. |
| `MAIL_FROM_NAME` | e.g. `Trader Journal`. |
| `ADMIN_USERNAMES` | Comma-separated usernames allowed into the admin views. Set this rather than relying on the bootstrap fallback. |
| `PUBLIC_RECENT_TRADES_USERNAME` | Whose trades the landing-page tape shows. Leave empty for an empty tape. |

Full list with defaults: `.env.example` and the README.

---

## Step 4 — First deploy

**Deployments → Deploy** (or push to the connected branch).

The build does nothing but `npm install` — there is no build step for the
front-end, by design. Expect it to finish in well under a minute.

If the deploy fails, read the build log. The two realistic causes are a typo in
`vercel.json` and a missing `package.json` dependency; neither depends on the
database.

---

## Step 5 — Verify, in this order

Replace `YOUR-DOMAIN` with the deployment URL.

**1. The PHP source-disclosure bug is dead.**

```bash
curl -s "https://YOUR-DOMAIN/trade_handler.php?action=session"
```

Expect JSON (`{"ok":true,...}` with a `csrfToken`). If you see `<?php` you are
looking at the old bug — the deployment still contains a `.php` file.

**2. The database is reachable.**

The same call proves it: `{"ok":false,"error":"Database initialization failed…"}`
means `DATABASE_URL` is wrong, unreachable, or still the `*.railway.internal`
one. Check **Vercel → the deployment → Logs** for the underlying error; it is
logged server-side and deliberately never sent to the browser.

**3. Your existing account logs in.** This is the one that matters.

Open `https://YOUR-DOMAIN` in a browser and log in with your **existing**
username and password — the one you used on Railway. Your PHP `$2y$` bcrypt
hash is verified unchanged by the Node backend; no password reset should be
necessary for anyone.

Then confirm the data round-trips:

- your existing trades appear;
- edit or add one trade and let it save;
- hard-reload the page — the change is still there;
- open a trade with a screenshot and confirm the image still renders.

**4. The rest of the surface.** Log out and back in, request a password reset
(check the email arrives and its link opens the reset form), watch one live
price tick, and open the landing page logged out to check the public tape.

`docs/launch-checklist.md` has the fuller list.

> Note: `http://localhost` runs the front-end in **local preview mode** — auth
> bypassed, data in browser storage. Verify against the real HTTPS domain, never
> against localhost.

---

## Step 6 — Turn off the Railway app service

Once step 5 passes:

- In Railway, **stop or delete the app service** (the one that ran the PHP
  container). It has nothing left to serve.
- **Leave the Postgres service running.** That is your live data and Vercel is
  now the thing connecting to it.

Do not delete, reset, or "reprovision" the Postgres service at any point.

---

## Rollback

Nothing in this deploy touches the database, so there is no data to roll back —
no schema change was made, no row was rewritten, and password hashes are still
stored in the same `$2y$` bcrypt format the PHP wrote. Rollback is purely about
which code serves traffic.

**Fastest (seconds): roll back the Vercel deployment.**
Vercel → **Deployments** → pick the last deployment that worked → **⋯ → Promote
to Production** (or *Instant Rollback*). Traffic moves immediately.

**If the whole Vercel port has to go: restore the PHP app.**

```bash
# 880750e is the last commit before the Vercel port.
git checkout 880750e -- trade_handler.php Dockerfile .dockerignore
git commit -m "Rollback: restore PHP backend"
```

Then redeploy that on a host with a PHP runtime (Railway, using the restored
Dockerfile) and point DNS back at it. The restored PHP reads the same database
and authenticates the same hashes — including any account created while Vercel
was live, because new hashes are written with the `$2y$` prefix too.

**If a rollback is only needed because reset emails are not sending,** do not
roll back — that is `RESEND_API_KEY` / `MAIL_FROM` configuration and everything
else keeps working without it.

---

## Local development after the cutover

`php -S 127.0.0.1:8000` no longer runs anything; there is no PHP in the repo.

```bash
npm install
npm i -g vercel
vercel link
vercel env pull        # writes .env.local — gitignored, never commit it
vercel dev             # http://localhost:3000
npm test               # 13 checks, no database required
```

`vercel env pull` puts your real secrets on disk in `.env.local`. `.gitignore`
already excludes it. Do not move, rename or copy it into the repo.
