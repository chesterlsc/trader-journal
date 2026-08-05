# Launch Checklist

## Configuration

- Set `DATABASE_URL` on the Vercel project (Production, Preview and Development).
- Set `SESSION_SECRET` so cookies survive a database URL rotation.
- Set `APP_URL` so reset links point to the public domain.
- Set `MAIL_FROM` and, if using Resend, `RESEND_API_KEY`.
- Set `ADMIN_USERNAME` or `ADMIN_USERNAMES` if bootstrap-admin fallback is not desired.
- Set `PUBLIC_RECENT_TRADES_USERNAME` or `PUBLIC_RECENT_TRADES_USER_ID` if the landing page should show a public trade feed.

## Pre-Launch Smoke Tests

- Register a new account.
- Log out and log back in with both username and email, if email login is enabled for that user.
- Request a password reset and confirm the emailed link works (there is no debug reset URL any more).
- Create a trade with a screenshot, save, reload, and confirm the screenshot still appears.
- Edit the same trade, replace or remove the screenshot, save, and reload again.
- Add open and closed trades, then confirm the recent-trades cards render correctly.
- Check live price refresh for at least one crypto pair and one metals pair if those markets are in scope.
- Confirm CSV export, JSON backup, and JSON import still work.

## Admin and Audit

- Confirm the expected admin account can open the admin users view.
- Confirm `login_logs` returns the latest register, login, and logout events for admin review.
- Verify no unintended account is treated as admin.

## Deployment

- Run `npm test` (13 checks, no database needed).
- Existing database: apply nothing — the backend issues no DDL. Brand-new database only: `psql "$DATABASE_URL" -f db/schema.sql`.
- Deploy the app and verify the production domain matches `APP_URL`.
- Confirm `curl -s https://YOUR-DOMAIN/trade_handler.php?action=session` returns JSON, not source text.
- Clear CDN or browser cache if users may still have older `app.js` or `styles.css` cached.

## Post-Deploy Verification

- Open the landing page while logged out and confirm the public feed is either correct or intentionally empty.
- Log in, load journal data, save once, and confirm screenshots still persist after the round trip.
- Trigger one live price refresh and one password reset in production.
- Review the first few rows in `journal_users`, `password_reset_requests`, `trade_screenshots`, `symbol_prices`, and `login_info`.

## Follow-Up Refactor

- Split `app.js` into smaller modules once the launch path is stable.
- Add automated backend and frontend smoke tests before broader public rollout.
