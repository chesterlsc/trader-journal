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

Use **Save to PHP JSON** and **Load from PHP JSON** buttons inside the app.

PHP data will be stored at:

- `data/journal_data.json`

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
