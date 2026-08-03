# Blackbox OS Design Architecture

## Product thesis

Trader Journal is not treated as a generic analytics dashboard. It is designed as an execution operating system that helps a trader move through one repeatable loop:

1. prepare
2. execute
3. record
4. review
5. detect patterns
6. improve the next session

The interface prioritizes discipline, decision quality, risk awareness, and evidence over decorative dashboard density.

## Visual system

### Direction

The product uses a restrained black, graphite, warm gold, green, and red system inspired by professional market terminals, flight recorders, and technical control rooms.

### Hierarchy

- large editorial headings establish the active module
- monospaced labels communicate system state and quantitative values
- gold indicates primary actions and active navigation
- green and red are reserved for positive and negative trading outcomes
- quiet borders and spacing replace excessive card stacking

### Surfaces

- base canvas: near black
- operational panels: layered graphite
- important controls: warm gold
- success: restrained green
- danger and rule violations: restrained red

## Application architecture

### Access terminal

The authentication experience is a two-column command entrance rather than a centered generic login card. The product promise, public trade evidence, and account access remain visible in one composition.

### Navigation rail

Desktop navigation acts as a persistent mission rail. Mobile navigation collapses into a compact command header while preserving every existing route.

### Command bar

New Trade and Export remain globally available. Any in-progress trade is surfaced inside the same command layer to reduce navigation friction.

### Performance module

The dashboard is restructured visually around:

- account balance as the dominant metric
- secondary performance metrics in a compact matrix
- equity, drawdown, strategy, and trader-score analysis
- discipline and risk controls
- setup-level edge detection

### Trade capture

The existing trade form is presented as an execution workflow:

- context
- risk and pricing
- setup
- advanced psychology and evidence

The backend fields and element IDs remain unchanged, preserving all existing behavior.

### Review and journal modules

Filtering, import/export, reflections, calendar review, and monthly review use the same visual language so the product feels like one operating system rather than separate utilities.

## Responsive rules

- desktop: persistent mission rail plus sticky command navigation
- tablet: compact header navigation and single-column analytical modules
- mobile: two-column metric summaries where useful, stacked forms, full-width actions, and horizontal scrolling only for data tables and the seven-day calendar

## Compatibility strategy

This redesign replaces the visual layer while preserving:

- authentication and password reset
- PostgreSQL synchronization
- local autosave
- trade calculations
- screenshot storage
- CSV/TSV import
- JSON backup and restore
- public recent-trade feed
- admin views
- chart rendering
- route and element IDs used by `app.js`

## QA checklist

Before merging, verify:

- login, registration, logout, and password reset
- all navigation modules on desktop and mobile
- trade creation, editing, deletion, and in-progress state
- screenshot upload and preview
- risk settings save correctly
- charts resize without clipping
- public recent trades display correctly
- calendar cells remain readable at narrow widths
- CSV/TSV import and JSON backup actions remain usable
- admin-only sections retain their hidden and visible states
- no horizontal page overflow at 320 px width
