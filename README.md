# Chester Journal (Offline Trading Analytics)

A professional-style offline trading journal focused on:

- Performance analytics and expectancy
- Drawdown and risk-rule tracking
- Custom starting balance and optional account balance override
- Discipline and psychology monitoring
- Daily reflections and monthly review
- Local storage + optional PHP JSON persistence

## Files

- `index.html`
- `styles.css`
- `app.js`
- `trade_handler.php`

## Run Locally (LocalStorage only)

Open `index.html` directly in your browser.

## Run with PHP JSON Save/Load

From this folder:

```bash
php -S localhost:8000
```

Then open:

- `http://localhost:8000`

Use **Cloud Save Login** in the sidebar:

- Register a username/password (first time).
- Login to your account.
- Use **Save to PHP JSON** and **Load from PHP JSON**.

Data is saved per user session.

PHP data will be stored at:

- `data/users.json`
- `data/accounts/<username>.json`

## Deploy on Railway

This repo includes a `Dockerfile`, so Railway can build it without Railpack detection.

1. Connect repo to Railway.
2. Redeploy latest commit.
3. Generate public domain in Railway Networking.
4. Add a volume mounted at `/app/data` for persistent journal storage.

## Data Controls

- Export CSV (trades)
- Backup JSON (all app data)
- Import JSON (restore full state)

## Keyboard Shortcuts

- `Cmd/Ctrl + S` while on Trade Entry: save trade
- `/` anywhere: jump to journal search filter
# chester-trading-journal
# chester-trading-journal
# chester-trading-journal
# chester-trading-journal
# chester-trading-journal
