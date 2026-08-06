import {
  readStorageJson,
  writeStorageJson,
  createId,
  toDateInputValue,
  parseNumber,
  ensureNumber,
  ensurePositiveNumber,
  ensureNonNegative,
  sortTradesAsc,
  sortTradesDesc,
  escapeCsvValue,
  triggerDownload,
  setMessage,
  round,
  clamp,
  escapeHtml,
  getWeekKey,
  debounce
} from "./src/lib/core.js";
import { formatCurrency } from "./src/lib/format.js";
import { getNextSessionOpen, formatCountdown } from "./src/lib/sessions.js";
import {
  normalizeMarketSymbol,
  fetchLivePricesFromBackend
} from "./src/modules/livePrices.js";
import { createTradeDisplayHelpers, liveCellAttrs } from "./src/modules/tradeDisplay.js";
import { createRecentTradesView } from "./src/modules/recentTradesView.js";
import { createChartsModule, traceSmoothPath } from "./src/modules/charts.js";
import { parseQuickTrade, resolveSymbol, inferMarket } from "./src/lib/tradeParse.js";
import {
  PROP_PRESETS,
  PROP_PRESET_AS_OF,
  defaultPropRules,
  evaluateProp,
  findPropPreset,
  mllPressure,
  normalizePropRules,
  propSteps
} from "./src/lib/propRules.js";

const STORAGE_KEYS = {
  trades: "axiom_journal_trades_v1",
  settings: "axiom_journal_settings_v1",
  reflections: "axiom_journal_reflections_v1",
  replay: "axiom_journal_replay_v1",
  lastSaved: "axiom_journal_last_saved_v1",
  adminPanels: "axiom_journal_admin_panels_v1",
  // 1f #06 voice notes. A SEPARATE key on purpose: audio is orders of
  // magnitude larger than a trade record, and the trades key is what gets
  // POSTed to the server on every autosave. Keeping clips out of that object
  // is what stops a 30-second ramble from riding on every sync. The price is
  // that clips are device-local — see voiceStoreRead().
  voice: "axiom_journal_voice_v1"
};

/* The pre-trade checklist a trader starts with. 1f #02 makes the list itself
   editable (state.settings.preTradeRules), so this is only the seed — but the
   ids are PERSISTED on every trade that ticked them, so these three ids must
   never be renamed or old rows lose their labels. Declared above
   DEFAULT_SETTINGS because that object references it at module-evaluation
   time; anything below the init() call is in the temporal dead zone. */
const DEFAULT_PRE_TRADE_RULES = [
  { id: "playbook", label: "Setup is in my playbook" },
  { id: "structure-stop", label: "Stop is at structure, not at a round number" },
  { id: "no-news", label: "No news inside 15 minutes" }
];

const DEFAULT_SETTINGS = {
  journalName: "Your",
  startingBalance: 10000,
  balanceOverride: 0,
  dailyMaxLoss: 300,
  weeklyMaxLoss: 1000,
  riskPerTrade: 1,
  equityGoal: 15000,
  // 1f #02 — the checklist shown in the New Trade sheet, written once here.
  preTradeRules: DEFAULT_PRE_TRADE_RULES,
  // 1f #03 — the cooldown speed bump. cooldownLossStreak = 0 turns off the
  // consecutive-loss trigger; the loss-budget triggers still fire whenever a
  // budget is configured and breached, because that is the budget's whole job.
  cooldownEnabled: true,
  cooldownLossStreak: 3,
  // Multi-account. Seeded empty and filled by ensureAccounts() on the first
  // load, because the migration needs the trader's real starting balance and
  // that is not known at module-evaluation time.
  accounts: [],
  activeAccountId: ""
};

/* ---- DEMO (guest) MODE ----------------------------------------------------
   Try-before-signup. The ONLY thing an account buys is persistence, so demo
   mode is a full app with an ephemeral storage target: sessionStorage, under
   a distinct key prefix, never the localStorage keys a real user writes and
   never the server. state.auth.isAuthenticated stays false throughout, so
   queueServerAutosave()/saveToPhpStorage()/loadFromPhpStorage() and the CSRF
   session logic are untouched by construction.
   Declared here (far above the module-level init() call) — anything below it
   is in the temporal dead zone during the first render. */
const GUEST_MODE_KEY = "axiom_journal_demo_v1";
const GUEST_KEY_PREFIX = "demo:";
// Sample rows ride the existing importBatchId field (normalizeTrades keeps it)
// so they can be told apart from anything the visitor logs themselves — that
// is what makes an honest carry-over on sign-up possible.
const DEMO_BATCH_ID = "demo-sample-journal";
const DEMO_REFLECTION_TAG = "sample";
const DEMO_NOTICE =
  "Demo mode — nothing here is saved. Create a free account to keep it.";
const DEMO_TRADE_NOTE_PREFIX = "SAMPLE DATA —";

// Sample journal spec. Deterministic and generated, not a shipped blob: four
// instruments, a fixed R-outcome sequence and index-cycled context fields.
const DEMO_INSTRUMENTS = [
  // asset, market, entry, stop distance (price), lots, price decimals
  { asset: "EURUSD", market: "Forex", entry: 1.085, stopDistance: 0.002, size: 0.5, decimals: 5 },
  { asset: "GBPUSD", market: "Forex", entry: 1.272, stopDistance: 0.0025, size: 0.4, decimals: 5 },
  { asset: "XAUUSD", market: "Metals", entry: 3312, stopDistance: 5, size: 0.2, decimals: 2 },
  { asset: "BTCUSD", market: "Crypto", entry: 64200, stopDistance: 400, size: 0.25, decimals: 2 }
];
// R-multiple per closed sample trade. 9 wins / 6 losses / 1 break-even,
// +12.6R total — a believable month, not a highlight reel.
const DEMO_OUTCOMES_R = [2, -1, 1.6, 2.4, -1, 0, 2.2, -1, 1.4, 3, -1, -0.6, 1.8, 2.6, -1, 1.2];
const DEMO_DAYS_AGO = [27, 26, 25, 22, 21, 20, 19, 15, 14, 13, 12, 8, 7, 6, 5, 2];
const DEMO_SESSIONS = ["London", "New York", "Asia"];
const DEMO_SETUPS = ["Breakout", "Liquidity Grab", "Trend Continuation", "Reversal", "Scalp"];
const DEMO_TIMEFRAMES = ["M15", "H1", "M5", "H4"];
const DEMO_PSYCHOLOGY = ["Focused", "Perfect Execution", "Hesitant", "Focused", "Emotional"];
const DEMO_EXECUTION = ["A+", "A", "B", "A", "C"];

const SERVER_AUTOSAVE_DEBOUNCE_MS = 900;
const LIVE_PRICE_REFRESH_MS = 5000;
const LOCAL_PREVIEW_STORAGE_KEY = "axiom_local_preview";
const THEME_STORAGE_KEY = "axiom_journal_theme_v1";
const THEME_CROSSFADE_MS = 300;
const COUNT_UP_DURATION_MS = 600;
// Active count-up rAF handles, keyed by node (init() runs at module
// evaluation, so this must be declared before the init() call below).
const countUpFrames = new WeakMap();

// Single reduced-motion source for every JS-driven animation (count-up,
// pnl ticks, chart draw-in, theme crossfade). CSS motion is handled by the
// zeroed duration tokens + global kill block in styles.css.
const REDUCED_MOTION_QUERY = window.matchMedia("(prefers-reduced-motion: reduce)");

function prefersReducedMotion() {
  return REDUCED_MOTION_QUERY.matches;
}

// CSRF token issued by the server session action; sent on every POST.
let csrfToken = "";
// Element that opened the landing auth modal; focus returns to it on close.
let authModalTrigger = null;
const PRESET_SETUP_TYPES = new Set(["Breakout", "Liquidity Grab", "Trend Continuation", "Reversal", "Scalp", "Custom"]);
const PRODUCT_BRAND_TEXT = "Trader Journal";
const PRODUCT_BRAND_MARKUP =
  '<span class="brand-word-accent">Trader</span><span class="brand-word-primary">Journal</span>';

const state = {
  // state.trades is the ACTIVE account's trades and nothing else. Every reader
  // in this file — analytics, calendar, review, charts, exports — therefore
  // scopes to the active account without knowing accounts exist. The other
  // accounts' rows sit in state.otherTrades untouched until persistState()
  // writes the two back out as one journal. Three functions know about the
  // split (loadState, persistState, adoptAllTrades); nothing else needs to.
  trades: [],
  otherTrades: [],
  settings: { ...DEFAULT_SETTINGS },
  reflections: [],
  replayNotes: {},
  bulkPreview: [],
  recentTrades: [],
  publicRecentTrades: [],
  loginLogs: [],
  adminUsers: [],
  auth: {
    checked: false,
    isAuthenticated: false,
    username: "",
    isAdmin: false,
    previewMode: false,
    landingPreviewMode: false,
    // Demo mode: full app, ephemeral storage. NEVER implies authentication.
    guestMode: false,
    guestNoticeDismissed: false,
    intent: "register",
    mobileAuthVisible: false,
    sessionCheckVersion: 0,
    resetToken: "",
    resetTokenStatus: "idle"
  },
  serverSync: {
    timerId: null,
    inFlight: false
  },
  marketData: {
    currentPrices: {},
    timerId: null,
    inFlight: false
  },
  filters: {
    dateFrom: "",
    dateTo: "",
    market: "all",
    setup: "all",
    session: "all",
    timeframe: "all",
    psychology: "all",
    search: "",
    // 1e chip row. Replaces the old Result <select>: "wins"/"losses" are the
    // result filter, "rules" and "nonote" are predicates the selects could
    // not express. One control, one field.
    quick: "all"
  },
  dashboard: {
    performanceDimension: "setup",
    performanceMetric: "pnl",
    // 1a balance card range toggle: scopes the equity sparkline and the
    // range-return chip. "1m" = 30 days, "3m" = 90, "all" = since start.
    balanceRange: "1m"
  },
  journalSort: {
    key: "",
    dir: 1
  },
  // 1f #04 playbook pages. `setup` is the page you are on and the second hash
  // segment; `curve`/`dates`/`key` are the series the charts module paints for
  // it. They live on state (not in a module-local) so charts.js can hash them
  // exactly like every other series and keep its draw-in guard honest.
  playbook: { setup: "", curve: [], dates: [], key: "line" },
  analytics: null
};

const ui = {
  authShell: document.getElementById("authShell"),
  sidebar: document.getElementById("sidebar"),
  mainNav: document.getElementById("mainNav"),
  navToggleBtn: document.getElementById("navToggleBtn"),
  appContent: document.querySelector(".content"),
  navRiskGroove: document.getElementById("navRiskGroove"),
  navRiskLabel: document.getElementById("navRiskLabel"),
  navRiskValue: document.getElementById("navRiskValue"),
  authOverlay: document.getElementById("authOverlay"),
  authPanel: document.querySelector(".auth-panel"),
  brandTitle: document.getElementById("brandTitle"),
  brandTitles: Array.from(document.querySelectorAll("[data-brand-title]")),
  authTitle: document.getElementById("authTitle"),
  authCopy: document.getElementById("authCopy"),
  navButtons: Array.from(document.querySelectorAll(".nav-btn")),
  views: Array.from(document.querySelectorAll(".view")),
  lastSaved: document.getElementById("lastSaved"),
  authStatus: document.getElementById("authStatus"),
  authMessage: document.getElementById("authMessage"),
  recentTradesList: document.getElementById("recentTradesList"),
  // 1d landing: the tape's honest "this week" counter, filled from the rows
  // actually on the tape (see renderHeroRecentTrades) and hidden at zero.
  lndTapeCount: document.getElementById("lndTapeCount"),
  lndTapeCountText: document.getElementById("lndTapeCountText"),
  lndTapeNote: document.getElementById("lndTapeNote"),
  dashLeonTape: document.getElementById("dashLeonTape"),
  dashLeonTapeList: document.getElementById("dashLeonTapeList"),
  heroEmailForm: document.getElementById("heroEmailForm"),
  heroEmail: document.getElementById("heroEmail"),
  authControls: document.getElementById("authControls"),
  authIdentifier: document.getElementById("authIdentifier"),
  authPassword: document.getElementById("authPassword"),
  authRemember: document.getElementById("authRemember"),
  loginBtn: document.getElementById("loginBtn"),
  registerBtn: document.getElementById("registerBtn"),
  forgotPasswordBtn: document.getElementById("forgotPasswordBtn"),
  heroRegisterBtn: document.getElementById("heroRegisterBtn"),
  heroLoginBtn: document.getElementById("heroLoginBtn"),
  ctaRegisterBtn: document.getElementById("ctaRegisterBtn"),
  demoStartBtns: Array.from(document.querySelectorAll("[data-start-demo]")),
  demoBanner: document.getElementById("demoBanner"),
  demoBannerRegisterBtn: document.getElementById("demoBannerRegisterBtn"),
  demoBannerDismissBtn: document.getElementById("demoBannerDismissBtn"),
  previewLandingBtns: Array.from(document.querySelectorAll("[data-preview-landing]")),
  previewAppBtn: document.getElementById("previewAppBtn"),
  resetPasswordView: document.getElementById("resetPasswordView"),
  resetPassword: document.getElementById("resetPassword"),
  resetPasswordConfirm: document.getElementById("resetPasswordConfirm"),
  resetPasswordBtn: document.getElementById("resetPasswordBtn"),
  cancelResetBtn: document.getElementById("cancelResetBtn"),
  desktopLogoutBtn: document.getElementById("desktopLogoutBtn"),
  mobileLogoutBtn: document.getElementById("mobileLogoutBtn"),
  themeToggles: Array.from(document.querySelectorAll("[data-theme-toggle]")),
  metricNodes: Array.from(document.querySelectorAll("[data-metric]")),
  metricDeltaNodes: Array.from(document.querySelectorAll("[data-metric-delta]")),
  metricGrid: document.getElementById("dashboardMetricGrid"),
  dashSparkline: document.getElementById("dashSparkline"),
  dashHeroToday: document.getElementById("dashHeroToday"),
  dashHeroWeek: document.getElementById("dashHeroWeek"),
  dashHeroRange: document.getElementById("dashHeroRange"),
  balanceRangeButtons: Array.from(document.querySelectorAll("[data-balance-range]")),
  dashClock: document.getElementById("dashClock"),
  dashHello: document.getElementById("dashboardHeading"),
  riskState: document.getElementById("riskState"),
  riskDial: document.getElementById("riskDial"),
  riskDialArc: document.getElementById("riskDialArc"),
  riskDialValue: document.getElementById("riskDialValue"),
  riskConsequence: document.getElementById("riskConsequence"),
  cooldownRulesBtn: document.getElementById("cooldownRulesBtn"),
  riskRulesBtn: document.getElementById("riskRulesBtn"),
  allSetupsBtn: document.getElementById("allSetupsBtn"),
  navUnjournalledBadge: document.getElementById("navUnjournalledBadge"),
  tabBarUnjournalledBadge: document.getElementById("tabBarUnjournalledBadge"),
  topnavMore: document.getElementById("topnavMore"),
  dashPlaybook: document.getElementById("dashPlaybook"),
  dashPlaybookGrid: document.getElementById("dashPlaybookGrid"),
  dashSetupAlert: document.getElementById("dashSetupAlert"),
  dashSetupAlertText: document.getElementById("dashSetupAlertText"),
  // 1f #04 playbook pages.
  playbookHeading: document.getElementById("playbookHeading"),
  playbookLede: document.getElementById("playbookLede"),
  playbookPicker: document.getElementById("playbookPicker"),
  playbookEmpty: document.getElementById("playbookEmpty"),
  playbookStats: document.getElementById("playbookStats"),
  playbookChartPanel: document.getElementById("playbookChartPanel"),
  playbookChart: document.getElementById("playbookChart"),
  playbookBreakdowns: document.getElementById("playbookBreakdowns"),
  playbookShotsPanel: document.getElementById("playbookShotsPanel"),
  playbookShotsLede: document.getElementById("playbookShotsLede"),
  playbookShots: document.getElementById("playbookShots"),
  playbookBackBtn: document.getElementById("playbookBackBtn"),
  playbookJournalBtn: document.getElementById("playbookJournalBtn"),
  dashUnjournalled: document.getElementById("dashUnjournalled"),
  dashUnjournalledCount: document.getElementById("dashUnjournalledCount"),
  dashUnjournalledList: document.getElementById("dashUnjournalledList"),
  dashJournalStreak: document.getElementById("dashJournalStreak"),
  dashJournalBars: document.getElementById("dashJournalBars"),
  balanceCard: document.querySelector(".metric-card-balance"),
  balanceOverrideNote: document.getElementById("balanceOverrideNote"),
  riskStrip: document.getElementById("riskStrip"),
  scoreInfoDialog: document.getElementById("scoreInfoDialog"),
  scoreInfoButtons: Array.from(document.querySelectorAll("[data-score-info]")),
  dashboardEmptyState: document.getElementById("dashboardEmptyState"),
  dashboardEmptyCta: document.getElementById("dashboardEmptyCta"),
  riskForm: document.getElementById("riskForm"),
  riskFormMessage: document.getElementById("riskFormMessage"),
  riskInputs: {
    journalName: document.getElementById("journalName"),
    startingBalance: document.getElementById("startingBalance"),
    balanceOverride: document.getElementById("balanceOverride"),
    dailyMaxLoss: document.getElementById("dailyMaxLoss"),
    weeklyMaxLoss: document.getElementById("weeklyMaxLoss"),
    riskPerTrade: document.getElementById("riskPerTrade"),
    equityGoal: document.getElementById("equityGoal"),
    cooldownEnabled: document.getElementById("cooldownEnabled"),
    cooldownLossStreak: document.getElementById("cooldownLossStreak")
  },
  // 1f #02 checklist editor + the causal readout it feeds.
  rulesPanel: document.getElementById("rulesPanel"),
  rulesForm: document.getElementById("rulesForm"),
  rulesEditorList: document.getElementById("rulesEditorList"),
  rulesAddBtn: document.getElementById("rulesAddBtn"),
  rulesFormMessage: document.getElementById("rulesFormMessage"),
  ruleCostList: document.getElementById("ruleCostList"),
  // 1f #03 cooldown lock.
  cooldownFieldset: document.getElementById("cooldownFieldset"),
  cooldownDialog: document.getElementById("cooldownDialog"),
  cooldownForm: document.getElementById("cooldownForm"),
  cooldownHeadline: document.getElementById("cooldownHeadline"),
  cooldownDetail: document.getElementById("cooldownDetail"),
  cooldownQuestion: document.getElementById("cooldownQuestion"),
  cooldownAnswer: document.getElementById("cooldownAnswer"),
  cooldownMessage: document.getElementById("cooldownMessage"),
  cooldownStepAwayBtn: document.getElementById("cooldownStepAwayBtn"),
  cooldownSettingsBtn: document.getElementById("cooldownSettingsBtn"),
  dashLogCooldownFlag: document.getElementById("dashLogCooldownFlag"),
  // Multi-account: the switcher exists twice (desktop top bar, mobile sidebar
  // nav) because those are different DOM at different breakpoints.
  accountSwitches: Array.from(document.querySelectorAll("[data-account-switch]")),
  accountsPanel: document.getElementById("accountsPanel"),
  accountList: document.getElementById("accountList"),
  accountAddBtn: document.getElementById("accountAddBtn"),
  accountDialog: document.getElementById("accountDialog"),
  accountDialogTitle: document.getElementById("accountDialogTitle"),
  accountForm: document.getElementById("accountForm"),
  accountFormMessage: document.getElementById("accountFormMessage"),
  accountCancelBtn: document.getElementById("accountCancelBtn"),
  propFieldset: document.getElementById("propFieldset"),
  propTrailRow: document.getElementById("propTrailRow"),
  propBasisRow: document.getElementById("propBasisRow"),
  propBasisNote: document.getElementById("propBasisNote"),
  propZeroStartNote: document.getElementById("propZeroStartNote"),
  accountFields: {
    label: document.getElementById("accountLabel"),
    firm: document.getElementById("accountFirm"),
    type: document.getElementById("accountType"),
    startingBalance: document.getElementById("accountStartingBalance"),
    currency: document.getElementById("accountCurrency"),
    preset: document.getElementById("propPreset"),
    propEnabled: document.getElementById("propEnabled"),
    profitTarget: document.getElementById("propProfitTarget"),
    drawdown: document.getElementById("propDrawdown"),
    mode: document.getElementById("propMode"),
    basis: document.getElementById("propBasis"),
    trailStops: document.getElementById("propTrailStops"),
    trailStopAt: document.getElementById("propTrailStopAt"),
    dailyLossLimit: document.getElementById("propDailyLossLimit"),
    consistencyPct: document.getElementById("propConsistencyPct"),
    maxContracts: document.getElementById("propMaxContracts"),
    flattenBy: document.getElementById("propFlattenBy"),
    confirmed: document.getElementById("propConfirmed")
  },
  // The tracker card itself.
  propTracker: document.getElementById("propTracker"),
  propAccountName: document.getElementById("propAccountName"),
  propStatus: document.getElementById("propStatus"),
  propEquity: document.getElementById("propEquity"),
  propEquityMeta: document.getElementById("propEquityMeta"),
  propMllBlock: document.getElementById("propMllBlock"),
  propMll: document.getElementById("propMll"),
  propRoom: document.getElementById("propRoom"),
  propRoomBar: document.getElementById("propRoomBar"),
  propMllMeta: document.getElementById("propMllMeta"),
  propMllMoves: document.getElementById("propMllMoves"),
  propTargetBlock: document.getElementById("propTargetBlock"),
  propTargetValue: document.getElementById("propTargetValue"),
  propTargetBar: document.getElementById("propTargetBar"),
  propTargetMeta: document.getElementById("propTargetMeta"),
  propDailyBlock: document.getElementById("propDailyBlock"),
  propDailyValue: document.getElementById("propDailyValue"),
  propDailyBar: document.getElementById("propDailyBar"),
  propDailyMeta: document.getElementById("propDailyMeta"),
  propWarning: document.getElementById("propWarning"),
  propLimits: document.getElementById("propLimits"),
  propHonesty: document.getElementById("propHonesty"),
  disciplineScore: document.getElementById("disciplineScore"),
  dailyTradingScore: document.getElementById("dailyTradingScore"),
  goalProgress: document.getElementById("goalProgress"),
  riskViolations: document.getElementById("riskViolations"),
  edgeRows: document.getElementById("edgeRows"),
  equityChart: document.getElementById("equityChart"),
  // 1f #05 equity scrub — the panel the playhead feeds.
  equityScrub: document.getElementById("equityScrub"),
  equityScrubHint: document.getElementById("equityScrubHint"),
  equityScrubPos: document.getElementById("equityScrubPos"),
  equityScrubSymbol: document.getElementById("equityScrubSymbol"),
  equityScrubNet: document.getElementById("equityScrubNet"),
  equityScrubMeta: document.getElementById("equityScrubMeta"),
  equityScrubNote: document.getElementById("equityScrubNote"),
  equityScrubShot: document.getElementById("equityScrubShot"),
  equityScrubClear: document.getElementById("equityScrubClear"),
  drawdownChart: document.getElementById("drawdownChart"),
  psychologyChart: document.getElementById("psychologyChart"),
  sessionChart: document.getElementById("sessionChart"),
  rMultipleChart: document.getElementById("rMultipleChart"),
  strategyPerformanceChart: document.getElementById("strategyPerformanceChart"),
  strategyDimensionButtons: Array.from(document.querySelectorAll("[data-performance-dimension]")),
  strategyMetricButtons: Array.from(document.querySelectorAll("[data-performance-metric]")),
  traderScoreChart: document.getElementById("traderScoreChart"),
  traderScoreValue: document.getElementById("traderScoreValue"),
  traderScoreCaption: document.getElementById("traderScoreCaption"),

  // 1b quick capture — route 1 (⌘K command bar) and routes 2/3 (the sheet).
  captureBar: document.getElementById("captureBar"),
  captureBarForm: document.getElementById("captureBarForm"),
  captureInput: document.getElementById("captureInput"),
  captureReadout: document.getElementById("captureReadout"),
  captureToSheetBtn: document.getElementById("captureToSheetBtn"),
  captureToast: document.getElementById("captureToast"),
  tradeSheet: document.getElementById("tradeSheet"),
  tradeSheetForm: document.getElementById("tradeSheetForm"),
  tradeSheetCloseBtn: document.getElementById("tradeSheetCloseBtn"),
  sheetSymbol: document.getElementById("sheetSymbol"),
  sheetEntry: document.getElementById("sheetEntry"),
  sheetStop: document.getElementById("sheetStop"),
  sheetRiskCustom: document.getElementById("sheetRiskCustom"),
  sheetDirectionButtons: Array.from(document.querySelectorAll("[data-sheet-direction]")),
  sheetRiskButtons: Array.from(document.querySelectorAll("[data-sheet-risk]")),
  sheetRulesList: document.getElementById("sheetRulesList"),
  sheetSize: document.getElementById("sheetSize"),
  sheetAtRisk: document.getElementById("sheetAtRisk"),
  sheetBudgetAfter: document.getElementById("sheetBudgetAfter"),
  sheetPips: document.getElementById("sheetPips"),
  sheetMessage: document.getElementById("sheetMessage"),
  sheetSubmitBtn: document.getElementById("sheetSubmitBtn"),
  sheetDetailBtn: document.getElementById("sheetDetailBtn"),

  // 1c close & journal — step 2 of the same <dialog>.
  journalSheetForm: document.getElementById("journalSheetForm"),
  journalSheetCloseBtn: document.getElementById("journalSheetCloseBtn"),
  journalClosedAt: document.getElementById("journalClosedAt"),
  journalSymbol: document.getElementById("journalSymbol"),
  journalMeta: document.getElementById("journalMeta"),
  journalNet: document.getElementById("journalNet"),
  journalSub: document.getElementById("journalSub"),
  journalMoodChips: document.getElementById("journalMoodChips"),
  journalGradeChips: document.getElementById("journalGradeChips"),
  journalTagChips: document.getElementById("journalTagChips"),
  journalNewTagInput: document.getElementById("journalNewTagInput"),
  journalNote: document.getElementById("journalNote"),
  journalPasteBtn: document.getElementById("journalPasteBtn"),
  journalDrop: document.getElementById("journalDrop"),
  journalShotInput: document.getElementById("journalShotInput"),
  journalSheetMessage: document.getElementById("journalSheetMessage"),
  journalSaveBtn: document.getElementById("journalSaveBtn"),

  // 1f #06 voice notes.
  journalVoiceBtn: document.getElementById("journalVoiceBtn"),
  journalVoiceState: document.getElementById("journalVoiceState"),
  journalVoiceTime: document.getElementById("journalVoiceTime"),
  journalVoiceMeter: document.getElementById("journalVoiceMeter"),
  journalVoiceLevel: document.getElementById("journalVoiceLevel"),
  journalVoicePlayer: document.getElementById("journalVoicePlayer"),
  journalVoiceActions: document.getElementById("journalVoiceActions"),
  journalVoiceDeleteBtn: document.getElementById("journalVoiceDeleteBtn"),
  journalVoiceQuota: document.getElementById("journalVoiceQuota"),
  dashJournalCta: document.getElementById("dashJournalCta"),
  dashJournalCtaCount: document.getElementById("dashJournalCtaCount"),

  tradeForm: document.getElementById("tradeForm"),
  tradeSubmitBtn: document.getElementById("tradeSubmitBtn"),
  tradeResetBtn: document.getElementById("tradeResetBtn"),
  tradeFormMessage: document.getElementById("tradeFormMessage"),
  bulkSource: document.getElementById("bulkSource"),
  bulkInput: document.getElementById("bulkInput"),
  bulkPreviewBtn: document.getElementById("bulkPreviewBtn"),
  bulkImportBtn: document.getElementById("bulkImportBtn"),
  bulkClearBtn: document.getElementById("bulkClearBtn"),
  bulkUndoBtn: document.getElementById("bulkUndoBtn"),
  bulkMessage: document.getElementById("bulkMessage"),
  bulkPreviewWrap: document.getElementById("bulkPreviewWrap"),
  bulkPreviewBody: document.getElementById("bulkPreviewBody"),
  // Admin panel markup is JS-injected into this mount only when the session
  // is an admin (ship-now #12); the handles below are bound at injection time.
  adminPanelsMount: document.getElementById("adminPanelsMount"),
  loginLogsPanel: null,
  refreshLoginLogsBtn: null,
  loginLogsMessage: null,
  loginLogsBody: null,
  adminUsersPanel: null,
  refreshAdminUsersBtn: null,
  adminUsersMessage: null,
  adminUsersBody: null,
  tradeFields: {
    tradeId: document.getElementById("tradeId"),
    tradeDate: document.getElementById("tradeDate"),
    session: document.getElementById("session"),
    market: document.getElementById("market"),
    asset: document.getElementById("asset"),
    direction: document.getElementById("direction"),
    entryPrice: document.getElementById("entryPrice"),
    stopLoss: document.getElementById("stopLoss"),
    takeProfit: document.getElementById("takeProfit"),
    exitPrice: document.getElementById("exitPrice"),
    riskPercent: document.getElementById("riskPercent"),
    positionSize: document.getElementById("positionSize"),
    tradeResult: document.getElementById("tradeResult"),
    tradeInProgress: document.getElementById("tradeInProgress"),
    setupType: document.getElementById("setupType"),
    customSetupWrap: document.getElementById("customSetupWrap"),
    customSetupType: document.getElementById("customSetupType"),
    timeframe: document.getElementById("timeframe"),
    psychology: document.getElementById("psychology"),
    executionQuality: document.getElementById("executionQuality"),
    screenshot: document.getElementById("screenshot"),
    screenshotData: document.getElementById("screenshotData"),
    screenshotLabel: document.getElementById("screenshotLabel"),
    screenshotPreview: document.getElementById("screenshotPreview"),
    tradeNotes: document.getElementById("tradeNotes")
  },
  directionButtons: Array.from(document.querySelectorAll(".direction-btn")),

  tradesBody: document.getElementById("tradesBody"),
  journalMessage: document.getElementById("journalMessage"),
  filters: {
    dateFrom: document.getElementById("filterDateFrom"),
    dateTo: document.getElementById("filterDateTo"),
    market: document.getElementById("filterMarket"),
    setup: document.getElementById("filterSetup"),
    session: document.getElementById("filterSession"),
    timeframe: document.getElementById("filterTimeframe"),
    psychology: document.getElementById("filterPsychology"),
    search: document.getElementById("filterSearch")
  },
  // 1e: the chip row replaced the Result <select> — Wins/Losses are chips now.
  reviewChips: Array.from(document.querySelectorAll(".rev-chip")),
  reviewCount: document.getElementById("reviewCount"),
  reviewNoNoteCount: document.getElementById("revNoNoteCount"),
  reviewExportBtn: document.getElementById("reviewExportBtn"),
  clearFiltersBtn: document.getElementById("clearFiltersBtn"),
  journalSortHeaders: Array.from(document.querySelectorAll("#journal th[data-sort]")),
  journalNewTradeBtn: document.getElementById("journalNewTradeBtn"),
  // Mobile tab-bar FAB. The four tab destinations need no wiring — they carry
  // .nav-btn + data-target, so ui.navButtons above already owns them.
  tabBarNewTradeBtn: document.getElementById("tabBarNewTradeBtn"),
  exportCsvBtn: document.getElementById("exportCsvBtn"),
  exportCsvBtnMobile: document.getElementById("exportCsvBtnMobile"),
  progressTradeSummary: document.getElementById("progressTradeSummary"),
  progressTradeLabel: document.getElementById("progressTradeLabel"),
  progressTradeTrack: document.getElementById("progressTradeTrack"),
  deleteFilteredBtn: document.getElementById("deleteFilteredBtn"),
  backupJsonBtn: document.getElementById("backupJsonBtn"),
  importJsonBtn: document.getElementById("importJsonBtn"),
  jsonImportInput: document.getElementById("jsonImportInput"),
  savePhpBtn: document.getElementById("savePhpBtn"),
  loadPhpBtn: document.getElementById("loadPhpBtn"),

  reflectionForm: document.getElementById("reflectionForm"),
  reflectionMessage: document.getElementById("reflectionMessage"),
  reflectionsList: document.getElementById("reflectionsList"),

  // 1f #07 weekly digest
  digestDate: document.getElementById("digestDate"),
  digestPrevBtn: document.getElementById("digestPrevBtn"),
  digestNextBtn: document.getElementById("digestNextBtn"),
  digestDraftBtn: document.getElementById("digestDraftBtn"),
  digestSummary: document.getElementById("digestSummary"),
  replaySeedNote: document.getElementById("replaySeedNote"),

  reviewMonth: document.getElementById("reviewMonth"),
  monthlyNet: document.getElementById("monthlyNet"),
  monthlyWinRate: document.getElementById("monthlyWinRate"),
  monthlyTrades: document.getElementById("monthlyTrades"),
  monthlyBestSetup: document.getElementById("monthlyBestSetup"),
  dashboardCalendarMonth: document.getElementById("dashboardCalendarMonth"),
  calendarHeading: document.getElementById("calendarHeading"),
  calendarMeta: document.getElementById("calendarMeta"),
  calendarNet: document.getElementById("calendarNet"),
  calPrevBtn: document.getElementById("calPrevBtn"),
  calNextBtn: document.getElementById("calNextBtn"),
  calendarGrid: document.getElementById("calendarGrid"),
  replayNotes: document.getElementById("replayNotes"),
  saveReplayBtn: document.getElementById("saveReplayBtn"),
  replayMessage: document.getElementById("replayMessage")
};

const tradeDisplay = createTradeDisplayHelpers({ state, calculateTradeMetrics });
const {
  formatHeroPrice,
  formatProgressTradePrice,
  formatTradeTimeline,
  formatCompactTradeDate,
  formatRecentTradeStatus,
  getClosedTradeResolution,
  parseTradeEntryDate,
  formatSignedPips,
  sortRecentTradeRowsDesc,
  sortRecentTradeRowsAsc,
  getClosedTradeToneClass,
  getRecentTradeStatusClass,
  getOpenTradePnlPercent,
  getOpenTradePriceMove,
  getOpenTradeLiveSnapshot,
  getLiveToneClass,
  formatSignedPercent,
  formatPriceMove,
  formatSignedCurrency,
  formatLivePercentLabel,
  parseIsoDate
} = tradeDisplay;

const recentTradesView = createRecentTradesView({
  state,
  ui,
  canAccessApp,
  switchView,
  setAuthIntent,
  formatCompactTradeDate,
  sortRecentTradeRowsDesc,
  formatTapePrice: (price) => formatCapturePrice(price),
  // Pip distance for a tape row's stop/target — the feed carries no market
  // field, so it is inferred from the symbol like everywhere else.
  tapePips: (trade, price) =>
    pipsBetween(trade.asset, inferMarket(trade.asset), trade.entryPrice, price)
});
const {
  renderHeroRecentTrades,
  renderDashLeonTape,
  handleRecentTradesClick,
  normalizeRecentTrades
} = recentTradesView;

// renderEquityScrub is a hoisted function declaration, so naming it here —
// above its definition and above the init() call — is safe.
const { renderCharts, clearScrub } = createChartsModule({
  ui,
  state,
  prefersReducedMotion,
  onScrub: renderEquityScrub
});

// Declared before init() so first-render code can reach them (module-level
// let/const below init() are in the temporal dead zone during the first
// render). Equity-sparkline draw-in state: the hash guard replays the
// animation only when the dataset changes, so live ticks never restart it.
let dashSparkHash = "";
let dashSparkFrame = 0;

// Declared above init() on purpose: describeJournalFilters() runs inside the
// first renderAll(), and a module-level const declared further down the file
// is in the temporal dead zone at that point and throws, aborting boot.
const QUICK_FILTER_LABELS = {
  wins: "wins",
  losses: "losses",
  rules: "rule broken",
  nonote: "not journalled"
};

// 1a balance-card range toggle. Declared here (above the module-level init()
// call) like every other module const: anything below it is in the temporal
// dead zone during the first render.
const BALANCE_RANGE_DAYS = { "1m": 30, "3m": 90, all: 0 };
const BALANCE_RANGE_LABELS = { "1m": "past 30 days", "3m": "past 90 days", all: "all time" };

// 1f #04 playbook pages. Below this many closed trades a setup's win rate,
// profit factor, average R and expectancy are noise wearing a decimal point,
// so the page withholds them and says the threshold out loud. Declared here,
// above the module-level init() call, like every other module const.
const PLAYBOOK_MIN_TRADES = 5;

/* ── 1b quick capture ──────────────────────────────────────────────────────
   Declared here, above the module-level init() call, like every other module
   const — anything below it is in the temporal dead zone during first render.

   The checklist itself now lives in settings (DEFAULT_PRE_TRADE_RULES seeds
   it) — see getPreTradeRules(). */

// Sheet state. Everything else is read straight off the inputs on demand —
// only what has no field of its own lives here.
const sheetState = {
  riskChoice: "1",       // "0.5" | "1" | "2" | "custom"
  direction: "Buy",
  rules: new Set()
};

let captureToastTimer = 0;

/* ── 1c close & journal ────────────────────────────────────────────────────
   Also above init(), same temporal-dead-zone rule.

   The mood chips are the mockup's five words; `value` is the string the
   record has always stored, so the psychology filter, the psychology chart
   and every historic trade keep working untouched. Label ≠ value on purpose
   for the last two. */
const JOURNAL_MOODS = [
  { value: "Focused", label: "Focused" },
  { value: "Hesitant", label: "Hesitant" },
  { value: "Emotional", label: "Emotional" },
  { value: "Revenge Trade", label: "Revenge" },
  { value: "Perfect Execution", label: "Perfect" }
];

const JOURNAL_GRADES = ["A+", "A", "B", "C", "F"];

// Seed vocabulary for "what went wrong". Anything the trader adds themselves
// persists by riding on the trades that carry it — see getKnownMistakeTags().
const DEFAULT_MISTAKE_TAGS = ["Entered early", "Moved stop", "Oversized", "Off-playbook"];

// localStorage is the storage target in preview mode and sessionStorage in
// demo mode; both are ~5MB for the WHOLE journal. One shared ceiling for
// every inline image, used by the trade form and the close sheet alike.
const MAX_INLINE_IMAGE_BYTES = 350 * 1024;

const journalState = {
  tradeId: "",
  psychology: "Focused",
  executionQuality: "B",
  tags: new Set(),
  screenshotName: "",
  screenshotData: ""
};

/* ── 1f #06 voice notes ────────────────────────────────────────────────────
   Above init() like everything else in this block.

   The arithmetic, because it is the whole design. Web Storage holds ~5MB for
   the WHOLE journal, and a data URL is base64 — 4 stored characters for every
   3 bytes of audio. So:

     16 kbit/s mono Opus  =  2 KB of audio per second
     60 s hard cap        =  120 KB  ->  ~160 KB of base64
     1000 KB total budget =  ~12 minutes of talking across the journal

   16 kbit/s is a voice bitrate, not a music one, and that is the point: this
   is somebody muttering "chased it after the first push" into a phone.

   Two ceilings, both enforced before the write, because a single blown
   setItem takes the whole journal down with it:
     * PER CLIP  — a browser that ignores audioBitsPerSecond gets rejected
                   with a message instead of silently eating the quota;
     * TOTAL     — the budget across every clip, checked with the clip being
                   replaced already subtracted.

   ponytail: chars, not bytes, is the honest unit here — it is what setItem
   actually consumes. IndexedDB would store the Blob raw (no base64 tax, far
   bigger quota) and is the upgrade path if 12 minutes ever stops being
   enough; it costs an async storage layer this feature does not yet need. */
const VOICE_MAX_SECONDS = 60;
const VOICE_WARN_SECONDS = 45;
const VOICE_BITS_PER_SECOND = 16000;
const VOICE_MAX_CLIP_CHARS = 200 * 1024;
const VOICE_TOTAL_CHARS = 1000 * 1024;

// Everything the recorder needs while the sheet is open. `clip` is STAGED —
// it is only written to storage when the sheet is submitted, exactly like the
// note and the screenshot, so backing out of the sheet backs out of the clip.
const voiceState = {
  clip: null,          // { data, mime, seconds } | null
  aborted: false,      // the sheet closed mid-take; throw the buffer away
  recorder: null,
  stream: null,
  audioCtx: null,
  analyser: null,
  levels: null,
  chunks: [],
  startedAt: 0,
  timerId: 0,
  frame: 0
};

/* ── 1e review + calendar ──────────────────────────────────────────────────
   Above init() like everything else here — a module-level binding below that
   call is in the temporal dead zone during first render.

   Which rows have their detail open. The table re-renders wholesale on every
   filter/sort/save, so the open set has to live outside the markup. In-memory
   only: an expansion is a glance, not a preference. */
const expandedTradeIds = new Set();

// Mood → tone, so the chip is never colour-only guesswork in the renderer.
const MOOD_TONES = {
  Focused: "is-good",
  "Perfect Execution": "is-good",
  Hesitant: "is-warn",
  Emotional: "is-bad",
  "Revenge Trade": "is-bad"
};

/* ── 1f system features ────────────────────────────────────────────────────
   Above init() like everything else here.

   #02 rule cost. A rule only gets a money verdict once BOTH sides of it have
   this many closed trades — below that the difference is noise dressed up as
   a finding, and the panel says so instead of printing a number. */
const RULE_COST_MIN_SIDE = 5;

// The checklist editor's working copy. Lives outside settings so add/remove/
// retype can be abandoned by navigating away; Save writes it to settings.
let rulesDraft = null;

/* #03 cooldown. The answer the trader typed to get past the speed bump, held
   until the trade it unlocked is written — then stamped on that trade and
   cleared. That stamp is the only record of the interaction, and it is what
   makes "how many of my cooldown overrides were revenge trades" answerable. */
let pendingCooldown = null;

// { reason, opener } while the cooldown dialog is up — the opener is the route
// the trader was taking, resumed verbatim once they answer.
let cooldownPrompt = null;

const METRIC_DELTA_SPECS = {
  accountBalance: { read: (a) => a.totalPnl, format: formatCurrency },
  totalTrades: { read: (a) => a.totalTrades, format: (v) => String(Math.round(v)), neutral: true },
  winRate: { read: (a) => a.winRate, format: (v) => `${v.toFixed(1)}%` },
  avgRR: { read: (a) => a.avgRR, format: (v) => v.toFixed(2) },
  profitFactor: {
    read: (a) => a.profitFactor,
    format: (v) => v.toFixed(2),
    skip: (current, previous) => current.profitFactor >= 999 || previous.profitFactor >= 999
  },
  currentDrawdown: { read: (a) => a.currentDrawdown, format: formatCurrency, invert: true },
  maxDrawdown: { read: (a) => a.maxDrawdown, format: formatCurrency, invert: true },
  bestDay: { read: (a) => a.bestDay.pnl, format: formatCurrency },
  worstDay: { read: (a) => a.worstDay.pnl, format: formatCurrency },
  expectancy: { read: (a) => a.expectancy, format: formatCurrency },
  winningStreak: { read: (a) => a.maxWinStreak, format: (v) => String(Math.round(v)) },
  losingStreak: { read: (a) => a.maxLossStreak, format: (v) => String(Math.round(v)), invert: true }
};

/* ── delete affordances ────────────────────────────────────────────────────
   Above init() like everything else in this block — a module-level binding
   below that call is in the temporal dead zone during the first render.

   Deleting a trading journal is the one action in this app with no natural
   recovery, so both delete routes end in the same undo window. 30s, not the
   toast's usual 5: "wait, that was the wrong filter" takes longer than five
   seconds to arrive. */
const UNDO_TOAST_MS = 30000;

// Swipe-to-reveal on a row card. The swipe only OPENS the action; the delete
// itself is a deliberate second tap through the normal confirm. A pocket
// swipe must never destroy a trade.
const SWIPE_REVEAL_PX = 56;   // travel that counts as a reveal
const SWIPE_AXIS_PX = 10;     // travel before the axis is decided
const swipeTrack = { row: null, x0: 0, y0: 0, axis: "" };
let swipedRow = null;

/* ── multi-account + prop-firm tracker ─────────────────────────────────────
   Above init() like every other module-level binding in this block. A const
   declared below the init() call is in the temporal dead zone during the first
   render and throws, which aborts boot and silently kills every listener bound
   after it. That has shipped four times; it is not shipping a fifth. */
const ACCOUNT_TYPES = [
  { id: "personal", label: "Personal" },
  { id: "evaluation", label: "Evaluation" },
  { id: "funded", label: "Funded" }
];
const ACCOUNT_TYPE_IDS = new Set(ACCOUNT_TYPES.map((type) => type.id));
const MAX_ACCOUNTS = 24;
// The account every pre-multi-account trade migrates into. Renaming this is
// cosmetic — the migration matches on "no accountId", never on this string.
const DEFAULT_ACCOUNT_LABEL = "Main";

// The account being edited in #accountDialog, or "" for a brand-new one.
let accountDraftId = "";

/* The single line that has to be true wherever a limit is shown. The app holds
   the trader's own numbers checked against the trader's own typed limits — it
   is not a source of truth on any firm's current rules, and it never sees an
   intraday tick. */
const PROP_DISCLAIMER =
  "These limits are the ones you typed in, not a firm's rule book. Confirm every figure against your own account before you trade it.";
const PROP_VISIBILITY_NOTE =
  "Computed from closed trades only. This journal never sees intraday equity or open-position P&L, so a limit that was touched and recovered from inside a session leaves no trace here.";

/* ── V3 landing: live ticker pair + scripted product demo ──────────────────
   Above init() like every other module-level binding — a const declared below
   that call is in the temporal dead zone during the first render. */
const TICKER_SYMBOLS = ["BTCUSDT", "XAUUSD"];
const TICKER_CACHE_KEY = "axiom_journal_ticker_v1";
// Last price actually rendered per symbol — the strip's delta is "vs the
// previous poll you saw", whether that came from cache or live.
const tickerShown = {};
// Every 12th 5s tick (60s) re-pulls the public feed so the Leon tape rows
// stay live, not just the prices. Skipped in preview/demo shells: their
// fetch would fail against the static server and wipe the simulated tape.
let leonFeedTick = 0;

// Scripted product demo. One deterministic timeline drives three modes:
// autoplay while the frame is on screen, replay on demand, and a static
// step-through under reduced motion. Every number in it is sample data on a
// $10,000 demo account and the frame is labelled as such — this is a replay
// of the real components, not footage and not a mock.
const LND_DEMO_COMMAND = "xauusd short 4234 sl 4244 tp 4214 0.02 lots";
const LND_DEMO_NOTE_TEXT = "Waited for the retest instead of chasing it.";
const lndDemoPlayer = {
  steps: [],
  keyframes: [],
  index: 0,
  timer: 0,
  playing: false,
  started: false,
  staticMode: false,
  ui: null
};

init();

function init() {
  const localPreview = isLocalPreviewMode();
  state.auth.landingPreviewMode = localPreview && isLocalLandingPreviewRequested();
  state.auth.previewMode = localPreview && !state.auth.landingPreviewMode;
  // Demo mode survives a reload (sessionStorage) but never a new tab. Set
  // before loadState() so the journal is read from the right storage target.
  state.auth.guestMode = !state.auth.previewMode && !state.auth.landingPreviewMode && isGuestSessionStored();
  if (state.auth.guestMode) {
    // mobileAuthVisible is settled two lines down by the reset-token check —
    // a demo tab carrying a password-reset link should still show that flow.
    state.auth.checked = true;
  }
  state.auth.resetToken = getResetTokenFromUrl();
  state.auth.resetTokenStatus = state.auth.resetToken ? "pending" : "idle";
  state.auth.mobileAuthVisible = Boolean(state.auth.resetToken);
  if (state.auth.previewMode) {
    state.auth.checked = true;
    state.auth.mobileAuthVisible = false;
  } else if (state.auth.landingPreviewMode) {
    state.auth.checked = true;
    state.auth.mobileAuthVisible = false;
  }
  applyTheme(getStoredTheme());
  loadState();
  // Reload inside a demo tab: sessionStorage still holds the journal. If it
  // somehow does not, re-seed rather than dropping the visitor into an empty app.
  if (state.auth.guestMode && state.trades.length === 0) {
    seedDemoJournal();
  }
  // 1f #06: clips whose trade no longer exists are unreachable through the UI
  // and would sit in the storage budget forever. Pruned at LOAD, never at
  // delete — the 30s delete-undo window has to be able to bring a trade and
  // its clip back together.
  pruneVoiceNotes();
  applyInitialDates();
  hydrateRiskForm();
  hydrateReviewMonth();
  updateBranding();
  updateAuthUi();
  document.body.classList.add("auth-ready");
  updateAccessGate();
  syncSetupTypeCustomField();
  syncTradeProgressState();
  bindEvents();
  syncMobileNavState();
  renderLoginLogs();
  renderAdminUsers();
  renderAll();
  renderLastSaved();
  setupScrollReveals();
  setupLandingReveals();
  setupDeckTilt();
  // Cached ticker prices paint before the first poll answers, marked stale
  // until it does; the demo player owns its own reduced-motion branch.
  setupLandingTicker();
  setupStickyDashTicker();
  setupShowcaseChooser();
  setupLandingDemo();
  startLivePriceLoop();
  // Hash router: restore the deep-linked view for preview sessions; the
  // authenticated flow restores in checkAuthSession once the gate opens.
  if (canAccessApp()) {
    const initialView = restoreRouteFromHash();
    if (initialView && initialView !== "dashboard") {
      switchView(initialView);
    }
  }
  if (state.auth.previewMode || state.auth.guestMode) {
    state.recentTrades = normalizeRecentTrades(state.trades);
    renderHeroRecentTrades();
    refreshLivePrices({ immediate: true });
    return;
  }
  if (state.auth.landingPreviewMode) {
    state.publicRecentTrades = normalizeRecentTrades(state.trades);
    renderHeroRecentTrades();
    refreshLivePrices({ immediate: true });
    return;
  }
  loadPublicRecentTrades({ silent: true });
  if (state.auth.resetToken) {
    validateResetToken();
  }
  checkAuthSession();
}

// Clay V3: dark is the primary theme, light is the stored opt-in. Must stay
// in agreement with the FOUC guard in index.html <head> or the page flashes.
function getStoredTheme() {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
  } catch (error) {
    return "dark";
  }
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "light") {
    root.setAttribute("data-theme", "light");
  } else {
    root.removeAttribute("data-theme");
  }
  ui.themeToggles.forEach((button) => {
    const next = theme === "light" ? "dark" : "light";
    // [data-theme-glyph] toggles carry a moon mark (1a top bar) — label them
    // through aria only, or the glyph gets overwritten with a word.
    if (!button.hasAttribute("data-theme-glyph")) {
      button.textContent = next === "light" ? "Light" : "Dark";
    }
    button.setAttribute("aria-label", `Switch to ${next} theme`);
  });
  window.dispatchEvent(new CustomEvent("themechange", { detail: { theme } }));
}

function toggleTheme() {
  const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch (error) {
    // Private mode: theme still flips for this session.
  }
  if (prefersReducedMotion()) {
    applyTheme(next);
    return;
  }
  document.documentElement.classList.add("theme-switching");
  applyTheme(next);
  window.setTimeout(() => {
    document.documentElement.classList.remove("theme-switching");
  }, THEME_CROSSFADE_MS);
}

function bindEvents() {
  if (ui.loginBtn) {
    ui.loginBtn.addEventListener("click", handleLogin);
  }
  if (ui.registerBtn) {
    ui.registerBtn.addEventListener("click", handleRegister);
  }
  if (ui.desktopLogoutBtn) {
    ui.desktopLogoutBtn.addEventListener("click", handleLogout);
  }
  if (ui.mobileLogoutBtn) {
    ui.mobileLogoutBtn.addEventListener("click", handleLogout);
  }
  ui.themeToggles.forEach((button) => {
    button.addEventListener("click", toggleTheme);
  });

  // The sparkline is canvas: it must be repainted when the palette flips and
  // resized when the hero's width changes (charts.js handles its own).
  window.addEventListener("themechange", () => {
    dashSparkHash = "";
    renderDashSparkline(state.analytics);
  });
  let sparkResizeTimer = 0;
  window.addEventListener("resize", () => {
    window.clearTimeout(sparkResizeTimer);
    sparkResizeTimer = window.setTimeout(() => {
      if (ui.dashSparkline) {
        drawDashSparkline(ui.dashSparkline, getScopedEquity(state.analytics), 1);
      }
    }, 150);
  });

  if (ui.authPassword) {
    ui.authPassword.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        if (state.auth.intent === "login") {
          handleLogin();
        } else {
          handleRegister();
        }
      }
    });
  }
  [ui.resetPassword, ui.resetPasswordConfirm].forEach((input) => {
    if (!input) {
      return;
    }
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handlePasswordReset();
      }
    });
  });

  if (ui.forgotPasswordBtn) {
    ui.forgotPasswordBtn.addEventListener("click", handleForgotPassword);
  }
  // 1d hero: the email is handed to the auth panel's identifier field (it takes
  // a username OR an email), so this is a real first step of sign-up rather
  // than a decorative capture box. Empty submit just opens the panel.
  if (ui.heroEmailForm) {
    ui.heroEmailForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const email = String(ui.heroEmail?.value || "").trim();
      setAuthIntent("register", { focus: !email });
      if (email && ui.authIdentifier) {
        ui.authIdentifier.value = email;
        window.setTimeout(() => ui.authPassword?.focus(), 120);
      }
    });
  }
  if (ui.authOverlay) {
    ui.authOverlay.addEventListener("click", closeLandingAuthModal);
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeLandingAuthModal();
    }
  });
  // Focus trap (§4 modals): while the landing auth modal is open, Tab cycles
  // inside the panel; Escape (above) closes and returns focus to the trigger.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || !ui.authPanel || !document.body.classList.contains("modal-open")) {
      return;
    }

    const focusables = Array.from(
      ui.authPanel.querySelectorAll("button, [href], input, select, textarea")
    ).filter((node) => !node.hidden && !node.disabled && node.offsetParent !== null);
    if (!focusables.length) {
      return;
    }

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !ui.authPanel.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !ui.authPanel.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  });
  if (ui.heroRegisterBtn) {
    ui.heroRegisterBtn.addEventListener("click", () => {
      setAuthIntent("register", { focus: true });
    });
  }
  if (ui.heroLoginBtn) {
    ui.heroLoginBtn.addEventListener("click", () => {
      setAuthIntent("login", { focus: true });
    });
  }
  if (ui.ctaRegisterBtn) {
    ui.ctaRegisterBtn.addEventListener("click", () => {
      setAuthIntent("register", { focus: true });
    });
  }
  // "See inside first" — every landing entry point into demo mode.
  ui.demoStartBtns.forEach((button) => {
    button.addEventListener("click", () => {
      enterGuestMode();
    });
  });
  if (ui.demoBannerRegisterBtn) {
    ui.demoBannerRegisterBtn.addEventListener("click", () => {
      // body.demo-signup swaps the app shell for the landing + auth modal
      // WITHOUT leaving demo mode, so the journal survives until submitAuth
      // decides what to carry over. Escape / overlay click returns to the app.
      setAuthIntent("register", { focus: true });
      window.scrollTo({ top: 0, behavior: "auto" });
    });
  }
  if (ui.demoBannerDismissBtn) {
    ui.demoBannerDismissBtn.addEventListener("click", dismissDemoNotice);
  }
  // Local preview only: real sessions get the Logout button instead, so this
  // never gives a signed-in user a way out that skips logging out.
  ui.previewLandingBtns.forEach((button) => {
    button.hidden = !state.auth.previewMode;
    button.addEventListener("click", () => {
      window.location.href = `${window.location.pathname}?landing=1`;
    });
  });
  if (ui.previewAppBtn) {
    ui.previewAppBtn.hidden = !state.auth.landingPreviewMode;
    ui.previewAppBtn.addEventListener("click", () => {
      window.location.href = window.location.pathname;
    });
  }
  if (ui.resetPasswordBtn) {
    ui.resetPasswordBtn.addEventListener("click", handlePasswordReset);
  }
  if (ui.cancelResetBtn) {
    ui.cancelResetBtn.addEventListener("click", () => clearResetTokenState(true));
  }

  if (ui.navToggleBtn) {
    ui.navToggleBtn.addEventListener("click", () => {
      toggleMobileNav();
    });
  }

  ui.navButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      switchView(btn.dataset.target);
    });
  });

  // Hash router: back/forward and hand-edited hashes route through switchView
  // so is-active/aria-current stay in sync. An empty hash means dashboard.
  window.addEventListener("hashchange", () => {
    if (!canAccessApp()) {
      return;
    }
    const id = getViewFromHash() || (window.location.hash ? "" : "dashboard");
    if (!id) {
      return;
    }
    // #playbook/<setup>: two setup pages share one view, so back/forward
    // between them is a hash change the isViewActive() guard would swallow.
    const setup = id === "playbook" ? getPlaybookSetupFromHash() : "";
    const setupChanged = Boolean(setup) && setup !== state.playbook.setup;
    if (setupChanged) {
      state.playbook.setup = setup;
    }
    if (setupChanged || !isViewActive(id)) {
      switchView(id);
    }
  });

  // Click-to-sort journal headers (Enter/Space for keyboard).
  ui.journalSortHeaders.forEach((th) => {
    th.addEventListener("click", () => handleJournalSort(th.dataset.sort));
    th.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleJournalSort(th.dataset.sort);
      }
    });
  });

  // Score-formula info popover: native <dialog>, Escape closes for free.
  ui.scoreInfoButtons.forEach((button) => {
    button.addEventListener("click", () => {
      ui.scoreInfoDialog?.showModal();
    });
  });
  if (ui.scoreInfoDialog) {
    ui.scoreInfoDialog.querySelector("[data-score-info-close]")?.addEventListener("click", () => {
      ui.scoreInfoDialog.close();
    });
    ui.scoreInfoDialog.addEventListener("click", (event) => {
      if (event.target === ui.scoreInfoDialog) {
        ui.scoreInfoDialog.close();
      }
    });
  }

  ui.riskForm.addEventListener("submit", handleRiskSubmit);
  ui.tradeForm.addEventListener("submit", handleTradeSubmit);
  ui.tradeResetBtn.addEventListener("click", () => resetTradeForm(false));
  // Segmented Long/Short control drives the hidden native select, so every
  // existing read/write of ui.tradeFields.direction keeps working.
  ui.directionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (ui.tradeFields.direction) {
        ui.tradeFields.direction.value = button.dataset.direction || "Buy";
      }
      syncDirectionToggle();
    });
  });
  syncDirectionToggle();
  ui.tradeFields.setupType.addEventListener("change", syncSetupTypeCustomField);
  ui.tradeFields.tradeInProgress.addEventListener("change", syncTradeProgressState);
  ui.tradeFields.screenshot.addEventListener("change", handleScreenshotUpload);
  if (ui.recentTradesList) {
    ui.recentTradesList.addEventListener("click", handleRecentTradesClick);
  }
  if (ui.progressTradeTrack) {
    ui.progressTradeTrack.addEventListener("click", handleProgressTradeDetailsToggle);
  }
  if (ui.bulkPreviewBtn) {
    ui.bulkPreviewBtn.addEventListener("click", handleBulkPreview);
  }
  if (ui.bulkImportBtn) {
    // Pending flash before the synchronous parse so large pastes show
    // feedback; the timeout lets the label paint first.
    ui.bulkImportBtn.addEventListener("click", () => {
      setPendingState(ui.bulkImportBtn, true, "Importing…");
      window.setTimeout(() => {
        try {
          handleBulkImport();
        } finally {
          setPendingState(ui.bulkImportBtn, false);
        }
      }, 0);
    });
  }
  if (ui.bulkClearBtn) {
    ui.bulkClearBtn.addEventListener("click", clearBulkImport);
  }
  if (ui.bulkUndoBtn) {
    ui.bulkUndoBtn.addEventListener("click", undoLastImport);
  }
  // Admin refresh buttons are bound inside ensureAdminPanels() at injection.

  document.querySelectorAll(".copy-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const original = "Copy";
      try {
        await navigator.clipboard.writeText(button.dataset.copy || "");
        button.textContent = "Copied";
      } catch (error) {
        button.textContent = "Copy failed";
      }
      window.setTimeout(() => {
        button.textContent = original;
      }, 1500);
    });
  });

  Object.values(ui.filters).forEach((input) => {
    input.addEventListener("input", handleFilterChange);
    input.addEventListener("change", handleFilterChange);
  });

  ui.clearFiltersBtn.addEventListener("click", clearFilters);
  ui.tradesBody.addEventListener("click", handleTradeTableClick);
  bindRowSwipe();

  // 1e review chips + header Export.
  ui.reviewChips.forEach((chip) => {
    chip.addEventListener("click", () => setQuickFilter(chip.dataset.quick));
  });
  ui.reviewExportBtn?.addEventListener("click", exportTradesCsv);

  // 1b: the primary path is capture, not the form. "Log a trade" advertises
  // ⌘K, so it opens exactly what ⌘K opens; the FAB and the empty-state CTA go
  // straight to the sheet (route 3 — the FAB expands in place, it no longer
  // navigates). The full form stays reachable via Add detail / Edit / the nav.
  // 1f #03: all three go through requestTradeCapture(), which is where the
  // cooldown speed bump lives.
  ui.journalNewTradeBtn.addEventListener("click", () => requestTradeCapture(openQuickCapture));
  ui.tabBarNewTradeBtn?.addEventListener("click", () => requestTradeCapture(() => openTradeSheet()));
  ui.dashboardEmptyCta?.addEventListener("click", () => requestTradeCapture(() => openTradeSheet()));
  bindQuickCapture();
  ui.exportCsvBtn.addEventListener("click", exportTradesCsv);
  ui.exportCsvBtnMobile?.addEventListener("click", exportTradesCsv);

  // --- 1a dashboard wiring -------------------------------------------------
  ui.balanceRangeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.dashboard.balanceRange = button.dataset.balanceRange || "1m";
      syncBalanceRangeButtons();
      renderBalanceCard(state.analytics);
    });
  });

  // 1f #05: the way back out of a scrub without a keyboard. Escape does the
  // same job while the curve has focus; the charts module owns both.
  ui.equityScrubClear?.addEventListener("click", () => {
    clearScrub();
    ui.equityChart?.focus();
  });

  // Both "Rules" routes land on the risk budgets that drive the consequence
  // line. Phase 6 replaces this target with the cooldown feature itself.
  // 1f: RULES is the checklist you write once; "Cooldown rules →" is the lock
  // that acts on the budgets. Two destinations, two links.
  ui.riskRulesBtn?.addEventListener("click", () => {
    switchView("dashboard");
    scrollDashboardTo(ui.rulesPanel);
  });
  [ui.cooldownRulesBtn, ui.cooldownSettingsBtn].forEach((button) => {
    button?.addEventListener("click", () => {
      ui.cooldownDialog?.close();
      cooldownPrompt = null;
      switchView("dashboard");
      scrollDashboardTo(ui.cooldownFieldset || ui.riskForm);
    });
  });

  // 1f #02 checklist editor.
  ui.rulesForm?.addEventListener("submit", handleRulesSubmit);
  ui.rulesAddBtn?.addEventListener("click", handleRulesAdd);
  ui.rulesEditorList?.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-rule-remove]");
    if (remove) {
      handleRulesRemove(Number(remove.dataset.ruleRemove));
    }
  });

  // --- multi-account + prop tracker ---------------------------------------
  ui.accountSwitches.forEach((select) => {
    select.addEventListener("change", () => switchAccount(select.value));
  });
  ui.accountList?.addEventListener("click", handleAccountsPanelClick);
  ui.accountAddBtn?.addEventListener("click", () => openAccountDialog(""));
  ui.accountForm?.addEventListener("submit", handleAccountSubmit);
  ui.accountCancelBtn?.addEventListener("click", () => ui.accountDialog?.close());
  ui.accountDialog?.addEventListener("close", () => {
    accountDraftId = "";
  });
  ui.accountFields.preset?.addEventListener("change", (event) => applyPropPreset(event.target.value));
  // Enabling prop rules, or switching between a trailing and a static limit,
  // changes which fields are even meaningful — so the form follows immediately
  // rather than leaving contradictory controls live.
  [
    ui.accountFields.propEnabled,
    ui.accountFields.mode,
    ui.accountFields.basis,
    ui.accountFields.startingBalance
  ].forEach((field) => {
    field?.addEventListener("change", syncAccountDialogState);
  });
  ui.accountFields.startingBalance?.addEventListener("input", syncAccountDialogState);
  // Any hand-edit of a prefilled figure means it is no longer the preset's
  // number, and the tracker must stop calling it one.
  [
    ui.accountFields.profitTarget,
    ui.accountFields.drawdown,
    ui.accountFields.dailyLossLimit,
    ui.accountFields.trailStopAt,
    ui.accountFields.maxContracts
  ].forEach((field) => {
    field?.addEventListener("input", () => {
      if (ui.accountFields.preset && ui.accountFields.preset.value !== "custom") {
        ui.accountFields.preset.value = "custom";
      }
    });
  });

  // 1f #03 cooldown dialog.
  ui.cooldownForm?.addEventListener("submit", handleCooldownSubmit);
  ui.cooldownStepAwayBtn?.addEventListener("click", handleCooldownStepAway);
  // Esc / backdrop dismissal is a "step away" too — it must not leave a stale
  // prompt holding an opener.
  ui.cooldownDialog?.addEventListener("close", () => {
    cooldownPrompt = null;
  });
  // 1f #04: "All setups →" opens the playbook, landing on whichever setup is
  // already selected (busiest one on a first visit). Every other door into a
  // setup page — the playbook tiles, the Edge Detection rows, the picker chips
  // — carries the same attribute, so one delegated listener covers them all,
  // including the markup renderPlaybookPage() rebuilds on every pass.
  ui.allSetupsBtn?.addEventListener("click", () => {
    openPlaybook("");
  });
  document.addEventListener("click", (event) => {
    const link = event.target.closest("[data-playbook-setup]");
    if (link) {
      openPlaybook(link.dataset.playbookSetup);
    }
  });
  ui.playbookBackBtn?.addEventListener("click", () => {
    switchView("dashboard");
    scrollDashboardTo(ui.dashPlaybook);
  });
  ui.playbookJournalBtn?.addEventListener("click", openPlaybookInJournal);
  // 1c: every route into the queue opens the same close sheet for that trade.
  ui.dashUnjournalledList?.addEventListener("click", (event) => {
    const row = event.target.closest("[data-unjournalled-trade]");
    if (row) {
      openJournalSheet(row.dataset.unjournalledTrade);
    }
  });
  // Mobile: one pill instead of the row list, pointed at the oldest trade
  // still waiting. Saving advances the queue, so repeated taps clear it.
  ui.dashJournalCta?.addEventListener("click", () => {
    const pending = getUnjournalledTrades();
    openJournalSheet(pending[pending.length - 1]?.id);
  });
  // Overflow menu is a <details>; close it on outside click and on Escape.
  if (ui.topnavMore) {
    document.addEventListener("click", (event) => {
      if (ui.topnavMore.open && !ui.topnavMore.contains(event.target)) {
        ui.topnavMore.open = false;
      }
    });
    ui.topnavMore.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        ui.topnavMore.open = false;
        ui.topnavMore.querySelector("summary")?.focus();
      }
    });
    ui.topnavMore.addEventListener("click", (event) => {
      if (event.target.closest(".topnav-menu-item")) {
        ui.topnavMore.open = false;
      }
    });
  }
  // The greeting carries a live session countdown; a minute tick is enough.
  window.setInterval(renderGreeting, 60000);
  ui.backupJsonBtn.addEventListener("click", exportBackupJson);
  ui.deleteFilteredBtn?.addEventListener("click", deleteFilteredTrades);
  ui.importJsonBtn.addEventListener("click", () => ui.jsonImportInput.click());
  ui.jsonImportInput.addEventListener("change", importBackupJson);

  ui.savePhpBtn.addEventListener("click", async () => {
    setPendingState(ui.savePhpBtn, true, "Saving…");
    try {
      await saveToPhpStorage();
    } finally {
      setPendingState(ui.savePhpBtn, false);
    }
  });
  ui.loadPhpBtn.addEventListener("click", async () => {
    setPendingState(ui.loadPhpBtn, true, "Loading…");
    try {
      await loadFromPhpStorage();
    } finally {
      setPendingState(ui.loadPhpBtn, false);
    }
  });

  ui.strategyDimensionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.dashboard.performanceDimension = button.dataset.performanceDimension || "setup";
      renderCharts(state.analytics);
    });
  });

  ui.strategyMetricButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.dashboard.performanceMetric = button.dataset.performanceMetric || "pnl";
      renderCharts(state.analytics);
    });
  });

  ui.reflectionForm.addEventListener("submit", handleReflectionSubmit);

  // 1f #07. The digest fills the reflection form; the form saves it. One save
  // path, not two. dataset.weekOf is the only thing that marks a saved entry
  // as a weekly digest, so retyping the date by hand drops the mark rather
  // than filing a hand-written Tuesday note as week 31's review.
  ui.digestDraftBtn?.addEventListener("click", applyWeeklyDigest);
  ui.digestPrevBtn?.addEventListener("click", () => stepDigestWeek(-7));
  ui.digestNextBtn?.addEventListener("click", () => stepDigestWeek(7));
  ui.digestDate?.addEventListener("change", renderDigestSummary);
  document.getElementById("reflectionDate")?.addEventListener("change", () => {
    delete ui.reflectionForm.dataset.weekOf;
  });

  ui.reviewMonth.addEventListener("change", renderMonthlyReview);
  ui.dashboardCalendarMonth.addEventListener("change", renderCalendarView);
  ui.calPrevBtn?.addEventListener("click", () => stepCalendarMonth(-1));
  ui.calNextBtn?.addEventListener("click", () => stepCalendarMonth(1));
  if (ui.calendarGrid) {
    ui.calendarGrid.addEventListener("click", handleCalendarDayClick);
  }
  ui.saveReplayBtn.addEventListener("click", saveReplayNotes);

  // Clear pnl-tick classes once the flash finishes so the next change replays.
  document.addEventListener("animationend", (event) => {
    if (event.animationName === "tickUp" || event.animationName === "tickDown") {
      event.target.classList.remove("tick-up", "tick-down");
    }
    if (event.animationName === "formShake") {
      event.target.classList.remove("form-shake");
    }
  });

  window.addEventListener("resize", debounce(() => {
    if (!isCompactAuthViewport()) {
      state.auth.mobileAuthVisible = true;
    }
    updateAuthUi();
    if (state.analytics) {
      renderCharts(state.analytics);
    }
    syncMobileNavState();
  }, 120));

  window.addEventListener("keydown", (event) => {
    const mobile = isMobileViewport();
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === "s") {
      if (mobile) {
        return;
      }
      if (isViewActive("trade-entry")) {
        event.preventDefault();
        ui.tradeForm.requestSubmit();
      }
    }

    // 1b route 1: ⌘K is the command bar. On a touch viewport there is no
    // keyboard to type a command line into, so it opens the sheet instead.
    if (mod && event.key.toLowerCase() === "k") {
      if (!canAccessApp()) {
        return;
      }
      event.preventDefault();
      requestTradeCapture(openQuickCapture);
    }

    if (!mod && event.key === "/") {
      if (mobile || !canAccessApp()) {
        return;
      }
      event.preventDefault();
      switchView("journal");
      ui.filters.search.focus();
    }

    if (event.key === "Escape") {
      toggleMobileNav(false);
    }
  });

  document.addEventListener("click", (event) => {
    if (!isMobileViewport()) {
      return;
    }

    if (!ui.sidebar) {
      return;
    }

    // The scrim is .sidebar::after, so its taps target .sidebar itself — that
    // is an OUTSIDE tap even though contains() says otherwise. Everything else
    // inside the rail or the sheet (both DOM descendants of #sidebar, fixed
    // position or not) still counts as inside.
    if (event.target !== ui.sidebar && ui.sidebar.contains(event.target)) {
      return;
    }

    toggleMobileNav(false);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      refreshLivePrices({ immediate: true });
    }
  });
}

function switchView(id) {
  if (!canAccessApp()) {
    setMessage(ui.authMessage, "Login first to open the dashboard.", "error");
    updateAccessGate();
    return;
  }

  ui.navButtons.forEach((btn) => {
    const isActive = btn.dataset.target === id;
    btn.classList.toggle("is-active", isActive);
    // [data-nav-silent] routes (the TJ mark) share a destination with a real
    // nav item — two aria-current="page" in one nav is a screen-reader bug.
    if (isActive && !btn.hasAttribute("data-nav-silent")) {
      btn.setAttribute("aria-current", "page");
    } else {
      btn.removeAttribute("aria-current");
    }
  });

  ui.views.forEach((view) => {
    view.classList.toggle("is-active", view.id === id);
  });

  // 1f #04: the playbook page IS its data, so render before it is shown — and
  // force a chart repaint, because its canvas had no layout width while the
  // view was hidden and would otherwise paint at the 900px fallback. Runs
  // before the hash sync below: renderPlaybookPage() settles which setup is
  // actually on screen, and that setup is half of the URL.
  if (id === "playbook") {
    renderPlaybookPage();
    if (state.analytics) {
      renderCharts(state.analytics, { force: true });
    }
  }

  // Hash router: keep location.hash in sync so refresh/back/forward restore
  // the view. The first programmatic set uses replaceState so page load does
  // not burn a history entry; later switches push normally.
  const target = viewHash(id);
  if (window.location.hash !== `#${target}`) {
    if (window.location.hash) {
      window.location.hash = target;
    } else {
      try {
        window.history.replaceState(null, "", `#${target}`);
      } catch (error) {
        window.location.hash = target;
      }
    }
  }

  if (isMobileViewport()) {
    toggleMobileNav(false);
  }

  // Dismissing the demo notice hides it for the view you are on, not forever —
  // it has to be honest on every screen, so navigation brings it back.
  if (state.auth.guestMode) {
    state.auth.guestNoticeDismissed = false;
    syncDemoNotice();
  }
}

// Two-segment hashes: "#playbook/<setup>" is a view id plus a page argument.
// Every other route is still a bare view id, so the split is a no-op for them.
function viewHash(id) {
  return id === "playbook" && state.playbook.setup
    ? `${id}/${encodeURIComponent(state.playbook.setup)}`
    : id;
}

function getViewFromHash() {
  const id = window.location.hash.replace(/^#/, "").split("/")[0];
  return id && ui.views.some((view) => view.id === id) ? id : "";
}

function getPlaybookSetupFromHash() {
  const parts = window.location.hash.replace(/^#/, "").split("/");
  if (parts[0] !== "playbook") {
    return "";
  }
  try {
    // A setup name may legitimately contain "/", so the tail rejoins.
    return decodeURIComponent(parts.slice(1).join("/"));
  } catch (error) {
    return "";
  }
}

// The deep-link route: view id plus, for a playbook link, the setup segment,
// so a pasted or refreshed #playbook/Breakout lands on Breakout's page rather
// than on whichever setup happens to be busiest.
function restoreRouteFromHash() {
  const id = getViewFromHash();
  const setup = id === "playbook" ? getPlaybookSetupFromHash() : "";
  if (setup) {
    state.playbook.setup = setup;
  }
  return id;
}

function isMobileViewport() {
  return window.matchMedia("(max-width: 1024px)").matches;
}

function isCompactAuthViewport() {
  return window.matchMedia("(max-width: 760px)").matches;
}

function toggleMobileNav(forceState) {
  if (!ui.sidebar || !ui.navToggleBtn || !isMobileViewport()) {
    return;
  }

  const isOpen = ui.sidebar.classList.contains("nav-open");
  const nextState = typeof forceState === "boolean" ? forceState : !isOpen;
  if (nextState === isOpen) {
    return;
  }
  ui.sidebar.classList.toggle("nav-open", nextState);
  ui.navToggleBtn.classList.toggle("is-open", nextState);
  ui.navToggleBtn.setAttribute("aria-expanded", String(nextState));

  // The focus trap is the platform's own. With .content inert, Tab cycles
  // exactly the chrome that is still live: the rail, the sheet, and the tab
  // bar + FAB — which is the correct trap here precisely BECAUSE the dock
  // stays tappable. A strict wrap-around trap that excluded the dock would
  // contradict the whole design. Cleared again in syncMobileNavState(), so a
  // rotate to desktop width can never strand the app inert.
  if (ui.appContent) {
    ui.appContent.inert = nextState;
  }
  if (nextState) {
    ui.mainNav?.querySelector("button:not([hidden]):not(:disabled)")?.focus();
  } else {
    ui.navToggleBtn.focus();
  }
}

function syncMobileNavState() {
  if (!ui.sidebar || !ui.navToggleBtn) {
    return;
  }

  if (!isMobileViewport()) {
    ui.sidebar.classList.remove("nav-open");
    ui.navToggleBtn.classList.remove("is-open");
    ui.navToggleBtn.setAttribute("aria-expanded", "false");
    if (ui.appContent) {
      ui.appContent.inert = false;
    }
  }
}

// The rail's one live number. Tri-state, resolved in this order:
//   1. a prop account with a drawdown limit  -> ROOM
//   2. no prop, but a personal daily limit   -> DAY LEFT
//   3. neither                               -> hidden, and the rail reclaims
//      the width. It never invents a limit nobody entered, which is the rule
//      renderPropTracker() already follows.
// Never rendered to a visitor who is not in the app — a $0.00 on the chrome of
// a logged-out page reads as broken, not as empty.
function renderNavRisk() {
  if (!ui.navRiskGroove) {
    return;
  }

  const prop = canAccessApp() ? getActivePropEvaluation() : null;
  let label = null;
  let value = 0;
  let used = 0;
  let tone = "";

  if (prop && prop.room !== null) {
    const span = prop.rules.drawdown > 0 ? prop.rules.drawdown : 1;
    label = prop.room <= 0 ? "Breached" : "Room";
    value = prop.room;
    used = clamp(1 - prop.room / span, 0, 1);
    const pressure = mllPressure(prop, typicalLossSize());
    tone = prop.room <= 0 ? "is-breach" : pressure.level === "warn" ? "is-warn" : "";
  } else if (canAccessApp()) {
    const left = getDailyBudgetLeft();
    if (left !== null) {
      const limit = state.settings.dailyMaxLoss;
      label = "Day left";
      value = left;
      used = clamp(1 - left / limit, 0, 1);
      tone = used >= 1 ? "is-breach" : used >= 0.75 ? "is-warn" : "";
    }
  }

  ui.navRiskGroove.hidden = label === null;
  if (label === null) {
    return;
  }
  setText(ui.navRiskLabel, label);
  setText(ui.navRiskValue, formatCurrency(value));
  ui.navRiskGroove.style.setProperty("--risk-used", String(used));
  ui.navRiskGroove.className = `rail-groove ${tone}`.trim();
}

function isLocalPreviewMode() {
  // Auth bypass is dev-only: plain-http localhost (how the app is previewed
  // without a DB) or an explicit ?preview=1 opt-in persisted for the tab session.
  const { protocol, hostname } = window.location;
  const isLocalHostname =
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "::1";
  if (protocol === "file:" || (isLocalHostname && protocol === "http:")) {
    return true;
  }

  try {
    const params = new URLSearchParams(window.location.search);
    const requested = String(params.get("preview") || "").trim().toLowerCase();
    if (requested === "1" || requested === "true" || requested === "yes") {
      window.sessionStorage.setItem(LOCAL_PREVIEW_STORAGE_KEY, "1");
    }
    return window.sessionStorage.getItem(LOCAL_PREVIEW_STORAGE_KEY) === "1";
  } catch (error) {
    return false;
  }
}

function isLocalLandingPreviewRequested() {
  try {
    const params = new URLSearchParams(window.location.search);
    const value = String(params.get("landing") || "").trim().toLowerCase();
    return value === "1" || value === "true" || value === "yes";
  } catch (error) {
    return false;
  }
}

function canAccessApp() {
  return state.auth.previewMode || state.auth.guestMode || (state.auth.checked && state.auth.isAuthenticated);
}

/* ---- Demo mode lifecycle -------------------------------------------------
   Enter → seed (or rehydrate) an ephemeral journal and open the app.
   Exit   → wipe sessionStorage, reload the real localStorage journal, land
            back on the marketing shell. isAuthenticated is never touched. */

function isGuestSessionStored() {
  try {
    return window.sessionStorage.getItem(GUEST_MODE_KEY) === "1";
  } catch (error) {
    return false;
  }
}

function enterGuestMode() {
  state.auth.guestMode = true;
  state.auth.guestNoticeDismissed = false;
  state.auth.checked = true;
  state.auth.mobileAuthVisible = false;
  state.auth.landingPreviewMode = false;
  cancelServerAutosave();
  try {
    window.sessionStorage.setItem(GUEST_MODE_KEY, "1");
  } catch (error) {
    // Private mode: demo still runs, it just cannot survive a reload.
  }

  // Re-entering an existing demo tab keeps whatever the visitor already logged.
  loadState();
  if (state.trades.length === 0) {
    seedDemoJournal();
  }

  state.recentTrades = normalizeRecentTrades(state.trades);
  state.publicRecentTrades = [];
  state.loginLogs = [];
  state.adminUsers = [];
  hydrateRiskForm();
  hydrateReviewMonth();
  resetTradeForm(false);
  clearFilters();
  updateBranding();
  updateAuthUi();
  updateAccessGate();
  syncDemoNotice();
  renderAll();
  renderLastSaved();
  renderHeroRecentTrades();
  switchView("dashboard");
  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  refreshLivePrices({ immediate: true });
}

// Drops the demo flag and every ephemeral key. Does NOT re-render — callers
// decide what happens next (exit to landing, or continue into an auth flow).
function clearGuestMode() {
  state.auth.guestMode = false;
  state.auth.guestNoticeDismissed = false;
  try {
    window.sessionStorage.removeItem(GUEST_MODE_KEY);
    Object.values(STORAGE_KEYS).forEach((key) => {
      window.sessionStorage.removeItem(`${GUEST_KEY_PREFIX}${key}`);
    });
  } catch (error) {
    // Nothing to clear.
  }
  syncDemoNotice();
}

function exitGuestMode() {
  clearGuestMode();
  loadState();
  state.auth.checked = true;
  state.auth.mobileAuthVisible = false;
  state.recentTrades = [];
  state.marketData.currentPrices = {};
  hydrateRiskForm();
  hydrateReviewMonth();
  clearFilters();
  updateAuthUi();
  updateAccessGate();
  renderAll();
  renderLastSaved();
  loadPublicRecentTrades({ silent: true });
  window.scrollTo({ top: 0, behavior: "auto" });
}

// Everything the visitor added themselves — the seeded sample rows are
// filtered out by batch id / tag so a new account never inherits fabricated
// trading history.
function collectGuestOwnWork() {
  return {
    trades: state.trades.filter((trade) => trade.importBatchId !== DEMO_BATCH_ID),
    reflections: state.reflections.filter((entry) => !entry.tags.includes(DEMO_REFLECTION_TAG))
  };
}

// Called from submitAuth BEFORE the account exists: takes the visitor's own
// work out of the demo, tears the demo down, and restores whatever real
// journal was in localStorage so the normal auth path behaves as usual.
function takeGuestCarryOver() {
  if (!state.auth.guestMode) {
    return null;
  }
  const carry = collectGuestOwnWork();
  clearGuestMode();
  loadState();
  return carry;
}

function applyGuestCarryOver(carry) {
  if (!carry || (carry.trades.length === 0 && carry.reflections.length === 0)) {
    return 0;
  }
  const existingIds = new Set(state.trades.map((trade) => trade.id));
  // The demo journal has its own account list, so a carried row's accountId
  // points at an account that does not exist in the real journal. Re-stamping
  // it onto the active account is what puts the carried work where the trader
  // is actually looking.
  const added = carry.trades
    .filter((trade) => !existingIds.has(trade.id))
    .map((trade) => ({ ...trade, accountId: state.settings?.activeAccountId || "" }));
  state.trades = state.trades.concat(added);
  const existingReflectionIds = new Set(state.reflections.map((entry) => entry.id));
  state.reflections = state.reflections.concat(
    carry.reflections.filter((entry) => !existingReflectionIds.has(entry.id))
  );
  return added.length;
}

/* ---- The persistent, honest demo notice ---------------------------------- */

function syncDemoNotice() {
  if (!ui.demoBanner) {
    return;
  }
  ui.demoBanner.hidden = !state.auth.guestMode || state.auth.guestNoticeDismissed;
}

function dismissDemoNotice() {
  state.auth.guestNoticeDismissed = true;
  syncDemoNotice();
}

// Surfaced at the moments persistence would have mattered: saving a trade,
// exporting, or reaching for the server Save/Load buttons. Brings the banner
// back even if it was dismissed — dismissal is per-moment, not forever.
function nudgeGuest(target, message) {
  state.auth.guestNoticeDismissed = false;
  syncDemoNotice();
  if (target) {
    setMessage(target, message ? `${message} ${DEMO_NOTICE}` : DEMO_NOTICE, "notice");
  }
}

/* ---- Sample journal ------------------------------------------------------
   Generated from DEMO_* specs above: 16 closed trades over four weeks plus
   one open XAUUSD position so the live ticker has something to price, and two
   reflections. Every row is labelled SAMPLE DATA in its notes and carries the
   DEMO_BATCH_ID so it can never be mistaken for — or carried over as — real
   trading history. */
function seedDemoJournal() {
  const demo = buildDemoJournal();
  state.settings = normalizeSettings(DEFAULT_SETTINGS);
  state.otherTrades = [];
  state.reflections = normalizeReflections(demo.reflections);
  state.replayNotes = {};
  // The demo gets the same one-account migration a real journal gets, so the
  // switcher and the accounts panel are honest in demo mode too.
  applyActiveAccount();
  adoptAllTrades(normalizeTrades(demo.trades));
  persistState({ skipServerSync: true });
}

function buildDemoJournal() {
  const roundTo = (value, decimals) => Number(value.toFixed(decimals));
  const dayIso = (daysAgo) => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - daysAgo);
    return toDateInputValue(date);
  };

  const trades = DEMO_OUTCOMES_R.map((outcomeR, index) => {
    const instrument = DEMO_INSTRUMENTS[index % DEMO_INSTRUMENTS.length];
    const isBuy = index % 3 !== 1;
    const dir = isBuy ? 1 : -1;
    // A little deterministic drift so 16 rows are not all at one price.
    const entry = roundTo(
      instrument.entry * (1 + ((index % 7) - 3) * 0.0025),
      instrument.decimals
    );
    const stop = roundTo(entry - dir * instrument.stopDistance, instrument.decimals);
    const target = roundTo(entry + dir * instrument.stopDistance * 2.2, instrument.decimals);
    const exit = roundTo(entry + dir * instrument.stopDistance * outcomeR, instrument.decimals);
    const date = dayIso(DEMO_DAYS_AGO[index]);

    return {
      id: `${DEMO_BATCH_ID}-${index}`,
      createdAt: `${date}T09:00:00.000Z`,
      closedAt: `${date}T14:30:00.000Z`,
      updatedAt: `${date}T14:30:00.000Z`,
      date,
      session: DEMO_SESSIONS[index % DEMO_SESSIONS.length],
      market: instrument.market,
      asset: instrument.asset,
      direction: isBuy ? "Buy" : "Sell",
      entryPrice: entry,
      stopLoss: stop,
      takeProfit: target,
      exitPrice: exit,
      riskPercent: 1,
      positionSize: instrument.size,
      tradeResult: "Auto",
      status: "closed",
      setupType: DEMO_SETUPS[index % DEMO_SETUPS.length],
      timeframe: DEMO_TIMEFRAMES[index % DEMO_TIMEFRAMES.length],
      psychology: DEMO_PSYCHOLOGY[index % DEMO_PSYCHOLOGY.length],
      executionQuality: DEMO_EXECUTION[index % DEMO_EXECUTION.length],
      importBatchId: DEMO_BATCH_ID,
      // SAMPLE checklist history, so the rule-cost report has something to
      // report in demo mode. Every row here is already flagged as sample data
      // by DEMO_BATCH_ID and by the note prefix — the skip pattern is
      // deterministic, not a claim about anyone's trading.
      preTradeRulesAsked: DEFAULT_PRE_TRADE_RULES.map((rule) => rule.id),
      preTradeRules: DEFAULT_PRE_TRADE_RULES.map((rule) => rule.id).filter(
        (id) => !(index % 3 === 1 && id === "no-news")
      ),
      notes:
        outcomeR > 0
          ? `${DEMO_TRADE_NOTE_PREFIX} plan followed, target hit at ${outcomeR}R.`
          : outcomeR === 0
            ? `${DEMO_TRADE_NOTE_PREFIX} scratched at break even when momentum stalled.`
            : `${DEMO_TRADE_NOTE_PREFIX} stop taken cleanly, no averaging down.`
    };
  });

  const openDate = dayIso(0);
  const openInstrument = DEMO_INSTRUMENTS[2];
  trades.push({
    id: `${DEMO_BATCH_ID}-open`,
    createdAt: `${openDate}T08:15:00.000Z`,
    closedAt: "",
    updatedAt: `${openDate}T08:15:00.000Z`,
    date: openDate,
    session: "London",
    market: openInstrument.market,
    asset: openInstrument.asset,
    direction: "Buy",
    entryPrice: openInstrument.entry,
    stopLoss: openInstrument.entry - openInstrument.stopDistance,
    takeProfit: openInstrument.entry + openInstrument.stopDistance * 3,
    exitPrice: 0,
    riskPercent: 1,
    positionSize: 0.05,
    tradeResult: "Auto",
    status: "open",
    setupType: "Trend Continuation",
    timeframe: "H1",
    psychology: "Focused",
    executionQuality: "A",
    importBatchId: DEMO_BATCH_ID,
    preTradeRulesAsked: DEFAULT_PRE_TRADE_RULES.map((rule) => rule.id),
    preTradeRules: DEFAULT_PRE_TRADE_RULES.map((rule) => rule.id),
    notes: `${DEMO_TRADE_NOTE_PREFIX} open position, priced live so you can watch the P&L move.`
  });

  const reflections = [
    {
      id: `${DEMO_BATCH_ID}-reflection-1`,
      date: dayIso(6),
      wentWell: "Waited for the London sweep instead of chasing the Asia range.",
      mistake: "Moved the stop up too early on the second GBPUSD entry.",
      followRules: "Yes",
      improveTomorrow: "Let the runner breathe until the session high is taken.",
      tags: [DEMO_REFLECTION_TAG],
      createdAt: `${dayIso(6)}T18:00:00.000Z`
    },
    {
      id: `${DEMO_BATCH_ID}-reflection-2`,
      date: dayIso(2),
      wentWell: "Stopped after the daily loss limit instead of trading it back.",
      mistake: "Took an unplanned scalp out of boredom in the New York lull.",
      followRules: "Partially",
      improveTomorrow: "One setup per session. Close the platform after the second loss.",
      tags: [DEMO_REFLECTION_TAG],
      createdAt: `${dayIso(2)}T18:00:00.000Z`
    }
  ];

  return { trades, reflections };
}

function setAuthIntent(intent, options = {}) {
  if (intent !== "login" && intent !== "register") {
    return;
  }

  // Remember the opener so closing the modal can return focus to it (§4).
  if (!state.auth.mobileAuthVisible && document.activeElement instanceof HTMLElement) {
    authModalTrigger = document.activeElement;
  }

  state.auth.intent = intent;
  state.auth.mobileAuthVisible = true;
  setMessage(ui.authMessage, "", "");
  updateAuthUi();

  if (options.focus && !state.auth.isAuthenticated) {
    window.setTimeout(() => {
      ui.authIdentifier?.focus();
    }, 120);
  }
}

function closeLandingAuthModal() {
  if (state.auth.isAuthenticated || state.auth.previewMode) {
    return;
  }

  const wasVisible = state.auth.mobileAuthVisible;
  state.auth.mobileAuthVisible = false;
  updateAuthUi();
  setMessage(ui.authMessage, "", "");

  if (wasVisible && authModalTrigger?.isConnected) {
    authModalTrigger.focus();
  }
  authModalTrigger = null;
}

function getResetTokenFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    return (params.get("reset") || "").trim();
  } catch (error) {
    return "";
  }
}

function setResetTokenInUrl(token) {
  try {
    const nextUrl = new URL(window.location.href);
    if (token) {
      nextUrl.searchParams.set("reset", token);
    } else {
      nextUrl.searchParams.delete("reset");
    }
    window.history.replaceState({}, "", nextUrl.toString());
  } catch (error) {
    // Ignore URL updates when unavailable.
  }
}

async function validateResetToken() {
  if (!state.auth.resetToken) {
    state.auth.resetTokenStatus = "idle";
    updateAuthUi();
    return;
  }

  state.auth.resetTokenStatus = "pending";
  updateAuthUi();

  try {
    const response = await fetch(
      `trade_handler.php?action=validate_reset_token&token=${encodeURIComponent(state.auth.resetToken)}`,
      {
        method: "GET",
        credentials: "same-origin"
      }
    );
    const body = await response.json();
    if (!response.ok || !body.ok || !body.valid) {
      throw new Error(body.error || "Reset link is invalid or expired.");
    }
    state.auth.mobileAuthVisible = true;
    state.auth.resetTokenStatus = "valid";
    updateAuthUi();
  } catch (error) {
    state.auth.resetToken = "";
    state.auth.resetTokenStatus = "invalid";
    state.auth.mobileAuthVisible = true;
    setResetTokenInUrl("");
    updateAuthUi();
    setMessage(ui.authMessage, error.message || "Reset link is invalid or expired.", "error");
  }
}

function updateAccessGate() {
  const previewMode = state.auth.previewMode;
  const guestMode = state.auth.guestMode;
  const locked = !previewMode && !guestMode && state.auth.checked && !state.auth.isAuthenticated;
  const disableNavigation = !canAccessApp();
  const authenticated = state.auth.checked && state.auth.isAuthenticated;

  document.body.classList.toggle("auth-locked", locked);
  document.body.classList.add("auth-ready");
  document.body.classList.toggle("is-authenticated", authenticated);
  document.body.classList.toggle("is-preview", previewMode);
  // .is-guest joins .is-authenticated/.is-preview everywhere the CSS decides
  // "the app shell is on screen" — layout, tab bar, footer clearance.
  document.body.classList.toggle("is-guest", guestMode);
  // Demo visitor reaching for the account form: show the landing shell over
  // the demo instead of tearing it down, so nothing they logged is lost.
  document.body.classList.toggle("demo-signup", guestMode && state.auth.mobileAuthVisible);
  syncDemoNotice();

  ui.navButtons.forEach((btn) => {
    btn.disabled = disableNavigation;
    btn.setAttribute("aria-disabled", String(disableNavigation));
  });

  if (locked) {
    toggleMobileNav(false);
  }
}

function readAuthForm(forRegister = false) {
  const identifier = (ui.authIdentifier?.value || "").trim().toLowerCase();
  const password = ui.authPassword?.value || "";

  if (!identifier) {
    return { ok: false, error: "Enter a username or email address." };
  }

  if (password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }

  if (forRegister) {
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
    const validUsername = /^[a-zA-Z0-9._-]{3,32}$/.test(identifier);
    if (!validEmail && !validUsername) {
      return { ok: false, error: "Use a valid email address or a 3-32 character username." };
    }
  }

  return { ok: true, identifier, password };
}

function readResetPasswordForm() {
  const password = ui.resetPassword?.value || "";
  const confirm = ui.resetPasswordConfirm?.value || "";

  if (!state.auth.resetToken) {
    return { ok: false, error: "Reset link is missing or invalid." };
  }

  if (password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }

  if (password !== confirm) {
    return { ok: false, error: "Passwords do not match." };
  }

  return { ok: true, password };
}

async function checkAuthSession() {
  const checkVersion = state.auth.sessionCheckVersion + 1;
  state.auth.sessionCheckVersion = checkVersion;

  try {
    const response = await fetch("trade_handler.php?action=session", {
      method: "GET",
      credentials: "same-origin"
    });
    const body = await response.json();

    if (body && body.csrfToken) {
      csrfToken = String(body.csrfToken);
    }

    if (checkVersion !== state.auth.sessionCheckVersion) {
      return;
    }

    if (response.ok && body.ok && body.authenticated) {
      state.auth.checked = true;
      state.auth.isAuthenticated = true;
      state.auth.username = String(body.username || "");
      state.auth.isAdmin = Boolean(body.isAdmin);
    } else {
      state.auth.checked = true;
      state.auth.isAuthenticated = false;
      state.auth.username = "";
      state.auth.isAdmin = false;
      state.auth.mobileAuthVisible = Boolean(state.auth.resetToken);
    }
  } catch (error) {
    if (checkVersion !== state.auth.sessionCheckVersion) {
      return;
    }
    state.auth.checked = true;
    state.auth.isAuthenticated = false;
    state.auth.username = "";
    state.auth.isAdmin = false;
    state.auth.mobileAuthVisible = true;
    setMessage(ui.authMessage, "Auth service unavailable. Ensure PHP server and PostgreSQL are running.", "error");
  }

  if (checkVersion !== state.auth.sessionCheckVersion) {
    return;
  }

  updateAuthUi();

  if (state.auth.isAuthenticated) {
    const loaded = await loadFromPhpStorage({ silent: true, source: "session", preferLocalIfServerEmpty: true });
    await loadRecentTrades({ silent: true });
    if (loaded) {
      setMessage(ui.authMessage, `Session restored for ${state.auth.username}.`, "success");
    }
    await loadLoginLogs({ silent: true });
    await loadAdminUsers({ silent: true });
    refreshLivePrices({ immediate: true });
    switchView(restoreRouteFromHash() || "dashboard");
  } else {
    state.recentTrades = [];
    renderHeroRecentTrades();
    state.loginLogs = [];
    state.adminUsers = [];
    renderLoginLogs();
    renderAdminUsers();
    updateAccessGate();
    await loadPublicRecentTrades({ silent: true });
  }
}

// Async buttons (§4): dim + inert + swapped label while the request runs.
// Kills auth double-submit; label restored from dataset on completion.
function setPendingState(button, pending, label = "Working…") {
  if (!button) {
    return;
  }
  if (pending) {
    button.dataset.restoreLabel = button.textContent;
    button.textContent = label;
    button.classList.add("is-pending");
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
  } else {
    if (button.dataset.restoreLabel !== undefined) {
      button.textContent = button.dataset.restoreLabel;
      delete button.dataset.restoreLabel;
    }
    button.classList.remove("is-pending");
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}

async function handleLogin() {
  setAuthIntent("login");
  const credentials = readAuthForm(false);
  if (!credentials.ok) {
    setMessage(ui.authMessage, credentials.error, "error");
    return;
  }

  setPendingState(ui.loginBtn, true, "Signing in…");
  try {
    await submitAuth("login", credentials.password, "Logged in.", credentials.identifier);
  } finally {
    setPendingState(ui.loginBtn, false);
  }
}

async function handleRegister() {
  setAuthIntent("register");
  const credentials = readAuthForm(true);
  if (!credentials.ok) {
    setMessage(ui.authMessage, credentials.error, "error");
    return;
  }

  setPendingState(ui.registerBtn, true, "Creating…");
  try {
    await submitAuth("register", credentials.password, "Account created and logged in.", credentials.identifier);
  } finally {
    setPendingState(ui.registerBtn, false);
  }
}

async function handleLogout() {
  // In demo mode the same control is "Exit demo": there is no session to end,
  // so nothing is sent to the server — the ephemeral journal is just dropped.
  if (state.auth.guestMode) {
    exitGuestMode();
    return;
  }

  state.auth.sessionCheckVersion += 1;
  try {
    const response = await fetch("trade_handler.php?action=logout", {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      credentials: "same-origin"
    });
    const body = await response.json();
    if (!response.ok || !body.ok) {
      throw new Error(body.error || "Logout failed");
    }
  } catch (error) {
    setMessage(ui.authMessage, "Logout failed.", "error");
    return;
  }

  state.auth.checked = true;
  state.auth.isAuthenticated = false;
  state.auth.username = "";
  state.auth.isAdmin = false;
  state.auth.intent = "register";
  state.auth.mobileAuthVisible = false;
  state.recentTrades = [];
  state.loginLogs = [];
  state.adminUsers = [];
  renderHeroRecentTrades();
  renderLoginLogs();
  renderAdminUsers();
  cancelServerAutosave();
  updateAuthUi();
  setMessage(ui.authMessage, "", "");
  await loadPublicRecentTrades({ silent: true });
  refreshLivePrices({ immediate: true });
}

async function submitAuth(action, password, successMessage, identifier = "") {
  state.auth.sessionCheckVersion += 1;
  let carryOver = null;
  try {
    const response = await fetch(`trade_handler.php?action=${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      // "Remember me": checked issues a persistent cookie, unchecked keeps the
      // browser-session cookie. Only login/register may set it.
      body: JSON.stringify({ identifier, password, remember: ui.authRemember ? ui.authRemember.checked : true })
    });
    const body = await response.json();
    if (!response.ok || !body.ok) {
      throw new Error(body.error || `${action} failed`);
    }

    if (body.csrfToken) {
      csrfToken = String(body.csrfToken);
    }

    // Only once the account genuinely exists: pull the visitor's own demo
    // work aside (sample rows excluded), tear the demo down and restore the
    // real localStorage journal, so from here this is the ordinary auth path.
    // Doing it after the response means a failed login leaves the demo intact.
    carryOver = takeGuestCarryOver();

    state.auth.checked = true;
    state.auth.isAuthenticated = true;
    state.auth.username = String(body.username || identifier);
    state.auth.isAdmin = Boolean(body.isAdmin);
    state.auth.resetToken = "";
    state.auth.resetTokenStatus = "idle";
    setResetTokenInUrl("");
    updateAuthUi();

    if (action === "register") {
      resetJournalState();
      // A brand-new account has nothing to lose, so demo work carries over
      // automatically. Sample rows were already filtered out.
      const kept = applyGuestCarryOver(carryOver);
      if (kept > 0) {
        persistState({ skipServerSync: true });
        renderAll();
      }
      const saved = await saveToPhpStorage({ silent: true });
      const keptNote = kept > 0 ? ` Kept the ${kept} trade(s) you logged in the demo.` : "";
      if (saved) {
        setMessage(ui.authMessage, `${successMessage} Fresh journal ready.${keptNote}`, "success");
      } else {
        setMessage(ui.authMessage, `${successMessage} Fresh journal created locally.${keptNote}`, "success");
      }
    } else {
      const loaded = await loadFromPhpStorage({ silent: true, source: "auth", preferLocalIfServerEmpty: true });
      // Logging in can land on an account that already has a journal, so the
      // demo work is APPENDED and only after an explicit yes — never a
      // silent overwrite of an existing journal.
      let kept = 0;
      if (carryOver && carryOver.trades.length > 0) {
        const confirmed = window.confirm(
          `Add the ${carryOver.trades.length} trade(s) you logged in demo mode to this account's journal? ` +
            "Nothing already in this journal will be replaced. Choose Cancel to discard the demo trades."
        );
        if (confirmed) {
          kept = applyGuestCarryOver(carryOver);
          persistState();
          renderAll();
        }
      }
      const keptNote = kept > 0 ? ` Added ${kept} trade(s) from your demo.` : "";
      if (loaded) {
        setMessage(ui.authMessage, `${successMessage} Server journal loaded.${keptNote}`, "success");
      } else {
        setMessage(ui.authMessage, `${successMessage} Using local journal until server load succeeds.${keptNote}`, "error");
      }
    }

    await loadRecentTrades({ silent: true });
    await loadLoginLogs({ silent: true });
    await loadAdminUsers({ silent: true });
    refreshLivePrices({ immediate: true });
    switchView("dashboard");
  } catch (error) {
    const errorMessage = error.message || `${action} failed`;
    if (action === "login" && /invalid|incorrect|password|username|email|credential/i.test(errorMessage)) {
      setMessage(ui.authMessage, "password or username / email is incorrect", "error");
    } else {
      setMessage(ui.authMessage, errorMessage, "error");
    }
  }
}

function resetJournalState() {
  state.settings = normalizeSettings(DEFAULT_SETTINGS);
  state.trades = [];
  // Both halves, or the next persistState() writes another account's journal
  // back over an intentionally emptied one.
  state.otherTrades = [];
  applyActiveAccount();
  state.recentTrades = [];
  state.publicRecentTrades = [];
  state.reflections = [];
  state.replayNotes = {};
  state.bulkPreview = [];
  persistState({ skipServerSync: true });
  hydrateRiskForm();
  hydrateReviewMonth();
  resetTradeForm(false);
  clearFilters();
  renderAll();
  renderLastSaved();
}

function updateAuthUi() {
  if (!ui.authStatus || !ui.loginBtn || !ui.registerBtn || !ui.desktopLogoutBtn || !ui.mobileLogoutBtn) {
    renderAdminUsers();
    updateAccessGate();
    return;
  }

  ui.authStatus.classList.remove("is-on", "is-off");
  const hasResetToken = Boolean(state.auth.resetToken) && !state.auth.isAuthenticated;
  const isResetPending = hasResetToken && state.auth.resetTokenStatus === "pending";
  const isResetMode = hasResetToken && state.auth.resetTokenStatus === "valid";
  const loginMode = state.auth.intent === "login";
  const collapseForLanding =
    !state.auth.isAuthenticated &&
    !state.auth.mobileAuthVisible &&
    !isResetMode &&
    !isResetPending;

  if (ui.authTitle) {
    ui.authTitle.textContent = isResetMode
      ? "Reset your password"
      : isResetPending
        ? "Verifying reset link"
      : loginMode
        ? "Log in to Trader Journal"
        : "Create your account";
  }
  if (ui.authCopy) {
    ui.authCopy.textContent = isResetMode
      ? "Set a new password to regain access to your journal."
      : isResetPending
        ? "Checking that your password reset link is still valid."
      : loginMode
        ? "Use your username or email to continue."
        : "Create your account to start journaling.";
  }
  if (ui.authPassword) {
    ui.authPassword.autocomplete = loginMode ? "current-password" : "new-password";
  }
  ui.registerBtn.classList.toggle("primary", !loginMode);
  ui.loginBtn.classList.toggle("primary", loginMode);

  if (ui.authControls) {
    ui.authControls.hidden = isResetMode || isResetPending;
  }
  if (ui.resetPasswordView) {
    ui.resetPasswordView.classList.toggle("is-visible", isResetMode);
    ui.resetPasswordView.hidden = !isResetMode;
    ui.resetPasswordView.style.display = isResetMode ? "grid" : "none";
  }
  if (ui.forgotPasswordBtn) {
    ui.forgotPasswordBtn.hidden = isResetMode || isResetPending || !loginMode;
  }
  if (ui.authShell) {
    ui.authShell.classList.toggle("auth-panel-visible", !collapseForLanding);
    ui.authShell.classList.toggle("auth-panel-hidden", collapseForLanding);
    ui.authShell.classList.toggle("mobile-auth-expanded", !collapseForLanding);
    ui.authShell.classList.toggle("mobile-auth-collapsed", collapseForLanding);
  }
  if (ui.authOverlay) {
    ui.authOverlay.hidden = false;
  }
  document.body.classList.toggle("modal-open", !collapseForLanding && !state.auth.isAuthenticated && !state.auth.previewMode);

  if (!state.auth.checked) {
    ui.authStatus.textContent = isResetPending ? "Verifying reset link..." : "";
    if (ui.authPanel) {
      ui.authPanel.hidden = false;
      ui.authPanel.style.display = "grid";
    }
    ui.desktopLogoutBtn.hidden = true;
    ui.mobileLogoutBtn.hidden = true;
    renderAdminUsers();
    updateAccessGate();
    return;
  }

  // Demo mode never fakes a session: the account controls become an explicit
  // exit, not a logout, because there is nothing logged in to log out of.
  if (state.auth.guestMode) {
    ui.authStatus.textContent = "Demo mode — not signed in";
    ui.authStatus.classList.add("is-off");
    ui.loginBtn.hidden = false;
    ui.registerBtn.hidden = false;
    ui.desktopLogoutBtn.hidden = false;
    ui.mobileLogoutBtn.hidden = false;
    ui.desktopLogoutBtn.textContent = "Exit demo";
    ui.mobileLogoutBtn.textContent = "Exit demo";
    if (ui.authIdentifier) {
      ui.authIdentifier.disabled = false;
    }
    if (ui.authPassword) {
      ui.authPassword.disabled = false;
    }
    if (ui.authPanel) {
      ui.authPanel.hidden = false;
      ui.authPanel.style.display = "grid";
    }
    renderAdminUsers();
    updateAccessGate();
    return;
  }

  ui.desktopLogoutBtn.textContent = "Logout";
  ui.mobileLogoutBtn.textContent = "Logout";

  if (state.auth.previewMode) {
    ui.authStatus.textContent = "";
    ui.loginBtn.hidden = true;
    ui.registerBtn.hidden = true;
    ui.desktopLogoutBtn.hidden = true;
    ui.mobileLogoutBtn.hidden = true;
    if (ui.authIdentifier) {
      ui.authIdentifier.disabled = false;
    }
    if (ui.authPassword) {
      ui.authPassword.disabled = false;
    }
    if (ui.authPanel) {
      ui.authPanel.hidden = false;
      ui.authPanel.style.display = "grid";
    }
    renderAdminUsers();
    updateAccessGate();
    return;
  }

  if (state.auth.isAuthenticated) {
    ui.authStatus.textContent = state.auth.isAdmin
      ? `Logged in as ${state.auth.username} (Admin)`
      : `Logged in as ${state.auth.username}`;
    ui.authStatus.classList.add("is-on");
    if (ui.authIdentifier) {
      ui.authIdentifier.value = "";
      ui.authIdentifier.disabled = true;
    }
    ui.loginBtn.hidden = true;
    ui.registerBtn.hidden = true;
    ui.desktopLogoutBtn.hidden = false;
    ui.mobileLogoutBtn.hidden = false;
    if (ui.authPanel) {
      ui.authPanel.hidden = false;
      ui.authPanel.style.display = "grid";
    }
    if (ui.authPassword) {
      ui.authPassword.disabled = true;
    }
    if (ui.authPassword) {
      ui.authPassword.value = "";
    }
  } else {
    ui.authStatus.textContent = isResetPending ? "Verifying reset link..." : isResetMode ? "Reset link verified" : "";
    if (ui.authStatus.textContent) {
      ui.authStatus.classList.add(isResetMode ? "is-on" : "is-off");
    }
    state.auth.isAdmin = false;
    ui.loginBtn.hidden = isResetMode || isResetPending;
    ui.registerBtn.hidden = isResetMode || isResetPending;
    ui.desktopLogoutBtn.hidden = true;
    ui.mobileLogoutBtn.hidden = true;
    if (ui.authPanel) {
      ui.authPanel.hidden = false;
      ui.authPanel.style.display = "grid";
    }
    if (ui.authIdentifier) {
      ui.authIdentifier.disabled = false;
    }
    if (ui.authPassword) {
      ui.authPassword.disabled = false;
    }
  }

  renderAdminUsers();
  updateAccessGate();
}

async function handleForgotPassword() {
  setAuthIntent("login");
  const identifier = (ui.authIdentifier?.value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) {
    setMessage(ui.authMessage, "Enter the account email address first.", "error");
    return;
  }

  try {
    const response = await fetch("trade_handler.php?action=forgot_password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ email: identifier })
    });
    const body = await response.json();
    if (!response.ok || !body.ok) {
      throw new Error(body.error || "Password reset request failed.");
    }
    setMessage(ui.authMessage, body.message || "Reset request recorded.", "success");
  } catch (error) {
    setMessage(ui.authMessage, error.message || "Password reset request failed.", "error");
  }
}

async function handlePasswordReset() {
  const payload = readResetPasswordForm();
  if (!payload.ok) {
    setMessage(ui.authMessage, payload.error, "error");
    return;
  }

  setPendingState(ui.resetPasswordBtn, true, "Resetting…");
  try {
    const response = await fetch("trade_handler.php?action=reset_password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        token: state.auth.resetToken,
        password: payload.password
      })
    });
    const body = await response.json();
    if (!response.ok || !body.ok) {
      throw new Error(body.error || "Password reset failed.");
    }

    clearResetTokenState(false);
    setMessage(ui.authMessage, body.message || "Password reset complete. You can log in now.", "success");
  } catch (error) {
    setMessage(ui.authMessage, error.message || "Password reset failed.", "error");
  } finally {
    setPendingState(ui.resetPasswordBtn, false);
  }
}

function clearResetTokenState(clearMessage = false) {
  state.auth.resetToken = "";
  state.auth.resetTokenStatus = "idle";
  state.auth.intent = "login";
  state.auth.mobileAuthVisible = true;
  setResetTokenInUrl("");
  if (ui.resetPassword) {
    ui.resetPassword.value = "";
  }
  if (ui.resetPasswordConfirm) {
    ui.resetPasswordConfirm.value = "";
  }
  updateAuthUi();
  if (clearMessage) {
    setMessage(ui.authMessage, "", "");
  }
}

function isViewActive(id) {
  const view = document.getElementById(id);
  return view && view.classList.contains("is-active");
}

function applyInitialDates() {
  const today = toDateInputValue(new Date());
  const thisMonth = today.slice(0, 7);

  if (!ui.tradeFields.tradeDate.value) {
    ui.tradeFields.tradeDate.value = today;
  }

  ui.tradeFields.riskPercent.value = String(state.settings.riskPerTrade);

  const reflectionDate = document.getElementById("reflectionDate");
  if (!reflectionDate.value) {
    reflectionDate.value = today;
  }

  // The digest defaults to the week you are in, not the Sunday you are near.
  if (ui.digestDate && !ui.digestDate.value) {
    ui.digestDate.value = today;
  }

  if (!ui.reviewMonth.value) {
    ui.reviewMonth.value = thisMonth;
  }

  if (!ui.dashboardCalendarMonth.value) {
    ui.dashboardCalendarMonth.value = thisMonth;
  }
}

function hydrateRiskForm() {
  ui.riskInputs.startingBalance.value = state.settings.startingBalance;
  ui.riskInputs.balanceOverride.value = state.settings.balanceOverride > 0 ? state.settings.balanceOverride : "";
  ui.riskInputs.dailyMaxLoss.value = state.settings.dailyMaxLoss;
  ui.riskInputs.weeklyMaxLoss.value = state.settings.weeklyMaxLoss;
  ui.riskInputs.riskPerTrade.value = state.settings.riskPerTrade;
  ui.riskInputs.equityGoal.value = state.settings.equityGoal;
  if (ui.riskInputs.cooldownEnabled) {
    ui.riskInputs.cooldownEnabled.checked = state.settings.cooldownEnabled;
  }
  if (ui.riskInputs.cooldownLossStreak) {
    ui.riskInputs.cooldownLossStreak.value = state.settings.cooldownLossStreak;
  }
  // The checklist editor hydrates from the same places the risk form does:
  // login, logout, demo start, import. Drop the draft so a stale half-edit
  // from a previous session never survives a journal swap.
  rulesDraft = null;
  renderRulesEditor();
}

function hydrateReviewMonth() {
  const todayMonth = toDateInputValue(new Date()).slice(0, 7);
  if (!ui.reviewMonth.value) {
    ui.reviewMonth.value = todayMonth;
  }

  if (!ui.dashboardCalendarMonth.value) {
    ui.dashboardCalendarMonth.value = todayMonth;
  }

  ui.replayNotes.value = state.replayNotes[ui.reviewMonth.value] || "";
}

function handleRiskSubmit(event) {
  event.preventDefault();

  const parsedOverride = parseNumber(ui.riskInputs.balanceOverride.value);
  const nextSettings = {
    journalName: state.settings.journalName,
    startingBalance: parseNumber(ui.riskInputs.startingBalance.value),
    balanceOverride: Number.isFinite(parsedOverride) && parsedOverride >= 0 ? parsedOverride : 0,
    dailyMaxLoss: parseNumber(ui.riskInputs.dailyMaxLoss.value),
    weeklyMaxLoss: parseNumber(ui.riskInputs.weeklyMaxLoss.value),
    riskPerTrade: parseNumber(ui.riskInputs.riskPerTrade.value),
    equityGoal: parseNumber(ui.riskInputs.equityGoal.value),
    // 1f #03: the cooldown lives in risk settings because it is a risk rule.
    // The checklist is edited in its own panel and is untouched here.
    preTradeRules: state.settings.preTradeRules,
    cooldownEnabled: Boolean(ui.riskInputs.cooldownEnabled?.checked),
    cooldownLossStreak: parseNumber(ui.riskInputs.cooldownLossStreak?.value),
    // Accounts are edited in their own dialog. This form rebuilds the settings
    // object from scratch, so anything it does not carry is deleted — which is
    // exactly how the prop configuration would silently vanish on a Save.
    accounts: state.settings.accounts,
    activeAccountId: state.settings.activeAccountId
  };

  if (
    nextSettings.startingBalance <= 0 ||
    nextSettings.balanceOverride < 0 ||
    nextSettings.dailyMaxLoss < 0 ||
    nextSettings.weeklyMaxLoss < 0 ||
    nextSettings.riskPerTrade < 0 ||
    nextSettings.equityGoal <= 0
  ) {
    setMessage(ui.riskFormMessage, "Use valid positive values for all risk fields.", "error");
    return;
  }

  state.settings = normalizeSettings(nextSettings);
  // Starting balance has one owner — the account. Editing it here writes it
  // back rather than leaving the mirror and the account disagreeing.
  const activeAccount = getActiveAccount();
  if (activeAccount && nextSettings.startingBalance > 0) {
    activeAccount.startingBalance = nextSettings.startingBalance;
  }
  persistState();
  renderAll();
  setMessage(ui.riskFormMessage, "Risk settings updated.", "success");
}

function handleTradeSubmit(event) {
  event.preventDefault();

  const payload = readTradeForm();
  if (!payload.ok) {
    setMessage(ui.tradeFormMessage, payload.error, "error");
    flagInvalidField(payload.field);
    return;
  }

  const existingId = ui.tradeFields.tradeId.value.trim();
  const existingTrade = existingId ? getExistingTrade(existingId) : null;
  // 1f #03: a NEW trade written after a cooldown override carries the answer.
  // An edit does not — buildTradeRecord already carries the original stamp.
  const input = existingId ? payload.value : { ...consumePendingCooldown(), ...payload.value };
  const trade = buildTradeRecord(input, {
    id: existingId,
    createdAt: existingTrade?.createdAt || "",
    closedAt: existingTrade?.closedAt || "",
    existingTrade
  });

  if (existingId) {
    state.trades = state.trades.map((item) => (item.id === existingId ? trade : item));
  } else {
    state.trades.push(trade);
  }

  persistState();
  renderAll();
  resetTradeForm(true);
  // The moment persistence matters most: the trade is in the journal and
  // fully usable, but it will not survive the tab.
  if (state.auth.guestMode) {
    nudgeGuest(ui.tradeFormMessage, existingId ? "Trade updated in the demo." : "Trade added to the demo.");
    return;
  }
  setMessage(ui.tradeFormMessage, existingId ? "Trade updated." : "Trade saved.", "success");
}

// Form-shake (graft): 4px shake on the offending field only; under reduced
// motion the shake is skipped and the .is-invalid border flash carries the
// feedback. The shake class is cleared on animationend.
function flagInvalidField(field) {
  if (!field) {
    return;
  }

  field.classList.remove("form-shake");
  if (!prefersReducedMotion()) {
    void field.offsetWidth;
    field.classList.add("form-shake");
  }
  field.classList.add("is-invalid");
  window.setTimeout(() => {
    field.classList.remove("is-invalid");
  }, 1200);
  field.focus();
}

function syncDirectionToggle() {
  const value = ui.tradeFields.direction?.value || "Buy";
  ui.directionButtons.forEach((button) => {
    const isActive = button.dataset.direction === value;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function syncSetupTypeCustomField() {
  const isCustom = ui.tradeFields.setupType.value === "Custom";
  if (ui.tradeFields.customSetupType) {
    ui.tradeFields.customSetupType.hidden = !isCustom;
    ui.tradeFields.customSetupType.toggleAttribute("required", isCustom);
  }

  if (!isCustom && ui.tradeFields.customSetupType) {
    ui.tradeFields.customSetupType.value = "";
  }
}

function syncTradeProgressState() {
  const isOpen = Boolean(ui.tradeFields.tradeInProgress?.checked);

  if (ui.tradeFields.exitPrice) {
    ui.tradeFields.exitPrice.required = !isOpen;
    if (isOpen) {
      ui.tradeFields.exitPrice.value = "";
      ui.tradeFields.exitPrice.placeholder = "Set after trade closes";
    } else {
      ui.tradeFields.exitPrice.placeholder = "";
    }
  }

  if (ui.tradeFields.tradeResult) {
    ui.tradeFields.tradeResult.disabled = isOpen;
    if (isOpen) {
      ui.tradeFields.tradeResult.value = "Auto";
    }
  }
}

function getExistingTrade(id) {
  return state.trades.find((trade) => trade.id === id);
}

function readTradeForm() {
  const screenshotFile = ui.tradeFields.screenshot.files?.[0] || null;
  const screenshotLabel = ui.tradeFields.screenshotLabel.textContent || "";
  const hasStoredLabel =
    screenshotLabel !== "No screenshot selected" &&
    screenshotLabel !== "Screenshot filename stored.";

  const value = {
    date: ui.tradeFields.tradeDate.value,
    session: ui.tradeFields.session.value,
    market: ui.tradeFields.market.value,
    asset: ui.tradeFields.asset.value.trim().toUpperCase(),
    direction: ui.tradeFields.direction.value,
    entryPrice: parseNumber(ui.tradeFields.entryPrice.value),
    stopLoss: parseNumber(ui.tradeFields.stopLoss.value),
    takeProfit: parseNumber(ui.tradeFields.takeProfit.value),
    exitPrice: parseNumber(ui.tradeFields.exitPrice.value),
    riskPercent: parseNumber(ui.tradeFields.riskPercent.value),
    positionSize: parseNumber(ui.tradeFields.positionSize.value),
    tradeResult: ui.tradeFields.tradeResult.value,
    status: ui.tradeFields.tradeInProgress.checked ? "open" : "closed",
    setupType: ui.tradeFields.setupType.value === "Custom"
      ? ui.tradeFields.customSetupType.value.trim()
      : ui.tradeFields.setupType.value,
    timeframe: ui.tradeFields.timeframe.value,
    psychology: ui.tradeFields.psychology.value,
    executionQuality: ui.tradeFields.executionQuality.value,
    screenshotName: screenshotFile ? screenshotFile.name : hasStoredLabel ? screenshotLabel : "",
    screenshotData: ui.tradeFields.screenshotData.value || "",
    notes: ui.tradeFields.tradeNotes.value.trim()
  };

  if (!value.date || !value.asset) {
    return {
      ok: false,
      error: "Date and Asset are required.",
      field: !value.date ? ui.tradeFields.tradeDate : ui.tradeFields.asset
    };
  }

  if (!value.setupType) {
    return {
      ok: false,
      error: "Enter a custom setup name or choose a preset setup.",
      field: ui.tradeFields.customSetupType
    };
  }

  // A target is optional everywhere else — the quick capture prints "no
  // target — R:R unknown" and the sheet hands off takeProfit: 0. The full
  // form demanding one made the sheet -> Add detail -> Save path fail with a
  // silent focus jump. Empty means "no target"; a typed one must make sense.
  const numericFields = [
    ["Entry Price", value.entryPrice, ui.tradeFields.entryPrice],
    ["Stop Loss", value.stopLoss, ui.tradeFields.stopLoss],
    ["Risk %", value.riskPercent, ui.tradeFields.riskPercent],
    ["Position Size", value.positionSize, ui.tradeFields.positionSize]
  ];

  for (const [label, amount, field] of numericFields) {
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, error: `${label} must be greater than zero.`, field };
    }
  }

  if (value.status === "closed" && (!Number.isFinite(value.exitPrice) || value.exitPrice <= 0)) {
    return {
      ok: false,
      error: "Exit Price must be greater than zero for closed trades.",
      field: ui.tradeFields.exitPrice
    };
  }

  if (value.direction === "Buy" && value.stopLoss >= value.entryPrice) {
    return {
      ok: false,
      error: "For Buy trades, stop loss should be below entry price.",
      field: ui.tradeFields.stopLoss
    };
  }

  if (value.direction === "Sell" && value.stopLoss <= value.entryPrice) {
    return {
      ok: false,
      error: "For Sell trades, stop loss should be above entry price.",
      field: ui.tradeFields.stopLoss
    };
  }

  if (!String(ui.tradeFields.takeProfit.value || "").trim()) {
    value.takeProfit = 0;
  } else if (!Number.isFinite(value.takeProfit) || value.takeProfit <= 0) {
    return {
      ok: false,
      error: "Take Profit must be greater than zero — or leave it empty for no target.",
      field: ui.tradeFields.takeProfit
    };
  } else if (value.direction === "Buy" ? value.takeProfit <= value.entryPrice : value.takeProfit >= value.entryPrice) {
    return {
      ok: false,
      error:
        value.direction === "Buy"
          ? "For Buy trades, the target should be above entry price."
          : "For Sell trades, the target should be below entry price.",
      field: ui.tradeFields.takeProfit
    };
  }

  return { ok: true, value };
}

function buildTradeRecord(tradeInput, options = {}) {
  const now = new Date().toISOString();
  const existingId = String(options.id || "").trim();
  const existingTrade = options.existingTrade && typeof options.existingTrade === "object" ? options.existingTrade : null;
  const status = tradeInput.status === "open" ? "open" : "closed";
  const metricsInput = status === "open" ? { ...tradeInput, exitPrice: tradeInput.entryPrice } : tradeInput;
  const metrics = calculateTradeMetrics(metricsInput);
  const closedAt = status === "open"
    ? ""
    : String(options.closedAt || existingTrade?.closedAt || now);
  const resolvedResult =
    status === "open"
      ? "Open"
      : tradeInput.tradeResult === "Auto"
        ? metrics.autoResult
        : tradeInput.tradeResult;

  return {
    id: existingId || createId(),
    createdAt: existingId ? String(options.createdAt || now) : now,
    updatedAt: now,
    ...tradeInput,
    // Every trade belongs to exactly one account, stamped in the one function
    // every creation path already goes through (form, sheet, quick capture,
    // bulk import, close-at-market). An edit keeps whatever account it was
    // filed under; a new row lands in whichever account is on screen. Placed
    // after the spread so a caller cannot half-set it.
    accountId: String(existingTrade?.accountId || tradeInput.accountId || state.settings.activeAccountId || ""),
    // 1b: the pre-trade rules the trader ticked in the sheet. The full form
    // does not ask for them, so an edit through it must CARRY them, not wipe
    // them — an empty array from readTradeForm is absence, not a de-tick.
    preTradeRules: Array.isArray(tradeInput.preTradeRules)
      ? tradeInput.preTradeRules.map(String)
      : Array.isArray(existingTrade?.preTradeRules)
        ? existingTrade.preTradeRules.map(String)
        : [],
    // 1f #02/#03: same carry rule — the full form asks for none of these, so
    // editing a trade through it must never erase what the sheet recorded.
    preTradeRulesAsked: Array.isArray(tradeInput.preTradeRulesAsked)
      ? tradeInput.preTradeRulesAsked.map(String)
      : Array.isArray(existingTrade?.preTradeRulesAsked)
        ? existingTrade.preTradeRulesAsked.map(String)
        : [],
    cooldownOverride: Boolean(
      tradeInput.cooldownOverride === undefined ? existingTrade?.cooldownOverride : tradeInput.cooldownOverride
    ),
    cooldownReason: String(tradeInput.cooldownReason || existingTrade?.cooldownReason || ""),
    cooldownNote: String(tradeInput.cooldownNote || existingTrade?.cooldownNote || ""),
    // 1c: same carry rule. Only the close sheet asks for these, so an edit
    // through the full form must not silently drop them.
    mistakeTags: Array.isArray(tradeInput.mistakeTags)
      ? tradeInput.mistakeTags.map(String)
      : Array.isArray(existingTrade?.mistakeTags)
        ? existingTrade.mistakeTags.map(String)
        : [],
    journalledAt: String(tradeInput.journalledAt || existingTrade?.journalledAt || ""),
    exitPrice: status === "open" ? 0 : tradeInput.exitPrice,
    status,
    closedAt,
    result: resolvedResult,
    netPnl: status === "open" ? 0 : metrics.netPnl,
    riskAmount: metrics.riskAmount,
    rMultiple: status === "open" ? 0 : metrics.rMultiple,
    rrRatio: metrics.rrRatio,
    pips: status === "open" ? 0 : metrics.pips,
    pipSize: metrics.pipSize,
    pipValuePerLot: metrics.pipValuePerLot,
    dollarPerPip: metrics.dollarPerPip
  };
}

function handleBulkPreview() {
  if (!canAccessApp()) {
    setMessage(ui.bulkMessage, "Login first before importing trades.", "error");
    return;
  }

  const parsed = parseBulkTrades(ui.bulkInput.value, ui.bulkSource.value);
  state.bulkPreview = parsed.trades;
  renderBulkPreview(parsed.trades);

  if (!parsed.trades.length) {
    const errorText = parsed.errors[0] || "No valid rows found. Check your headers and values.";
    setMessage(ui.bulkMessage, errorText, "error");
    return;
  }

  let message = `Preview ready: ${parsed.trades.length} valid row(s).`;
  if (parsed.errors.length > 0) {
    message += ` Skipped ${parsed.errors.length} invalid row(s).`;
  }
  setMessage(ui.bulkMessage, message, "success");
}

function handleBulkImport() {
  if (!canAccessApp()) {
    setMessage(ui.bulkMessage, "Login first before importing trades.", "error");
    return;
  }

  const parsed = parseBulkTrades(ui.bulkInput.value, ui.bulkSource.value);
  if (!parsed.trades.length) {
    const errorText = parsed.errors[0] || "No valid rows found to import.";
    setMessage(ui.bulkMessage, errorText, "error");
    renderBulkPreview([]);
    return;
  }

  let imported = 0;
  let duplicates = 0;
  // Every imported row carries the same batch id so Undo Last Import can
  // remove exactly this batch later.
  const importBatchId = createId();

  parsed.trades.forEach((tradeInput) => {
    if (isLikelyDuplicateTrade(tradeInput)) {
      duplicates += 1;
      return;
    }

    state.trades.push({ ...buildTradeRecord(tradeInput), importBatchId });
    imported += 1;
  });

  if (imported === 0) {
    setMessage(ui.bulkMessage, "All parsed rows matched existing trades. Nothing imported.", "error");
    return;
  }

  persistState();
  renderAll();
  clearBulkImport(true);

  let message = `Imported ${imported} trade(s).`;
  if (duplicates > 0) {
    message += ` Skipped ${duplicates} duplicate row(s).`;
  }
  if (parsed.errors.length > 0) {
    message += ` Skipped ${parsed.errors.length} invalid row(s).`;
  }
  setMessage(ui.bulkMessage, message, "success");
  setMessage(ui.tradeFormMessage, message, "success");
}

function getLastImportBatch() {
  let latest = null;
  state.trades.forEach((trade) => {
    if (!trade.importBatchId) {
      return;
    }
    if (!latest || String(trade.createdAt) > String(latest.createdAt)) {
      latest = trade;
    }
  });

  if (!latest) {
    return null;
  }

  const count = state.trades.filter((trade) => trade.importBatchId === latest.importBatchId).length;
  return { id: latest.importBatchId, count };
}

function syncBulkUndoButton() {
  if (!ui.bulkUndoBtn) {
    return;
  }

  const batch = getLastImportBatch();
  ui.bulkUndoBtn.hidden = !batch;
  if (batch) {
    ui.bulkUndoBtn.textContent = `Undo Last Import (${batch.count})`;
  }
}

function undoLastImport() {
  const batch = getLastImportBatch();
  if (!batch) {
    return;
  }

  const confirmed = window.confirm(`Remove the ${batch.count} trade(s) added by the last import?`);
  if (!confirmed) {
    return;
  }

  state.trades = state.trades.filter((trade) => trade.importBatchId !== batch.id);
  persistState();
  renderAll();
  setMessage(ui.bulkMessage, `Removed ${batch.count} imported trade(s).`, "success");
}

function clearBulkImport(keepMessage = false) {
  if (ui.bulkInput) {
    ui.bulkInput.value = "";
  }
  state.bulkPreview = [];
  renderBulkPreview([]);
  if (!keepMessage) {
    setMessage(ui.bulkMessage, "", "");
  }
}

function renderBulkPreview(trades) {
  if (!ui.bulkPreviewWrap || !ui.bulkPreviewBody) {
    return;
  }

  if (!trades.length) {
    ui.bulkPreviewWrap.hidden = true;
    ui.bulkPreviewBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="10">No preview rows.</td>
      </tr>
    `;
    return;
  }

  // Missing stop/TP/exit values are flagged with an em dash instead of being
  // fabricated; rows without an exit import as open positions.
  const priceCell = (label, value) =>
    Number.isFinite(value) && value > 0
      ? `<td data-label="${label}" class="num">${escapeHtml(String(value))}</td>`
      : `<td data-label="${label}" class="num bulk-missing" title="Not provided in the pasted data">—</td>`;

  ui.bulkPreviewWrap.hidden = false;
  ui.bulkPreviewBody.innerHTML = trades
    .slice(0, 30)
    .map((trade) => `
      <tr>
        <td data-label="Date">${escapeHtml(trade.date)}</td>
        <td data-label="Asset">${escapeHtml(trade.asset)}</td>
        <td data-label="Market">${escapeHtml(trade.market)}</td>
        <td data-label="Direction">${escapeHtml(trade.direction)}</td>
        <td data-label="Entry" class="num">${escapeHtml(String(trade.entryPrice))}</td>
        ${priceCell("Stop", trade.stopLoss)}
        ${priceCell("Take", trade.takeProfit)}
        ${priceCell("Exit", trade.exitPrice)}
        <td data-label="Size" class="num">${escapeHtml(String(trade.positionSize))}</td>
        <td data-label="Status">${trade.status === "open" ? '<span class="pill">Open</span>' : "Closed"}</td>
      </tr>
    `)
    .join("");
}

function parseBulkTrades(rawInput, source) {
  const text = String(rawInput || "").trim();
  if (!text) {
    return { trades: [], errors: ["Paste CSV/TSV content first."] };
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    return { trades: [], errors: ["Include a header row and at least one data row."] };
  }

  const delimiter = detectBulkDelimiter(lines[0]);
  const headers = parseDelimitedLine(lines[0], delimiter).map(normalizeBulkHeader).filter(Boolean);
  if (!headers.length) {
    return { trades: [], errors: ["Unable to parse header columns."] };
  }

  const trades = [];
  const errors = [];

  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseDelimitedLine(lines[i], delimiter);
    if (!cells.some((cell) => String(cell).trim().length > 0)) {
      continue;
    }

    const row = {};
    headers.forEach((header, index) => {
      row[header] = String(cells[index] || "").trim();
    });

    const mapped = mapBulkRowToTrade(row, source, i + 1);
    if (!mapped.ok) {
      errors.push(mapped.error);
      continue;
    }

    trades.push(mapped.trade);
  }

  return { trades, errors };
}

function mapBulkRowToTrade(row, source, rowNumber) {
  const dateText = parseImportDate(getBulkValue(row, [
    "date",
    "trade_date",
    "open_time",
    "close_time",
    "time",
    "timestamp"
  ]));

  if (!dateText) {
    return { ok: false, error: `Row ${rowNumber}: invalid date.` };
  }

  const asset = getBulkValue(row, ["asset", "symbol", "pair", "instrument", "ticker"])
    .replace(/\s+/g, "")
    .toUpperCase();
  if (!asset) {
    return { ok: false, error: `Row ${rowNumber}: missing asset/symbol.` };
  }

  const direction = normalizeImportedDirection(getBulkValue(row, ["direction", "side", "position", "type"]));
  if (!direction) {
    return { ok: false, error: `Row ${rowNumber}: direction must be Buy/Sell or Long/Short.` };
  }

  const entryPrice = parseImportNumber(getBulkValue(row, ["entry", "entry_price", "open", "open_price", "price"]));
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    return { ok: false, error: `Row ${rowNumber}: invalid entry price.` };
  }

  // Never fabricate prices: missing stop/TP/exit stays 0 (flagged in the
  // preview) and a missing exit imports the row as an open position.
  const stopLossRaw = parseImportNumber(getBulkValue(row, ["stop", "stop_loss", "sl", "stoploss"]));
  const takeProfitRaw = parseImportNumber(getBulkValue(row, ["take", "take_profit", "tp", "target"]));
  const exitPriceRaw = parseImportNumber(getBulkValue(row, ["exit", "exit_price", "close", "close_price"]));
  const stopLoss = Number.isFinite(stopLossRaw) && stopLossRaw > 0 ? stopLossRaw : 0;
  const takeProfit = Number.isFinite(takeProfitRaw) && takeProfitRaw > 0 ? takeProfitRaw : 0;
  const exitPrice = Number.isFinite(exitPriceRaw) && exitPriceRaw > 0 ? exitPriceRaw : 0;
  const status = exitPrice > 0 ? "closed" : "open";

  const riskPercentRaw = parseImportNumber(getBulkValue(row, ["risk_percent", "risk", "risk_pct", "risk_"]));
  const riskPercent = Number.isFinite(riskPercentRaw) && riskPercentRaw > 0 ? riskPercentRaw : state.settings.riskPerTrade;

  const positionSizeRaw = parseImportNumber(getBulkValue(row, ["position_size", "size", "qty", "quantity", "volume", "lot", "lot_size", "amount"]));
  const positionSize = Number.isFinite(positionSizeRaw) && positionSizeRaw > 0 ? positionSizeRaw : 1;

  const market = inferImportedMarket(
    asset,
    source,
    getBulkValue(row, ["market", "market_type", "class"])
  );

  const tradeResult = normalizeImportedResult(getBulkValue(row, ["result", "outcome"]));
  const session = getBulkValue(row, ["session"]).trim() || "Custom";
  const setupType = getBulkValue(row, ["setup", "setup_type"]).trim() || "Custom";
  const timeframe = getBulkValue(row, ["timeframe", "tf"]).trim().toUpperCase() || "M15";
  const psychology = getBulkValue(row, ["psychology", "emotion"]).trim() || "Focused";
  const executionQuality = getBulkValue(row, ["execution", "execution_quality", "grade"]).trim() || "B";
  const notes = getBulkValue(row, ["notes", "note", "comment", "remarks"]).trim();

  return {
    ok: true,
    trade: {
      date: dateText,
      session,
      market,
      asset,
      direction,
      entryPrice,
      stopLoss,
      takeProfit,
      exitPrice,
      riskPercent,
      positionSize,
      tradeResult: status === "open" ? "Auto" : tradeResult,
      status,
      setupType,
      timeframe,
      psychology,
      executionQuality,
      screenshotName: "",
      screenshotData: "",
      notes: notes ? notes : `Imported from ${source.toUpperCase()}`
    }
  };
}

function detectBulkDelimiter(headerLine) {
  const commaCount = (headerLine.match(/,/g) || []).length;
  const tabCount = (headerLine.match(/\t/g) || []).length;
  return tabCount > commaCount ? "\t" : ",";
}

function parseDelimitedLine(line, delimiter) {
  const row = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        value += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      row.push(value.trim());
      value = "";
      continue;
    }

    value += char;
  }

  row.push(value.trim());
  return row;
}

function normalizeBulkHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getBulkValue(row, keys) {
  for (const key of keys) {
    const normalized = normalizeBulkHeader(key);
    const value = row[normalized];
    if (value !== undefined && String(value).trim() !== "") {
      return String(value).trim();
    }
  }

  return "";
}

function parseImportDate(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 30000 && numeric < 80000) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    excelEpoch.setUTCDate(excelEpoch.getUTCDate() + Math.floor(numeric));
    return toDateInputValue(excelEpoch);
  }

  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return toDateInputValue(date);
  }

  const normalized = value.replace(/\./g, "-").replace(/\//g, "-");
  const parts = normalized.split("-");
  if (parts.length === 3) {
    const [a, b, c] = parts.map((item) => Number(item));
    if (Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c)) {
      if (String(parts[0]).length === 4) {
        const isoCandidate = `${String(a).padStart(4, "0")}-${String(b).padStart(2, "0")}-${String(c).padStart(2, "0")}`;
        const parsed = new Date(`${isoCandidate}T00:00:00`);
        if (!Number.isNaN(parsed.getTime())) {
          return isoCandidate;
        }
      }
      const isoCandidate = `${String(c).padStart(4, "0")}-${String(a).padStart(2, "0")}-${String(b).padStart(2, "0")}`;
      const parsed = new Date(`${isoCandidate}T00:00:00`);
      if (!Number.isNaN(parsed.getTime())) {
        return isoCandidate;
      }
    }
  }

  return "";
}

function parseImportNumber(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) {
    return NaN;
  }

  const cleaned = value
    .replace(/[$,%\s]/g, "")
    .replace(/,/g, "")
    .replace(/[^\d.-]/g, "");

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function normalizeImportedDirection(rawValue) {
  const value = String(rawValue || "").trim().toLowerCase();
  if (!value) {
    return "";
  }

  if (value.includes("buy") || value.includes("long")) {
    return "Buy";
  }

  if (value.includes("sell") || value.includes("short")) {
    return "Sell";
  }

  return "";
}

function normalizeImportedResult(rawValue) {
  const value = String(rawValue || "").trim().toLowerCase();
  if (!value) {
    return "Auto";
  }

  if (value.includes("win") || value.includes("profit")) {
    return "Win";
  }

  if (value.includes("loss") || value.includes("lose")) {
    return "Loss";
  }

  if (value.includes("break")) {
    return "Break Even";
  }

  return "Auto";
}

function inferImportedMarket(asset, source, marketRaw) {
  const explicit = normalizeMarketLabel(marketRaw);
  if (explicit) {
    return explicit;
  }

  if (source === "vantage") {
    return "Forex";
  }
  if (source === "binance") {
    return "Crypto";
  }

  if (asset.startsWith("XAU") || asset.startsWith("XAG")) {
    return "Metals";
  }
  if (/^[A-Z]{6}$/.test(asset)) {
    return "Forex";
  }
  if (asset.endsWith("USDT") || asset.endsWith("USDC") || asset.endsWith("BTC") || asset.endsWith("ETH")) {
    return "Crypto";
  }
  if (/^[A-Z]{1,5}$/.test(asset)) {
    return "Stocks";
  }

  return "Other";
}

function normalizeMarketLabel(rawValue) {
  const value = String(rawValue || "").trim().toLowerCase();
  if (!value) {
    return "";
  }

  if (value === "forex" || value === "fx") return "Forex";
  if (value === "crypto" || value === "cryptocurrency") return "Crypto";
  if (value === "stocks" || value === "stock") return "Stocks";
  if (value === "indices" || value === "index") return "Indices";
  if (value === "metals" || value === "metal") return "Metals";
  if (value === "commodities" || value === "commodity") return "Commodities";
  if (value === "futures" || value === "future") return "Futures";
  if (value === "etf" || value === "etfs") return "ETFs";
  if (value === "options" || value === "option") return "Options";

  return "Other";
}

function isLikelyDuplicateTrade(tradeInput) {
  return state.trades.some((trade) =>
    trade.date === tradeInput.date &&
    trade.asset === tradeInput.asset &&
    trade.direction === tradeInput.direction &&
    Math.abs(Number(trade.entryPrice) - Number(tradeInput.entryPrice)) < 1e-9 &&
    Math.abs(Number(trade.exitPrice) - Number(tradeInput.exitPrice)) < 1e-9 &&
    Math.abs(Number(trade.positionSize) - Number(tradeInput.positionSize)) < 1e-9
  );
}

function calculateTradeMetrics(trade) {
  const directionFactor = trade.direction === "Buy" ? 1 : -1;
  const pipSpec = getPipSpec(trade);
  // Imported rows may legitimately lack a stop or target (no fabrication):
  // without a stop the risk falls back to the settings risk %, and RR is 0.
  const hasStop = Number.isFinite(trade.stopLoss) && trade.stopLoss > 0;
  const hasTarget = Number.isFinite(trade.takeProfit) && trade.takeProfit > 0;
  const directedMoveToExit = (trade.exitPrice - trade.entryPrice) * directionFactor;
  const rawPips = pipSpec.pipSize > 0 ? directedMoveToExit / pipSpec.pipSize : 0;
  const pips = round(rawPips);

  const pipDistanceToStop = hasStop && pipSpec.pipSize > 0
    ? Math.abs((trade.entryPrice - trade.stopLoss) / pipSpec.pipSize)
    : 0;

  let netPnl = 0;
  let riskFromStructure = 0;
  let dollarPerPip = 0;

  if (pipSpec.mode === "pip-lot") {
    dollarPerPip = round(pipSpec.pipValuePerLot * trade.positionSize);
    netPnl = round(pips * dollarPerPip);
    riskFromStructure = round(pipDistanceToStop * dollarPerPip);
  } else {
    netPnl = round(directedMoveToExit * trade.positionSize);
    riskFromStructure = hasStop
      ? round(Math.abs(trade.entryPrice - trade.stopLoss) * trade.positionSize)
      : 0;
    dollarPerPip = round(pipSpec.pipSize * trade.positionSize);
  }

  const fallbackRisk = state.settings.startingBalance * (trade.riskPercent / 100);
  const riskAmount = round(riskFromStructure > 0 ? riskFromStructure : fallbackRisk);
  const rMultiple = riskAmount > 0 ? round(netPnl / riskAmount) : 0;

  const rrDenominator = hasStop ? Math.abs(trade.entryPrice - trade.stopLoss) : 0;
  const rrNumerator = hasTarget ? Math.abs(trade.takeProfit - trade.entryPrice) : 0;
  const rrRatio = rrDenominator > 0 && rrNumerator > 0 ? round(rrNumerator / rrDenominator) : 0;

  let autoResult = "Break Even";
  if (netPnl > 0) {
    autoResult = "Win";
  } else if (netPnl < 0) {
    autoResult = "Loss";
  }

  return {
    netPnl,
    riskAmount,
    rMultiple,
    rrRatio,
    autoResult,
    pips,
    pipSize: pipSpec.pipSize,
    pipValuePerLot: pipSpec.pipValuePerLot,
    dollarPerPip
  };
}

function getPipSpec(trade) {
  const asset = String(trade.asset || "").toUpperCase();
  const market = String(trade.market || "").toLowerCase();
  const isCryptoLike = isCryptoMarketSymbol(asset, market);

  // User-requested XAUUSD model: 0.01 lot => $1 per pip (1.0 price move).
  if (asset.startsWith("XAU")) {
    return { mode: "pip-lot", pipSize: 1, pipValuePerLot: 100 };
  }

  if (asset.startsWith("XAG")) {
    return { mode: "pip-lot", pipSize: 0.01, pipValuePerLot: 50 };
  }

  if (isCryptoLike) {
    return {
      mode: "unit",
      pipSize: 1,
      pipValuePerLot: 0
    };
  }

  const isForexPair = /^[A-Z]{6}$/.test(asset);
  if (isForexPair || market === "forex") {
    const isJpyPair = asset.endsWith("JPY");
    return { mode: "pip-lot", pipSize: isJpyPair ? 0.01 : 0.0001, pipValuePerLot: 10 };
  }

  return {
    mode: "unit",
    pipSize: inferPipSizeFromPrice(trade.entryPrice, market),
    pipValuePerLot: 0
  };
}

// Distance between two prices expressed in pips for the instrument, using the
// same pip spec the P&L engine uses — capture and results can never disagree.
function pipsBetween(asset, market, priceA, priceB) {
  if (!Number.isFinite(priceA) || !Number.isFinite(priceB) || priceA <= 0 || priceB <= 0) {
    return null;
  }
  const spec = getPipSpec({ asset, market, entryPrice: priceA });
  if (!spec || !Number.isFinite(spec.pipSize) || spec.pipSize <= 0) {
    return null;
  }
  return Math.abs(priceA - priceB) / spec.pipSize;
}

function formatPips(pips) {
  if (!Number.isFinite(pips)) {
    return "";
  }
  return pips >= 1000 ? Math.round(pips).toLocaleString("en-US") : pips.toFixed(1);
}

function inferPipSizeFromPrice(entryPrice, market) {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    return 0.01;
  }

  if (market === "crypto") {
    if (entryPrice >= 10000) return 10;
    if (entryPrice >= 1000) return 1;
    if (entryPrice >= 100) return 0.1;
    if (entryPrice >= 1) return 0.01;
    if (entryPrice >= 0.1) return 0.001;
    return 0.0001;
  }

  if (market === "stocks" || market === "etfs" || market === "indices") {
    if (entryPrice >= 1000) return 1;
    if (entryPrice >= 100) return 0.1;
    return 0.01;
  }

  if (market === "metals" || market === "commodities" || market === "futures") {
    if (entryPrice >= 100) return 0.1;
    return 0.01;
  }

  return 0.01;
}

function isCryptoMarketSymbol(asset, market) {
  if (market === "crypto") {
    return true;
  }

  if (!asset) {
    return false;
  }

  if (/(USDT|USDC)$/.test(asset)) {
    return true;
  }

  const knownCryptoUsdPairs = new Set([
    "BTCUSD",
    "ETHUSD",
    "ETCUSD",
    "SOLUSD",
    "XRPUSD",
    "ADAUSD",
    "DOGEUSD",
    "BNBUSD",
    "LTCUSD",
    "BCHUSD",
    "AVAXUSD",
    "LINKUSD",
    "DOTUSD",
    "TRXUSD",
    "MATICUSD",
    "SUIUSD",
    "TONUSD",
    "SHIBUSD"
  ]);

  return knownCryptoUsdPairs.has(asset);
}

/* The one place an image becomes a storable data URL. Resolves
   { name, data, tooLarge } — data is "" when the file is over the inline
   ceiling, so the caller can still keep the filename — or null when the file
   is not an image or could not be read at all. Shared by the trade form and
   the 1c close sheet so there is exactly one size cap in the app. */
function readInlineImage(file) {
  return new Promise((resolve) => {
    if (!file || !String(file.type || "").startsWith("image/")) {
      resolve(null);
      return;
    }

    const name = file.name || `chart-${Date.now()}.png`;
    if (file.size > MAX_INLINE_IMAGE_BYTES) {
      resolve({ name, data: "", tooLarge: true });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      resolve({ name, data: typeof reader.result === "string" ? reader.result : "", tooLarge: false });
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

async function handleScreenshotUpload(event) {
  const file = event.target.files?.[0];
  if (!file) {
    clearScreenshotPreview();
    return;
  }

  ui.tradeFields.screenshotLabel.textContent = file.name;
  const image = await readInlineImage(file);

  if (!image) {
    ui.tradeFields.screenshotData.value = "";
    setMessage(ui.tradeFormMessage, "Failed to read screenshot file.", "error");
    return;
  }

  if (image.tooLarge) {
    ui.tradeFields.screenshotData.value = "";
    ui.tradeFields.screenshotPreview.textContent = "Screenshot attached (too large for inline storage).";
    setMessage(
      ui.tradeFormMessage,
      "Screenshot name saved, but image data skipped (file too large for localStorage).",
      "error"
    );
    return;
  }

  ui.tradeFields.screenshotData.value = image.data;
  ui.tradeFields.screenshotPreview.innerHTML = `<img src="${image.data}" alt="Trade screenshot preview" />`;
  setMessage(ui.tradeFormMessage, "Screenshot embedded with this trade.", "success");
}

function clearScreenshotPreview() {
  ui.tradeFields.screenshotData.value = "";
  ui.tradeFields.screenshotLabel.textContent = "No screenshot selected";
  ui.tradeFields.screenshotPreview.textContent = "No preview";
}

function resetTradeForm(keepDate) {
  const currentDate = ui.tradeFields.tradeDate.value;
  ui.tradeForm.reset();
  ui.tradeFields.tradeId.value = "";
  ui.tradeFields.tradeResult.value = "Auto";
  ui.tradeFields.tradeInProgress.checked = false;
  ui.tradeFields.setupType.value = "Breakout";
  ui.tradeFields.customSetupType.value = "";
  ui.tradeFields.riskPercent.value = String(state.settings.riskPerTrade);
  ui.tradeFields.screenshot.value = "";
  clearScreenshotPreview();
  ui.tradeSubmitBtn.textContent = "Save Trade";
  syncDirectionToggle();
  syncSetupTypeCustomField();
  syncTradeProgressState();

  if (keepDate) {
    ui.tradeFields.tradeDate.value = currentDate || toDateInputValue(new Date());
  } else {
    ui.tradeFields.tradeDate.value = toDateInputValue(new Date());
  }
}

function handleFilterChange() {
  state.filters.dateFrom = ui.filters.dateFrom.value;
  state.filters.dateTo = ui.filters.dateTo.value;
  state.filters.market = ui.filters.market.value;
  state.filters.setup = ui.filters.setup.value;
  state.filters.session = ui.filters.session.value;
  state.filters.timeframe = ui.filters.timeframe.value;
  state.filters.psychology = ui.filters.psychology.value;
  state.filters.search = ui.filters.search.value.trim().toLowerCase();
  renderJournalTable();
}

function clearFilters() {
  ui.filters.dateFrom.value = "";
  ui.filters.dateTo.value = "";
  ui.filters.market.value = "all";
  ui.filters.setup.value = "all";
  ui.filters.session.value = "all";
  ui.filters.timeframe.value = "all";
  ui.filters.psychology.value = "all";
  ui.filters.search.value = "";
  state.filters.quick = "all";
  handleFilterChange();
}

// 1e chip row. Clicking the active chip clears it back to All — a chip that
// cannot be un-pressed is a trap on a filter bar.
function setQuickFilter(value) {
  state.filters.quick = state.filters.quick === value ? "all" : value || "all";
  renderJournalTable();
}

/* "Rule broken": the trade risked more than the configured per-trade cap.
   Same predicate calculateAnalytics uses for riskPerTradeViolations, so the
   chip and the Risk Controls warning list can never disagree. */
function isRuleBroken(trade) {
  return Number(trade.riskPercent) > state.settings.riskPerTrade;
}

/* ══ 1b QUICK CAPTURE ══════════════════════════════════════════════════════
   design-source/1b-quick-capture.html. Three routes to logging a trade:
     1. ⌘K command bar — one line, parsed live by src/lib/tradeParse.js.
     2. The sheet — five fields, a live size/risk/budget readout and the
        pre-trade checklist. Step 2 (Close & journal) is a later phase.
     3. Thumb — the mobile FAB expands into the same sheet in place.
   All three land in the SAME record builder, so a capture is indistinguishable
   from a form entry once saved (and stays editable in the full form).

   Nothing here is fabricated: size comes from the real stop distance and the
   real account balance through the app's own pip model, and the budget line
   comes from the configured daily loss limit and today's actual P&L. Where a
   figure cannot be computed the readout says so instead of showing a number.
   ─────────────────────────────────────────────────────────────────────────── */

function getAccountBalance() {
  const fromAnalytics = state.analytics?.accountBalance;
  if (Number.isFinite(fromAnalytics) && fromAnalytics > 0) {
    return fromAnalytics;
  }
  return state.settings.balanceOverride > 0
    ? state.settings.balanceOverride
    : state.settings.startingBalance;
}

// Position size that puts exactly `riskAmount` at risk between entry and stop,
// through the same pip model calculateTradeMetrics uses to price the trade —
// so the size shown before the click is the size the journal prices after it.
// The inverse of computePositionSize: a trader who speaks in lots gets their
// risk derived from the size instead of the other way round.
function estimateRiskFromSize({ asset, market, entryPrice, stopLoss, positionSize }) {
  const distance = Math.abs(entryPrice - stopLoss);
  if (!(distance > 0) || !(positionSize > 0)) {
    return 0;
  }
  const spec = getPipSpec({ asset, market, entryPrice });
  if (spec.mode === "pip-lot") {
    return (distance / spec.pipSize) * spec.pipValuePerLot * positionSize;
  }
  return distance * positionSize;
}

function computePositionSize({ asset, market, entryPrice, stopLoss, riskAmount }) {
  const distance = Math.abs(entryPrice - stopLoss);
  if (!(distance > 0) || !(riskAmount > 0)) {
    return 0;
  }

  const spec = getPipSpec({ asset, market, entryPrice });
  if (spec.mode === "pip-lot") {
    const perLot = (distance / spec.pipSize) * spec.pipValuePerLot;
    return perLot > 0 ? riskAmount / perLot : 0;
  }
  return riskAmount / distance;
}

// "0.28 BTC" / "0.42 lots". Pip-lot instruments are sized in lots; unit
// instruments are sized in the base asset, so the suffix names it.
function formatPositionSize(size, asset, market) {
  if (!(size > 0)) {
    return "—";
  }

  const spec = getPipSpec({ asset, market, entryPrice: 1 });
  const rounded = size >= 100 ? size.toFixed(0) : size >= 1 ? size.toFixed(2) : size.toFixed(4);
  const trimmed = rounded.includes(".") ? rounded.replace(/0+$/, "").replace(/\.$/, "") : rounded;
  if (spec.mode === "pip-lot") {
    return `${trimmed} ${size === 1 ? "lot" : "lots"}`;
  }
  const base = String(asset || "").toUpperCase().replace(/(USDT|USDC|USD)$/, "");
  return base ? `${trimmed} ${base}` : trimmed;
}

// What is left of today's loss budget right now, from the configured limit and
// today's realised P&L. Returns null when no daily limit is set — the readout
// then says so rather than inventing a headroom figure.
function getDailyBudgetLeft() {
  const limit = state.settings.dailyMaxLoss;
  if (!(limit > 0)) {
    return null;
  }
  const todayPnl = state.analytics?.todayPnl || 0;
  return Math.max(limit - Math.max(-todayPnl, 0), 0);
}

// Context the five-field sheet does not ask for. Structural only: the session
// from the real clock, the market from the symbol, the setup and timeframe
// carried over from the last trade. Psychology and execution quality are
// deliberately NOT carried over — those are post-trade judgements and belong
// to step 2, so they keep the schema defaults until the trader grades them.
function inferTradeContext(symbol) {
  const last = state.trades.slice().sort(sortTradesDesc)[0] || null;
  const upcoming = getNextSessionOpen(new Date());
  return {
    date: toDateInputValue(new Date()),
    session: upcoming?.name || last?.session || "Custom",
    market: inferMarket(symbol) === "Other" ? last?.market || "Other" : inferMarket(symbol),
    setupType: last?.setupType || "Breakout",
    timeframe: last?.timeframe || "M15",
    psychology: "Focused",
    executionQuality: "B"
  };
}

// The one place all three capture routes build a record. Always an OPEN trade:
// exits, result and the journal note are step 2's job.
function saveCapturedTrade(value, preTradeRules, preTradeRulesAsked) {
  const context = inferTradeContext(value.symbol);
  const trade = buildTradeRecord({
    ...consumePendingCooldown(),
    ...context,
    asset: value.symbol,
    direction: value.direction,
    entryPrice: value.entryPrice,
    stopLoss: value.stopLoss,
    takeProfit: value.takeProfit || 0,
    exitPrice: 0,
    riskPercent: value.riskPercent,
    positionSize: value.positionSize,
    tradeResult: "Auto",
    status: "open",
    screenshotName: "",
    screenshotData: "",
    notes: "",
    preTradeRules: Array.from(preTradeRules || []),
    preTradeRulesAsked: Array.from(preTradeRulesAsked || [])
  });

  state.trades.push(trade);
  persistState();
  renderAll();
  refreshLivePrices({ immediate: true });
  return trade;
}

/* `onUndo` turns the confirmation into an action. textContent wipes any button
   from the previous toast first, so an expired undo can never be clicked. */
function showCaptureToast(text, tone = "success", options = {}) {
  if (!ui.captureToast) {
    return;
  }
  const { onUndo = null, undoLabel = "Undo", duration = 5000 } = options;
  ui.captureToast.textContent = text;
  ui.captureToast.dataset.tone = tone;
  if (onUndo) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "capture-toast-undo";
    button.textContent = undoLabel;
    button.addEventListener("click", () => {
      window.clearTimeout(captureToastTimer);
      ui.captureToast.hidden = true;
      onUndo();
    });
    ui.captureToast.appendChild(button);
  }
  ui.captureToast.hidden = false;
  window.clearTimeout(captureToastTimer);
  captureToastTimer = window.setTimeout(() => {
    ui.captureToast.hidden = true;
  }, duration);
}

// Route split. A command line needs a keyboard; a touch viewport gets the
// sheet, which is the same five fields with thumbs instead of syntax.
function openQuickCapture() {
  if (!canAccessApp()) {
    return;
  }
  if (isMobileViewport() || window.matchMedia("(pointer: coarse)").matches) {
    openTradeSheet();
    return;
  }
  openCaptureBar();
}

/* ── Route 1: the ⌘K command bar ─────────────────────────────────────────── */

function openCaptureBar() {
  if (!ui.captureBar || ui.captureBar.open) {
    return;
  }
  ui.captureInput.value = "";
  renderCaptureReadout();
  ui.captureBar.showModal();
  ui.captureInput.focus();
}

function closeCaptureBar() {
  if (ui.captureBar?.open) {
    ui.captureBar.close();
  }
}

const CAPTURE_CHIP_TONES = { symbol: "accent", long: "pos", short: "neg", warn: "warn", error: "neg" };

function captureChip(text, tone) {
  const cls = CAPTURE_CHIP_TONES[tone] ? ` cmdk-chip-${CAPTURE_CHIP_TONES[tone]}` : "";
  return `<span class="cmdk-chip${cls}">${escapeHtml(text)}</span>`;
}

function renderCaptureReadout() {
  if (!ui.captureReadout) {
    return;
  }

  const raw = ui.captureInput.value;
  if (!raw.trim()) {
    ui.captureReadout.innerHTML =
      '<p class="cmdk-empty">Symbol, direction, entry, stop, and the risk you are taking. Anything else is optional.</p>';
    return;
  }

  const parsed = parseTradeCommand(raw);
  const value = parsed.value;
  const chips = [];

  if (value.symbol) chips.push(captureChip(value.symbol, "symbol"));
  if (value.direction) {
    chips.push(captureChip(value.direction === "Buy" ? "LONG" : "SHORT", value.direction === "Buy" ? "long" : "short"));
  }
  if (value.entryPrice > 0) chips.push(captureChip(`entry ${formatCapturePrice(value.entryPrice)}`));
  if (value.stopLoss > 0) {
    const stopPips = pipsBetween(value.symbol, value.market, value.entryPrice, value.stopLoss);
    const pipTail = stopPips !== null && value.entryPrice > 0 ? ` · ${formatPips(stopPips)} pips` : "";
    chips.push(captureChip(`stop ${formatCapturePrice(value.stopLoss)}${pipTail}`));
  }

  // Risk %, converted to cash against the REAL account balance. A trader who
  // gives an explicit size instead ("0.02 lots") gets risk derived FROM it.
  const balance = getAccountBalance();
  let riskAmount = 0;
  if (value.positionSize > 0 && !(value.riskCash > 0) && !(value.riskPercent > 0)) {
    riskAmount = estimateRiskFromSize({
      asset: value.symbol,
      market: value.market,
      entryPrice: value.entryPrice,
      stopLoss: value.stopLoss,
      positionSize: value.positionSize
    });
    if (riskAmount > 0) {
      const percent = balance > 0 ? (riskAmount / balance) * 100 : 0;
      value.riskPercent = round(percent);
      chips.push(captureChip(`risk ${formatCurrency(riskAmount)} = ${value.riskPercent}% (from size)`));
    }
  } else if (value.riskCash > 0) {
    riskAmount = value.riskCash;
    const percent = balance > 0 ? (riskAmount / balance) * 100 : 0;
    value.riskPercent = round(percent);
    chips.push(captureChip(`risk ${formatCurrency(riskAmount)} = ${value.riskPercent}%`));
  } else {
    const percent = value.riskPercent > 0 ? value.riskPercent : state.settings.riskPerTrade;
    value.riskPercent = percent;
    riskAmount = (balance * percent) / 100;
    const tail = value.riskPercent > 0 ? "" : " (your default)";
    chips.push(captureChip(`risk ${round(percent)}% = ${formatCurrency(riskAmount)}${tail}`));
  }

  if (!value.positionSize && parsed.ok) {
    value.positionSize = computePositionSize({
      asset: value.symbol,
      market: value.market,
      entryPrice: value.entryPrice,
      stopLoss: value.stopLoss,
      riskAmount
    });
  }
  if (value.positionSize > 0) {
    chips.push(captureChip(`size ${formatPositionSize(value.positionSize, value.symbol, value.market)}`));
  }

  if (value.takeProfit > 0 && value.stopLoss > 0 && value.entryPrice > 0) {
    const rr = Math.abs(value.takeProfit - value.entryPrice) / Math.abs(value.entryPrice - value.stopLoss);
    const targetPips = pipsBetween(value.symbol, value.market, value.entryPrice, value.takeProfit);
    const pipTail = targetPips !== null ? ` · ${formatPips(targetPips)} pips` : "";
    chips.push(captureChip(`target ${formatCapturePrice(value.takeProfit)}${pipTail} · R:R ${rr.toFixed(2)}`));
  } else if (parsed.ok) {
    chips.push(captureChip("no target — R:R unknown", "warn"));
  }

  const status = parsed.ok
    ? '<p class="cmdk-status is-ok">Enter opens this position.</p>'
    : `<p class="cmdk-status is-error">${escapeHtml(parsed.error)}</p>`;

  ui.captureReadout.innerHTML = `<div class="cmdk-chips">${chips.join("")}</div>${status}`;
  ui.captureBar?.classList.toggle("is-invalid", !parsed.ok);
}

// Prices span 1.0855 to 118,400 — keep the significant digits without padding
// a five-figure index price with decimals it does not have.
function formatCapturePrice(price) {
  if (!Number.isFinite(price)) {
    return "—";
  }
  const decimals = price >= 1000 ? 0 : price >= 10 ? 2 : price >= 1 ? 4 : 6;
  return price.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}

// Pip-distance stops/targets ("sl 10p", "tp 20 pips") become real prices
// here, against entry and direction — the parser stays pip-spec-free.
function resolvePipDistances(value) {
  if (!(value.entryPrice > 0) || !value.direction) {
    return value;
  }
  const spec = getPipSpec({ asset: value.symbol, market: value.market, entryPrice: value.entryPrice });
  if (value.stopPips > 0 && !(value.stopLoss > 0)) {
    value.stopLoss =
      value.direction === "Buy"
        ? value.entryPrice - value.stopPips * spec.pipSize
        : value.entryPrice + value.stopPips * spec.pipSize;
  }
  if (value.targetPips > 0 && !(value.takeProfit > 0)) {
    value.takeProfit =
      value.direction === "Buy"
        ? value.entryPrice + value.targetPips * spec.pipSize
        : value.entryPrice - value.targetPips * spec.pipSize;
  }
  return value;
}

function parseTradeCommand(raw) {
  const parsed = parseQuickTrade(raw);
  resolvePipDistances(parsed.value);
  return parsed;
}

function handleCaptureSubmit(event) {
  event.preventDefault();
  const parsed = parseTradeCommand(ui.captureInput.value);
  if (!parsed.ok) {
    // Unparseable input SAYS so rather than saving something wrong.
    renderCaptureReadout();
    flagInvalidField(ui.captureInput);
    return;
  }

  const value = parsed.value;
  const balance = getAccountBalance();
  if (value.riskCash > 0) {
    value.riskPercent = balance > 0 ? round((value.riskCash / balance) * 100) : 0;
  } else if (!(value.riskPercent > 0)) {
    value.riskPercent = state.settings.riskPerTrade;
  }
  const riskAmount = value.riskCash > 0 ? value.riskCash : (balance * value.riskPercent) / 100;

  if (!(value.positionSize > 0)) {
    value.positionSize = computePositionSize({
      asset: value.symbol,
      market: value.market,
      entryPrice: value.entryPrice,
      stopLoss: value.stopLoss,
      riskAmount
    });
  }
  if (!(value.positionSize > 0)) {
    ui.captureReadout.innerHTML =
      '<p class="cmdk-status is-error">Cannot size this trade — set a risk % or a size.</p>';
    return;
  }

  // Command-bar capture ticks no rules AND asks none: both lists stay empty,
  // which is what keeps this trade out of the rule-cost report rather than
  // logging three phantom skips.
  saveCapturedTrade(value, [], []);
  closeCaptureBar();
  showCaptureToast(
    state.auth.guestMode
      ? `${value.symbol} ${value.direction === "Buy" ? "long" : "short"} opened in the demo — nothing here is saved.`
      : `${value.symbol} ${value.direction === "Buy" ? "long" : "short"} opened · ${formatPositionSize(value.positionSize, value.symbol, value.market)} at risk ${formatCurrency(riskAmount)}`
  );
}

/* ── Routes 2 & 3: the sheet ─────────────────────────────────────────────── */

function openTradeSheet(prefill = null) {
  if (!ui.tradeSheet || !canAccessApp() || ui.tradeSheet.open) {
    return;
  }

  setSheetStep(1);
  ui.sheetSymbol.value = prefill?.symbol || "";
  ui.sheetEntry.value = prefill?.entryPrice ? String(prefill.entryPrice) : "";
  ui.sheetStop.value = prefill?.stopLoss ? String(prefill.stopLoss) : "";
  sheetState.direction = prefill?.direction === "Sell" ? "Sell" : "Buy";
  sheetState.rules.clear();

  // Default risk chip = the trader's configured risk-per-trade when it is one
  // of the presets, otherwise Custom pre-filled with it.
  const configured = round(state.settings.riskPerTrade);
  if (["0.5", "1", "2"].includes(String(configured))) {
    sheetState.riskChoice = String(configured);
    ui.sheetRiskCustom.value = "";
  } else {
    sheetState.riskChoice = "custom";
    ui.sheetRiskCustom.value = configured > 0 ? String(configured) : "";
  }

  renderSheetRules();
  syncSheetControls();
  renderSheetReadout();
  setMessage(ui.sheetMessage, "", "");
  ui.tradeSheet.showModal();
  ui.sheetSymbol.focus();
}

function closeTradeSheet() {
  if (ui.tradeSheet?.open) {
    ui.tradeSheet.close();
  }
}

function renderSheetRules() {
  if (!ui.sheetRulesList) {
    return;
  }
  // 1f #02: the list is the trader's own now. Delete every rule and the whole
  // fieldset goes with it — an empty checklist should not leave a legend and a
  // promise about the discipline score standing over nothing.
  const rules = getPreTradeRules();
  const fieldset = ui.sheetRulesList.closest(".sheet-rules");
  if (fieldset) {
    fieldset.hidden = rules.length === 0;
  }
  ui.sheetRulesList.innerHTML = rules
    .map(
      (rule) => `
      <label class="sheet-rule">
        <input type="checkbox" class="sheet-rule-box" value="${escapeHtml(rule.id)}" />
        <span class="sheet-rule-mark" aria-hidden="true"></span>
        <span class="sheet-rule-text">${escapeHtml(rule.label)}</span>
      </label>`
    )
    .join("");
}

function getSheetRiskPercent() {
  if (sheetState.riskChoice === "custom") {
    const custom = parseNumber(ui.sheetRiskCustom.value);
    return Number.isFinite(custom) && custom > 0 ? custom : 0;
  }
  return Number(sheetState.riskChoice) || 0;
}

function syncSheetControls() {
  ui.sheetDirectionButtons.forEach((button) => {
    const isActive = button.dataset.sheetDirection === sheetState.direction;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
  ui.sheetRiskButtons.forEach((button) => {
    const isActive = button.dataset.sheetRisk === sheetState.riskChoice;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
  ui.sheetRiskCustom.hidden = sheetState.riskChoice !== "custom";
}

function readSheetValues() {
  const symbol = resolveSymbol(ui.sheetSymbol.value);
  const market = symbol ? inferMarket(symbol) : "";
  const direction = sheetState.direction;
  const entryPrice = parseNumber(ui.sheetEntry.value);
  // "10p" / "10 pips" in the stop box is a pip DISTANCE off entry — exact
  // prices still work exactly as before. One choke point: the readout, the
  // validation and the submit all read the stop through here.
  const stopRaw = String(ui.sheetStop.value || "").trim();
  const pipMatch = /^(\d*\.?\d+)\s*(?:p|pips?)$/i.exec(stopRaw);
  let stopLoss = parseNumber(stopRaw);
  if (pipMatch && entryPrice > 0) {
    const spec = getPipSpec({ asset: symbol, market, entryPrice });
    const distance = Number(pipMatch[1]) * spec.pipSize;
    stopLoss = direction === "Buy" ? entryPrice - distance : entryPrice + distance;
  }
  return {
    symbol,
    market,
    direction,
    entryPrice,
    stopLoss,
    takeProfit: 0,
    riskPercent: getSheetRiskPercent(),
    positionSize: 0
  };
}

function renderSheetReadout() {
  const value = readSheetValues();
  const balance = getAccountBalance();
  const riskAmount = value.riskPercent > 0 ? (balance * value.riskPercent) / 100 : 0;
  const size = computePositionSize({
    asset: value.symbol,
    market: value.market,
    entryPrice: value.entryPrice,
    stopLoss: value.stopLoss,
    riskAmount
  });

  ui.sheetSize.textContent = size > 0 ? formatPositionSize(size, value.symbol, value.market) : "—";
  ui.sheetAtRisk.textContent = riskAmount > 0 ? formatCurrency(riskAmount) : "—";

  // Pips ready at the point of journalling: stop distance in the instrument's
  // own pip size, from the same spec the P&L engine settles with.
  if (ui.sheetPips) {
    const stopPips = pipsBetween(value.symbol, value.market, value.entryPrice, value.stopLoss);
    ui.sheetPips.textContent = stopPips !== null ? `${formatPips(stopPips)} pips` : "—";
  }

  const budgetLeft = getDailyBudgetLeft();
  if (budgetLeft === null) {
    ui.sheetBudgetAfter.textContent = "no limit set";
    ui.sheetBudgetAfter.className = "sheet-readout-val is-muted";
  } else if (!(riskAmount > 0)) {
    ui.sheetBudgetAfter.textContent = `${formatCurrency(budgetLeft)} left`;
    ui.sheetBudgetAfter.className = "sheet-readout-val";
  } else {
    const after = budgetLeft - riskAmount;
    ui.sheetBudgetAfter.textContent =
      after >= 0 ? `${formatCurrency(after)} left` : `${formatCurrency(Math.abs(after))} over`;
    ui.sheetBudgetAfter.className = `sheet-readout-val ${after >= 0 ? "is-pos" : "is-neg"}`;
  }
}

function validateSheet() {
  const value = readSheetValues();
  if (!value.symbol) {
    return { ok: false, error: "Which instrument?", field: ui.sheetSymbol };
  }
  if (!(value.entryPrice > 0)) {
    return { ok: false, error: "Entry must be greater than zero.", field: ui.sheetEntry };
  }
  if (!(value.stopLoss > 0)) {
    return { ok: false, error: "A stop is what makes the size real. Add one.", field: ui.sheetStop };
  }
  if (value.direction === "Buy" && value.stopLoss >= value.entryPrice) {
    return { ok: false, error: "Long: the stop must sit below entry.", field: ui.sheetStop };
  }
  if (value.direction === "Sell" && value.stopLoss <= value.entryPrice) {
    return { ok: false, error: "Short: the stop must sit above entry.", field: ui.sheetStop };
  }
  if (!(value.riskPercent > 0)) {
    return { ok: false, error: "Pick a risk, or type a custom one.", field: ui.sheetRiskCustom };
  }

  const riskAmount = (getAccountBalance() * value.riskPercent) / 100;
  value.positionSize = computePositionSize({
    asset: value.symbol,
    market: value.market,
    entryPrice: value.entryPrice,
    stopLoss: value.stopLoss,
    riskAmount
  });
  if (!(value.positionSize > 0)) {
    return { ok: false, error: "Cannot size this trade from those numbers.", field: ui.sheetEntry };
  }

  return { ok: true, value, riskAmount };
}

function handleSheetSubmit(event) {
  event.preventDefault();
  const check = validateSheet();
  if (!check.ok) {
    setMessage(ui.sheetMessage, check.error, "error");
    flagInvalidField(check.field);
    return;
  }

  saveCapturedTrade(
    check.value,
    sheetState.rules,
    getPreTradeRules().map((rule) => rule.id)
  );
  closeTradeSheet();
  showCaptureToast(
    state.auth.guestMode
      ? `${check.value.symbol} ${check.value.direction === "Buy" ? "long" : "short"} opened in the demo — nothing here is saved.`
      : `${check.value.symbol} ${check.value.direction === "Buy" ? "long" : "short"} opened · ${formatPositionSize(check.value.positionSize, check.value.symbol, check.value.market)} at risk ${formatCurrency(check.riskAmount)}`
  );
}

// "Add detail": hand the five fields to the full form for anyone who wants
// every field. Nothing is saved here — the form's own Save Trade does that.
function handleSheetAddDetail() {
  const value = readSheetValues();
  const context = inferTradeContext(value.symbol);
  closeTradeSheet();
  resetTradeForm(false);

  if (value.symbol) {
    ui.tradeFields.asset.value = value.symbol;
    ui.tradeFields.market.value = context.market;
  }
  ui.tradeFields.session.value = context.session;
  ui.tradeFields.direction.value = value.direction;
  if (value.entryPrice > 0) ui.tradeFields.entryPrice.value = String(value.entryPrice);
  if (value.stopLoss > 0) ui.tradeFields.stopLoss.value = String(value.stopLoss);
  if (value.riskPercent > 0) ui.tradeFields.riskPercent.value = String(value.riskPercent);

  const riskAmount = (getAccountBalance() * value.riskPercent) / 100;
  const size = computePositionSize({
    asset: value.symbol,
    market: value.market,
    entryPrice: value.entryPrice,
    stopLoss: value.stopLoss,
    riskAmount
  });
  if (size > 0) {
    // round() in core.js is 2dp; sub-cent lot sizes need four.
    ui.tradeFields.positionSize.value = String(Math.round(size * 10000) / 10000);
  }

  ui.tradeFields.tradeInProgress.checked = true;
  syncDirectionToggle();
  syncTradeProgressState();
  switchView("trade-entry");
  ui.tradeFields.takeProfit.focus();
  setMessage(ui.tradeFormMessage, "Carried over from the sheet. Fill the rest and save.", "success");
}

/* ── 1c: step 2 — close & journal ─────────────────────────────────────────
   design-source/1c-journaling.html. The same <dialog> as step 1: the two
   halves are two forms and only one is ever visible, so "open → close →
   journal" is one object and the step indicator is honest.

   Everything the trade already knows is printed. The four inputs are the
   ones no database can infer, and only the note needs a keyboard. */

function setSheetStep(step) {
  ui.tradeSheetForm.hidden = step !== 1;
  ui.journalSheetForm.hidden = step !== 2;
}

function openJournalSheet(id) {
  const trade = getExistingTrade(id);
  if (!ui.journalSheetForm || !canAccessApp() || !trade || trade.status === "open") {
    return;
  }

  journalState.tradeId = trade.id;
  journalState.psychology = trade.psychology || "Focused";
  journalState.executionQuality = trade.executionQuality || "B";
  journalState.tags = new Set(Array.isArray(trade.mistakeTags) ? trade.mistakeTags : []);
  journalState.screenshotName = trade.screenshotName || "";
  journalState.screenshotData = trade.screenshotData || "";

  ui.journalNote.value = trade.notes || "";
  ui.journalNewTagInput.hidden = true;
  setMessage(ui.journalSheetMessage, "", "");
  renderJournalHeader(trade);
  renderJournalChips();
  renderJournalChart();
  resetVoicePanel(trade.id);

  setSheetStep(2);
  if (!ui.tradeSheet.open) {
    ui.tradeSheet.showModal();
  }
  ui.journalMoodChips.querySelector(".jrn-chip")?.focus();
}

function renderJournalHeader(trade) {
  const closed = parseIsoDate(trade.closedAt || trade.updatedAt || trade.createdAt);
  const time = closed
    ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(closed)
    : "";
  // "Closed · 14:22 · London" — the session is the trade's own, not a guess.
  ui.journalClosedAt.textContent = ["Closed", time, String(trade.session || "").trim()]
    .filter(Boolean)
    .join(" · ");

  ui.journalSymbol.textContent = trade.asset || "—";
  ui.journalMeta.textContent = [
    trade.direction === "Sell" ? "SHORT" : "LONG",
    trade.timeframe,
    trade.setupType
  ]
    .filter(Boolean)
    .join(" · ");

  const net = Number(trade.netPnl) || 0;
  ui.journalNet.textContent = formatSignedCurrency(net);
  ui.journalNet.className = `jrn-net ${net > 0 ? "is-pos" : net < 0 ? "is-neg" : ""}`.trim();

  const rMultiple = Number(trade.rMultiple);
  const rLabel = Number.isFinite(rMultiple)
    ? `${rMultiple > 0 ? "+" : ""}${rMultiple.toFixed(2)}R`
    : "—";
  // The result word carries win/loss as text, so colour and depth are never
  // the only signal (WCAG 1.4.1).
  ui.journalSub.textContent = `${trade.result || "—"} · ${rLabel} · ${formatSignedPips(Number(trade.pips))}`;
}

function journalChipHtml(kind, value, label, active, className) {
  return `<button class="${className}" type="button" data-journal-${kind}="${escapeHtml(value)}" aria-pressed="${active}">${escapeHtml(label)}</button>`;
}

// The tag vocabulary IS the trades: the four seeds plus every tag any trade
// already carries. A custom tag therefore persists the moment the trade it
// was added to is saved, with no second store to migrate or keep in sync.
function getKnownMistakeTags() {
  const seen = new Map();
  const add = (tag) => {
    const clean = String(tag || "").trim();
    if (clean && !seen.has(clean.toLowerCase())) {
      seen.set(clean.toLowerCase(), clean);
    }
  };
  DEFAULT_MISTAKE_TAGS.forEach(add);
  state.trades.forEach((trade) => (trade.mistakeTags || []).forEach(add));
  journalState.tags.forEach(add);
  return Array.from(seen.values());
}

function renderJournalChips() {
  ui.journalMoodChips.innerHTML = JOURNAL_MOODS.map((mood) =>
    journalChipHtml("mood", mood.value, mood.label, journalState.psychology === mood.value, "jrn-chip")
  ).join("");

  ui.journalGradeChips.innerHTML = JOURNAL_GRADES.map((grade) =>
    journalChipHtml("grade", grade, grade, journalState.executionQuality === grade, "jrn-grade")
  ).join("");

  ui.journalTagChips.innerHTML =
    getKnownMistakeTags()
      .map((tag) => journalChipHtml("tag", tag, tag, journalState.tags.has(tag), "jrn-chip"))
      .join("") +
    `<button class="jrn-chip-add" type="button" data-journal-add-tag>+ new tag</button>`;
}

function renderJournalChart() {
  if (journalState.screenshotData) {
    ui.journalDrop.classList.add("is-filled");
    ui.journalDrop.innerHTML = `<img src="${journalState.screenshotData}" alt="Chart screenshot attached to this trade" />`;
    return;
  }

  ui.journalDrop.classList.remove("is-filled");
  ui.journalDrop.innerHTML = journalState.screenshotName
    ? `<span>${escapeHtml(journalState.screenshotName)}<br />filename only — too large to store</span>`
    : "<span>drop, paste<br />or pick a screenshot</span>";
}

async function acceptJournalImage(file) {
  const image = await readInlineImage(file);
  if (!image) {
    setMessage(ui.journalSheetMessage, "That is not an image this browser can read.", "error");
    return;
  }

  journalState.screenshotName = image.name;
  journalState.screenshotData = image.data;
  renderJournalChart();
  setMessage(
    ui.journalSheetMessage,
    image.tooLarge
      ? `Over ${Math.round(MAX_INLINE_IMAGE_BYTES / 1024)}KB — the filename is stored, the image is not.`
      : "Chart attached.",
    image.tooLarge ? "error" : "success"
  );
}

/* ── 1f #06 voice notes ────────────────────────────────────────────────────
   design-source/1f-features.html #06: "Thirty seconds of talking beats a
   paragraph nobody types."

   What the design asked for and this does NOT do: transcription. There is no
   speech-to-text in this app — no API, no model, nothing — so a clip is audio
   and only audio. Every string below says that out loud rather than letting
   the trader assume a recording is as findable as a written note. If it turns
   out clips get recorded and never found again, that is the feature failing
   honestly, which beats it failing quietly.

   Where the audio lives, and why it is not with the trade: STORAGE_KEYS.voice
   is a separate object, `{ [tradeId]: { data, mime, seconds, createdAt } }`,
   written through the same journalStore() indirection as everything else (so
   demo mode's clips die with the tab). It is deliberately NOT part of the
   trade record, because the trade record is what persistState() POSTs to the
   server on every autosave — a 150KB clip in there would ride on every sync
   for the rest of the journal's life. The price of that call, stated plainly
   in the UI: clips are device-local, are not synced, and are not in exports. */

// The store, read defensively — a hand-edited or half-written key must degrade
// to "no clips", never to a crash on the journal sheet.
function voiceStoreRead() {
  const raw = readStorageJson(journalKey(STORAGE_KEYS.voice), {}, journalStore());
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

// Unlike writeStorageJson this REPORTS failure. A quota error here has to
// reach the trader as a sentence; swallowing it into console.error is how a
// clip silently fails to exist.
function voiceStoreWrite(map) {
  try {
    journalStore().setItem(journalKey(STORAGE_KEYS.voice), JSON.stringify(map));
    return true;
  } catch (error) {
    console.error("Voice note write failed:", error);
    return false;
  }
}

// The trust boundary. Everything this returns goes straight into an <audio
// src>, so the scheme is checked here once rather than at each of the three
// places that play a clip.
function voiceClipFor(tradeId) {
  const clip = voiceStoreRead()[String(tradeId || "")];
  return clip && typeof clip.data === "string" && clip.data.startsWith("data:audio/") ? clip : null;
}

function voiceUsedChars(map, exceptTradeId) {
  return Object.keys(map).reduce(
    (sum, id) => (id === String(exceptTradeId) ? sum : sum + String(map[id]?.data || "").length),
    0
  );
}

// KB of STORED CHARACTERS — what the quota actually counts. Reporting the
// decoded audio size instead would flatter every number here by a third.
function formatVoiceSize(chars) {
  const kb = Number(chars) / 1024;
  return `${kb > 0 && kb < 1 ? kb.toFixed(1) : Math.round(kb)} KB`;
}

function formatVoiceDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// Names the oldest clip so a "storage is full" message can point at something
// the trader can actually go and delete, instead of telling them to guess.
function oldestVoiceClipLabel() {
  const map = voiceStoreRead();
  const oldest = Object.keys(map)
    .filter((id) => map[id] && map[id].data)
    .sort((a, b) => String(map[a].createdAt || "").localeCompare(String(map[b].createdAt || "")))[0];
  if (!oldest) {
    return "";
  }
  const trade = allTrades().find((item) => String(item.id) === oldest);
  return trade ? `${trade.asset} on ${formatIsoShort(trade.date)}` : "";
}

function pruneVoiceNotes() {
  const map = voiceStoreRead();
  const ids = new Set(allTrades().map((trade) => String(trade.id)));
  const kept = {};
  let dropped = 0;
  Object.keys(map).forEach((id) => {
    if (ids.has(id)) {
      kept[id] = map[id];
    } else {
      dropped += 1;
    }
  });
  if (dropped) {
    voiceStoreWrite(kept);
  }
}

/* The only write path. Returns "" on success, or the sentence to show.

   Both ceilings are checked BEFORE setItem, because a blown quota does not
   fail politely — it throws on the write that happens to be next, which could
   just as easily be the trades key. Rejecting a clip costs the trader one
   recording; letting the quota go costs them the journal. */
function commitVoiceClip(tradeId, clip) {
  const id = String(tradeId || "");
  const map = voiceStoreRead();

  if (!clip) {
    if (!(id in map)) {
      return "";
    }
    delete map[id];
    return voiceStoreWrite(map) ? "" : "The browser refused to update voice storage.";
  }

  if (clip.data.length > VOICE_MAX_CLIP_CHARS) {
    return `That clip is ${formatVoiceSize(clip.data.length)}, over the ${formatVoiceSize(
      VOICE_MAX_CLIP_CHARS
    )} per-clip ceiling. It was not saved — everything else on this trade was.`;
  }

  if (voiceUsedChars(map, id) + clip.data.length > VOICE_TOTAL_CHARS) {
    const oldest = oldestVoiceClipLabel();
    return `Voice storage is full at ${formatVoiceSize(VOICE_TOTAL_CHARS)}. The clip was not saved — everything else on this trade was.${
      oldest ? ` The oldest clip is ${oldest}; open it from Trade Review and delete it to free space.` : ""
    }`;
  }

  // An unchanged clip keeps its original timestamp, so re-saving a trade does
  // not shuffle it to the back of the "oldest clip" queue.
  const previous = map[id];
  map[id] = {
    data: clip.data,
    mime: clip.mime || "",
    seconds: clip.seconds,
    createdAt: previous && previous.data === clip.data ? previous.createdAt : new Date().toISOString()
  };
  return voiceStoreWrite(map)
    ? ""
    : "The browser refused the clip — storage is full. Everything else on this trade was saved.";
}

// The first container this browser will record. Opus is the target; Safari
// answers audio/mp4 (AAC) and that is fine — the clip is played back by the
// same browser that wrote it, and the data URL carries its own type. Returns
// "" to mean "let the browser choose", null to mean "cannot record at all".
function voiceMimeType() {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return typeof MediaRecorder === "undefined" ? null : "";
  }
  return (
    ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"].find((type) =>
      MediaRecorder.isTypeSupported(type)
    ) || ""
  );
}

function canRecordVoice() {
  return voiceMimeType() !== null && typeof navigator.mediaDevices?.getUserMedia === "function";
}

function isVoiceRecording() {
  return Boolean(voiceState.recorder) && voiceState.recorder.state === "recording";
}

function voiceElapsedSeconds() {
  return voiceState.startedAt ? Math.floor((Date.now() - voiceState.startedAt) / 1000) : 0;
}

function setVoiceStatus(text, tone) {
  if (!ui.journalVoiceState) {
    return;
  }
  ui.journalVoiceState.textContent = text;
  ui.journalVoiceState.className = `jrn-voice-state${tone ? ` is-${tone}` : ""}`;
}

// Real numbers only: what is actually stored, against the ceiling that is
// actually enforced, with the staged clip counted the way it will be counted
// on save.
function voiceQuotaLine() {
  const map = voiceStoreRead();
  const others = Object.keys(map).filter(
    (id) => map[id] && map[id].data && id !== String(journalState.tradeId)
  );
  const used = others.reduce((sum, id) => sum + map[id].data.length, 0);
  const staged = voiceState.clip ? voiceState.clip.data.length : 0;
  const count = others.length + (staged ? 1 : 0);
  // The warning arrives while there is still room to act on it, not at the
  // refusal. 80% of the budget is roughly two more full-length clips.
  const near = used + staged >= VOICE_TOTAL_CHARS * 0.8;
  const oldest = near ? oldestVoiceClipLabel() : "";
  return (
    `Audio only — a clip is not searchable, is not in exports, and stays on this device (it is never synced). ` +
    `${formatVoiceSize(used + staged)} of ${formatVoiceSize(VOICE_TOTAL_CHARS)} used across ${count} ${
      count === 1 ? "clip" : "clips"
    }.` +
    (near
      ? ` Nearly full — new clips will be refused soon.${
          oldest ? ` The oldest is ${oldest}; delete it from Trade Review to free space.` : ""
        }`
      : "")
  );
}

function renderVoicePanel() {
  if (!ui.journalVoiceBtn) {
    return;
  }

  const recording = isVoiceRecording();
  const hasClip = Boolean(voiceState.clip) && !recording;

  ui.journalVoiceBtn.textContent = recording ? "Stop" : voiceState.clip ? "Re-record" : "Record";
  ui.journalVoiceBtn.classList.toggle("is-recording", recording);
  ui.journalVoiceBtn.setAttribute("aria-pressed", String(recording));

  ui.journalVoiceTime.hidden = !recording;
  ui.journalVoiceMeter.hidden = !recording;
  if (recording) {
    ui.journalVoiceTime.textContent = formatVoiceDuration(voiceElapsedSeconds());
  } else {
    ui.journalVoiceLevel.style.width = "0%";
  }

  ui.journalVoicePlayer.hidden = !hasClip;
  ui.journalVoiceActions.hidden = !hasClip;
  if (hasClip) {
    if (ui.journalVoicePlayer.getAttribute("src") !== voiceState.clip.data) {
      ui.journalVoicePlayer.src = voiceState.clip.data;
    }
  } else {
    ui.journalVoicePlayer.pause?.();
    ui.journalVoicePlayer.removeAttribute("src");
  }

  ui.journalVoiceQuota.textContent = voiceQuotaLine();
}

/* A live readout, not decoration: the meter is the only proof the microphone
   is hearing anything at all. Reduced motion therefore keeps the READING and
   drops the eased travel — the CSS transition on .jrn-voice-level is what the
   media query removes, not this loop. Dropping the meter under reduced motion
   would take away information, not movement. */
function startVoiceMeter(stream) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) {
    return;
  }

  try {
    voiceState.audioCtx = new Ctx();
    voiceState.analyser = voiceState.audioCtx.createAnalyser();
    voiceState.analyser.fftSize = 512;
    voiceState.levels = new Uint8Array(voiceState.analyser.frequencyBinCount);
    voiceState.audioCtx.createMediaStreamSource(stream).connect(voiceState.analyser);
  } catch (error) {
    voiceState.analyser = null;
    return;
  }

  const paint = () => {
    if (!voiceState.analyser) {
      return;
    }
    voiceState.analyser.getByteTimeDomainData(voiceState.levels);
    let peak = 0;
    for (let i = 0; i < voiceState.levels.length; i += 1) {
      peak = Math.max(peak, Math.abs(voiceState.levels[i] - 128));
    }
    // 128 is full scale. Ordinary speech peaks well below it, so the ×2.4 is
    // what makes a normal voice fill most of the bar instead of a sliver.
    ui.journalVoiceLevel.style.width = `${Math.min(100, Math.round((peak / 128) * 240))}%`;
    voiceState.frame = window.requestAnimationFrame(paint);
  };
  paint();
}

/* Stops the tracks. Not cosmetic and not optional: leaving them live keeps the
   browser's "this site is recording" indicator burning after the sheet is
   gone, which is the single most alarming thing a journal app can do. */
function releaseVoiceHardware() {
  if (voiceState.frame) {
    window.cancelAnimationFrame(voiceState.frame);
    voiceState.frame = 0;
  }
  if (voiceState.timerId) {
    window.clearInterval(voiceState.timerId);
    voiceState.timerId = 0;
  }
  voiceState.analyser = null;
  voiceState.levels = null;
  if (voiceState.audioCtx) {
    voiceState.audioCtx.close().catch(() => {});
    voiceState.audioCtx = null;
  }
  if (voiceState.stream) {
    voiceState.stream.getTracks().forEach((track) => track.stop());
    voiceState.stream = null;
  }
  voiceState.recorder = null;
  voiceState.startedAt = 0;
}

function tickVoiceTimer() {
  const seconds = voiceElapsedSeconds();
  ui.journalVoiceTime.textContent = formatVoiceDuration(seconds);
  ui.journalVoiceTime.classList.toggle("is-warn", seconds >= VOICE_WARN_SECONDS);
  if (seconds >= VOICE_WARN_SECONDS && seconds < VOICE_MAX_SECONDS) {
    setVoiceStatus(`${VOICE_MAX_SECONDS - seconds}s left — it stops on its own at ${formatVoiceDuration(VOICE_MAX_SECONDS)}.`, "warn");
  }
  // A hard stop, not a nudge. The per-clip ceiling is the only thing between a
  // forgotten recorder and a blown storage quota.
  if (seconds >= VOICE_MAX_SECONDS) {
    stopVoiceRecording();
  }
}

async function startVoiceRecording() {
  if (!canRecordVoice()) {
    setVoiceStatus("This browser cannot record audio. Type the note instead.", "error");
    return;
  }

  setVoiceStatus("Waiting for the microphone…", "");
  let stream;
  try {
    // Permission is asked HERE, on the press, and nowhere else in the app.
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    const denied = error?.name === "NotAllowedError" || error?.name === "SecurityError";
    setVoiceStatus(
      denied
        ? "Microphone access was refused. Allow it for this site in the browser's settings, or type the note."
        : "No microphone the browser could open. Type the note instead.",
      "error"
    );
    return;
  }

  // The sheet may have been closed while the permission prompt was up.
  if (!isJournalSheetOpen()) {
    stream.getTracks().forEach((track) => track.stop());
    return;
  }

  const mimeType = voiceMimeType();
  const options = { audioBitsPerSecond: VOICE_BITS_PER_SECOND };
  if (mimeType) {
    options.mimeType = mimeType;
  }

  let recorder;
  try {
    recorder = new MediaRecorder(stream, options);
  } catch (error) {
    // A browser that rejects the bitrate hint still records; it just records
    // fatter, which the per-clip ceiling catches at the end.
    recorder = new MediaRecorder(stream);
  }

  voiceState.stream = stream;
  voiceState.recorder = recorder;
  voiceState.chunks = [];
  voiceState.aborted = false;
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data && event.data.size) {
      voiceState.chunks.push(event.data);
    }
  });
  recorder.addEventListener("stop", finishVoiceRecording);
  recorder.start();
  voiceState.startedAt = Date.now();
  voiceState.timerId = window.setInterval(tickVoiceTimer, 200);
  startVoiceMeter(stream);
  renderVoicePanel();
  setVoiceStatus(`Recording — it stops on its own at ${formatVoiceDuration(VOICE_MAX_SECONDS)}.`, "rec");
}

function stopVoiceRecording() {
  if (voiceState.timerId) {
    window.clearInterval(voiceState.timerId);
    voiceState.timerId = 0;
  }
  if (voiceState.recorder && voiceState.recorder.state !== "inactive") {
    voiceState.recorder.stop();
    return;
  }
  releaseVoiceHardware();
  renderVoicePanel();
}

// Closing the sheet mid-recording throws the take away rather than staging it.
function abandonVoiceRecording() {
  if (voiceState.recorder && voiceState.recorder.state !== "inactive") {
    voiceState.aborted = true;
    try {
      voiceState.recorder.stop();
    } catch (error) {
      releaseVoiceHardware();
    }
    return;
  }
  releaseVoiceHardware();
}

function finishVoiceRecording() {
  const seconds = Math.min(VOICE_MAX_SECONDS, Math.max(1, voiceElapsedSeconds()));
  const mime = voiceState.recorder?.mimeType || voiceState.chunks[0]?.type || "audio/webm";
  const chunks = voiceState.chunks;
  const aborted = voiceState.aborted;
  voiceState.chunks = [];
  voiceState.aborted = false;
  releaseVoiceHardware();
  renderVoicePanel();

  if (aborted || !chunks.length) {
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const data = String(reader.result || "");
    if (!data.startsWith("data:audio/")) {
      setVoiceStatus("The browser produced something that is not audio. Nothing was kept.", "error");
      return;
    }
    // Rejected here rather than at save, so the answer is "record a shorter
    // one" while the trader is still holding the thought.
    if (data.length > VOICE_MAX_CLIP_CHARS) {
      setVoiceStatus(
        `That clip is ${formatVoiceSize(data.length)}, over the ${formatVoiceSize(
          VOICE_MAX_CLIP_CHARS
        )} per-clip ceiling. Record a shorter one.`,
        "error"
      );
      return;
    }
    voiceState.clip = { data, mime, seconds };
    renderVoicePanel();
    setVoiceStatus(
      `Clip ready — ${formatVoiceDuration(seconds)}, ${formatVoiceSize(data.length)}. It saves with the trade.`,
      "success"
    );
  };
  reader.onerror = () => setVoiceStatus("The browser could not read the recording.", "error");
  reader.readAsDataURL(new Blob(chunks, { type: mime }));
}

function deleteStagedVoiceClip() {
  voiceState.clip = null;
  renderVoicePanel();
  setVoiceStatus("Clip removed. It goes for good when you save this trade.", "warn");
}

// Called every time the sheet opens: adopt whatever is stored for this trade,
// discard anything left over from the last one.
function resetVoicePanel(tradeId) {
  abandonVoiceRecording();
  const stored = voiceClipFor(tradeId);
  voiceState.clip = stored
    ? { data: stored.data, mime: stored.mime || "", seconds: Number(stored.seconds) || 0 }
    : null;
  renderVoicePanel();

  if (!canRecordVoice()) {
    ui.journalVoiceBtn.disabled = true;
    setVoiceStatus("This browser cannot record audio. Type the note instead.", "error");
    return;
  }
  ui.journalVoiceBtn.disabled = false;
  setVoiceStatus(
    voiceState.clip
      ? `Clip attached — ${formatVoiceDuration(voiceState.clip.seconds)}.`
      : `Say it instead of typing it. ${VOICE_MAX_SECONDS} seconds max.`,
    ""
  );
}

function bindVoiceNote() {
  if (!ui.journalVoiceBtn) {
    return;
  }
  ui.journalVoiceBtn.addEventListener("click", () => {
    if (isVoiceRecording()) {
      stopVoiceRecording();
    } else {
      startVoiceRecording();
    }
  });
  ui.journalVoiceDeleteBtn.addEventListener("click", deleteStagedVoiceClip);
  // Escape, the backdrop and the × all end at the dialog's own close event, so
  // this one listener is what guarantees the microphone is released.
  ui.tradeSheet?.addEventListener("close", abandonVoiceRecording);
}

function isJournalSheetOpen() {
  return Boolean(ui.tradeSheet?.open) && ui.journalSheetForm && !ui.journalSheetForm.hidden;
}

// ⌘V anywhere in the sheet. The textarea keeps text pastes; only an image on
// the clipboard is intercepted.
function handleJournalPaste(event) {
  if (!isJournalSheetOpen()) {
    return;
  }
  const item = Array.from(event.clipboardData?.items || []).find((entry) =>
    String(entry.type || "").startsWith("image/")
  );
  if (!item) {
    return;
  }
  event.preventDefault();
  acceptJournalImage(item.getAsFile());
}

// The button is a convenience for pointer users; it is hidden outright where
// navigator.clipboard.read() does not exist (Firefox), because the keyboard
// paste and the drop zone already cover that case.
async function handleJournalPasteButton() {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((entry) => entry.startsWith("image/"));
      if (type) {
        acceptJournalImage(new File([await item.getType(type)], "pasted-chart.png", { type }));
        return;
      }
    }
    setMessage(ui.journalSheetMessage, "No image on the clipboard.", "error");
  } catch {
    setMessage(
      ui.journalSheetMessage,
      "The browser blocked clipboard access. Press ⌘V with the sheet focused, or drop the file on the chart box.",
      "error"
    );
  }
}

function commitNewMistakeTag(focusChip) {
  const raw = ui.journalNewTagInput.value.trim().replace(/\s+/g, " ").slice(0, 28);
  ui.journalNewTagInput.hidden = true;
  ui.journalNewTagInput.value = "";
  if (!raw) {
    return;
  }
  // Fold onto an existing tag when it only differs by case, so the vocabulary
  // does not grow "Moved stop" AND "moved stop".
  const existing = getKnownMistakeTags().find((tag) => tag.toLowerCase() === raw.toLowerCase());
  const tag = existing || raw;
  journalState.tags.add(tag);
  renderJournalChips();
  if (focusChip) {
    ui.journalTagChips.querySelector(`[data-journal-tag="${CSS.escape(tag)}"]`)?.focus();
  }
}

// Single-choice group: exactly one chip pressed, and the pressed state is
// flipped IN PLACE rather than by re-rendering — a keyboard user who presses
// Enter on a chip must not have the focused element yanked out from under
// them.
function setJournalGroupPressed(group, chosen) {
  group.querySelectorAll("button").forEach((button) => {
    button.setAttribute("aria-pressed", String(button === chosen));
  });
}

function handleJournalChipClick(event) {
  const chip = event.target.closest("button");
  if (!chip) {
    return;
  }

  if (chip.dataset.journalMood) {
    journalState.psychology = chip.dataset.journalMood;
    setJournalGroupPressed(ui.journalMoodChips, chip);
  } else if (chip.dataset.journalGrade) {
    journalState.executionQuality = chip.dataset.journalGrade;
    setJournalGroupPressed(ui.journalGradeChips, chip);
  } else if (chip.dataset.journalTag) {
    const tag = chip.dataset.journalTag;
    const pressed = !journalState.tags.has(tag);
    if (pressed) {
      journalState.tags.add(tag);
    } else {
      journalState.tags.delete(tag);
    }
    chip.setAttribute("aria-pressed", String(pressed));
  } else if (chip.hasAttribute("data-journal-add-tag")) {
    ui.journalNewTagInput.hidden = false;
    ui.journalNewTagInput.focus();
  }
}

function handleJournalSubmit(event) {
  event.preventDefault();
  const trade = getExistingTrade(journalState.tradeId);
  if (!trade) {
    closeTradeSheet();
    return;
  }

  // Same shape as closeTradeAtMarket: strip the audit fields so
  // buildTradeRecord re-stamps them, and let the rest ride the spread.
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, closedAt: _closedAt, ...tradeInput } = trade;
  const journalled = buildTradeRecord(
    {
      ...tradeInput,
      psychology: journalState.psychology,
      executionQuality: journalState.executionQuality,
      mistakeTags: Array.from(journalState.tags),
      notes: ui.journalNote.value.trim(),
      screenshotName: journalState.screenshotName,
      screenshotData: journalState.screenshotData,
      journalledAt: new Date().toISOString()
    },
    { id: trade.id, createdAt: trade.createdAt, closedAt: trade.closedAt, existingTrade: trade }
  );

  state.trades = state.trades.map((item) => (item.id === trade.id ? journalled : item));
  persistState();
  renderAll();

  /* 1f #06: the clip is written to its own key, after the trade, and it is the
     one part of this save that is allowed to fail. If it does, the sheet stays
     OPEN with the reason — the trade is already safe, and the trader needs to
     be able to delete the clip and save again rather than discover on some
     later reload that the recording never existed. */
  const voiceError = commitVoiceClip(trade.id, voiceState.clip);
  if (voiceError) {
    setVoiceStatus(voiceError, "error");
    setMessage(ui.journalSheetMessage, "Trade saved. The voice clip was not — see below.", "error");
    renderVoicePanel();
    return;
  }
  closeTradeSheet();

  const remaining = getUnjournalledTrades().length;
  showCaptureToast(
    remaining
      ? `${journalled.asset} journalled · ${remaining} left in the queue.`
      : `${journalled.asset} journalled — the queue is clear.`
  );
}

function bindJournalSheet() {
  if (!ui.journalSheetForm) {
    return;
  }

  ui.journalSheetForm.addEventListener("submit", handleJournalSubmit);
  ui.journalSheetCloseBtn.addEventListener("click", closeTradeSheet);
  ui.journalMoodChips.addEventListener("click", handleJournalChipClick);
  ui.journalGradeChips.addEventListener("click", handleJournalChipClick);
  ui.journalTagChips.addEventListener("click", handleJournalChipClick);

  ui.journalNewTagInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitNewMistakeTag(true);
    } else if (event.key === "Escape") {
      // Stop <dialog> from reading this as "close the sheet".
      event.stopPropagation();
      event.preventDefault();
      ui.journalNewTagInput.value = "";
      ui.journalNewTagInput.hidden = true;
    }
  });
  // Blur commits too, but never steals focus back — the click that caused the
  // blur has to be allowed to land.
  ui.journalNewTagInput.addEventListener("blur", () => commitNewMistakeTag(false));

  ui.journalDrop.addEventListener("click", () => ui.journalShotInput.click());
  ui.journalShotInput.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) {
      acceptJournalImage(file);
    }
    event.target.value = "";
  });

  ["dragenter", "dragover"].forEach((type) => {
    ui.journalDrop.addEventListener(type, (event) => {
      event.preventDefault();
      ui.journalDrop.classList.add("is-over");
    });
  });
  ["dragleave", "dragend", "drop"].forEach((type) => {
    ui.journalDrop.addEventListener(type, () => ui.journalDrop.classList.remove("is-over"));
  });
  ui.journalDrop.addEventListener("drop", (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      acceptJournalImage(file);
    }
  });

  document.addEventListener("paste", handleJournalPaste);
  ui.journalPasteBtn.hidden = typeof navigator.clipboard?.read !== "function";
  ui.journalPasteBtn.addEventListener("click", handleJournalPasteButton);
  bindVoiceNote();
}

function bindQuickCapture() {
  bindJournalSheet();

  if (ui.captureBarForm) {
    ui.captureBarForm.addEventListener("submit", handleCaptureSubmit);
    ui.captureInput.addEventListener("input", renderCaptureReadout);
    ui.captureToSheetBtn.addEventListener("click", () => {
      const parsed = parseTradeCommand(ui.captureInput.value);
      closeCaptureBar();
      openTradeSheet(parsed.value);
    });
    // Clicking the backdrop closes; <dialog> reports the click on itself.
    ui.captureBar.addEventListener("click", (event) => {
      if (event.target === ui.captureBar) {
        closeCaptureBar();
      }
    });
  }

  if (ui.tradeSheetForm) {
    ui.tradeSheetForm.addEventListener("submit", handleSheetSubmit);
    ui.tradeSheetCloseBtn.addEventListener("click", closeTradeSheet);
    ui.sheetDetailBtn.addEventListener("click", handleSheetAddDetail);
    ui.tradeSheet.addEventListener("click", (event) => {
      if (event.target === ui.tradeSheet) {
        closeTradeSheet();
      }
    });
    [ui.sheetSymbol, ui.sheetEntry, ui.sheetStop, ui.sheetRiskCustom].forEach((input) => {
      input.addEventListener("input", renderSheetReadout);
    });
    ui.sheetDirectionButtons.forEach((button) => {
      button.addEventListener("click", () => {
        sheetState.direction = button.dataset.sheetDirection === "Sell" ? "Sell" : "Buy";
        syncSheetControls();
        renderSheetReadout();
      });
    });
    ui.sheetRiskButtons.forEach((button) => {
      button.addEventListener("click", () => {
        sheetState.riskChoice = button.dataset.sheetRisk || "1";
        syncSheetControls();
        if (sheetState.riskChoice === "custom") {
          ui.sheetRiskCustom.focus();
        }
        renderSheetReadout();
      });
    });
    ui.sheetRulesList.addEventListener("change", (event) => {
      const box = event.target.closest(".sheet-rule-box");
      if (!box) {
        return;
      }
      if (box.checked) {
        sheetState.rules.add(box.value);
      } else {
        sheetState.rules.delete(box.value);
      }
    });
  }
}

function handleTradeTableClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  const id = button.dataset.id;
  if (!id) {
    return;
  }

  // 1e: the chevron opens the trade in place. Patched, not re-rendered — a
  // full renderJournalTable() here would restamp the live-price cells mid
  // 5s tick and blow away the row the pointer is on.
  if (button.dataset.action === "expand") {
    const detail = ui.tradesBody.querySelector(`[data-detail-for="${CSS.escape(id)}"]`);
    if (!detail) {
      return;
    }
    const open = detail.hidden;
    detail.hidden = !open;
    button.setAttribute("aria-expanded", open ? "true" : "false");
    button.closest("tr")?.classList.toggle("is-expanded", open);
    if (open) {
      expandedTradeIds.add(id);
    } else {
      expandedTradeIds.delete(id);
    }
    return;
  }

  if (button.dataset.action === "delete") {
    deleteTrade(id);
    return;
  }

  // 1f #06: swap the button for a real <audio controls>. voiceClipFor() is the
  // scheme check, so nothing but a data:audio/ URL ever reaches src.
  if (button.dataset.action === "voice") {
    const clip = voiceClipFor(id);
    if (!clip) {
      button.textContent = "Clip is gone";
      button.disabled = true;
      return;
    }
    const audio = document.createElement("audio");
    audio.className = "rev-voice-player";
    audio.controls = true;
    audio.autoplay = true;
    audio.src = clip.data;
    button.replaceWith(audio);
    return;
  }

  if (button.dataset.action === "close") {
    closeTradeAtMarket(id);
    return;
  }

  // 1c: re-open the close sheet for any closed trade — the queue is not the
  // only way back to it, and a journal entry stays editable.
  if (button.dataset.action === "journal") {
    openJournalSheet(id);
    return;
  }

  if (button.dataset.action === "edit") {
    loadTradeIntoForm(id);
  }
}

/* ── swipe to reveal Delete ────────────────────────────────────────────────
   Touch only, and only on a row card. Three things it must not do:

   1. Delete on the swipe. The swipe REVEALS a Delete button; deleting is a
      second, deliberate tap that goes through the same confirm as the
      row-detail Delete. A phone in a pocket does not get to wipe a trade.
   2. Eat vertical scrolling. The axis is decided once, at 10px of travel, and
      a vertical verdict abandons the gesture for good. `touch-action: pan-y`
      on the row (clay-v2 §16) means the browser owns the vertical axis
      outright — we never preventDefault, so scrolling stays native.
   3. Fire from the filter chip strip. These listeners are on #tradesBody; the
      chip strip is a sibling of the table, so its horizontal scroll is never
      seen here at all.

   Desktop/keyboard equivalent: the row-detail Delete button, untouched. */
// 900px is where styles.css turns every row into a card (tr{display:block}) —
// the same breakpoint clay-v2 §16b styles the reveal at. One source of truth.
function isCardLayout() {
  return window.matchMedia("(max-width: 900px)").matches;
}

function bindRowSwipe() {
  const body = ui.tradesBody;
  if (!body) {
    return;
  }

  body.addEventListener("pointerdown", (event) => {
    // Mouse users have the row-detail Delete; a touch laptop at 1400px is a
    // DESKTOP layout, where tr is still a table-row and the reveal has no
    // styling and nowhere to open into. Both gates, not just pointerType.
    if (event.pointerType === "mouse" || !event.isPrimary || !isCardLayout()) {
      return;
    }
    // A tap that starts on a control is that control's, not a swipe.
    if (event.target.closest("button, a, input, select, textarea")) {
      return;
    }
    const row = event.target.closest("tr[data-trade-id]");
    if (!row) {
      return;
    }
    if (swipedRow && swipedRow !== row) {
      closeRowSwipe();
    }
    swipeTrack.row = row;
    swipeTrack.x0 = event.clientX;
    swipeTrack.y0 = event.clientY;
    swipeTrack.axis = "";
  });

  body.addEventListener("pointermove", (event) => {
    if (!swipeTrack.row) {
      return;
    }
    const dx = event.clientX - swipeTrack.x0;
    const dy = event.clientY - swipeTrack.y0;
    if (!swipeTrack.axis) {
      if (Math.abs(dx) < SWIPE_AXIS_PX && Math.abs(dy) < SWIPE_AXIS_PX) {
        return;
      }
      // Ties go to the page. Scrolling is the common case by orders of
      // magnitude, and a swallowed scroll is worse than a missed swipe.
      swipeTrack.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (swipeTrack.axis === "y") {
        swipeTrack.row = null;
      }
    }
  }, { passive: true });

  const settle = (event) => {
    const row = swipeTrack.row;
    swipeTrack.row = null;
    if (!row || swipeTrack.axis !== "x") {
      return;
    }
    const dx = event.clientX - swipeTrack.x0;
    if (dx >= SWIPE_REVEAL_PX) {
      openRowSwipe(row);
    } else if (dx <= -SWIPE_REVEAL_PX) {
      closeRowSwipe();
    }
  };

  body.addEventListener("pointerup", settle);
  body.addEventListener("pointercancel", () => {
    swipeTrack.row = null;
  });

  // Any tap outside the open row puts it away, like every other reveal.
  document.addEventListener("pointerdown", (event) => {
    if (swipedRow && !event.target.closest("tr[data-trade-id]")) {
      closeRowSwipe();
    }
  });
}

function openRowSwipe(row) {
  closeRowSwipe();
  const id = row.dataset.tradeId;
  const host = row.querySelector(".rev-chev-cell") || row.lastElementChild;
  if (!id || !host) {
    return;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "row-swipe-delete";
  // The existing #tradesBody click delegate owns these two attributes, so the
  // revealed button routes straight into deleteTrade() — confirm, then undo.
  button.dataset.action = "delete";
  button.dataset.id = id;
  button.textContent = "Delete";
  host.appendChild(button);
  row.classList.add("is-swiped");
  swipedRow = row;
}

function closeRowSwipe() {
  if (!swipedRow) {
    return;
  }
  swipedRow.classList.remove("is-swiped");
  swipedRow.querySelector(".row-swipe-delete")?.remove();
  swipedRow = null;
}

// Close-at-market: confirm against the cached live price, then close the
// trade through the existing buildTradeRecord/persistState/autosave path.
function closeTradeAtMarket(id) {
  const trade = getExistingTrade(id);
  if (!trade || trade.status !== "open") {
    return;
  }

  const price = getOpenTradeLiveSnapshot(trade)?.currentPrice;
  if (!Number.isFinite(price) || price <= 0) {
    setMessage(ui.journalMessage, `No live price for ${trade.asset} yet. Try again in a few seconds or close it manually via Edit.`, "error");
    return;
  }

  const confirmed = window.confirm(
    `Close ${trade.asset} ${trade.direction === "Sell" ? "Short" : "Long"} at the last live price (${price})?`
  );
  if (!confirmed) {
    return;
  }

  // Strip identity/audit fields so buildTradeRecord re-stamps them; the rest
  // of the record (including importBatchId) rides through the spread.
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, closedAt: _closedAt, ...tradeInput } = trade;
  const closedTrade = buildTradeRecord(
    { ...tradeInput, exitPrice: price, status: "closed" },
    { id: trade.id, createdAt: trade.createdAt, existingTrade: trade }
  );

  state.trades = state.trades.map((item) => (item.id === id ? closedTrade : item));
  persistState();
  renderAll();
  setMessage(ui.journalMessage, `Closed ${trade.asset} at ${price} (${formatCurrency(closedTrade.netPnl)}).`, "success");
  // 1c: closing IS the trigger. Every close route in the app lands here —
  // the journal table's Close button and the dashboard ticker's alike — so
  // this is the single place the journalling sheet has to fire from.
  openJournalSheet(id);
}

function deleteTrade(id) {
  const trade = getExistingTrade(id);
  if (!trade) {
    return;
  }

  const confirmed = window.confirm(`Delete trade ${trade.asset} on ${trade.date}?`);
  if (!confirmed) {
    return;
  }

  removeTrades([trade], `Deleted ${trade.asset} on ${formatIsoShort(trade.date)}.`);
}

/* The single delete path. Every route in — the row-detail Delete button, the
   swipe reveal, Delete all — lands here, so every route in gets the same undo
   window and the same persistState()/renderAll() pair (which is what keeps
   demo mode on sessionStorage and an authenticated user syncing). */
function removeTrades(doomed, message) {
  if (!doomed.length) {
    return;
  }

  const ids = new Set(doomed.map((trade) => String(trade.id)));
  state.trades = state.trades.filter((trade) => !ids.has(String(trade.id)));
  closeRowSwipe();
  persistState();
  renderAll();
  setMessage(ui.journalMessage, message, "success");
  showCaptureToast(message, "success", {
    duration: UNDO_TOAST_MS,
    onUndo: () => {
      state.trades = restoreTrades(state.trades, doomed);
      persistState();
      renderAll();
      setMessage(
        ui.journalMessage,
        `Restored ${doomed.length} trade${doomed.length === 1 ? "" : "s"}.`,
        "success"
      );
    }
  });
}

/* Id-keyed union, not a concat: the undo toast outlives the delete by 30s, so
   the trader can log a new trade — or import a backup — in between. Restoring
   must never duplicate a row that is already back. Order does not matter; the
   table and every analytic sort themselves. */
function restoreTrades(current, removed) {
  const present = new Set(current.map((trade) => String(trade.id)));
  return current.concat(removed.filter((trade) => !present.has(String(trade.id))));
}

/* Typed confirmation for the bulk delete. Accepts the word DELETE or the exact
   count, so the trader has to have read either the verb or the number — an OK
   button can be hit by muscle memory, "DELETE" cannot. */
function isBulkDeleteConfirmed(answer, count) {
  const typed = String(answer ?? "").trim();
  return typed.toUpperCase() === "DELETE" || (typed !== "" && typed === String(count));
}

/* Delete all — scoped to the CURRENT FILTER, and it says so with the real
   count, because a trader with "Losses · London" applied must never discover
   afterwards that it meant everything. */
function deleteFilteredTrades() {
  const doomed = getFilteredTrades();
  if (!doomed.length) {
    setMessage(ui.journalMessage, "Nothing to delete — no trades match the current filters.", "error");
    return;
  }

  const scope = describeJournalFilters();
  const noun = `trade${doomed.length === 1 ? "" : "s"}`;
  const answer = window.prompt(
    `Delete all ${doomed.length} ${scope.length ? "filtered " : ""}${noun}?` +
      (scope.length ? `\n\nFilter: ${scope.join(" · ")}` : "\n\nNo filter is applied — this is the whole journal.") +
      `\n\nA JSON backup downloads first, and you get ${Math.round(UNDO_TOAST_MS / 1000)} seconds to undo.` +
      `\n\nType DELETE (or ${doomed.length}) to confirm:`,
    ""
  );

  if (!isBulkDeleteConfirmed(answer, doomed.length)) {
    if (answer !== null) {
      setMessage(ui.journalMessage, "Delete cancelled — the confirmation did not match.", "error");
    }
    return;
  }

  // Backup BEFORE the state mutates, through the same builder the Backup JSON
  // button uses, so the file restores through the existing Import JSON path.
  downloadBackupJson(doomed, `trading-journal-deleted-${doomed.length}-${Date.now()}.json`);
  removeTrades(doomed, `Deleted ${doomed.length} ${noun}. Backup downloaded.`);
}

function loadTradeIntoForm(id) {
  const trade = getExistingTrade(id);
  if (!trade) {
    return;
  }

  ui.tradeFields.tradeId.value = trade.id;
  ui.tradeFields.tradeDate.value = trade.date;
  ui.tradeFields.session.value = trade.session;
  ui.tradeFields.market.value = trade.market;
  ui.tradeFields.asset.value = trade.asset;
  ui.tradeFields.direction.value = trade.direction;
  ui.tradeFields.entryPrice.value = trade.entryPrice;
  ui.tradeFields.stopLoss.value = trade.stopLoss;
  ui.tradeFields.takeProfit.value = trade.takeProfit > 0 ? trade.takeProfit : "";
  ui.tradeFields.exitPrice.value = trade.status === "open" ? "" : trade.exitPrice;
  ui.tradeFields.riskPercent.value = trade.riskPercent;
  ui.tradeFields.positionSize.value = trade.positionSize;
  ui.tradeFields.tradeResult.value = trade.status === "open" ? "Auto" : trade.tradeResult === "Auto" ? "Auto" : trade.result;
  ui.tradeFields.tradeInProgress.checked = trade.status === "open";
  if (PRESET_SETUP_TYPES.has(trade.setupType)) {
    ui.tradeFields.setupType.value = trade.setupType;
    ui.tradeFields.customSetupType.value = "";
  } else {
    ui.tradeFields.setupType.value = "Custom";
    ui.tradeFields.customSetupType.value = trade.setupType;
  }
  ui.tradeFields.timeframe.value = trade.timeframe;
  ui.tradeFields.psychology.value = trade.psychology;
  ui.tradeFields.executionQuality.value = trade.executionQuality;
  ui.tradeFields.tradeNotes.value = trade.notes || "";
  ui.tradeFields.screenshotData.value = trade.screenshotData || "";

  if (trade.screenshotData) {
    ui.tradeFields.screenshotPreview.innerHTML = `<img src="${trade.screenshotData}" alt="Trade screenshot preview" />`;
  } else if (trade.screenshotName) {
    ui.tradeFields.screenshotPreview.textContent = "Screenshot filename stored.";
  } else {
    ui.tradeFields.screenshotPreview.textContent = "No preview";
  }

  ui.tradeFields.screenshotLabel.textContent = trade.screenshotName || "No screenshot selected";
  ui.tradeSubmitBtn.textContent = "Update Trade";
  syncDirectionToggle();
  syncSetupTypeCustomField();
  syncTradeProgressState();

  switchView("trade-entry");
  setMessage(ui.tradeFormMessage, "Editing trade entry.", "success");
}

function handleReflectionSubmit(event) {
  event.preventDefault();

  const date = document.getElementById("reflectionDate").value;
  const wentWell = document.getElementById("wentWell").value.trim();
  const mistake = document.getElementById("mistake").value.trim();
  const followRules = document.getElementById("followRules").value;
  const improveTomorrow = document.getElementById("improveTomorrow").value.trim();
  const tags = Array.from(document.querySelectorAll("input[name='reflectionTag']:checked")).map((node) => node.value);

  if (!date || !wentWell || !mistake || !improveTomorrow) {
    setMessage(ui.reflectionMessage, "Complete all reflection fields.", "error");
    return;
  }

  // 1f #07: set only by applyWeeklyDigest(), cleared the moment the date is
  // retyped by hand. One digest per week — re-drafting and saving replaces the
  // filed one instead of stacking near-identical entries.
  const weekOf = String(ui.reflectionForm.dataset.weekOf || "");
  if (weekOf) {
    state.reflections = state.reflections.filter((entry) => entry.weekOf !== weekOf);
  }

  state.reflections.unshift({
    id: createId(),
    date,
    wentWell,
    mistake,
    followRules,
    improveTomorrow,
    tags,
    weekOf,
    createdAt: new Date().toISOString()
  });

  if (state.reflections.length > 180) {
    state.reflections = state.reflections.slice(0, 180);
  }

  persistState();
  renderAll();
  ui.reflectionForm.reset();
  delete ui.reflectionForm.dataset.weekOf;
  document.getElementById("reflectionDate").value = toDateInputValue(new Date());
  setMessage(
    ui.reflectionMessage,
    weekOf ? `Weekly digest saved for ${weekOf}. It now seeds the Monthly Review.` : "Reflection saved.",
    "success"
  );
}

function saveReplayNotes() {
  const month = ui.reviewMonth.value;
  if (!month) {
    setMessage(ui.replayMessage, "Select a review month first.", "error");
    return;
  }

  state.replayNotes[month] = ui.replayNotes.value;
  persistState();
  setMessage(ui.replayMessage, "Replay notes saved.", "success");
}

function exportTradesCsv() {
  if (!state.trades.length) {
    setMessage(ui.journalMessage, "No trades to export.", "error");
    return;
  }

  // Scoped to the active account, like every other view. The account name is
  // the first column so a file cannot be mistaken for the whole journal.
  const accountLabel = getActiveAccount()?.label || "";
  const headers = [
    "account",
    "createdAt",
    "closedAt",
    "date",
    "session",
    "market",
    "asset",
    "direction",
    "entryPrice",
    "stopLoss",
    "takeProfit",
    "exitPrice",
    "riskPercent",
    "positionSize",
    "setupType",
    "timeframe",
    "psychology",
    "executionQuality",
    "status",
    "result",
    "pips",
    "pipSize",
    "pipValuePerLot",
    "dollarPerPip",
    "netPnl",
    "rMultiple",
    "rrRatio",
    // 1c: the close sheet's own fields. escapeCsvValue quotes every cell, so
    // the comma-joined tag array is safe as-is.
    "mistakeTags",
    "journalledAt",
    "notes"
  ];

  const rows = state.trades.map((trade) => {
    return headers
      .map((field) => escapeCsvValue(field === "account" ? accountLabel : trade[field] ?? ""))
      .join(",");
  });

  const csv = [headers.join(","), ...rows].join("\n");
  triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8" }), `trading-journal-${Date.now()}.csv`);
  if (state.auth.guestMode) {
    nudgeGuest(ui.journalMessage, "CSV exported — it includes the sample rows.");
    return;
  }
  setMessage(ui.journalMessage, "CSV exported.", "success");
}

/* One backup shape, two callers: the Backup JSON button (whole journal) and
   the bulk delete's pre-flight snapshot (just the doomed rows). The file is
   the same schema either way, so importBackupJson restores both. */
function downloadBackupJson(trades, filename) {
  const backup = {
    exportedAt: new Date().toISOString(),
    settings: state.settings,
    trades,
    reflections: state.reflections,
    replayNotes: state.replayNotes
  };

  triggerDownload(
    new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }),
    filename
  );
}

function exportBackupJson() {
  // A backup is the one thing that must NOT be account-scoped: it is the
  // trader's whole journal, and settings carries the account list with it.
  downloadBackupJson(allTrades(), `trading-journal-backup-${Date.now()}.json`);
  if (state.auth.guestMode) {
    nudgeGuest(ui.journalMessage, "JSON backup exported — it includes the sample rows.");
    return;
  }
  setMessage(ui.journalMessage, "JSON backup exported.", "success");
}

function importBackupJson(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result || "{}"));

      if (!window.confirm("Import backup and replace current journal data?")) {
        event.target.value = "";
        return;
      }

      state.settings = normalizeSettings(parsed.settings);
      state.reflections = normalizeReflections(parsed.reflections);
      state.replayNotes = normalizeReplayNotes(parsed.replayNotes);
      // A backup taken before multi-account has no accountId on any row, and
      // one taken after carries its own account list in settings — either way
      // the split is re-derived rather than assumed.
      applyActiveAccount();
      adoptAllTrades(normalizeTrades(parsed.trades));

      persistState();
      hydrateRiskForm();
      renderAll();
      setMessage(ui.journalMessage, "Backup imported.", "success");
    } catch (error) {
      setMessage(ui.journalMessage, "Invalid JSON backup file.", "error");
    } finally {
      event.target.value = "";
    }
  };

  reader.onerror = () => {
    setMessage(ui.journalMessage, "Failed to read JSON file.", "error");
    event.target.value = "";
  };

  reader.readAsText(file);
}

async function saveToPhpStorage(options = {}) {
  const { silent = false } = options;

  if (!state.auth.isAuthenticated) {
    if (!silent) {
      if (state.auth.guestMode) {
        nudgeGuest(ui.journalMessage, "The server journal needs an account.");
      } else {
        setMessage(ui.journalMessage, "Login first to save on server database.", "error");
      }
    }
    return;
  }

  const payload = {
    settings: state.settings,
    // The server stores the whole journal, not the account currently on
    // screen. Sending state.trades alone would delete the other accounts.
    trades: allTrades(),
    reflections: state.reflections,
    replayNotes: state.replayNotes
  };

  try {
    state.serverSync.inFlight = true;
    const response = await fetch("trade_handler.php?action=save", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });

    const body = await response.json();
    if (!response.ok || !body.ok) {
      throw new Error(body.error || "Server save failed");
    }

    if (!silent) {
      setMessage(ui.journalMessage, "Saved to server database.", "success");
    }
    await loadRecentTrades({ silent: true });
    return true;
  } catch (error) {
    if (!silent) {
      setMessage(
        ui.journalMessage,
        error.message || "Server save failed. Confirm DATABASE_URL and open app via PHP server.",
        "error"
      );
    }
    return false;
  } finally {
    state.serverSync.inFlight = false;
  }
}

async function loadFromPhpStorage(options = {}) {
  const { silent = false, preferLocalIfServerEmpty = true } = options;

  if (!state.auth.isAuthenticated) {
    if (!silent) {
      if (state.auth.guestMode) {
        nudgeGuest(ui.journalMessage, "There is no server journal to load in the demo.");
      } else {
        setMessage(ui.journalMessage, "Login first to load server database.", "error");
      }
    }
    return false;
  }

  // Skeleton pulse on metric values + journal rows while the server journal
  // loads (auth restore or manual load). Cleared in finally.
  document.body.classList.add("is-journal-loading");
  try {
    const localSnapshot = {
      settings: { ...state.settings },
      trades: allTrades(),
      reflections: [...state.reflections],
      replayNotes: { ...state.replayNotes }
    };

    const response = await fetch("trade_handler.php?action=load", {
      method: "GET",
      credentials: "same-origin"
    });

    const body = await response.json();
    if (!response.ok || !body.ok || !body.data) {
      throw new Error(body.error || "Server load failed");
    }

    const rawServerTrades = Array.isArray(body.data.trades) ? body.data.trades : [];
    const serverSettings = normalizeSettings(body.data.settings);
    const serverTrades = normalizeTrades(rawServerTrades);
    const serverReflections = normalizeReflections(body.data.reflections);
    const serverReplayNotes = normalizeReplayNotes(body.data.replayNotes);
    const serverTradesMalformed = rawServerTrades.length > 0 && serverTrades.length === 0;

    const shouldKeepLocal =
      localSnapshot.trades.length > 0 &&
      ((preferLocalIfServerEmpty && serverTrades.length === 0) || serverTradesMalformed);

    if (shouldKeepLocal) {
      state.settings = localSnapshot.settings;
      state.reflections = localSnapshot.reflections;
      state.replayNotes = localSnapshot.replayNotes;
      adoptAllTrades(localSnapshot.trades);
      persistState();
      if (!silent) {
        setMessage(
          ui.journalMessage,
          serverTradesMalformed
            ? "Server trade data looked malformed. Kept local trades and synced them back to the server."
            : "Server was empty. Kept local trades and synced them back to the server.",
          "success"
        );
      }
      return true;
    }

    if (serverTradesMalformed) {
      throw new Error("Server trade data is malformed. Update the backend fix before loading this journal.");
    }

    state.settings = serverSettings;
    state.reflections = serverReflections;
    state.replayNotes = serverReplayNotes;
    // Settings came from the server, so the account list did too — re-split
    // the server journal against THAT list, not the one that was on screen.
    applyActiveAccount();
    adoptAllTrades(serverTrades);

    persistState({ skipServerSync: true });
    hydrateRiskForm();
    renderAll();
    await loadRecentTrades({ silent: true });
    if (!silent) {
      setMessage(ui.journalMessage, "Loaded from server database.", "success");
    }
    return true;
  } catch (error) {
    if (!silent) {
      setMessage(
        ui.journalMessage,
        error.message || "Server load failed. Confirm DATABASE_URL and open app via PHP server.",
        "error"
      );
    }
    return false;
  } finally {
    document.body.classList.remove("is-journal-loading");
  }
}

async function loadLoginLogs(options = {}) {
  const { silent = false } = options;

  if (!state.auth.isAuthenticated) {
    state.loginLogs = [];
    renderLoginLogs();
    if (!silent && ui.loginLogsMessage) {
      setMessage(ui.loginLogsMessage, "Login first to view login logs.", "error");
    }
    return false;
  }

  if (!state.auth.isAdmin) {
    state.loginLogs = [];
    renderLoginLogs();
    return false;
  }

  try {
    const response = await fetch("trade_handler.php?action=login_logs", {
      method: "GET",
      credentials: "same-origin"
    });

    const body = await response.json();
    if (!response.ok || !body.ok || !Array.isArray(body.logs)) {
      throw new Error(body.error || "Failed to load login logs");
    }

    state.loginLogs = normalizeLoginLogs(body.logs);
    renderLoginLogs();
    if (!silent && ui.loginLogsMessage) {
      setMessage(ui.loginLogsMessage, `Loaded ${state.loginLogs.length} login event(s).`, "success");
    }
    return true;
  } catch (error) {
    if (!silent && ui.loginLogsMessage) {
      setMessage(ui.loginLogsMessage, error.message || "Failed to load login logs.", "error");
    }
    return false;
  }
}

// Admin panels ship out of the public HTML (ship-now #12): the markup lives
// only in this template and is injected when the session is an admin.
const ADMIN_PANELS_TEMPLATE = `
  <details class="panel panel-collapsible" id="loginLogsPanel">
    <summary class="panel-collapse-summary">
      <div class="panel-head">
        <h3>Admin Login Activity</h3>
        <p>Latest login, register, and logout events across all accounts.</p>
      </div>
      <span class="panel-collapse-toggle"><span class="toggle-label-open">Minimize</span><span class="toggle-label-closed">Show more</span></span>
    </summary>
    <div class="panel-collapsible-body">
      <div class="form-actions">
        <button id="refreshLoginLogsBtn" class="btn" type="button">Refresh Login Logs</button>
      </div>
      <p id="loginLogsMessage" class="form-message" aria-live="polite"></p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Username</th>
              <th>Event</th>
              <th>Status</th>
              <th>IP</th>
              <th>Device</th>
            </tr>
          </thead>
          <tbody id="loginLogsBody"></tbody>
        </table>
      </div>
    </div>
  </details>

  <details class="panel panel-collapsible" id="adminUsersPanel">
    <summary class="panel-collapse-summary">
      <div class="panel-head">
        <h3>Admin Users View</h3>
        <p>Read-only view of registered users and account activity.</p>
      </div>
      <span class="panel-collapse-toggle"><span class="toggle-label-open">Minimize</span><span class="toggle-label-closed">Show more</span></span>
    </summary>
    <div class="panel-collapsible-body">
      <div class="form-actions">
        <button id="refreshAdminUsersBtn" class="btn" type="button">Refresh Users</button>
      </div>
      <p id="adminUsersMessage" class="form-message" aria-live="polite"></p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>User ID</th>
              <th>Username</th>
              <th>Password Status</th>
              <th>Created</th>
              <th>Last Event</th>
              <th>Last Event Time</th>
              <th>Device</th>
              <th>Trades</th>
              <th>Reflections</th>
            </tr>
          </thead>
          <tbody id="adminUsersBody"></tbody>
        </table>
      </div>
    </div>
  </details>
`;

function readAdminPanelsOpenState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.adminPanels)) || {};
  } catch (error) {
    return {};
  }
}

function persistAdminPanelsOpenState() {
  try {
    localStorage.setItem(STORAGE_KEYS.adminPanels, JSON.stringify({
      loginLogs: Boolean(ui.loginLogsPanel?.open),
      users: Boolean(ui.adminUsersPanel?.open)
    }));
  } catch (error) {
    /* private mode — open state just won't persist */
  }
}

// Injects (or removes) the admin panels and rebinds the ui handles.
// Returns true when the panels exist and may be rendered into.
function ensureAdminPanels() {
  if (!ui.adminPanelsMount) {
    return false;
  }

  if (!state.auth.isAuthenticated || !state.auth.isAdmin) {
    if (ui.adminPanelsMount.childElementCount) {
      ui.adminPanelsMount.innerHTML = "";
      ui.loginLogsPanel = null;
      ui.refreshLoginLogsBtn = null;
      ui.loginLogsMessage = null;
      ui.loginLogsBody = null;
      ui.adminUsersPanel = null;
      ui.refreshAdminUsersBtn = null;
      ui.adminUsersMessage = null;
      ui.adminUsersBody = null;
    }
    return false;
  }

  if (ui.adminPanelsMount.childElementCount) {
    return true;
  }

  ui.adminPanelsMount.innerHTML = ADMIN_PANELS_TEMPLATE;
  ui.loginLogsPanel = document.getElementById("loginLogsPanel");
  ui.refreshLoginLogsBtn = document.getElementById("refreshLoginLogsBtn");
  ui.loginLogsMessage = document.getElementById("loginLogsMessage");
  ui.loginLogsBody = document.getElementById("loginLogsBody");
  ui.adminUsersPanel = document.getElementById("adminUsersPanel");
  ui.refreshAdminUsersBtn = document.getElementById("refreshAdminUsersBtn");
  ui.adminUsersMessage = document.getElementById("adminUsersMessage");
  ui.adminUsersBody = document.getElementById("adminUsersBody");

  // Persist <details> open state across refreshes (ship-now #11).
  const openState = readAdminPanelsOpenState();
  ui.loginLogsPanel.open = Boolean(openState.loginLogs);
  ui.adminUsersPanel.open = Boolean(openState.users);
  ui.loginLogsPanel.addEventListener("toggle", persistAdminPanelsOpenState);
  ui.adminUsersPanel.addEventListener("toggle", persistAdminPanelsOpenState);

  ui.refreshLoginLogsBtn.addEventListener("click", () => {
    loadLoginLogs({ silent: false });
  });
  ui.refreshAdminUsersBtn.addEventListener("click", () => {
    loadAdminUsers({ silent: false });
  });

  return true;
}

function renderLoginLogs() {
  if (!ensureAdminPanels()) {
    return;
  }

  if (!state.loginLogs.length) {
    ui.loginLogsBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="6">No login events yet.</td>
      </tr>
    `;
    return;
  }

  ui.loginLogsBody.innerHTML = state.loginLogs
    .map((log) => {
      const statusClass = log.success ? "pnl-positive" : "pnl-negative";
      const statusText = log.success ? "Success" : "Failed";
      const eventLabel = `${log.eventType}`.toUpperCase();
      const deviceLabel = summarizeUserAgent(log.userAgent);
      return `
        <tr>
          <td data-label="Date">${escapeHtml(log.createdAt)}</td>
          <td data-label="Username">${escapeHtml(log.username || "-")}</td>
          <td data-label="Event">${escapeHtml(eventLabel)}</td>
          <td data-label="Status" class="${statusClass}">${escapeHtml(statusText)}</td>
          <td data-label="IP">${escapeHtml(log.ipAddress || "-")}</td>
          <td data-label="Device" class="user-agent-cell" title="${escapeHtml(deviceLabel)}">
            ${escapeHtml(deviceLabel)}
          </td>
        </tr>
      `;
    })
    .join("");
}

function normalizeLoginLogs(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      username: String(item.username || ""),
      eventType: String(item.event_type || item.eventType || "unknown"),
      success: Boolean(item.success),
      ipAddress: String(item.ip_address || item.ipAddress || ""),
      userAgent: String(item.user_agent || item.userAgent || ""),
      createdAt: String(item.created_at || item.createdAt || "")
    }))
    .slice(0, 200);
}

async function loadAdminUsers(options = {}) {
  const { silent = false } = options;

  if (!state.auth.isAuthenticated) {
    state.adminUsers = [];
    renderAdminUsers();
    if (!silent && ui.adminUsersMessage) {
      setMessage(ui.adminUsersMessage, "Login first to view users.", "error");
    }
    return false;
  }

  if (!state.auth.isAdmin) {
    state.adminUsers = [];
    renderAdminUsers();
    if (!silent && ui.adminUsersMessage) {
      setMessage(ui.adminUsersMessage, "Admin account required.", "error");
    }
    return false;
  }

  try {
    const response = await fetch("trade_handler.php?action=users_admin", {
      method: "GET",
      credentials: "same-origin"
    });

    const body = await response.json();
    if (!response.ok || !body.ok || !Array.isArray(body.users)) {
      throw new Error(body.error || "Failed to load admin users");
    }

    state.adminUsers = normalizeAdminUsers(body.users);
    renderAdminUsers();
    if (!silent && ui.adminUsersMessage) {
      setMessage(ui.adminUsersMessage, `Loaded ${state.adminUsers.length} user account(s).`, "success");
    }
    return true;
  } catch (error) {
    if (!silent && ui.adminUsersMessage) {
      setMessage(ui.adminUsersMessage, error.message || "Failed to load admin users.", "error");
    }
    return false;
  }
}

function renderAdminUsers() {
  if (!ensureAdminPanels()) {
    return;
  }

  if (!state.adminUsers.length) {
    ui.adminUsersBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="9">No users found.</td>
      </tr>
    `;
    return;
  }

  ui.adminUsersBody.innerHTML = state.adminUsers
    .map((user) => {
      const statusClass = user.lastSuccess ? "pnl-positive" : "pnl-negative";
      const statusText = user.lastEvent ? `${user.lastEvent}${user.lastSuccess ? " (OK)" : " (Fail)"}` : "-";
      const deviceLabel = summarizeUserAgent(user.lastUserAgent);
      return `
        <tr>
          <td data-label="User ID">${escapeHtml(String(user.id))}</td>
          <td data-label="Username">${escapeHtml(user.username)}</td>
          <td data-label="Password Status">${escapeHtml(user.passwordStatus)}</td>
          <td data-label="Created">${escapeHtml(user.createdAt || "-")}</td>
          <td data-label="Last Event" class="${user.lastEvent ? statusClass : ""}">${escapeHtml(statusText)}</td>
          <td data-label="Last Event Time">${escapeHtml(user.lastLoginAt || "-")}</td>
          <td data-label="Device">${escapeHtml(deviceLabel)}</td>
          <td data-label="Trades">${escapeHtml(String(user.tradesCount))}</td>
          <td data-label="Reflections">${escapeHtml(String(user.reflectionsCount))}</td>
        </tr>
      `;
    })
    .join("");
}

function normalizeAdminUsers(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      id: Number(item.id || 0),
      username: String(item.username || ""),
      passwordStatus: String(item.password_status || item.passwordStatus || "Hashed"),
      createdAt: String(item.created_at || item.createdAt || ""),
      lastEvent: String(item.last_event || item.lastEvent || "").toUpperCase(),
      lastSuccess: Boolean(item.last_success ?? item.lastSuccess ?? false),
      lastLoginAt: String(item.last_login_at || item.lastLoginAt || ""),
      lastUserAgent: String(item.last_user_agent || item.lastUserAgent || ""),
      tradesCount: Number(item.trades_count || item.tradesCount || 0),
      reflectionsCount: Number(item.reflections_count || item.reflectionsCount || 0)
    }))
    .slice(0, 500);
}

function summarizeUserAgent(input) {
  const ua = String(input || "");
  if (!ua) {
    return "-";
  }

  let platform = "Unknown";
  if (/android/i.test(ua)) {
    platform = "Android";
  } else if (/iphone/i.test(ua)) {
    platform = "iPhone";
  } else if (/ipad/i.test(ua)) {
    platform = "iPad";
  } else if (/windows/i.test(ua)) {
    platform = "Windows";
  } else if (/macintosh|mac os x/i.test(ua)) {
    platform = "macOS";
  } else if (/linux/i.test(ua)) {
    platform = "Linux";
  }

  let cpu = "";
  if (/arm|aarch64/i.test(ua)) {
    cpu = "ARM";
  } else if (/x86_64|win64|x64|amd64|intel/i.test(ua)) {
    cpu = "x64";
  } else if (/i686|x86/i.test(ua)) {
    cpu = "x86";
  }

  return cpu ? `${platform} / ${cpu}` : platform;
}

function renderAll() {
  updateBranding();
  // Scoped by construction: state.trades is the active account's rows only.
  state.analytics = calculateAnalytics(state.trades, state.settings, state.reflections);
  renderAccountSwitcher();
  renderAccountsPanel();
  renderHeroRecentTrades();
  renderDashLeonTape();
  renderProgressTradeSummary();
  renderDashboardMetrics(state.analytics);
  renderRiskStrip(state.analytics);
  renderPropTracker();
  renderNavRisk();
  renderGreeting();
  renderPlaybook(state.analytics);
  renderUnjournalled();
  renderRuleCost();
  renderCooldown();
  syncBulkUndoButton();
  renderRiskViolations(state.analytics);
  renderEdgeTable(state.analytics);
  // 1f #04: only when the page is on screen — it is a detail view, and its
  // series feed the chart hash, so refreshing it while hidden would replay
  // every chart's draw-in for a page nobody is looking at.
  if (isViewActive("playbook")) {
    renderPlaybookPage();
  }
  renderCharts(state.analytics);
  renderCalendarView();
  hydrateSetupFilter();
  renderJournalTable();
  renderReflections();
  renderMonthlyReview();
}

function renderProgressTradeSummary() {
  if (!ui.progressTradeSummary || !ui.progressTradeTrack || !ui.progressTradeLabel) {
    return;
  }

  if (!canAccessApp()) {
    ui.progressTradeSummary.hidden = true;
    return;
  }

  const openTrades = [...state.trades]
    .filter((trade) => trade.status === "open")
    .sort(sortTradesDesc)
    .slice(0, 5);

  if (!openTrades.length) {
    ui.progressTradeSummary.hidden = true;
    return;
  }

  ui.progressTradeLabel.textContent = openTrades.length === 1 ? "Open position" : "Open positions";
  // 1a: the in-progress cards collapse into an inline LIVE ticker pill —
  // symbol, price, % move, Close. innerHTML runs from renderAll only; the 5s
  // poll patches the [data-live-field] nodes in place (patchLiveNodes), so
  // this markup is never rebuilt on a tick.
  ui.progressTradeTrack.innerHTML = openTrades
    .map((trade) => {
      const snapshot = getOpenTradeLiveSnapshot(trade);
      const currentPrice = snapshot?.currentPrice ?? null;
      const livePercent = snapshot?.livePercent ?? null;
      const tone = snapshot?.toneClass ?? "";
      const symbol = escapeHtml(trade.asset || "—");

      // The pill body is a disclosure: tap it and the position's numbers
      // unfold — entry, stop and target with their pip distances, and the
      // live move in pips (patched by the same 5s loop, never re-rendered).
      const stopPips = pipsBetween(trade.asset, trade.market, trade.entryPrice, trade.stopLoss);
      const targetPips = trade.takeProfit > 0 ? pipsBetween(trade.asset, trade.market, trade.entryPrice, trade.takeProfit) : null;
      const stopText = trade.stopLoss > 0
        ? `${formatCapturePrice(trade.stopLoss)}${stopPips !== null ? ` · ${formatPips(stopPips)} pips` : ""}`
        : "—";
      const targetText = trade.takeProfit > 0
        ? `${formatCapturePrice(trade.takeProfit)}${targetPips !== null ? ` · ${formatPips(targetPips)} pips` : ""}`
        : "no target";

      return `
        <article class="dash-live-pill" data-trade-pill="${escapeHtml(String(trade.id || ""))}">
          <button class="dash-live-main" type="button" data-toggle-trade="${escapeHtml(String(trade.id || ""))}" aria-expanded="false" aria-label="Show details for ${symbol}">
            <span class="dash-live-dot" aria-hidden="true"></span>
            <span class="dash-live-tag">Live</span>
            <strong class="dash-live-symbol">${symbol}</strong>
            <span class="dash-live-price live-cell" ${liveCellAttrs(trade, "currentPrice")}>${Number.isFinite(currentPrice) ? formatProgressTradePrice(currentPrice) : "—"}</span>
            <span class="dash-live-move ${tone} live-cell" ${liveCellAttrs(trade, "livePercent")}>${escapeHtml(formatLivePercentLabel(livePercent, "OPEN"))}</span>
            <span class="dash-live-caret" aria-hidden="true"></span>
          </button>
          <button class="dash-live-close" type="button" data-close-trade="${escapeHtml(String(trade.id || ""))}" aria-label="Close ${symbol} at market price">Close</button>
          <div class="dash-live-detail" hidden>
            <span class="dash-live-cell"><span class="dash-live-k">entry</span><span class="dash-live-v">${formatCapturePrice(trade.entryPrice)}</span></span>
            <span class="dash-live-cell"><span class="dash-live-k">stop</span><span class="dash-live-v">${escapeHtml(stopText)}</span></span>
            <span class="dash-live-cell"><span class="dash-live-k">target</span><span class="dash-live-v">${escapeHtml(targetText)}</span></span>
            <span class="dash-live-cell"><span class="dash-live-k">live</span><span class="dash-live-v live-cell" ${liveCellAttrs(trade, "livePips")}>—</span></span>
          </div>
        </article>
      `;
    })
    .join("");
  ui.progressTradeSummary.hidden = false;
}

function handleProgressTradeDetailsToggle(event) {
  const closeButton = event.target.closest("[data-close-trade]");
  if (closeButton) {
    closeTradeAtMarket(closeButton.dataset.closeTrade);
    return;
  }
  const toggle = event.target.closest("[data-toggle-trade]");
  if (!toggle) {
    return;
  }
  const pill = toggle.closest(".dash-live-pill");
  const detail = pill?.querySelector(".dash-live-detail");
  if (!pill || !detail) {
    return;
  }
  const expanded = pill.classList.toggle("is-expanded");
  detail.hidden = !expanded;
  toggle.setAttribute("aria-expanded", String(expanded));
}

function getClosedTrades(trades = state.trades) {
  return trades.filter((trade) => trade.status !== "open");
}

function calculateAnalytics(trades, settings, reflections) {
  const ordered = getClosedTrades(trades).sort(sortTradesAsc);
  const equity = [settings.startingBalance];
  const drawdowns = [0];
  const initialTimelineDate = ordered[0]?.date || toDateInputValue(new Date());
  const equityDates = [initialTimelineDate];
  const drawdownDates = [initialTimelineDate];

  let peak = settings.startingBalance;
  let grossProfit = 0;
  let grossLoss = 0;
  let totalPnl = 0;
  let wins = 0;
  let losses = 0;
  let breakeven = 0;
  let rrSum = 0;
  let rrCount = 0;
  let rSum = 0;
  let rCount = 0;
  let maxDrawdown = 0;
  let drawdownSum = 0;
  let drawdownCount = 0;
  let maxWinStreak = 0;
  let maxLossStreak = 0;
  let currentWinStreak = 0;
  let currentLossStreak = 0;

  const dailyPnl = new Map();
  const weeklyPnl = new Map();
  const setupStats = new Map();
  const setupPerformance = new Map();
  const assetPerformance = new Map();
  const dayPerformance = new Map();
  const psychologyStats = new Map();
  const sessionPerformance = new Map();

  for (const trade of ordered) {
    totalPnl += trade.netPnl;

    if (trade.netPnl > 0) {
      wins += 1;
      grossProfit += trade.netPnl;
      currentWinStreak += 1;
      currentLossStreak = 0;
      maxWinStreak = Math.max(maxWinStreak, currentWinStreak);
    } else if (trade.netPnl < 0) {
      losses += 1;
      grossLoss += trade.netPnl;
      currentLossStreak += 1;
      currentWinStreak = 0;
      maxLossStreak = Math.max(maxLossStreak, currentLossStreak);
    } else {
      breakeven += 1;
      currentWinStreak = 0;
      currentLossStreak = 0;
    }

    if (Number.isFinite(trade.rrRatio) && trade.rrRatio > 0) {
      rrSum += trade.rrRatio;
      rrCount += 1;
    }

    if (Number.isFinite(trade.rMultiple)) {
      rSum += trade.rMultiple;
      rCount += 1;
    }

    const nextEquity = round(equity[equity.length - 1] + trade.netPnl);
    equity.push(nextEquity);
    equityDates.push(trade.date);

    if (nextEquity > peak) {
      peak = nextEquity;
    }

    const dd = round(peak - nextEquity);
    drawdowns.push(dd);
    drawdownDates.push(trade.date);
    if (dd > 0) {
      drawdownSum += dd;
      drawdownCount += 1;
    }
    maxDrawdown = Math.max(maxDrawdown, dd);

    dailyPnl.set(trade.date, round((dailyPnl.get(trade.date) || 0) + trade.netPnl));

    const weekKey = getWeekKey(trade.date);
    weeklyPnl.set(weekKey, round((weeklyPnl.get(weekKey) || 0) + trade.netPnl));

    const setupKey = trade.setupType || "Unknown";
    accumulatePerformanceEntry(setupPerformance, setupKey, trade);
    accumulatePerformanceEntry(assetPerformance, trade.asset || "Unknown", trade);
    accumulatePerformanceEntry(dayPerformance, getTradeDayLabel(trade.date), trade);
    accumulatePerformanceEntry(sessionPerformance, trade.session || "Unknown", trade);

    const psychKey = trade.psychology || "Unknown";
    const psychBucket = psychologyStats.get(psychKey) || { label: psychKey, pnl: 0, count: 0, wins: 0 };
    psychBucket.pnl = round(psychBucket.pnl + trade.netPnl);
    psychBucket.count += 1;
    if (trade.netPnl > 0) {
      psychBucket.wins += 1;
    }
    psychologyStats.set(psychKey, psychBucket);

    const setupBucket = setupStats.get(setupKey) || {
      setup: setupKey,
      trades: 0,
      wins: 0,
      netPnl: 0,
      rTotal: 0,
      rCount: 0
    };

    setupBucket.trades += 1;
    setupBucket.netPnl = round(setupBucket.netPnl + trade.netPnl);
    if (trade.result === "Win") {
      setupBucket.wins += 1;
    }
    if (Number.isFinite(trade.rMultiple)) {
      setupBucket.rTotal += trade.rMultiple;
      setupBucket.rCount += 1;
    }

    setupStats.set(setupKey, setupBucket);
  }

  const calculatedBalance = equity[equity.length - 1] || settings.startingBalance;
  const currentBalance = settings.balanceOverride > 0 ? settings.balanceOverride : calculatedBalance;
  const totalTrades = ordered.length;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const avgWin = wins > 0 ? grossProfit / wins : 0;
  const avgLoss = losses > 0 ? grossLoss / losses : 0;
  const avgRR = rrCount > 0 ? rrSum / rrCount : 0;
  const avgR = rCount > 0 ? rSum / rCount : 0;
  const profitFactor = grossLoss < 0 ? grossProfit / Math.abs(grossLoss) : grossProfit > 0 ? 999 : 0;
  const expectancy = totalTrades > 0 ? totalPnl / totalTrades : 0;
  const averageDrawdown = drawdownCount > 0 ? drawdownSum / drawdownCount : 0;

  const bestDay = getExtremeDay(dailyPnl, "max");
  const worstDay = getExtremeDay(dailyPnl, "min");
  const todayPnl = dailyPnl.get(toDateInputValue(new Date())) || 0;
  const weekPnl = weeklyPnl.get(getWeekKey(toDateInputValue(new Date()))) || 0;

  const dailyViolations = Array.from(dailyPnl.entries())
    .filter(([, pnl]) => pnl < -settings.dailyMaxLoss)
    .map(([day, pnl]) => ({ type: "daily", key: day, pnl }));

  const weeklyViolations = Array.from(weeklyPnl.entries())
    .filter(([, pnl]) => pnl < -settings.weeklyMaxLoss)
    .map(([week, pnl]) => ({ type: "weekly", key: week, pnl }));

  const riskPerTradeViolations = ordered
    .filter((trade) => trade.riskPercent > settings.riskPerTrade)
    .map((trade) => ({ type: "risk", key: `${trade.date} ${trade.asset}`, riskPercent: trade.riskPercent }));

  const disciplineScore = computeDisciplineScore(ordered, reflections, {
    dailyViolations,
    weeklyViolations,
    riskPerTradeViolations
  });

  const dailyTradingScore = computeDailyTradingScore(ordered, reflections, dailyViolations);

  const goalRange = Math.max(settings.equityGoal - settings.startingBalance, 1);
  const goalProgress = ((currentBalance - settings.startingBalance) / goalRange) * 100;
  const traderScore = computeTraderScore({
    winRate,
    profitFactor,
    avgWin,
    avgLoss,
    totalPnl,
    maxDrawdown,
    dailyPnl,
    startingBalance: settings.startingBalance
  });

  return {
    totalTrades,
    wins,
    losses,
    breakeven,
    winRate,
    avgWin,
    avgLoss,
    avgRR,
    avgR,
    profitFactor,
    expectancy,
    totalPnl,
    accountBalance: currentBalance,
    currentDrawdown: drawdowns[drawdowns.length - 1] || 0,
    maxDrawdown,
    averageDrawdown,
    bestDay,
    worstDay,
    todayPnl,
    weekPnl,
    maxWinStreak,
    maxLossStreak,
    dailyViolations,
    weeklyViolations,
    riskPerTradeViolations,
    equity,
    equityDates,
    drawdowns,
    drawdownDates,
    setupStats: Array.from(setupStats.values()),
    strategyPerformance: {
      setup: Array.from(setupPerformance.values()),
      asset: Array.from(assetPerformance.values()),
      day: sortDayPerformance(Array.from(dayPerformance.values()))
    },
    psychologyReport: Array.from(psychologyStats.values())
      .map((entry) => ({
        ...entry,
        winRate: entry.count > 0 ? (entry.wins / entry.count) * 100 : 0
      }))
      .sort((a, b) => b.pnl - a.pnl),
    sessionReport: Array.from(sessionPerformance.values()).sort((a, b) => b.pnl - a.pnl),
    rMultipleReport: buildRMultipleHistogram(ordered),
    disciplineScore,
    dailyTradingScore,
    goalProgress,
    traderScore
  };
}

// R-multiple distribution over closed trades, in fixed 1R buckets. Empty
// array when there are no trades so the chart shows its empty label.
function buildRMultipleHistogram(trades) {
  if (!trades.length) {
    return [];
  }

  const buckets = [
    { label: "< -2R", min: -Infinity, max: -2, tone: "neg" },
    { label: "-2R to -1R", min: -2, max: -1, tone: "neg" },
    { label: "-1R to 0R", min: -1, max: 0, tone: "neg" },
    { label: "0R to 1R", min: 0, max: 1, tone: "pos" },
    { label: "1R to 2R", min: 1, max: 2, tone: "pos" },
    { label: "> 2R", min: 2, max: Infinity, tone: "pos" }
  ].map((bucket) => ({ ...bucket, count: 0 }));

  trades.forEach((trade) => {
    const r = Number(trade.rMultiple);
    if (!Number.isFinite(r)) {
      return;
    }
    const bucket = buckets.find((item) => r >= item.min && r < item.max) || buckets[buckets.length - 1];
    bucket.count += 1;
  });

  return buckets;
}

function computeTraderScore({ winRate, profitFactor, avgWin, avgLoss, totalPnl, maxDrawdown, dailyPnl, startingBalance }) {
  const avgWinLossRatio = avgLoss < 0 ? avgWin / Math.abs(avgLoss) : avgWin > 0 ? 2.5 : 0;
  const recoveryFactor = maxDrawdown > 0 ? totalPnl / maxDrawdown : totalPnl > 0 ? 4 : 0;
  const drawdownPercent = startingBalance > 0 ? (maxDrawdown / startingBalance) * 100 : 0;
  const activeDays = dailyPnl.size;
  const positiveDays = Array.from(dailyPnl.values()).filter((value) => value > 0).length;
  const flatOrPositiveDays = Array.from(dailyPnl.values()).filter((value) => value >= 0).length;
  const consistencyRatio = activeDays > 0 ? (positiveDays * 0.8 + flatOrPositiveDays * 0.2) / activeDays : 0;

  const metrics = [
    { label: "Win %", value: clamp(winRate, 0, 100) },
    { label: "Profit factor", value: normalizeToScore(profitFactor, 0, 3) },
    { label: "Avg win/loss", value: normalizeToScore(avgWinLossRatio, 0, 2.5) },
    { label: "Recovery", value: normalizeToScore(recoveryFactor, 0, 4) },
    { label: "Max drawdown", value: clamp(100 - normalizeToScore(drawdownPercent, 0, 12), 0, 100) },
    { label: "Consistency", value: clamp(consistencyRatio * 100, 0, 100) }
  ];

  const score = metrics.reduce((sum, item) => sum + item.value, 0) / metrics.length || 0;
  let caption = "Collect more sessions to stabilize the score.";
  if (score >= 80) {
    caption = "Strong balance between edge quality and drawdown control.";
  } else if (score >= 60) {
    caption = "Stable base. Improve consistency and recovery to level up.";
  } else if (score >= 40) {
    caption = "Developing edge. Reduce drawdown pressure and tighten execution.";
  }

  return {
    score,
    caption,
    metrics
  };
}

function normalizeToScore(value, min, max) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (max <= min) {
    return 0;
  }
  return clamp(((value - min) / (max - min)) * 100, 0, 100);
}

function computeDisciplineScore(trades, reflections, violations) {
  let score = 100;
  const emotionalCount = trades.filter((trade) => trade.psychology === "Emotional" || trade.psychology === "Revenge Trade").length;
  const poorExecution = trades.filter((trade) => trade.executionQuality === "C" || trade.executionQuality === "F").length;
  const noRuleFollowCount = reflections.filter((entry) => entry.followRules === "No").length;
  const partialRuleCount = reflections.filter((entry) => entry.followRules === "Partially").length;

  score -= violations.riskPerTradeViolations.length * 10;
  score -= violations.dailyViolations.length * 8;
  score -= violations.weeklyViolations.length * 10;
  score -= emotionalCount * 5;
  score -= poorExecution * 4;
  score -= noRuleFollowCount * 6;
  score -= partialRuleCount * 3;

  const perfectExecution = trades.filter(
    (trade) => trade.executionQuality === "A+" || trade.psychology === "Perfect Execution"
  ).length;

  score += perfectExecution * 2;

  return clamp(Math.round(score), 0, 100);
}

function computeDailyTradingScore(trades, reflections, dailyViolations) {
  if (!trades.length) {
    return 0;
  }

  const sorted = [...trades].sort(sortTradesAsc);
  const latestDate = sorted[sorted.length - 1].date;
  const dayTrades = sorted.filter((trade) => trade.date === latestDate);
  const dayPnl = dayTrades.reduce((sum, trade) => sum + trade.netPnl, 0);
  const hasViolation = dailyViolations.some((item) => item.key === latestDate);
  const emotional = dayTrades.filter((trade) => trade.psychology === "Emotional" || trade.psychology === "Revenge Trade").length;
  const cleanExec = dayTrades.filter((trade) => trade.executionQuality === "A+" || trade.executionQuality === "A").length;

  let score = 50;
  score += dayPnl > 0 ? 20 : dayPnl < 0 ? -10 : 0;
  score += hasViolation ? -15 : 15;
  score -= emotional * 10;
  score += cleanExec * 5;

  const dayReflection = reflections.find((entry) => entry.date === latestDate);
  if (dayReflection) {
    if (dayReflection.followRules === "Yes") {
      score += 15;
    } else if (dayReflection.followRules === "Partially") {
      score += 5;
    } else {
      score -= 10;
    }
  }

  return clamp(Math.round(score), 0, 100);
}

function getExtremeDay(dailyMap, mode) {
  if (!dailyMap.size) {
    return { day: "-", pnl: 0 };
  }

  let selected = null;
  for (const [day, pnl] of dailyMap.entries()) {
    if (!selected) {
      selected = { day, pnl };
      continue;
    }

    if (mode === "max" && pnl > selected.pnl) {
      selected = { day, pnl };
    }

    if (mode === "min" && pnl < selected.pnl) {
      selected = { day, pnl };
    }
  }

  return selected;
}

function accumulatePerformanceEntry(map, label, trade) {
  const key = String(label || "Unknown");
  const current = map.get(key) || {
    label: key,
    pnl: 0,
    count: 0
  };

  current.pnl = round(current.pnl + trade.netPnl);
  current.count += 1;
  map.set(key, current);
}

function getTradeDayLabel(dateValue) {
  const parsed = new Date(`${String(dateValue || "").trim()}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown";
  }

  return parsed.toLocaleDateString("en-US", { weekday: "short" });
}

function sortDayPerformance(entries) {
  const order = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return [...entries].sort((a, b) => {
    const indexA = order.indexOf(a.label);
    const indexB = order.indexOf(b.label);
    return (indexA === -1 ? 99 : indexA) - (indexB === -1 ? 99 : indexB);
  });
}

// Count-up: tween old->new with rAF ease-out cubic. The dataset-hash guard
// skips renders whose formatted value did not change, so the tween replays
// only on real dataset changes (or on first arrival, counting up from 0).
function setCountUpValue(node, text, tween) {
  if (node.dataset.countHash === text) {
    return;
  }

  const fromValue = node.dataset.countHash === undefined ? 0 : Number(node.dataset.countValue);
  node.dataset.countHash = text;
  node.dataset.countValue = tween && Number.isFinite(tween.value) ? String(tween.value) : "";

  const previousFrame = countUpFrames.get(node);
  if (previousFrame) {
    cancelAnimationFrame(previousFrame);
    countUpFrames.delete(node);
  }

  if (
    prefersReducedMotion() ||
    !tween ||
    !Number.isFinite(tween.value) ||
    !Number.isFinite(fromValue) ||
    fromValue === tween.value
  ) {
    node.textContent = text;
    return;
  }

  const startTime = performance.now();
  const step = (now) => {
    const t = Math.min((now - startTime) / COUNT_UP_DURATION_MS, 1);
    if (t >= 1) {
      node.textContent = text;
      countUpFrames.delete(node);
      return;
    }
    const eased = 1 - Math.pow(1 - t, 3);
    node.textContent = tween.format(fromValue + (tween.value - fromValue) * eased);
    countUpFrames.set(node, requestAnimationFrame(step));
  };
  countUpFrames.set(node, requestAnimationFrame(step));
}

// Delta chips (§4 graft): each metric compares the current period against the
// previous one. With a full date filter set in the journal, the previous
// period is the same-length window immediately before it; otherwise the
// comparison is current calendar month vs previous calendar month.
function shiftDateString(dateString, days) {
  const parsed = new Date(`${dateString}T00:00:00`);
  parsed.setDate(parsed.getDate() + days);
  return toDateInputValue(parsed);
}

function getMetricDeltaWindows() {
  const { dateFrom, dateTo } = state.filters;
  if (dateFrom && dateTo && dateFrom <= dateTo) {
    const dayMs = 86400000;
    const lengthDays =
      Math.round((new Date(`${dateTo}T00:00:00`) - new Date(`${dateFrom}T00:00:00`)) / dayMs) + 1;
    return {
      label: "vs prev period",
      currentFrom: dateFrom,
      currentTo: dateTo,
      previousFrom: shiftDateString(dateFrom, -lengthDays),
      previousTo: shiftDateString(dateFrom, -1)
    };
  }

  const now = new Date();
  const currentMonth = toDateInputValue(now).slice(0, 7);
  const previousMonth = toDateInputValue(new Date(now.getFullYear(), now.getMonth() - 1, 1)).slice(0, 7);
  return {
    label: "vs prev month",
    currentFrom: `${currentMonth}-01`,
    currentTo: `${currentMonth}-31`,
    previousFrom: `${previousMonth}-01`,
    previousTo: `${previousMonth}-31`
  };
}

function renderMetricDeltas() {
  if (!ui.metricDeltaNodes.length) {
    return;
  }

  const windows = getMetricDeltaWindows();
  const inWindow = (from, to) => state.trades.filter((trade) => trade.date >= from && trade.date <= to);
  const previousTrades = inWindow(windows.previousFrom, windows.previousTo);
  const hasComparison = previousTrades.some((trade) => trade.status !== "open");
  const current = hasComparison
    ? calculateAnalytics(inWindow(windows.currentFrom, windows.currentTo), state.settings, state.reflections)
    : null;
  const previous = hasComparison
    ? calculateAnalytics(previousTrades, state.settings, state.reflections)
    : null;

  ui.metricDeltaNodes.forEach((node) => {
    const spec = METRIC_DELTA_SPECS[node.dataset.metricDelta];
    if (!spec || !hasComparison || (spec.skip && spec.skip(current, previous))) {
      node.hidden = true;
      node.closest(".dash-quad-card")?.classList.remove("is-pos", "is-neg");
      return;
    }

    const delta = spec.read(current) - spec.read(previous);
    const tone = spec.neutral ? 0 : spec.invert ? -delta : delta;
    // 1a: the chip leads with an arrow glyph and a negative one says
    // "sinking" in words, so the tile's pressed clay is never the only cue.
    const arrow = tone > 0 ? "▲ " : tone < 0 ? "▼ " : "";
    const magnitude = spec.format(Math.abs(delta));
    const suffix = tone < 0 ? " — sinking" : "";
    node.textContent = `${arrow}${magnitude} ${windows.label}${suffix}`;
    node.classList.toggle("is-pos", tone > 0);
    node.classList.toggle("is-neg", tone < 0);
    node.hidden = false;

    // Depth as data on the edge quad: the tile sinks when the metric got
    // worse against the previous period.
    const quadCard = node.closest(".dash-quad-card");
    if (quadCard) {
      quadCard.classList.toggle("is-pos", tone > 0);
      quadCard.classList.toggle("is-neg", tone < 0);
    }
  });
}

function renderDashboardMetrics(analytics) {
  const hasTrades = state.trades.length > 0;
  if (ui.metricGrid && ui.dashboardEmptyState) {
    ui.metricGrid.hidden = !hasTrades;
    ui.dashboardEmptyState.hidden = hasTrades;
  }

  const values = {
    accountBalance: formatCurrency(analytics.accountBalance),
    totalTrades: String(analytics.totalTrades),
    winRate: `${analytics.winRate.toFixed(1)}%`,
    avgRR: analytics.avgRR.toFixed(2),
    profitFactor: analytics.profitFactor >= 999 ? "∞" : analytics.profitFactor.toFixed(2),
    currentDrawdown: formatCurrency(analytics.currentDrawdown),
    maxDrawdown: formatCurrency(analytics.maxDrawdown),
    // The date rides in a .metric-sub caption so the rail numeral stays short.
    bestDay: analytics.bestDay.day === "-" ? "-" : formatCurrency(analytics.bestDay.pnl),
    worstDay: analytics.worstDay.day === "-" ? "-" : formatCurrency(analytics.worstDay.pnl),
    expectancy: formatCurrency(analytics.expectancy),
    winningStreak: String(analytics.maxWinStreak),
    losingStreak: String(analytics.maxLossStreak)
  };

  const wholeNumber = (value) => String(Math.round(value));
  const tweens = {
    accountBalance: { value: analytics.accountBalance, format: formatCurrency },
    totalTrades: { value: analytics.totalTrades, format: wholeNumber },
    winRate: { value: analytics.winRate, format: (value) => `${value.toFixed(1)}%` },
    avgRR: { value: analytics.avgRR, format: (value) => value.toFixed(2) },
    profitFactor:
      analytics.profitFactor >= 999
        ? null
        : { value: analytics.profitFactor, format: (value) => value.toFixed(2) },
    currentDrawdown: { value: analytics.currentDrawdown, format: formatCurrency },
    maxDrawdown: { value: analytics.maxDrawdown, format: formatCurrency },
    expectancy: { value: analytics.expectancy, format: formatCurrency },
    winningStreak: { value: analytics.maxWinStreak, format: wholeNumber },
    losingStreak: { value: analytics.maxLossStreak, format: wholeNumber }
  };

  // Money metrics only: value tone + a signed left hairline on the card.
  const toneValues = {
    accountBalance: analytics.accountBalance,
    expectancy: analytics.expectancy,
    bestDay: analytics.bestDay.pnl,
    worstDay: analytics.worstDay.pnl,
    currentDrawdown: analytics.currentDrawdown > 0 ? -analytics.currentDrawdown : 0,
    maxDrawdown: analytics.maxDrawdown > 0 ? -analytics.maxDrawdown : 0
  };

  ui.metricNodes.forEach((node) => {
    const key = node.dataset.metric;
    if (key in values) {
      setCountUpValue(node, values[key], tweens[key] || null);

      if (key in toneValues) {
        toneBySign(node, toneValues[key]);
        // The balance card hairline reads today's P&L sign, not the balance sign.
        const cardTone = key === "accountBalance" ? analytics.todayPnl : toneValues[key];
        const card = node.closest(".metric-card");
        if (card) {
          card.classList.toggle("is-pos", cardTone > 0);
          card.classList.toggle("is-neg", cardTone < 0);
        }
      } else {
        node.classList.remove("pnl-positive", "pnl-negative");
      }
    }
  });

  // --pl-intensity: clamp(|todayPnl| / dailyMaxLoss, 0, 1) drives the balance
  // card's signed hairline width/opacity — sign-at-a-glance, never a glow.
  if (ui.balanceCard) {
    const lossLimit = Math.max(state.settings.dailyMaxLoss, 1);
    ui.balanceCard.style.setProperty(
      "--pl-intensity",
      String(clamp(Math.abs(analytics.todayPnl) / lossLimit, 0, 1))
    );
  }

  // Best/worst-day dates as captions under their (now short) numerals.
  const subs = { bestDay: analytics.bestDay.day, worstDay: analytics.worstDay.day };
  Object.entries(subs).forEach(([key, day]) => {
    const node = document.querySelector(`[data-metric-sub="${key}"]`);
    if (node) {
      node.hidden = !day || day === "-";
      node.textContent = node.hidden ? "" : day;
    }
  });

  renderMetricDeltas();
  // 1a: the balance card owns its own chips + sparkline scoping.
  renderBalanceCard(analytics);

  // Reconcile balanceOverride vs the equity curve: when the override is set,
  // the balance card says so instead of silently contradicting the chart.
  if (ui.balanceOverrideNote) {
    ui.balanceOverrideNote.hidden = !(state.settings.balanceOverride > 0);
  }

  ui.disciplineScore.textContent = String(analytics.disciplineScore);
  ui.dailyTradingScore.textContent = String(analytics.dailyTradingScore);
  ui.goalProgress.textContent = `${clamp(Math.round(analytics.goalProgress), 0, 300)}%`;
  if (ui.traderScoreValue) {
    setCountUpValue(ui.traderScoreValue, analytics.traderScore.score.toFixed(1), {
      value: analytics.traderScore.score,
      format: (value) => value.toFixed(1)
    });
  }
  if (ui.traderScoreCaption) {
    ui.traderScoreCaption.textContent = analytics.traderScore.caption;
  }
}

function drawDashSparkline(canvas, points, progress) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 600;
  const height = canvas.clientHeight || 96;
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (points.length < 2) {
    return;
  }

  // Same visual language as the equity chart: multi-stop area, layered glow
  // stroke, haloed head marker. Every colour is a token.
  const styles = getComputedStyle(document.documentElement);
  const token = (name, fallback) => (styles.getPropertyValue(name) || "").trim() || fallback;
  const rising = points[points.length - 1] >= points[0];
  const stroke = token(rising ? "--pnl-pos" : "--pnl-neg", "#2fd18c");
  const areaTop = token(rising ? "--pnl-pos-line" : "--pnl-neg-line", stroke);
  const areaMid = token(rising ? "--pnl-pos-soft" : "--pnl-neg-soft", stroke);
  const areaFade = token(rising ? "--spark-pos-fade" : "--spark-neg-fade", "rgba(0, 0, 0, 0)");
  const glow = token(rising ? "--chart-pos-glow" : "--chart-neg-glow", stroke);

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const padTop = 14;
  const usable = Math.max(height - padTop - 4, 1);
  const stepX = Math.max(width - 5, 1) / (points.length - 1);
  const yFor = (value) => padTop + (1 - (value - min) / span) * usable;

  // Partial reveal: draw the first `progress` fraction of the series.
  const lastIndex = Math.max(1, Math.round((points.length - 1) * clamp(progress, 0, 1)));
  const drawn = points.slice(0, lastIndex + 1).map((value, index) => ({ x: index * stepX, y: yFor(value) }));
  const head = drawn[drawn.length - 1];

  const gradient = ctx.createLinearGradient(0, padTop, 0, height);
  gradient.addColorStop(0, areaTop);
  gradient.addColorStop(0.5, areaMid);
  gradient.addColorStop(1, areaFade);
  ctx.beginPath();
  ctx.moveTo(drawn[0].x, height);
  traceSmoothPath(ctx, drawn, false);
  ctx.lineTo(head.x, height);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = stroke;
  [
    [14, 0.32, 2.4],
    [6, 0.62, 2],
    [0, 1, 1.8]
  ].forEach(([blur, alpha, lineWidth]) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = glow;
    ctx.shadowBlur = blur;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    traceSmoothPath(ctx, drawn);
    ctx.stroke();
    ctx.restore();
  });

  const halo = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, 15);
  halo.addColorStop(0, areaMid);
  halo.addColorStop(1, areaFade);
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(head.x, head.y, 15, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.shadowColor = glow;
  ctx.shadowBlur = 12;
  ctx.fillStyle = stroke;
  ctx.beginPath();
  ctx.arc(head.x, head.y, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function renderDashSparkline(analytics) {
  const canvas = ui.dashSparkline;
  if (!canvas) {
    return;
  }

  // Scoped by the 1M / 3M / ALL toggle; the range rides in the hash so a
  // toggle repaints (and re-animates) but a live tick still does not.
  const points = getScopedEquity(analytics);
  const hash = `${state.dashboard.balanceRange}:${points.length}:${points[points.length - 1]}:${points[0]}`;
  const changed = hash !== dashSparkHash;
  dashSparkHash = hash;

  if (dashSparkFrame) {
    cancelAnimationFrame(dashSparkFrame);
    dashSparkFrame = 0;
  }

  if (!changed || prefersReducedMotion() || points.length < 2) {
    drawDashSparkline(canvas, points, 1);
    return;
  }

  const startTime = performance.now();
  const step = (now) => {
    const t = Math.min((now - startTime) / 640, 1);
    drawDashSparkline(canvas, points, 1 - Math.pow(1 - t, 3));
    dashSparkFrame = t < 1 ? requestAnimationFrame(step) : 0;
  };
  dashSparkFrame = requestAnimationFrame(step);
}

// Pointer-tracked 3D tilt for the dashboard deck cards. `stage` receives the
// pointer (it may be a wrapper),
// `panel` is what rotates. Writes five custom properties and nothing else:
// --tilt-x / --tilt-y (rotation, degrees), --px / --py (specular centre, %)
// and --sheen (specular opacity). All the visuals live in CSS.
//
// Only a real mouse on a hover-capable, wide viewport ever gets a rotation:
// callers refuse to bind at all under reduced motion, and the fine-pointer
// query gates every handler so a touch drag can never rotate a card. The
// matching CSS drops `perspective` and the specular below 980px / on coarse
// pointers, so those users see a still, flat, fully-rendered card.
function bindPointerTilt(stage, panel, maxTilt) {
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine) and (min-width: 980px)");
  let rect = null;
  let frame = 0;
  let tiltX = 0;
  let tiltY = 0;
  let sheenX = 50;
  let sheenY = 0;
  let sheen = 0;

  const commit = () => {
    frame = 0;
    panel.style.setProperty("--tilt-x", `${tiltX.toFixed(2)}deg`);
    panel.style.setProperty("--tilt-y", `${tiltY.toFixed(2)}deg`);
    panel.style.setProperty("--px", `${sheenX.toFixed(1)}%`);
    panel.style.setProperty("--py", `${sheenY.toFixed(1)}%`);
    panel.style.setProperty("--sheen", sheen.toFixed(2));
  };

  const schedule = () => {
    if (!frame) {
      frame = requestAnimationFrame(commit);
    }
  };

  const reset = () => {
    rect = null;
    tiltX = 0;
    tiltY = 0;
    sheenX = 50;
    sheenY = 0;
    sheen = 0;
    schedule();
  };

  const engaged = (event) => event.pointerType === "mouse" && finePointer.matches;

  // Rect is cached on enter (and dropped on leave/resize) so the pointer
  // handler never forces a synchronous layout while the tape is repainting.
  stage.addEventListener("pointerenter", (event) => {
    if (!engaged(event)) {
      return;
    }
    rect = stage.getBoundingClientRect();
  });

  stage.addEventListener("pointermove", (event) => {
    if (!engaged(event)) {
      return;
    }
    if (!rect) {
      rect = stage.getBoundingClientRect();
    }
    const nx = (event.clientX - rect.left) / (rect.width || 1) - 0.5;
    const ny = (event.clientY - rect.top) / (rect.height || 1) - 0.5;
    tiltY = clamp(nx, -0.5, 0.5) * 2 * maxTilt;
    tiltX = clamp(-ny, -0.5, 0.5) * 2 * maxTilt;
    sheenX = clamp((nx + 0.5) * 100, 0, 100);
    sheenY = clamp((ny + 0.5) * 100, 0, 100);
    sheen = 1;
    schedule();
  });

  stage.addEventListener("pointerleave", reset);
  window.addEventListener("resize", reset, { passive: true });
  // Older Safari only has the deprecated addListener; optional call keeps the
  // tilt working there instead of throwing during init.
  finePointer.addEventListener?.("change", reset);
}

// Dashboard deck cards (balance hero, risk meters, edge quad). The 1d landing
// no longer tilts anything — its tape is a flat clay card — so this is now the
// only caller.
function setupDeckTilt() {
  if (prefersReducedMotion()) {
    return;
  }

  document.querySelectorAll("[data-tilt]").forEach((card) => bindPointerTilt(card, card, 3.5));
}

// Landing sections fade up as they enter the viewport (same contract as the
// dashboard panels: reduced motion opts out of the mechanism entirely).
function setupLandingReveals() {
  const targets = Array.from(document.querySelectorAll("[data-landing-reveal]"));
  if (!targets.length || prefersReducedMotion() || !("IntersectionObserver" in window)) {
    targets.forEach((section) => section.classList.add("is-revealed"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-revealed");
          observer.unobserve(entry.target);
        }
      });
    },
    { rootMargin: "0px 0px -10% 0px", threshold: 0.08 }
  );

  targets.forEach((section) => observer.observe(section));
}

// Scroll-revealed dashboard panels. Reduced motion (or no IntersectionObserver)
// skips the mechanism entirely — the panels are simply visible.
function setupScrollReveals() {
  const targets = Array.from(
    document.querySelectorAll("#dashboard .panel-grid-analytics > .panel, #dashboard .panel-grid-bottom > .panel")
  );
  if (!targets.length || prefersReducedMotion() || !("IntersectionObserver" in window)) {
    return;
  }

  targets.forEach((panel, index) => {
    panel.dataset.reveal = "";
    panel.style.transitionDelay = `${Math.min(index, 4) * 60}ms`;
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-revealed");
          observer.unobserve(entry.target);
        }
      });
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.04 }
  );

  targets.forEach((panel) => observer.observe(panel));
}

// Daily/weekly risk-budget strip: how much of the configured loss limits
// today and this week have consumed. Breach logic mirrors the violations
// filters in calculateAnalytics (pnl < -limit).
function renderRiskStrip(analytics) {
  if (!ui.riskStrip) {
    return;
  }

  const entries = [
    { key: "day", pnl: analytics.todayPnl, limit: state.settings.dailyMaxLoss },
    { key: "week", pnl: analytics.weekPnl, limit: state.settings.weeklyMaxLoss }
  ];

  const visible = state.trades.length > 0 && entries.some((entry) => entry.limit > 0);
  ui.riskStrip.hidden = !visible;
  if (!visible) {
    return;
  }

  let tightestLeft = 1;
  let breached = false;

  entries.forEach((entry) => {
    const item = ui.riskStrip.querySelector(`[data-risk-strip="${entry.key}"]`);
    if (!item) {
      return;
    }

    item.hidden = !(entry.limit > 0);
    if (item.hidden) {
      return;
    }

    const used = Math.max(-entry.pnl, 0);
    const ratio = clamp(used / entry.limit, 0, 1);
    const isBreach = entry.pnl < -entry.limit;
    breached = breached || isBreach;
    tightestLeft = Math.min(tightestLeft, 1 - ratio);

    item.classList.toggle("is-breach", isBreach);
    item.classList.toggle("is-warn", !isBreach && ratio >= 0.6);

    const fill = item.querySelector(".risk-strip-fill");
    if (fill) {
      fill.style.width = `${Math.round(ratio * 100)}%`;
    }
    // "used / limit" — the figures the mockup asks for, in that order.
    const value = item.querySelector(".risk-strip-value");
    if (value) {
      value.textContent = `${formatCurrency(used)} / ${formatCurrency(entry.limit)}`;
    }
  });

  // The dial reads the TIGHTEST of the two budgets: the one that locks the
  // desk first is the one that matters. State is carried by the word, the
  // colour and the arc — never by the arc alone (WCAG 1.4.1).
  const percentLeft = Math.round(clamp(tightestLeft, 0, 1) * 100);
  const state3 = breached ? "breach" : tightestLeft <= 0.4 ? "warn" : "safe";

  if (ui.riskDial) {
    ui.riskDial.classList.remove("is-safe", "is-warn", "is-breach");
    ui.riskDial.classList.add(`is-${state3}`);
  }
  if (ui.riskState) {
    ui.riskState.textContent = state3.toUpperCase();
    ui.riskState.classList.remove("is-safe", "is-warn", "is-breach");
    ui.riskState.classList.add(`is-${state3}`);
  }
  if (ui.riskDialArc) {
    // r=48 → circumference 2πr. dasharray paints the remaining budget.
    const circumference = 2 * Math.PI * 48;
    ui.riskDialArc.setAttribute(
      "stroke-dasharray",
      `${(clamp(tightestLeft, 0, 1) * circumference).toFixed(1)} ${circumference.toFixed(1)}`
    );
  }
  if (ui.riskDialValue) {
    ui.riskDialValue.innerHTML = `${percentLeft}<span>%</span>`;
    ui.riskDial?.setAttribute("aria-label", `${percentLeft}% of the tightest loss budget left — ${state3}`);
    ui.riskDial?.setAttribute("role", "img");
  }
  if (ui.riskConsequence) {
    ui.riskConsequence.textContent = buildRiskConsequence(analytics, breached);
  }
}

// The consequence line, computed from the real budgets and risk-per-trade:
// risk amount = account balance x risk% , losses left = daily budget / that.
function buildRiskConsequence(analytics, breached) {
  const dailyLimit = state.settings.dailyMaxLoss;
  const weeklyLimit = state.settings.weeklyMaxLoss;

  if (weeklyLimit > 0 && analytics.weekPnl < -weeklyLimit) {
    return "The weekly budget is gone — the desk is locked until next week.";
  }
  if (breached || (dailyLimit > 0 && analytics.todayPnl < -dailyLimit)) {
    return "Today's budget is gone — the desk is locked until tomorrow.";
  }
  if (!(dailyLimit > 0)) {
    return "No daily loss budget set, so nothing stops you. Set one in Risk Controls.";
  }

  const riskPercent = state.settings.riskPerTrade;
  const riskAmount = (analytics.accountBalance * riskPercent) / 100;
  if (!(riskAmount > 0)) {
    return "Set a risk-per-trade percentage to see how many losses today's budget survives.";
  }

  const left = Math.max(dailyLimit - Math.max(-analytics.todayPnl, 0), 0);
  const losses = Math.floor(left / riskAmount);
  const risk = `${round(riskPercent)}%`;
  if (losses <= 0) {
    return `The next loss at ${risk} breaches today's budget and the desk locks until tomorrow.`;
  }
  if (losses === 1) {
    return `One more loss at ${risk} and the desk locks until tomorrow.`;
  }
  return `${losses} more losses at ${risk} and the desk locks until tomorrow.`;
}

/* ── 1a greeting ───────────────────────────────────────────────────────────
   "Wednesday · London open in 42m" + "Good morning, <name>."
   The countdown is computed against the real clock in each venue's own time
   zone (so DST is handled by Intl, not by a hard-coded offset) and weekend
   occurrences are skipped forward to Monday. */
// Name: the journal name if the trader set one, else the account username.
// No name configured returns "" and the greeting drops the address entirely —
// it never invents one.
function getTraderName() {
  const journalName = normalizeJournalName(state.settings.journalName);
  if (journalName && journalName !== DEFAULT_SETTINGS.journalName) {
    return journalName;
  }
  return String(state.auth.username || "").trim();
}

function renderGreeting() {
  if (!ui.dashClock || !ui.dashHello) {
    return;
  }

  const now = new Date();
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(now);
  const next = getNextSessionOpen(now);
  ui.dashClock.textContent = next
    ? `${weekday} · ${next.name} open in ${formatCountdown(next.minutes)}`
    : weekday;

  const hour = now.getHours();
  const partOfDay = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const name = getTraderName();
  ui.dashHello.textContent = name ? `Good ${partOfDay}, ${name}.` : `Good ${partOfDay}.`;
}

/* ── 1a balance card ─────────────────────────────────────────────────────── */
function syncBalanceRangeButtons() {
  ui.balanceRangeButtons.forEach((button) => {
    const isActive = button.dataset.balanceRange === state.dashboard.balanceRange;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function shiftDaysIso(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return toDateInputValue(date);
}

// Equity value as of a date, read off the analytics equity/equityDates pair.
// Before the first trade there is only the starting balance.
function balanceAtDate(analytics, isoDate) {
  const equity = Array.isArray(analytics?.equity) ? analytics.equity : [];
  const dates = Array.isArray(analytics?.equityDates) ? analytics.equityDates : [];
  if (!equity.length) {
    return state.settings.startingBalance;
  }
  let value = equity[0];
  for (let index = 0; index < equity.length; index += 1) {
    if ((dates[index] || "") <= isoDate) {
      value = equity[index];
    } else {
      break;
    }
  }
  return value;
}

function getScopedEquity(analytics) {
  const equity = Array.isArray(analytics?.equity) ? analytics.equity.filter(Number.isFinite) : [];
  const days = BALANCE_RANGE_DAYS[state.dashboard.balanceRange] || 0;
  if (!days || equity.length < 2) {
    return equity;
  }
  const cutoff = shiftDaysIso(days);
  const dates = Array.isArray(analytics.equityDates) ? analytics.equityDates : [];
  const scoped = equity.filter((_, index) => (dates[index] || "") >= cutoff);
  // Fewer than two points in the window is not a curve — fall back to all.
  return scoped.length >= 2 ? scoped : equity;
}

/* ── 1f #05 equity scrub ───────────────────────────────────────────────────
   The playhead in src/modules/charts.js hands renderEquityScrub an index into
   analytics.equity, or null when the scrub is cleared. Index 0 is the starting
   balance — a real point on the curve, but not a trade — and index i is the
   i-th closed trade in the same ascending order calculateAnalytics walked to
   build the curve. Everything on the panel is read off that trade; there is no
   placeholder row, so a curve with no trade behind a point says so. */

// The trade that produced equity[index], or null for the starting balance.
// Re-derived from state rather than cached onto analytics: this is the exact
// expression calculateAnalytics uses for `ordered`, so the two cannot drift
// out of step the way a parallel array would.
function equityScrubTradeAt(index) {
  if (!Number.isFinite(index) || index <= 0) {
    return null;
  }
  return getClosedTrades(state.trades).sort(sortTradesAsc)[index - 1] || null;
}

// What a screen reader hears as the playhead moves — the same facts the panel
// shows, in one line, and never a number the panel does not also show.
function equityScrubValueText(index, trade, count) {
  if (!Number.isFinite(index) || index < 0 || index >= count) {
    return "No point selected";
  }
  const position = `Point ${index + 1} of ${count}`;
  if (!trade) {
    return `${position}. Starting balance, before the first trade.`;
  }
  const parts = [
    position,
    trade.asset || "Unknown symbol",
    trade.setupType || "no setup recorded",
    trade.session || "no session recorded",
    // Spoken, not coloured: "up" and "down" are the sign, since a screen
    // reader never sees the green.
    trade.netPnl === 0 ? "net flat" : `net ${trade.netPnl > 0 ? "up" : "down"} ${formatCurrency(Math.abs(trade.netPnl))}`
  ];
  if (Number.isFinite(trade.rMultiple)) {
    parts.push(`${trade.rMultiple.toFixed(2)} R`);
  }
  return `${parts.join(", ")}.`;
}

function renderEquityScrub(index) {
  const equity = Array.isArray(state.analytics?.equity) ? state.analytics.equity : [];
  const dates = Array.isArray(state.analytics?.equityDates) ? state.analytics.equityDates : [];
  const count = equity.length;
  const engaged = Number.isFinite(index) && index >= 0 && index < count;
  const trade = engaged ? equityScrubTradeAt(index) : null;

  if (ui.equityChart) {
    ui.equityChart.setAttribute("aria-valuemin", "0");
    ui.equityChart.setAttribute("aria-valuemax", String(Math.max(count - 1, 0)));
    ui.equityChart.setAttribute("aria-valuenow", String(engaged ? index : 0));
    ui.equityChart.setAttribute("aria-valuetext", equityScrubValueText(index, trade, count));
  }

  if (ui.equityScrub) {
    ui.equityScrub.hidden = !engaged;
  }
  if (ui.equityScrubHint) {
    ui.equityScrubHint.hidden = engaged;
  }
  if (!engaged) {
    if (ui.equityScrubShot) {
      ui.equityScrubShot.hidden = true;
      ui.equityScrubShot.removeAttribute("src");
      ui.equityScrubShot.alt = "";
    }
    return;
  }

  setText(ui.equityScrubPos, `Point ${index + 1} of ${count} · balance ${formatCurrency(equity[index])}`);

  if (ui.equityScrubNet) {
    // Colour is never the only signal — the sign travels in the text too.
    ui.equityScrubNet.className = `eq-scrub-net${
      trade ? (trade.netPnl > 0 ? " pnl-positive" : trade.netPnl < 0 ? " pnl-negative" : "") : ""
    }`;
  }

  if (!trade) {
    setText(ui.equityScrubSymbol, "Starting balance");
    setText(ui.equityScrubNet, "");
    setText(
      ui.equityScrubMeta,
      dates[index] ? `Where the curve begins · ${formatIsoShort(dates[index])}` : "Where the curve begins"
    );
    setText(ui.equityScrubNote, "No trade here — this is the balance the account opened with.");
  } else {
    setText(ui.equityScrubSymbol, trade.asset || "Unknown symbol");
    setText(ui.equityScrubNet, playbookMoney(trade.netPnl));
    setText(
      ui.equityScrubMeta,
      [
        formatIsoShort(trade.date),
        trade.setupType || "No setup",
        trade.session || "No session",
        Number.isFinite(trade.rMultiple) ? `${trade.rMultiple.toFixed(2)}R` : "No R recorded"
      ].join(" · ")
    );
    setText(ui.equityScrubNote, trade.notes || "No note on this trade.");
  }

  if (ui.equityScrubNote) {
    ui.equityScrubNote.classList.toggle("is-muted", !trade || !trade.notes);
  }

  if (ui.equityScrubShot) {
    // Same trust boundary as the playbook shots: only an inline data: image
    // ever reaches a src attribute.
    const shot = trade && isInlineImage(trade.screenshotData) ? trade.screenshotData : "";
    if (shot) {
      ui.equityScrubShot.src = shot;
      ui.equityScrubShot.alt = `Chart screenshot from the ${trade.asset || "unknown"} trade on ${trade.date}`;
      ui.equityScrubShot.hidden = false;
    } else {
      ui.equityScrubShot.hidden = true;
      ui.equityScrubShot.removeAttribute("src");
      ui.equityScrubShot.alt = "";
    }
  }
}

function renderBalanceCard(analytics) {
  if (!analytics) {
    return;
  }
  syncBalanceRangeButtons();

  const hasTrades = state.trades.length > 0;
  const equity = Array.isArray(analytics.equity) ? analytics.equity : [];
  // Change figures come off the computed equity curve, never off a manual
  // balance override — mixing the two would produce a number nobody can trace.
  const computedBalance = equity[equity.length - 1] ?? state.settings.startingBalance;

  const setChip = (node, text, tone) => {
    if (!node) {
      return;
    }
    node.hidden = !hasTrades || !text;
    node.textContent = text || "";
    node.classList.toggle("is-pos", tone > 0);
    node.classList.toggle("is-neg", tone < 0);
  };

  const today = analytics.todayPnl;
  setChip(
    ui.dashHeroToday,
    `${today > 0 ? "▲ " : today < 0 ? "▼ " : ""}${formatCurrency(Math.abs(today))} today`,
    today
  );

  const weekAgo = balanceAtDate(analytics, shiftDaysIso(7));
  const weekPct = weekAgo > 0 ? ((computedBalance - weekAgo) / weekAgo) * 100 : 0;
  setChip(
    ui.dashHeroWeek,
    `${weekPct >= 0 ? "+" : "−"}${Math.abs(weekPct).toFixed(2)}% vs last week`,
    weekPct
  );

  const range = state.dashboard.balanceRange;
  const days = BALANCE_RANGE_DAYS[range] || 0;
  const base = days ? balanceAtDate(analytics, shiftDaysIso(days)) : state.settings.startingBalance;
  const change = computedBalance - base;
  setChip(
    ui.dashHeroRange,
    `${change >= 0 ? "+" : "−"}${formatCurrency(Math.abs(change))} ${BALANCE_RANGE_LABELS[range]}`,
    change
  );

  renderDashSparkline(analytics);
}

/* ── 1a playbook ─────────────────────────────────────────────────────────── */
function renderPlaybook(analytics) {
  if (!ui.dashPlaybook || !ui.dashPlaybookGrid) {
    return;
  }

  // Expectancy per setup = net P&L / trades taken. Most-used setups first,
  // which is what a playbook review actually wants to see.
  const rows = (analytics?.setupStats || [])
    .filter((row) => row.trades > 0)
    .map((row) => ({
      setup: row.setup,
      trades: row.trades,
      netPnl: row.netPnl,
      winRate: (row.wins / row.trades) * 100,
      expectancy: row.netPnl / row.trades
    }))
    .sort((a, b) => b.trades - a.trades)
    .slice(0, 4);

  ui.dashPlaybook.hidden = rows.length === 0;
  if (!rows.length) {
    ui.dashPlaybookGrid.innerHTML = "";
    renderSetupAlert();
    return;
  }

  const peak = Math.max(...rows.map((row) => Math.abs(row.expectancy)), 1);
  ui.dashPlaybookGrid.innerHTML = rows
    .map((row) => {
      const positive = row.expectancy >= 0;
      const width = clamp((Math.abs(row.expectancy) / peak) * 100, 6, 100);
      // 1f #04: the tile is the door into that setup's playbook page. A button
      // rather than a click handler on an <article> so it is keyboard-reachable
      // and announced as the control it now is.
      return `
        <button class="dash-play-tile ${positive ? "is-raised" : "is-sunk"}" type="button" data-playbook-setup="${escapeHtml(row.setup)}">
          <span class="dash-play-name">${escapeHtml(row.setup)}</span>
          <span class="dash-play-value ${positive ? "pnl-positive" : "pnl-negative"}"><span aria-hidden="true">${positive ? "▲" : "▼"}</span> ${positive ? "" : "−"}${formatCurrency(Math.abs(row.expectancy))}<span class="dash-play-unit">/trade</span></span>
          <span class="dash-play-meta">Net ${positive ? "+" : "−"}${formatCurrency(Math.abs(row.netPnl))}</span>
          <span class="dash-play-meta">${row.trades} trade${row.trades === 1 ? "" : "s"} · ${row.winRate.toFixed(0)}% win</span>
          <span class="dash-play-bar" aria-hidden="true"><span style="width:${width.toFixed(0)}%"></span></span>
        </button>
      `;
    })
    .join("");

  renderSetupAlert();
}

// A setup is "failing" when its most recent closed trades are an unbroken run
// of losses. Three is the shortest run worth naming; below that it is noise.
function findFailingSetup() {
  const bySetup = new Map();
  getClosedTrades()
    .slice()
    .sort(sortTradesDesc)
    .forEach((trade) => {
      const key = trade.setupType || "Unknown";
      if (!bySetup.has(key)) {
        bySetup.set(key, []);
      }
      bySetup.get(key).push(trade);
    });

  let worst = null;
  bySetup.forEach((trades, setup) => {
    let streak = 0;
    for (const trade of trades) {
      if (Number(trade.netPnl) < 0) {
        streak += 1;
      } else {
        break;
      }
    }
    if (streak >= 3 && (!worst || streak > worst.streak)) {
      worst = { setup, streak, trades: trades.slice(0, streak) };
    }
  });
  return worst;
}

function renderSetupAlert() {
  if (!ui.dashSetupAlert || !ui.dashSetupAlertText) {
    return;
  }

  const failing = findFailingSetup();
  ui.dashSetupAlert.hidden = !failing;
  if (!failing) {
    return;
  }

  const tags = failing.trades.map((trade) => String(trade.psychology || "").trim()).filter(Boolean);
  const counts = new Map();
  tags.forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
  const unique = Array.from(counts.keys());

  let tagSentence = "";
  if (tags.length === failing.streak && unique.length && unique.length <= 2) {
    tagSentence = ` Every one was tagged ${unique.join(" or ")}.`;
  } else if (unique.length) {
    const [topTag, topCount] = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
    if (topCount / failing.streak >= 0.5) {
      tagSentence = ` Most were tagged ${topTag}.`;
    }
  }

  ui.dashSetupAlertText.textContent =
    `${failing.setup} has been negative for ${failing.streak} trades straight.${tagSentence}` +
    " Retire it, or gate it behind your checklist.";
}

/* ══ 1f #04 — PLAYBOOK PAGES ═══════════════════════════════════════════════
   design-source/1f-features.html: "Each setup gets a page: its expectancy
   curve, its best session, its screenshots side by side. The Edge Detection
   table already computes every number — it just has nowhere to go."

   Route: #playbook/<setup>. Every figure is recomputed here from the ACTIVE
   account's closed trades in that setup (state.trades is already scoped), so
   the page can never disagree with the dashboard or with Edge Detection.

   The honesty rule: below PLAYBOOK_MIN_TRADES closed trades the win rate,
   profit factor, average R and expectancy are withheld and the threshold is
   stated. A 100% win rate over two trades is a lie with a percent sign on it.
   Trade count, net P&L and the screenshots are still shown — those are facts,
   not statistics. Profit factor with no losing trades is not "999": it is a
   number that cannot be computed yet, and the tile says so.
   ═══════════════════════════════════════════════════════════════════════════ */

// Setups the active account has actually closed trades in, busiest first.
function getPlaybookSetups() {
  const counts = new Map();
  getClosedTrades().forEach((trade) => {
    const key = trade.setupType || "Unknown";
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([setup, trades]) => ({ setup, trades }));
}

// A stored screenshot is only ever an inline data: image. Anything else in
// that field (a stale record, a hand-edited export) is not rendered as a src.
function isInlineImage(value) {
  return /^data:image\//i.test(String(value || ""));
}

function playbookGroup(trades, field) {
  const map = new Map();
  trades.forEach((trade) => {
    const label = String(trade[field] || "").trim() || "Unknown";
    const row = map.get(label) || { label, trades: 0, wins: 0, netPnl: 0 };
    row.trades += 1;
    row.netPnl = round(row.netPnl + trade.netPnl);
    if (trade.result === "Win") {
      row.wins += 1;
    }
    map.set(label, row);
  });
  return Array.from(map.values()).sort((a, b) => b.netPnl - a.netPnl);
}

function buildPlaybookReport(setup) {
  const trades = getClosedTrades()
    .filter((trade) => (trade.setupType || "Unknown") === setup)
    .sort(sortTradesAsc);

  let net = 0;
  let wins = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let rTotal = 0;
  let rCount = 0;
  const curve = [];
  const dates = [];

  trades.forEach((trade, index) => {
    net = round(net + trade.netPnl);
    if (trade.netPnl > 0) {
      wins += 1;
      grossProfit += trade.netPnl;
    } else if (trade.netPnl < 0) {
      grossLoss += Math.abs(trade.netPnl);
    }
    if (Number.isFinite(trade.rMultiple)) {
      rTotal += trade.rMultiple;
      rCount += 1;
    }
    // The expectancy curve: what this setup had been worth PER TRADE after
    // each trade it produced. Flat is a stable edge, a falling tail is an
    // edge decaying — which a cumulative P&L line hides behind its own slope.
    curve.push(round(net / (index + 1)));
    dates.push(trade.date);
  });

  return {
    setup,
    trades,
    count: trades.length,
    netPnl: net,
    wins,
    winRate: trades.length > 0 ? (wins / trades.length) * 100 : 0,
    expectancy: trades.length > 0 ? net / trades.length : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    avgR: rCount > 0 ? rTotal / rCount : null,
    rCount,
    curve,
    dates,
    sessions: playbookGroup(trades, "session"),
    timeframes: playbookGroup(trades, "timeframe"),
    psychology: playbookGroup(trades, "psychology"),
    shots: trades.filter((trade) => isInlineImage(trade.screenshotData)).slice().sort(sortTradesDesc)
  };
}

function playbookMoney(value) {
  return `${value >= 0 ? "+" : "−"}${formatCurrency(Math.abs(value))}`;
}

function playbookTradeCount(count) {
  return `${count} trade${count === 1 ? "" : "s"}`;
}

// Rows arrive sorted by net P&L descending, so best is first and worst last.
// With a single group there is no best or worst — there is one fact, and it
// says so rather than crowning the only candidate.
function playbookExtremes(rows, noun) {
  if (!rows.length) {
    return "";
  }
  if (rows.length === 1) {
    return `Only one ${noun} here — ${rows[0].label}, on all ${playbookTradeCount(rows[0].trades)}. Nothing to compare it against.`;
  }
  const best = rows[0];
  const worst = rows[rows.length - 1];
  return (
    `Best ${noun}: ${best.label}, ${playbookMoney(best.netPnl)} over ${playbookTradeCount(best.trades)}. ` +
    `Worst: ${worst.label}, ${playbookMoney(worst.netPnl)} over ${playbookTradeCount(worst.trades)}.`
  );
}

function playbookBarList(rows) {
  const peak = Math.max(...rows.map((row) => Math.abs(row.netPnl)), 1);
  return `
    <ul class="pb-bars">
      ${rows
        .map((row) => {
          const positive = row.netPnl >= 0;
          const width = clamp((Math.abs(row.netPnl) / peak) * 100, 6, 100);
          return `
            <li class="pb-bar-row">
              <span class="pb-bar-label">${escapeHtml(row.label)}</span>
              <span class="pb-bar-value ${positive ? "pnl-positive" : "pnl-negative"}">${playbookMoney(row.netPnl)}</span>
              <span class="pb-bar-track" aria-hidden="true"><span class="pb-bar-fill ${positive ? "is-pos" : "is-neg"}" style="width:${width.toFixed(0)}%"></span></span>
              <span class="pb-bar-meta">${playbookTradeCount(row.trades)} · ${Math.round((row.wins / row.trades) * 100)}% win</span>
            </li>
          `;
        })
        .join("")}
    </ul>
  `;
}

function playbookBreakdownCard(title, noun, rows) {
  return `
    <section class="panel pb-breakdown">
      <div class="panel-head">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(playbookExtremes(rows, noun))}</p>
      </div>
      ${playbookBarList(rows)}
    </section>
  `;
}

function renderPlaybookPage() {
  if (!ui.playbookPicker || !ui.playbookStats) {
    return;
  }

  const setups = getPlaybookSetups();
  const active = setups.some((row) => row.setup === state.playbook.setup)
    ? state.playbook.setup
    : setups[0]?.setup || "";
  state.playbook.setup = active;

  ui.playbookPicker.innerHTML = setups
    .map(
      (row) => `
        <button
          class="pb-pick${row.setup === active ? " is-active" : ""}"
          type="button"
          data-playbook-setup="${escapeHtml(row.setup)}"
          ${row.setup === active ? 'aria-current="page"' : ""}
        >${escapeHtml(row.setup)}<span class="pb-pick-count">${row.trades}</span></button>
      `
    )
    .join("");

  const report = active ? buildPlaybookReport(active) : null;
  const enough = Boolean(report) && report.count >= PLAYBOOK_MIN_TRADES;

  // The series charts.js paints. Cleared below the threshold so the canvas
  // shows its empty label instead of a curve nobody should read.
  state.playbook.curve = enough ? report.curve : [];
  state.playbook.dates = enough ? report.dates : [];
  state.playbook.key = enough && report.expectancy < 0 ? "neg" : "line";

  ui.playbookHeading.textContent = active || "Setups";
  if (ui.playbookJournalBtn) {
    ui.playbookJournalBtn.hidden = !active;
  }

  if (!report) {
    ui.playbookLede.textContent =
      "No closed trades yet. Log and close a trade and its setup gets a page here.";
    ui.playbookEmpty.hidden = true;
    ui.playbookStats.innerHTML = "";
    ui.playbookChartPanel.hidden = true;
    ui.playbookBreakdowns.innerHTML = "";
    ui.playbookShotsPanel.hidden = true;
    ui.playbookShots.innerHTML = "";
    return;
  }

  const accountLabel = getActiveAccount()?.label || "";
  ui.playbookLede.textContent =
    `${playbookTradeCount(report.count)} closed${accountLabel ? ` in ${accountLabel}` : ""}, ` +
    `net ${playbookMoney(report.netPnl)}.`;

  // Below the threshold: say so, name the number, and show nothing derived.
  ui.playbookEmpty.hidden = enough;
  if (!enough) {
    ui.playbookEmpty.textContent =
      `${report.setup} has ${playbookTradeCount(report.count)} closed. ` +
      `Win rate, profit factor, average R and the expectancy curve need at least ` +
      `${PLAYBOOK_MIN_TRADES} before they mean anything, so they are left out rather than guessed. ` +
      `Net so far is ${playbookMoney(report.netPnl)}.`;
  }

  ui.playbookStats.innerHTML = enough
    ? [
        {
          label: "Expectancy",
          value: playbookMoney(report.expectancy),
          meta: "per trade",
          tone: report.expectancy >= 0 ? "pos" : "neg"
        },
        {
          label: "Net P&L",
          value: playbookMoney(report.netPnl),
          meta: playbookTradeCount(report.count),
          tone: report.netPnl >= 0 ? "pos" : "neg"
        },
        {
          label: "Win rate",
          value: `${report.winRate.toFixed(0)}%`,
          meta: `${report.wins} of ${report.count} closed green`
        },
        {
          label: "Profit factor",
          value: report.profitFactor === null ? "—" : report.profitFactor.toFixed(2),
          meta: report.profitFactor === null ? "no losing trade yet" : "gross win ÷ gross loss"
        },
        {
          label: "Avg R",
          value: report.avgR === null ? "—" : `${report.avgR >= 0 ? "+" : "−"}${Math.abs(report.avgR).toFixed(2)}R`,
          meta: report.avgR === null ? "no risk distance recorded" : `over ${playbookTradeCount(report.rCount)}`
        }
      ]
        .map(
          (stat) => `
            <article class="pb-stat${stat.tone ? ` is-${stat.tone}` : ""}">
              <p class="pb-stat-label">${escapeHtml(stat.label)}</p>
              <p class="pb-stat-value${stat.tone ? ` pnl-${stat.tone === "pos" ? "positive" : "negative"}` : ""}">${escapeHtml(stat.value)}</p>
              <p class="pb-stat-meta">${escapeHtml(stat.meta)}</p>
            </article>
          `
        )
        .join("")
    : "";

  ui.playbookChartPanel.hidden = !enough;

  ui.playbookBreakdowns.innerHTML = enough
    ? [
        playbookBreakdownCard("Sessions", "session", report.sessions),
        playbookBreakdownCard("Timeframes", "timeframe", report.timeframes),
        playbookBreakdownCard("Psychology", "state of mind", report.psychology)
      ].join("")
    : "";

  ui.playbookShotsPanel.hidden = report.shots.length === 0;
  ui.playbookShotsLede.textContent = report.shots.length
    ? `${report.shots.length} of ${report.count} trades in ${report.setup} have a chart attached, newest first.`
    : "";
  ui.playbookShots.innerHTML = report.shots
    .map((trade) => {
      const positive = trade.netPnl >= 0;
      return `
        <figure class="pb-shot">
          <img
            class="pb-shot-img"
            src="${escapeHtml(trade.screenshotData)}"
            alt="Chart screenshot from the ${escapeHtml(trade.asset)} trade on ${escapeHtml(trade.date)}"
            loading="lazy"
          />
          <figcaption class="pb-shot-caption">
            <p class="pb-shot-head">
              <span class="pb-shot-symbol">${escapeHtml(trade.asset)}</span>
              <span class="pb-shot-net ${positive ? "pnl-positive" : "pnl-negative"}">${playbookMoney(trade.netPnl)}</span>
            </p>
            <p class="pb-shot-meta">${escapeHtml(formatIsoShort(trade.date))} · ${escapeHtml(trade.timeframe)} · ${escapeHtml(trade.session)}</p>
            ${
              trade.notes
                ? `<p class="pb-shot-note">${escapeHtml(trade.notes)}</p>`
                : '<p class="pb-shot-note is-muted">No note on this trade.</p>'
            }
          </figcaption>
        </figure>
      `;
    })
    .join("");
}

function openPlaybook(setup) {
  state.playbook.setup = setup || state.playbook.setup;
  switchView("playbook");
}

// The route back out: the review screen filtered to this setup and nothing
// else, so "show me the trades behind that number" is one tap.
function openPlaybookInJournal() {
  if (!state.playbook.setup) {
    return;
  }
  clearFilters();
  ui.filters.setup.value = state.playbook.setup;
  handleFilterChange();
  switchView("journal");
}

/* ── 1a unjournalled ─────────────────────────────────────────────────────────
   RULE: a CLOSED trade is journalled once it has been through the 1c close
   sheet (journalledAt) or it carries a note. Notes were the only test before
   1c existed, and they stay in the rule so every trade written before this
   ships keeps its status — psychology ships with a populated default, so
   testing that instead would flag nothing. One predicate, used by the card,
   the mobile pill, the streak, the bars and the nav badge. */
function isTradeJournalled(trade) {
  return Boolean(trade.journalledAt) || Boolean(String(trade.notes || "").trim());
}

function getUnjournalledTrades() {
  return getClosedTrades()
    .filter((trade) => !isTradeJournalled(trade))
    .sort(sortTradesDesc);
}

function renderUnjournalled() {
  const pending = getUnjournalledTrades();

  // Desktop top bar and mobile dock carry the same count — 1f #01 asks for the
  // badge in the nav AND the dock, and a phone only ever sees the dock.
  [ui.navUnjournalledBadge, ui.tabBarUnjournalledBadge].forEach((badge) => {
    if (!badge) {
      return;
    }
    badge.hidden = pending.length === 0;
    badge.textContent = String(pending.length);
    badge.setAttribute(
      "aria-label",
      `${pending.length} trade${pending.length === 1 ? "" : "s"} without a note`
    );
  });

  if (!ui.dashUnjournalled || !ui.dashUnjournalledList) {
    return;
  }

  // The card stays up once there is anything closed to journal: with an empty
  // queue it flips to the all-clear state, which is the only place the streak
  // is visible — hiding it would hide the reward for keeping it.
  const hasClosed = getClosedTrades().length > 0;
  ui.dashUnjournalled.hidden = !hasClosed;
  if (ui.dashJournalCta) {
    ui.dashJournalCta.hidden = !hasClosed || pending.length === 0;
    if (ui.dashJournalCtaCount) {
      ui.dashJournalCtaCount.textContent = String(pending.length);
    }
  }
  if (!hasClosed) {
    ui.dashUnjournalledList.innerHTML = "";
    return;
  }

  ui.dashUnjournalled.classList.toggle("is-clear", pending.length === 0);
  const lede = ui.dashUnjournalled.querySelector(".dash-unj-lede");
  if (ui.dashUnjournalledCount) {
    ui.dashUnjournalledCount.textContent = pending.length
      ? `${pending.length} trade${pending.length === 1 ? "" : "s"}`
      : "All clear";
  }
  if (lede) {
    lede.textContent = pending.length
      ? "Closed, but you never said why. Two minutes each."
      : "Every closed trade has a note. Keep it that way.";
  }

  ui.dashUnjournalledList.innerHTML = pending
    .slice(0, 3)
    .map((trade) => {
      const net = Number(trade.netPnl) || 0;
      const tone = net > 0 ? "pnl-positive" : net < 0 ? "pnl-negative" : "";
      const symbol = escapeHtml(trade.asset || "—");
      return `
        <button class="dash-unj-row" type="button" data-unjournalled-trade="${escapeHtml(String(trade.id || ""))}">
          <span class="dash-unj-symbol">${symbol}</span>
          <span class="dash-unj-net ${tone}">${net === 0 ? formatCurrency(0) : formatSignedCurrency(net)}</span>
          <span class="dash-unj-date">${escapeHtml(formatCompactTradeDate(trade))}</span>
          <span class="dash-unj-chevron" aria-hidden="true">›</span>
          <span class="visually-hidden">Journal this ${symbol} trade</span>
        </button>
      `;
    })
    .join("");

  renderJournalStreak();
}

// JOURNAL STREAK = consecutive TRADING days, counting back from the most
// recent day that has closed trades, on which every closed trade has a note.
function buildJournalDays() {
  const byDate = new Map();
  getClosedTrades().forEach((trade) => {
    const day = byDate.get(trade.date) || { date: trade.date, total: 0, journalled: 0 };
    day.total += 1;
    if (isTradeJournalled(trade)) {
      day.journalled += 1;
    }
    byDate.set(trade.date, day);
  });
  return Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? 1 : -1));
}

function renderJournalStreak() {
  const days = buildJournalDays();

  let streak = 0;
  for (const day of days) {
    if (day.total > 0 && day.journalled === day.total) {
      streak += 1;
    } else {
      break;
    }
  }

  if (ui.dashJournalStreak) {
    ui.dashJournalStreak.textContent = `${streak} day${streak === 1 ? "" : "s"}`;
  }

  if (!ui.dashJournalBars) {
    return;
  }

  // Seven most recent trading days, oldest → newest. Bar height is the trade
  // count for that day; the tone says whether they were all journalled.
  const recent = days.slice(0, 7).reverse();
  const peak = Math.max(...recent.map((day) => day.total), 1);
  ui.dashJournalBars.innerHTML = recent
    .map((day) => {
      const complete = day.journalled === day.total;
      const height = 10 + Math.round((day.total / peak) * 16);
      return `<span class="dash-unj-bar ${complete ? "is-done" : "is-missing"}" style="height:${height}px"></span>`;
    })
    .join("");
  ui.dashJournalBars.setAttribute(
    "aria-label",
    recent.length
      ? `Last ${recent.length} trading day${recent.length === 1 ? "" : "s"}: ${recent.filter((day) => day.journalled === day.total).length} fully journalled`
      : "No trading days yet"
  );
}

function scrollDashboardTo(node) {
  if (!node) {
    return;
  }
  node.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
}

/* ══ 1e CALENDAR ═══════════════════════════════════════════════════════════
   The month name is the heading, the meta line is trading days / trades /
   most-traded symbol, and MONTH NET sits beside the ‹ › nav. Every figure is
   computed from the closed trades in the month — there is no placeholder.
   ═══════════════════════════════════════════════════════════════════════════ */

// ‹ › month nav. The <input type="month"> stays the single source of truth,
// so the existing change listener does the re-render.
/* ══ 1f #02 — the pre-trade checklist, and what skipping it costs ══════════
   design-source/1f-features.html: "Three or four rules you write once, shown
   inside the New Trade sheet, stored with the row… With this it becomes
   causal: 'the nine trades where you skipped the news check are −$1,240.'"

   The editor writes state.settings.preTradeRules; the sheet reads it; the
   trade stores BOTH what was ticked and what was asked, and the report below
   is the difference between those two populations. */

// The editor works on a draft so a half-typed rule is never live in the sheet.
function getRulesDraft() {
  if (!rulesDraft) {
    rulesDraft = getPreTradeRules().map((rule) => ({ ...rule }));
  }
  return rulesDraft;
}

function renderRulesEditor() {
  if (!ui.rulesEditorList) {
    return;
  }
  const draft = getRulesDraft();
  ui.rulesEditorList.innerHTML = draft.length
    ? draft
        .map(
          (rule, index) => `
        <div class="rules-row">
          <input
            class="rules-input"
            type="text"
            maxlength="90"
            data-rule-index="${index}"
            value="${escapeHtml(rule.label)}"
            placeholder="e.g. No news inside 15 minutes"
            aria-label="Rule ${index + 1}"
          />
          <button class="rules-remove" type="button" data-rule-remove="${index}" aria-label="Remove rule ${index + 1}">
            <span aria-hidden="true">&times;</span>
          </button>
        </div>`
        )
        .join("")
    : '<p class="rules-empty">No rules. The New Trade sheet will not ask for a checklist, and the rule-cost report below stays empty.</p>';

  if (ui.rulesAddBtn) {
    ui.rulesAddBtn.disabled = draft.length >= 8;
  }
}

// Pull whatever is currently typed into the draft before add/remove/save, so
// a re-render never loses an edit.
function syncRulesDraftFromInputs() {
  const draft = getRulesDraft();
  ui.rulesEditorList?.querySelectorAll("[data-rule-index]").forEach((input) => {
    const index = Number(input.dataset.ruleIndex);
    if (draft[index]) {
      draft[index].label = input.value;
    }
  });
}

function handleRulesAdd() {
  syncRulesDraftFromInputs();
  const draft = getRulesDraft();
  if (draft.length >= 8) {
    return;
  }
  // Blank id: normalizePreTradeRules slugs one from the label on save. Minting
  // it here would bake in a slug of the placeholder text.
  draft.push({ id: "", label: "" });
  renderRulesEditor();
  ui.rulesEditorList?.querySelector(`[data-rule-index="${draft.length - 1}"]`)?.focus();
}

function handleRulesRemove(index) {
  syncRulesDraftFromInputs();
  getRulesDraft().splice(index, 1);
  renderRulesEditor();
  ui.rulesAddBtn?.focus();
}

function handleRulesSubmit(event) {
  event.preventDefault();
  syncRulesDraftFromInputs();
  const cleaned = normalizePreTradeRules(getRulesDraft());
  state.settings = normalizeSettings({ ...state.settings, preTradeRules: cleaned });
  rulesDraft = cleaned.map((rule) => ({ ...rule }));
  persistState();
  renderRulesEditor();
  renderAll();
  setMessage(
    ui.rulesFormMessage,
    cleaned.length
      ? `Checklist saved — ${cleaned.length} rule${cleaned.length === 1 ? "" : "s"} will show in the New Trade sheet.`
      : "Checklist cleared. The New Trade sheet will stop asking.",
    "success"
  );
}

/* The causal half. For each rule, split the trades that WERE SHOWN that rule
   into ticked and skipped, and compare the money. Trades that never saw a
   checklist (everything logged before 1f, every import, every command-bar
   capture) are excluded — they have no answer to compare. */
function computeRuleCosts() {
  const closed = getClosedTrades().filter((trade) => (trade.preTradeRulesAsked || []).length > 0);
  const sumNet = (rows) => rows.reduce((total, trade) => total + (Number(trade.netPnl) || 0), 0);

  return getPreTradeRules().map((rule) => {
    const seen = closed.filter((trade) => trade.preTradeRulesAsked.includes(rule.id));
    const kept = seen.filter((trade) => (trade.preTradeRules || []).includes(rule.id));
    const skipped = seen.filter((trade) => !(trade.preTradeRules || []).includes(rule.id));
    return {
      rule,
      keptCount: kept.length,
      skippedCount: skipped.length,
      keptPnl: sumNet(kept),
      skippedPnl: sumNet(skipped),
      ready: kept.length >= RULE_COST_MIN_SIDE && skipped.length >= RULE_COST_MIN_SIDE
    };
  });
}

// Trades opened through a cooldown prompt. A statement about specific rows,
// not a statistic, so one is enough to report.
function computeCooldownCost() {
  const rows = getClosedTrades().filter((trade) => trade.cooldownOverride);
  return {
    count: rows.length,
    pnl: rows.reduce((total, trade) => total + (Number(trade.netPnl) || 0), 0),
    revenge: rows.filter((trade) => trade.psychology === "Revenge Trade").length
  };
}

function renderRuleCost() {
  if (!ui.ruleCostList) {
    return;
  }

  const items = [];
  const costs = computeRuleCosts();
  const ready = costs.filter((cost) => cost.ready);

  ready.forEach((cost) => {
    const skippedText = `${cost.skippedCount} trade${cost.skippedCount === 1 ? "" : "s"}`;
    const tone = cost.skippedPnl < 0 ? "is-bad" : "is-good";
    items.push(
      `<li class="rule-cost-item ${tone}">
        The ${skippedText} where you skipped &ldquo;${escapeHtml(cost.rule.label)}&rdquo;
        ${cost.skippedCount === 1 ? "is" : "are"} <strong>${escapeHtml(formatSignedCurrency(cost.skippedPnl))}</strong>.
        The ${cost.keptCount} where you ticked it: <strong>${escapeHtml(formatSignedCurrency(cost.keptPnl))}</strong>.
      </li>`
    );
  });

  const cooldown = computeCooldownCost();
  if (cooldown.count > 0) {
    items.push(
      `<li class="rule-cost-item ${cooldown.pnl < 0 ? "is-bad" : "is-good"}">
        ${cooldown.count} closed trade${cooldown.count === 1 ? "" : "s"} taken through a cooldown prompt:
        <strong>${escapeHtml(formatSignedCurrency(cooldown.pnl))}</strong>${
          cooldown.revenge
            ? `, ${cooldown.revenge} tagged Revenge Trade`
            : ""
        }.
      </li>`
    );
  }

  if (!items.length) {
    // Nothing is ready — say exactly what the threshold is and how close the
    // best-covered rule is, rather than showing an empty panel or a number
    // built on two trades.
    if (!getPreTradeRules().length) {
      items.push(
        '<li class="rule-cost-note">No pre-trade checklist yet. Write your rules below and the cost of skipping them shows up here.</li>'
      );
    } else {
      const best = costs
        .slice()
        .sort((a, b) => Math.min(b.keptCount, b.skippedCount) - Math.min(a.keptCount, a.skippedCount))[0];
      const progress =
        best && best.keptCount + best.skippedCount > 0
          ? ` Closest: &ldquo;${escapeHtml(best.rule.label)}&rdquo; — ${best.keptCount} ticked, ${best.skippedCount} skipped.`
          : " No trade has been through the checklist yet.";
      items.push(
        `<li class="rule-cost-note">A rule needs ${RULE_COST_MIN_SIDE} closed trades on each side — ticked and skipped — before the money difference means anything.${progress}</li>`
      );
    }
  }

  ui.ruleCostList.innerHTML = items.join("");
}

/* ══ 1f #03 — the cooldown lock ═══════════════════════════════════════════
   design-source/1f-features.html: "at the daily limit, or after N losses in a
   row, the Log-a-trade button changes state and asks one question before it
   unlocks. Not a hard block, a speed bump."

   The trigger conditions are exactly the two branches buildRiskConsequence()
   already reports plus the configurable loss streak. Answering the question
   always unlocks — the friction IS the feature, refusal is not. */

function getConsecutiveLosses() {
  let losses = 0;
  for (const trade of getClosedTrades().sort(sortTradesDesc)) {
    if (trade.result !== "Loss") {
      break;
    }
    losses += 1;
  }
  return losses;
}

function getCooldownState() {
  if (!state.settings.cooldownEnabled || !canAccessApp()) {
    return null;
  }

  const analytics = state.analytics || {};
  const dailyLimit = state.settings.dailyMaxLoss;
  const weeklyLimit = state.settings.weeklyMaxLoss;

  /* Prop limits come FIRST, ahead of the personal budgets, because they are
     the ones that end the account rather than the day. Same speed bump, same
     one question, same override stamped on the trade — a prop limit does not
     get its own parallel interlock, it reuses this one. */
  const prop = getActivePropEvaluation();
  if (prop) {
    const account = getActiveAccount();
    const pressure = mllPressure(prop, typicalLossSize());
    if (prop.status === "breached") {
      return {
        reason: "prop-mll",
        badge: "Max loss limit breached",
        headline: `${account.label} is past its max loss limit on closed P&L.`,
        detail: `Closed trades put the account at ${formatCurrency(prop.breachBalance)} on ${
          prop.breachedOn
        }, at or below the ${formatCurrency(prop.mll)} limit. Confirm with the firm before you trade it.`,
        question: "What are you trading here, on an account you may no longer have?"
      };
    }
    if (prop.dailyBreached) {
      return {
        reason: "prop-daily",
        badge: "Daily limit spent",
        headline: `Today has spent the ${formatCurrency(prop.dailyLimit)} daily limit on ${account.label}.`,
        detail: `Today is ${formatSignedCurrency(prop.todayPnl)}, against the ${
          prop.dailyBinding === "firm" ? "firm limit" : "budget"
        } you entered.`,
        question: "What is the setup here that the last one did not have?"
      };
    }
    if (pressure.level === "warn") {
      return {
        reason: "prop-room",
        badge: `${formatCurrency(prop.room)} to the limit`,
        headline: `${formatCurrency(prop.room)} of room left on ${account.label}.`,
        detail: `Your typical losing trade on this account is ${formatCurrency(
          typicalLossSize()
        )}. ${pressure.lossesLeft === 0 ? "One more of those breaches the limit." : "One more of those, then the next one breaches it."}`,
        question: "What size are you taking, and what does it cost if it loses?"
      };
    }
  }

  if (weeklyLimit > 0 && (analytics.weekPnl || 0) < -weeklyLimit) {
    return {
      reason: "weekly",
      badge: "Weekly budget gone",
      headline: "The weekly loss budget is gone.",
      detail: `This week is ${formatSignedCurrency(analytics.weekPnl || 0)} against a ${formatCurrency(weeklyLimit)} budget.`,
      question: "What has changed since the trade that broke the budget?"
    };
  }
  if (dailyLimit > 0 && (analytics.todayPnl || 0) < -dailyLimit) {
    return {
      reason: "daily",
      badge: "Daily budget gone",
      headline: "Today's loss budget is gone.",
      detail: `Today is ${formatSignedCurrency(analytics.todayPnl || 0)} against a ${formatCurrency(dailyLimit)} budget.`,
      question: "What is the setup here that the last one did not have?"
    };
  }

  const streakLimit = state.settings.cooldownLossStreak;
  const losses = streakLimit > 0 ? getConsecutiveLosses() : 0;
  if (streakLimit > 0 && losses >= streakLimit) {
    return {
      reason: "streak",
      badge: `${losses} losses in a row`,
      headline: `${losses} losses in a row.`,
      detail: `Your cooldown triggers at ${streakLimit}. Change that in Risk Controls.`,
      question: "What is the setup here that the last one did not have?"
    };
  }
  return null;
}

// The button state. Colour is never the only signal — the badge word and the
// button's accessible description carry it too.
function renderCooldown() {
  const cool = getCooldownState();
  if (!cool && pendingCooldown) {
    // The condition lifted before the answer was spent; the stamp would be a
    // lie on whatever trade came next.
    pendingCooldown = null;
  }

  [ui.journalNewTradeBtn, ui.tabBarNewTradeBtn, ui.dashboardEmptyCta].forEach((button) => {
    if (!button) {
      return;
    }
    button.classList.toggle("is-cooldown", Boolean(cool));
    if (cool) {
      button.setAttribute("title", `${cool.headline} One question before you log another.`);
    } else {
      button.removeAttribute("title");
    }
  });

  if (ui.dashLogCooldownFlag) {
    ui.dashLogCooldownFlag.hidden = !cool;
    ui.dashLogCooldownFlag.textContent = cool ? cool.badge : "";
  }
}

/* Every route into "log a trade" passes through here: the dashboard button,
   the mobile FAB, the empty-state CTA and ⌘K. One gate, so a new entry point
   cannot accidentally bypass the speed bump. */
function requestTradeCapture(opener) {
  if (!canAccessApp()) {
    return;
  }
  // Already answered and the answer has not been spent — do not ask twice for
  // the same trade.
  const cool = pendingCooldown ? null : getCooldownState();
  if (!cool) {
    opener();
    return;
  }
  if (!ui.cooldownDialog) {
    // No dialog in the DOM: a speed bump that cannot render must not become a
    // block.
    opener();
    return;
  }
  cooldownPrompt = { reason: cool.reason, opener };
  ui.cooldownHeadline.textContent = cool.headline;
  ui.cooldownDetail.textContent = cool.detail;
  ui.cooldownQuestion.textContent = cool.question;
  ui.cooldownAnswer.value = "";
  setMessage(ui.cooldownMessage, "", "");
  ui.cooldownDialog.showModal();
  ui.cooldownAnswer.focus();
}

function handleCooldownSubmit(event) {
  event.preventDefault();
  const answer = ui.cooldownAnswer.value.trim();
  if (!answer) {
    setMessage(ui.cooldownMessage, "Answer it in your own words — that is the whole speed bump.", "error");
    ui.cooldownAnswer.focus();
    return;
  }
  const prompt = cooldownPrompt;
  pendingCooldown = { reason: prompt?.reason || "", note: answer };
  ui.cooldownDialog.close();
  renderCooldown();
  prompt?.opener?.();
  cooldownPrompt = null;
}

function handleCooldownStepAway() {
  ui.cooldownDialog?.close();
  cooldownPrompt = null;
  showCaptureToast("Nothing logged. The budget is still there tomorrow.");
}

// Spent by the next trade written after an override, then cleared.
function consumePendingCooldown() {
  if (!pendingCooldown) {
    return {};
  }
  const carry = {
    cooldownOverride: true,
    cooldownReason: pendingCooldown.reason,
    cooldownNote: pendingCooldown.note
  };
  pendingCooldown = null;
  return carry;
}

/* ══ MULTI-ACCOUNT ════════════════════════════════════════════════════════
   A trader running a 25K evaluation and a 50K funded account has two separate
   equity curves, two separate drawdowns and two separate sets of rules. Mixing
   them into one number is not a rounding error, it is a wrong answer — so the
   whole app is scoped to ONE account at a time and the switcher says which.

   The scoping trick is deliberately dumb: state.trades holds the active
   account's rows, state.otherTrades holds everything else, and persistState()
   writes the concatenation. Fifty existing readers of state.trades became
   account-scoped without being touched. */

function getAccounts() {
  return Array.isArray(state.settings.accounts) ? state.settings.accounts : [];
}

function getVisibleAccounts() {
  return getAccounts().filter((account) => !account.archived);
}

function getActiveAccount() {
  const accounts = getAccounts();
  if (!accounts.length) {
    return null;
  }
  const exact = accounts.find((account) => account.id === state.settings.activeAccountId);
  // An archived account is not a place to be standing, so an active id that
  // points at one falls through to the first live account.
  if (exact && !exact.archived) {
    return exact;
  }
  return accounts.find((account) => !account.archived) || exact || accounts[0];
}

function getAccountById(id) {
  return getAccounts().find((account) => account.id === String(id)) || null;
}

function accountTypeLabel(type) {
  return ACCOUNT_TYPES.find((item) => item.id === type)?.label || "Personal";
}

function makeAccount(input = {}) {
  const startingBalance = ensureNonNegative(input.startingBalance, 0);
  return {
    id: String(input.id || "").trim() || createId(),
    label: String(input.label || "").trim().slice(0, 40) || "Account",
    firm: String(input.firm || "").trim().slice(0, 40),
    type: ACCOUNT_TYPE_IDS.has(input.type) ? input.type : "personal",
    startingBalance,
    currency: (String(input.currency || "USD").trim().toUpperCase().slice(0, 4)) || "USD",
    archived: Boolean(input.archived),
    prop: normalizePropRules(input.prop, startingBalance)
  };
}

function normalizeAccounts(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  const seen = new Set();
  return input
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const account = makeAccount(item);
      // Two accounts sharing an id would make every trade ambiguous, so a
      // collision mints a fresh id rather than dropping the account.
      while (seen.has(account.id)) {
        account.id = createId();
      }
      seen.add(account.id);
      return account;
    })
    .slice(0, MAX_ACCOUNTS);
}

/* Every journal written before this feature has trades with no accountId and a
   settings object with no accounts. Both are filled in here, once, from the
   data that is already there — no trade is dropped, renamed or renumbered. */
function ensureAccounts() {
  if (!getAccounts().length) {
    state.settings.accounts = [
      makeAccount({
        label: DEFAULT_ACCOUNT_LABEL,
        startingBalance: state.settings.startingBalance
      })
    ];
  }
  const active = getActiveAccount();
  state.settings.activeAccountId = active ? active.id : "";
}

function allTrades() {
  return state.trades.concat(state.otherTrades);
}

/* Takes a WHOLE journal (all accounts) and splits it around the active
   account. Callers: loadState, the server load, the backup import, the demo
   seed and every account switch. */
function adoptAllTrades(list) {
  ensureAccounts();
  const activeId = state.settings.activeAccountId;
  const known = new Set(getAccounts().map((account) => account.id));
  const stamped = (Array.isArray(list) ? list : []).map((trade) => {
    const owner = String(trade.accountId || "");
    // No accountId (pre-migration), or an accountId whose account is gone:
    // the row belongs to the account the trader is looking at rather than to
    // nothing at all. Losing it would be the one unforgivable bug here.
    return known.has(owner) ? trade : { ...trade, accountId: activeId };
  });
  state.trades = stamped.filter((trade) => trade.accountId === activeId);
  state.otherTrades = stamped.filter((trade) => trade.accountId !== activeId);
}

/* The account owns its starting balance; state.settings mirrors it so that
   calculateAnalytics and every balance readout keep working without learning
   what an account is. A $0 start (Express-Funded style) is left out of the
   mirror on purpose — settings.startingBalance is also the base for percentage
   and position-size maths, and zero makes those meaningless. The prop tracker
   reads the account's own $0 directly, which is the only place it matters. */
function applyActiveAccount() {
  ensureAccounts();
  const account = getActiveAccount();
  if (account && account.startingBalance > 0) {
    state.settings.startingBalance = account.startingBalance;
  }
  adoptAllTrades(allTrades());
}

function switchAccount(id) {
  const account = getAccountById(id);
  if (!account || account.id === state.settings.activeAccountId) {
    renderAccountSwitcher();
    return;
  }
  // Fold the two lists back together BEFORE moving the pointer, or the old
  // active account's trades are the ones that get orphaned.
  const everything = allTrades();
  state.settings.activeAccountId = account.id;
  if (account.startingBalance > 0) {
    state.settings.startingBalance = account.startingBalance;
  }
  adoptAllTrades(everything);
  // A filter set for one account is meaningless on another, and a half-open
  // sheet belongs to a trade that is no longer on screen.
  clearFilters();
  hydrateRiskForm();
  persistState();
  renderAll();
  showCaptureToast(`Switched to ${account.label}. Everything on screen is this account only.`);
}

function saveAccount(draft) {
  const accounts = getAccounts();
  const index = accounts.findIndex((account) => account.id === draft.id);
  const everything = allTrades();
  if (index >= 0) {
    accounts[index] = draft;
  } else {
    accounts.push(draft);
    state.settings.activeAccountId = draft.id;
  }
  if (draft.id === state.settings.activeAccountId && draft.startingBalance > 0) {
    state.settings.startingBalance = draft.startingBalance;
  }
  adoptAllTrades(everything);
  hydrateRiskForm();
  persistState();
  renderAll();
}

/* Archiving, never deleting. An archived account keeps every trade it owns —
   it just stops appearing in the switcher. There is no "delete account" here
   on purpose: the trades under it have no separate home, and this app already
   has one irreversible action too many. */
function setAccountArchived(id, archived) {
  const account = getAccountById(id);
  if (!account) {
    return;
  }
  if (archived && getVisibleAccounts().length <= 1) {
    showCaptureToast("That is your only live account — add another before archiving this one.", "warn");
    return;
  }
  const everything = allTrades();
  account.archived = Boolean(archived);
  if (account.archived && account.id === state.settings.activeAccountId) {
    state.settings.activeAccountId = getVisibleAccounts()[0]?.id || "";
  }
  applyActiveAccount();
  adoptAllTrades(everything);
  hydrateRiskForm();
  persistState();
  renderAll();
  showCaptureToast(
    archived
      ? `${account.label} archived. Its ${countAccountTrades(account.id)} trades are still stored.`
      : `${account.label} is live again.`
  );
}

function countAccountTrades(id) {
  return allTrades().filter((trade) => trade.accountId === id).length;
}

/* ══ THE PROP-FIRM TRACKER ════════════════════════════════════════════════
   Everything below reads evaluateProp(), which reads the trader's own closed
   trades and the trader's own typed limits. Nothing here asserts what a firm's
   rules are, and nothing here says "you passed" — see renderPropTracker. */

function getActivePropEvaluation() {
  const account = getActiveAccount();
  if (!account || !account.prop?.enabled) {
    return null;
  }
  return evaluateProp({
    rules: account.prop,
    startBalance: account.startingBalance,
    steps: propSteps(state.trades, account.prop.basis),
    todayKey: toDateInputValue(new Date()),
    personalDailyLimit: state.settings.dailyMaxLoss
  });
}

// The size of an ordinary losing trade on THIS account, from real closed
// losses. Median rather than mean: one catastrophic loss should not make the
// warning complacent about the next normal one.
function typicalLossSize() {
  const losses = getClosedTrades()
    .map((trade) => Number(trade.netPnl))
    .filter((pnl) => Number.isFinite(pnl) && pnl < 0)
    .map((pnl) => Math.abs(pnl))
    .sort((a, b) => a - b);
  if (!losses.length) {
    return 0;
  }
  const middle = Math.floor(losses.length / 2);
  return losses.length % 2 ? losses[middle] : (losses[middle - 1] + losses[middle]) / 2;
}

function propStatusCopy(evaluation) {
  if (evaluation.status === "breached") {
    return { word: "BREACHED", tone: "breach" };
  }
  if (evaluation.status === "target-met") {
    // Deliberately NOT "PASSED". The research could not confirm the exact pass
    // condition any firm applies (minimum days, how "maintain the target" is
    // checked, an undisclosed consistency buffer), and this app cannot see the
    // account anyway. It reports the one thing it actually knows.
    return { word: "TARGET MET", tone: "good" };
  }
  if (evaluation.status === "idle") {
    return { word: "NO TRADES YET", tone: "idle" };
  }
  return { word: "IN PROGRESS", tone: "live" };
}

function renderPropTracker() {
  if (!ui.propTracker) {
    return;
  }

  const account = getActiveAccount();
  const evaluation = canAccessApp() ? getActivePropEvaluation() : null;
  ui.propTracker.hidden = !evaluation;
  if (!evaluation || !account) {
    return;
  }

  const money = (value) => formatCurrency(value);
  const status = propStatusCopy(evaluation);
  const pressure = mllPressure(evaluation, typicalLossSize());

  if (ui.propAccountName) {
    ui.propAccountName.textContent = account.firm ? `${account.label} · ${account.firm}` : account.label;
  }
  if (ui.propStatus) {
    ui.propStatus.textContent = status.word;
    ui.propStatus.className = `prop-status is-${status.tone}`;
  }

  // 1. Equity. The account's own money, from its own closed trades.
  setText(ui.propEquity, money(evaluation.balance));
  setText(
    ui.propEquityMeta,
    `${formatSignedCurrency(evaluation.netProfit)} since ${money(evaluation.startBalance)} start · ${evaluation.daysTraded} day${
      evaluation.daysTraded === 1 ? "" : "s"
    } traded`
  );

  // 2. The Max Loss Limit. The number that busts people, so it is the biggest
  //    thing after equity and it is stated in dollars, not as a percentage.
  const hasMll = evaluation.mll !== null;
  if (ui.propMllBlock) {
    ui.propMllBlock.hidden = !hasMll;
  }
  if (hasMll) {
    setText(ui.propMll, money(evaluation.mll));
    setText(ui.propRoom, formatSignedCurrency(evaluation.room));
    if (ui.propRoom) {
      // Colour is never the only signal — the dollar figure is right there —
      // but a green number above a red bar would be a contradiction.
      ui.propRoom.classList.toggle("is-warn", pressure.level === "warn");
      ui.propRoom.classList.toggle("is-breach", evaluation.room <= 0);
    }
    if (ui.propRoomBar) {
      // The bar reads room remaining against the full drawdown allowance —
      // never the sole signal, the dollar figures above carry it too.
      const span = evaluation.rules.drawdown > 0 ? evaluation.rules.drawdown : 1;
      const left = clamp(evaluation.room / span, 0, 1);
      ui.propRoomBar.style.width = `${Math.round(left * 100)}%`;
      ui.propRoomBar.parentElement?.classList.toggle("is-warn", left <= 0.4 && left > 0);
      ui.propRoomBar.parentElement?.classList.toggle("is-breach", evaluation.room <= 0);
    }
    setText(
      ui.propMllMeta,
      evaluation.rules.mode === "static"
        ? `Static floor — ${money(evaluation.startBalance)} start less a ${money(
            evaluation.rules.drawdown
          )} limit. It has never moved and never will.`
        : evaluation.mllLocked
          ? `Trailing, and now locked: it reached its ${money(evaluation.rules.trailStopAt)} ceiling and stops there.`
          : `Trails your best ${
              evaluation.rules.basis === "trade" ? "closed-trade" : "end-of-day"
            } balance of ${money(evaluation.peak)}, less ${money(evaluation.rules.drawdown)}. It only ever moves up.`
    );
    // How the floor moved as equity made new highs — the thing that surprises
    // people, shown as the moves that actually happened.
    const moves = evaluation.mllMoves;
    setText(
      ui.propMllMoves,
      moves.length
        ? `Moved up ${moves.length} time${moves.length === 1 ? "" : "s"} — last on ${
            moves[moves.length - 1].date
          }, from ${money(moves[moves.length - 1].from)} to ${money(moves[moves.length - 1].to)}.`
        : "Has not moved yet — it sits where it started."
    );
  }

  // 3. Profit target.
  const hasTarget = evaluation.baseTarget > 0;
  if (ui.propTargetBlock) {
    ui.propTargetBlock.hidden = !hasTarget;
  }
  if (hasTarget) {
    setText(ui.propTargetValue, `${money(Math.max(evaluation.netProfit, 0))} / ${money(evaluation.effectiveTarget)}`);
    if (ui.propTargetBar) {
      ui.propTargetBar.style.width = `${Math.round((evaluation.targetProgress || 0) * 100)}%`;
    }
    // consistencyRatio is null while the account is net flat or down — a best
    // day divided by a non-positive total profit is not a percentage, and
    // printing `null * 100` as "0%" would be a fabricated number.
    const ratioText =
      evaluation.consistencyRatio === null
        ? "the account is not net profitable yet, so there is no ratio to quote"
        : `${(evaluation.consistencyRatio * 100).toFixed(0)}% of total profit`;
    setText(
      ui.propTargetMeta,
      evaluation.effectiveTarget > evaluation.baseTarget
        ? `Raised from ${money(evaluation.baseTarget)}: your best day, ${money(
            evaluation.bestDay
          )}, is ${ratioText} against the ${evaluation.rules.consistencyPct}% consistency figure you entered.`
        : `${Math.round((evaluation.targetProgress || 0) * 100)}% of the ${money(evaluation.baseTarget)} target you entered.`
    );
  }

  // 4. Daily loss, against whichever budget is tighter.
  if (ui.propDailyBlock) {
    ui.propDailyBlock.hidden = evaluation.dailyLimit <= 0;
  }
  if (evaluation.dailyLimit > 0) {
    setText(ui.propDailyValue, `${money(evaluation.dailyUsed)} / ${money(evaluation.dailyLimit)}`);
    if (ui.propDailyBar) {
      const used = clamp(evaluation.dailyUsed / evaluation.dailyLimit, 0, 1);
      ui.propDailyBar.style.width = `${Math.round(used * 100)}%`;
      ui.propDailyBar.parentElement?.classList.toggle("is-warn", used >= 0.6 && used < 1);
      ui.propDailyBar.parentElement?.classList.toggle("is-breach", evaluation.dailyBreached);
    }
    setText(
      ui.propDailyMeta,
      evaluation.dailyBinding === "firm"
        ? `The firm limit you entered is the tighter of the two, so it is the one shown. Your own daily budget is ${
            state.settings.dailyMaxLoss > 0 ? money(state.settings.dailyMaxLoss) : "not set"
          }.`
        : `Your own daily budget is tighter than the ${money(
            evaluation.rules.dailyLossLimit
          )} firm limit you entered, so it is the one shown.`
    );
  }

  // 5. The warning that has to arrive BEFORE the breach.
  if (ui.propWarning) {
    const warning = buildPropWarning(evaluation, pressure);
    ui.propWarning.textContent = warning.text;
    ui.propWarning.className = `prop-warning is-${warning.tone}`;
  }

  if (ui.propLimits) {
    const bits = [];
    if (evaluation.rules.maxContracts > 0) {
      bits.push(`Max ${evaluation.rules.maxContracts} contract${evaluation.rules.maxContracts === 1 ? "" : "s"}`);
    }
    if (evaluation.rules.flattenBy) {
      bits.push(`Flat by ${evaluation.rules.flattenBy}`);
    }
    ui.propLimits.textContent = bits.join(" · ");
    ui.propLimits.hidden = bits.length === 0;
  }

  if (ui.propHonesty) {
    const notes = [PROP_DISCLAIMER, PROP_VISIBILITY_NOTE];
    if (!evaluation.rules.confirmed) {
      notes.unshift("These figures are still the prefilled defaults — open the account and confirm them against your statement.");
    }
    notes.push(
      "Days are bucketed by the date on each trade. If your firm's trading day starts the evening before, an evening fill will sit on the wrong day here."
    );
    ui.propHonesty.innerHTML = notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("");
  }
}

// One sentence, computed from the account's real room and its real losses.
// Never a prediction, never advice — an arithmetic statement about the gap.
function buildPropWarning(evaluation, pressure) {
  if (evaluation.status === "breached") {
    return {
      tone: "breach",
      text: `Closed P&L put this account at ${formatCurrency(evaluation.breachBalance)} on ${
        evaluation.breachedOn
      }, at or below the ${formatCurrency(evaluation.mll)} limit in force that day. Check the account with the firm before trading it.`
    };
  }
  if (evaluation.dailyBreached) {
    return {
      tone: "breach",
      text: `Today's ${formatCurrency(evaluation.dailyUsed)} loss has spent the ${formatCurrency(
        evaluation.dailyLimit
      )} daily limit.`
    };
  }
  if (pressure.level === "unknown") {
    return {
      tone: "idle",
      text: evaluation.mll === null
        ? "No max loss limit entered, so there is no floor to measure against. Add one in the account settings."
        : `${formatCurrency(evaluation.room)} of room. No closed losses on this account yet, so there is no typical loss size to measure it against.`
    };
  }
  if (pressure.lossesLeft === 0) {
    return {
      tone: "breach",
      text: `${formatCurrency(evaluation.room)} of room left, and your typical losing trade on this account is ${formatCurrency(
        typicalLossSize()
      )}. One more of those breaches the limit.`
    };
  }
  if (pressure.level === "warn") {
    return {
      tone: "warn",
      text: `${formatCurrency(evaluation.room)} of room left — one more typical loss of ${formatCurrency(
        typicalLossSize()
      )}, then the next one breaches the limit.`
    };
  }
  return {
    tone: "safe",
    text: `${formatCurrency(evaluation.room)} of room — about ${pressure.lossesLeft} more typical losses of ${formatCurrency(
      typicalLossSize()
    )} before the limit.`
  };
}

function setText(node, text) {
  if (node) {
    node.textContent = text;
  }
}

/* ══ THE ACCOUNT SWITCHER + EDITOR ════════════════════════════════════════ */

function renderAccountSwitcher() {
  const accounts = getVisibleAccounts();
  const activeId = getActiveAccount()?.id || "";
  // Two selects — the desktop top bar and the mobile sidebar nav, which are
  // different DOM under different breakpoints. One handler, one render.
  ui.accountSwitches.forEach((select) => {
    const options = accounts
      .map(
        (account) =>
          `<option value="${escapeHtml(account.id)}"${account.id === activeId ? " selected" : ""}>${escapeHtml(
            account.label
          )}</option>`
      )
      .join("");
    select.innerHTML = options;
    select.value = activeId;
    // A single account is not a choice; the control stays in the DOM for
    // screen readers but stops competing for attention.
    select.closest("[data-account-switch-wrap]")?.toggleAttribute("hidden", accounts.length < 2);
  });
}

function renderAccountsPanel() {
  if (!ui.accountList) {
    return;
  }
  const activeId = getActiveAccount()?.id || "";
  ui.accountList.innerHTML = getAccounts()
    .map((account) => {
      const isActive = account.id === activeId;
      const count = countAccountTrades(account.id);
      const prop = account.prop?.enabled
        ? `<span class="account-tag">${escapeHtml(
            account.prop.mode === "static" ? "Static limit" : "Trailing limit"
          )}</span>`
        : "";
      return `
        <li class="account-row${isActive ? " is-active" : ""}${account.archived ? " is-archived" : ""}">
          <div class="account-row-main">
            <p class="account-row-name">
              ${escapeHtml(account.label)}
              ${isActive ? '<span class="account-tag is-active-tag">Active</span>' : ""}
              ${account.archived ? '<span class="account-tag">Archived</span>' : ""}
              ${prop}
            </p>
            <p class="account-row-meta">
              ${escapeHtml(accountTypeLabel(account.type))}${account.firm ? ` · ${escapeHtml(account.firm)}` : ""}
              · ${escapeHtml(formatCurrency(account.startingBalance))} start
              · ${count} trade${count === 1 ? "" : "s"}
            </p>
          </div>
          <div class="account-row-actions">
            ${
              isActive || account.archived
                ? ""
                : `<button class="btn account-row-btn" type="button" data-account-activate="${escapeHtml(account.id)}">Switch to</button>`
            }
            <button class="btn account-row-btn" type="button" data-account-edit="${escapeHtml(account.id)}">Edit</button>
            <button class="btn account-row-btn" type="button" data-account-archive="${escapeHtml(account.id)}">${
              account.archived ? "Restore" : "Archive"
            }</button>
          </div>
        </li>
      `;
    })
    .join("");
}

function openAccountDialog(id) {
  if (!ui.accountDialog) {
    return;
  }
  const account = id ? getAccountById(id) : null;
  accountDraftId = account?.id || "";
  const prop = account?.prop || defaultPropRules(account?.startingBalance || 0);

  // The preset list is built here rather than in the HTML so the "as of" date
  // travels with the options and cannot go stale in a template.
  if (ui.accountFields.preset) {
    ui.accountFields.preset.innerHTML = PROP_PRESETS.map(
      (preset) => `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.label)}</option>`
    ).join("");
    ui.accountFields.preset.value = prop.presetId || "custom";
  }
  if (ui.accountFields.type) {
    ui.accountFields.type.innerHTML = ACCOUNT_TYPES.map(
      (type) => `<option value="${escapeHtml(type.id)}">${escapeHtml(type.label)}</option>`
    ).join("");
  }

  const fields = ui.accountFields;
  if (fields.label) fields.label.value = account?.label || "";
  if (fields.firm) fields.firm.value = account?.firm || "";
  if (fields.type) fields.type.value = account?.type || "personal";
  if (fields.startingBalance) fields.startingBalance.value = account ? String(account.startingBalance) : "";
  if (fields.currency) fields.currency.value = account?.currency || "USD";
  if (fields.propEnabled) fields.propEnabled.checked = Boolean(prop.enabled);
  if (fields.profitTarget) fields.profitTarget.value = prop.profitTarget ? String(prop.profitTarget) : "";
  if (fields.drawdown) fields.drawdown.value = prop.drawdown ? String(prop.drawdown) : "";
  if (fields.mode) fields.mode.value = prop.mode;
  if (fields.basis) fields.basis.value = prop.basis;
  if (fields.trailStops) fields.trailStops.checked = Boolean(prop.trailStops);
  if (fields.trailStopAt) fields.trailStopAt.value = String(prop.trailStopAt);
  if (fields.dailyLossLimit) fields.dailyLossLimit.value = prop.dailyLossLimit ? String(prop.dailyLossLimit) : "";
  if (fields.consistencyPct) fields.consistencyPct.value = prop.consistencyPct ? String(prop.consistencyPct) : "";
  if (fields.maxContracts) fields.maxContracts.value = prop.maxContracts ? String(prop.maxContracts) : "";
  if (fields.flattenBy) fields.flattenBy.value = prop.flattenBy;
  if (fields.confirmed) fields.confirmed.checked = Boolean(prop.confirmed);

  setMessage(ui.accountFormMessage, "", "");
  syncAccountDialogState();
  ui.accountDialogTitle.textContent = account ? `Edit ${account.label}` : "Add an account";
  ui.accountDialog.showModal();
  fields.label?.focus();
}

// Prefills from the tier table, then gets out of the way. Everything it writes
// is an ordinary form value the trader can overwrite before saving.
function applyPropPreset(presetId) {
  const preset = findPropPreset(presetId);
  const fields = ui.accountFields;
  if (!preset || !preset.rules) {
    setMessage(ui.accountFormMessage, "", "");
    syncAccountDialogState();
    return;
  }
  if (preset.account) {
    if (fields.startingBalance) fields.startingBalance.value = String(preset.account.startingBalance);
    if (fields.type) fields.type.value = preset.account.type;
  }
  if (fields.firm && preset.firm) fields.firm.value = preset.firm;
  if (fields.propEnabled) fields.propEnabled.checked = true;
  if (fields.profitTarget) fields.profitTarget.value = preset.rules.profitTarget ? String(preset.rules.profitTarget) : "";
  if (fields.drawdown) fields.drawdown.value = String(preset.rules.drawdown);
  if (fields.mode) fields.mode.value = preset.rules.mode;
  if (fields.basis) fields.basis.value = preset.rules.basis;
  if (fields.trailStops) fields.trailStops.checked = Boolean(preset.rules.trailStops);
  if (fields.trailStopAt) fields.trailStopAt.value = String(preset.rules.trailStopAt);
  if (fields.dailyLossLimit) fields.dailyLossLimit.value = String(preset.rules.dailyLossLimit);
  if (fields.consistencyPct) fields.consistencyPct.value = preset.rules.consistencyPct ? String(preset.rules.consistencyPct) : "";
  if (fields.maxContracts) fields.maxContracts.value = String(preset.rules.maxContracts);
  if (fields.flattenBy) fields.flattenBy.value = preset.rules.flattenBy;
  // A preset is not a confirmation. The trader ticks that box themselves.
  if (fields.confirmed) fields.confirmed.checked = false;
  setMessage(
    ui.accountFormMessage,
    `Prefilled from published figures read on ${PROP_PRESET_AS_OF}. ${preset.note} Check every number against your own account — firms change them.`,
    // "notice" is the only neutral kind setMessage styles; "info" would add an
    // unstyled class and the copy would read as ordinary body text.
    "notice"
  );
  syncAccountDialogState();
}

function syncAccountDialogState() {
  const on = Boolean(ui.accountFields.propEnabled?.checked);
  ui.propFieldset?.toggleAttribute("hidden", !on);
  const trailing = ui.accountFields.mode?.value !== "static";
  // A static limit has no trail, so its trail controls are not merely
  // irrelevant — leaving them enabled invites a contradictory rule set.
  ui.propTrailRow?.toggleAttribute("hidden", !trailing);
  if (ui.propBasisRow) {
    ui.propBasisRow.hidden = !trailing;
  }
  if (ui.propBasisNote) {
    ui.propBasisNote.textContent =
      ui.accountFields.basis?.value === "trade"
        ? "Trails after every closed trade. This is the closest a journal of closed trades can get to an intraday rule, and it draws a tighter floor than the end-of-day option. It is still not a real intraday peak — this app never sees one."
        : "Trails your end-of-day closed balance. If your firm trails intraday highs instead, your real limit will sit higher than the one shown here.";
  }
  const zeroStart = parseNumber(ui.accountFields.startingBalance?.value) === 0;
  if (ui.propZeroStartNote) {
    ui.propZeroStartNote.hidden = !zeroStart;
  }
}

function handleAccountSubmit(event) {
  event.preventDefault();
  const fields = ui.accountFields;
  const label = String(fields.label?.value || "").trim();
  if (!label) {
    setMessage(ui.accountFormMessage, "Give the account a name you will recognise in the switcher.", "error");
    fields.label?.focus();
    return;
  }

  const startingBalance = parseNumber(fields.startingBalance?.value);
  if (!Number.isFinite(startingBalance) || startingBalance < 0) {
    setMessage(ui.accountFormMessage, "Starting balance must be zero or more.", "error");
    fields.startingBalance?.focus();
    return;
  }

  const propEnabled = Boolean(fields.propEnabled?.checked);
  const drawdown = Math.max(parseNumber(fields.drawdown?.value) || 0, 0);
  if (propEnabled && !(drawdown > 0)) {
    setMessage(
      ui.accountFormMessage,
      "A max loss limit is the one figure the tracker cannot work without. Enter the dollar drawdown from your account.",
      "error"
    );
    fields.drawdown?.focus();
    return;
  }

  const draft = makeAccount({
    id: accountDraftId,
    label,
    firm: fields.firm?.value,
    type: fields.type?.value,
    startingBalance,
    currency: fields.currency?.value,
    archived: accountDraftId ? Boolean(getAccountById(accountDraftId)?.archived) : false,
    prop: {
      enabled: propEnabled,
      presetId: fields.preset?.value || "custom",
      presetAsOf: fields.preset?.value && fields.preset.value !== "custom" ? PROP_PRESET_AS_OF : "",
      profitTarget: parseNumber(fields.profitTarget?.value) || 0,
      drawdown,
      mode: fields.mode?.value,
      basis: fields.basis?.value,
      trailStops: Boolean(fields.trailStops?.checked),
      trailStopAt: parseNumber(fields.trailStopAt?.value) || 0,
      dailyLossLimit: parseNumber(fields.dailyLossLimit?.value) || 0,
      consistencyPct: parseNumber(fields.consistencyPct?.value) || 0,
      maxContracts: parseNumber(fields.maxContracts?.value) || 0,
      flattenBy: fields.flattenBy?.value || "",
      confirmed: Boolean(fields.confirmed?.checked)
    }
  });

  if (!accountDraftId && getAccounts().length >= MAX_ACCOUNTS) {
    setMessage(ui.accountFormMessage, `${MAX_ACCOUNTS} accounts is the limit.`, "error");
    return;
  }

  saveAccount(draft);
  ui.accountDialog?.close();
  showCaptureToast(accountDraftId ? `${draft.label} updated.` : `${draft.label} added and switched to.`);
  accountDraftId = "";
}

function handleAccountsPanelClick(event) {
  const activate = event.target.closest("[data-account-activate]");
  if (activate) {
    switchAccount(activate.dataset.accountActivate);
    return;
  }
  const edit = event.target.closest("[data-account-edit]");
  if (edit) {
    openAccountDialog(edit.dataset.accountEdit);
    return;
  }
  const archive = event.target.closest("[data-account-archive]");
  if (archive) {
    const account = getAccountById(archive.dataset.accountArchive);
    if (account) {
      setAccountArchived(account.id, !account.archived);
    }
  }
}

function stepCalendarMonth(delta) {
  if (!ui.dashboardCalendarMonth) {
    return;
  }
  const current = ui.dashboardCalendarMonth.value || toDateInputValue(new Date()).slice(0, 7);
  const [yearText, monthText] = current.split("-");
  const shifted = new Date(Number(yearText), Number(monthText) - 1 + delta, 1);
  if (Number.isNaN(shifted.getTime())) {
    return;
  }
  ui.dashboardCalendarMonth.value = `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
  renderCalendarView();
}

function renderCalendarView() {
  if (!ui.calendarGrid || !ui.dashboardCalendarMonth) {
    return;
  }

  const monthValue = ui.dashboardCalendarMonth.value || toDateInputValue(new Date()).slice(0, 7);
  const [yearText, monthText] = monthValue.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;

  if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    ui.calendarGrid.innerHTML = "";
    if (ui.calendarMeta) {
      ui.calendarMeta.textContent = "Choose a valid month.";
    }
    return;
  }

  const dayStats = buildCalendarDayStats(monthValue);
  const firstDay = new Date(year, monthIndex, 1);
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const startOffset = firstDay.getDay();
  const monthTrades = getClosedTrades().filter((trade) => trade.date.startsWith(monthValue));
  const monthPnl = monthTrades.reduce((sum, trade) => sum + trade.netPnl, 0);

  if (ui.calendarHeading) {
    ui.calendarHeading.textContent = new Intl.DateTimeFormat("en-US", {
      month: "long",
      year: "numeric"
    }).format(firstDay);
  }

  if (ui.calendarMeta) {
    if (!monthTrades.length) {
      ui.calendarMeta.textContent = "No closed trades this month.";
    } else {
      const counts = new Map();
      monthTrades.forEach((trade) => counts.set(trade.asset, (counts.get(trade.asset) || 0) + 1));
      const topAsset = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0][0];
      ui.calendarMeta.innerHTML = `${dayStats.size} trading day${dayStats.size === 1 ? "" : "s"} · ${
        monthTrades.length
      } trade${monthTrades.length === 1 ? "" : "s"} · most traded <strong>${escapeHtml(topAsset)}</strong>`;
    }
  }

  if (ui.calendarNet) {
    ui.calendarNet.textContent = monthPnl === 0 ? formatCurrency(0) : formatSignedCurrency(monthPnl);
    toneBySign(ui.calendarNet, monthPnl);
  }

  const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const cells = [];
  weekdayLabels.forEach((label) => {
    cells.push(`<div class="calendar-weekday">${label}</div>`);
  });

  for (let i = 0; i < startOffset; i += 1) {
    cells.push('<div class="calendar-cell calendar-cell-empty" aria-hidden="true"></div>');
  }

  // Intensity ramp (graft): each traded day gets --day-intensity 0-1 in four
  // clamped steps, relative to the month's largest daily swing.
  let monthMaxAbsPnl = 0;
  dayStats.forEach((stats) => {
    monthMaxAbsPnl = Math.max(monthMaxAbsPnl, Math.abs(stats.pnl));
  });

  const todayIso = toDateInputValue(new Date());

  for (let day = 1; day <= daysInMonth; day += 1) {
    const isoDate = `${monthValue}-${String(day).padStart(2, "0")}`;
    const stats = dayStats.get(isoDate) || { pnl: 0, trades: 0, topAsset: "-", winRate: 0 };
    const hasTrades = stats.trades > 0;
    const pnlClass = stats.pnl > 0 ? "pnl-positive" : stats.pnl < 0 ? "pnl-negative" : "";
    const toneClass = stats.pnl > 0 ? "calendar-cell-positive" : stats.pnl < 0 ? "calendar-cell-negative" : "calendar-cell-flat";
    const intensity = hasTrades && monthMaxAbsPnl > 0
      ? Math.ceil(clamp(Math.abs(stats.pnl) / monthMaxAbsPnl, 0, 1) * 4) / 4
      : 0;
    const cellClasses = [
      "calendar-cell",
      toneClass,
      pnlClass,
      isoDate === todayIso ? "calendar-cell-today" : "",
      hasTrades ? "calendar-cell-has-trades" : ""
    ].filter(Boolean).join(" ");
    // 1e tile: day number, P&L, one meta line. The signed money value carries
    // the win/loss state in text as well as colour, so the raise/sink is never
    // the only signal (WCAG 1.4.1).
    const cellBody = `
        <span class="calendar-cell-day">${day}</span>
        <span class="calendar-cell-pnl ${pnlClass}">${hasTrades ? escapeHtml(stats.pnl === 0 ? formatCurrency(0) : formatSignedCurrency(stats.pnl)) : "—"}</span>
        <span class="calendar-cell-meta">${hasTrades ? `${stats.trades} trade${stats.trades === 1 ? "" : "s"} · ${escapeHtml(stats.topAsset)}` : "no trades"}</span>
    `;

    // Traded days are real buttons (graft): click filters the journal to that day.
    cells.push(hasTrades
      ? `<button type="button" class="${cellClasses}" data-date="${isoDate}" style="--day-intensity:${intensity};" aria-label="${stats.trades} trade${stats.trades === 1 ? "" : "s"} on ${isoDate}, ${stats.pnl >= 0 ? "up" : "down"} ${formatCurrency(Math.abs(stats.pnl))} — review in the journal">${cellBody}</button>`
      : `<div class="${cellClasses}">${cellBody}</div>`);
  }

  if (!dayStats.size) {
    // Visible only in the <=760px agenda layout, which hides untraded days.
    cells.push('<div class="calendar-agenda-note">No trading days this month.</div>');
  }

  ui.calendarGrid.innerHTML = cells.join("");
}

function handleCalendarDayClick(event) {
  const cell = event.target.closest("[data-date]");
  if (!cell || !ui.calendarGrid.contains(cell)) {
    return;
  }

  const date = cell.dataset.date;
  ui.filters.dateFrom.value = date;
  ui.filters.dateTo.value = date;
  handleFilterChange();
  // The date inputs now live under "More filters"; open it so the range the
  // click just applied is visible rather than mysteriously in force.
  document.querySelector(".rev-more")?.setAttribute("open", "");
  switchView("journal");
}

function buildCalendarDayStats(monthValue) {
  const map = new Map();

  getClosedTrades()
    .filter((trade) => trade.date.startsWith(monthValue))
    .forEach((trade) => {
      const current = map.get(trade.date) || { pnl: 0, trades: 0, wins: 0, assets: new Map() };
      current.pnl = round(current.pnl + trade.netPnl);
      current.trades += 1;
      if (trade.result === "Win") {
        current.wins += 1;
      }
      current.assets.set(trade.asset, (current.assets.get(trade.asset) || 0) + 1);
      map.set(trade.date, current);
    });

  const result = new Map();
  map.forEach((value, key) => {
    let topAsset = "-";
    let topCount = -1;
    value.assets.forEach((count, asset) => {
      if (count > topCount) {
        topCount = count;
        topAsset = asset;
      }
    });

    result.set(key, {
      pnl: value.pnl,
      trades: value.trades,
      topAsset,
      winRate: value.trades > 0 ? (value.wins / value.trades) * 100 : 0
    });
  });

  return result;
}

function toneBySign(node, value) {
  node.classList.remove("pnl-positive", "pnl-negative");
  if (value > 0) {
    node.classList.add("pnl-positive");
  } else if (value < 0) {
    node.classList.add("pnl-negative");
  }
}

function renderRiskViolations(analytics) {
  const warnings = [];

  analytics.dailyViolations.forEach((item) => {
    warnings.push(`Daily loss limit broken on ${item.key} (${formatCurrency(item.pnl)}).`);
  });

  analytics.weeklyViolations.forEach((item) => {
    warnings.push(`Weekly loss limit broken on ${item.key} (${formatCurrency(item.pnl)}).`);
  });

  analytics.riskPerTradeViolations.forEach((item) => {
    warnings.push(`Risk per trade exceeded: ${item.key} at ${item.riskPercent.toFixed(2)}%.`);
  });

  if (!warnings.length) {
    ui.riskViolations.innerHTML = '<li class="ok">No rule violations detected.</li>';
    return;
  }

  ui.riskViolations.innerHTML = warnings.map((text) => `<li>${escapeHtml(text)}</li>`).join("");
}

function renderEdgeTable(analytics) {
  const rows = analytics.setupStats
    .map((setup) => {
      const winRate = setup.trades > 0 ? (setup.wins / setup.trades) * 100 : 0;
      const avgR = setup.rCount > 0 ? setup.rTotal / setup.rCount : 0;
      const expectancy = setup.trades > 0 ? setup.netPnl / setup.trades : 0;
      return {
        ...setup,
        winRate,
        avgR,
        expectancy
      };
    })
    .sort((a, b) => b.expectancy - a.expectancy);

  if (!rows.length) {
    ui.edgeRows.innerHTML = '<tr class="empty-row"><td colspan="6">No setup data yet.</td></tr>';
    return;
  }

  ui.edgeRows.innerHTML = rows
    .map((row) => {
      const netClass = row.netPnl >= 0 ? "pnl-positive" : "pnl-negative";
      const expClass = row.expectancy >= 0 ? "pnl-positive" : "pnl-negative";
      // 1f #04: the setup name is the link into its playbook page — this table
      // computes every number on that page and previously had nowhere to send
      // you with them.
      return `
        <tr>
          <td data-label="Setup"><button class="pb-link" type="button" data-playbook-setup="${escapeHtml(row.setup)}">${escapeHtml(row.setup)}</button></td>
          <td data-label="Trades" class="num">${row.trades}</td>
          <td data-label="Win Rate" class="num">${row.winRate.toFixed(1)}%</td>
          <td data-label="Net P&L" class="num ${netClass}">${formatCurrency(row.netPnl)}</td>
          <td data-label="Avg R" class="num">${row.avgR.toFixed(2)}R</td>
          <td data-label="Expectancy" class="num ${expClass}">${formatCurrency(row.expectancy)}</td>
        </tr>
      `;
    })
    .join("");
}

function handleJournalSort(key) {
  if (!key) {
    return;
  }

  if (state.journalSort.key === key) {
    state.journalSort.dir = -state.journalSort.dir;
  } else {
    state.journalSort = { key, dir: 1 };
  }
  renderJournalTable();
}

function compareTradeField(a, b, key) {
  const rawA = a[key];
  const rawB = b[key];
  const numA = Number(rawA);
  const numB = Number(rawB);
  if (rawA !== "" && rawB !== "" && Number.isFinite(numA) && Number.isFinite(numB)) {
    return numA - numB;
  }
  return String(rawA ?? "").localeCompare(String(rawB ?? ""));
}

function syncJournalSortIndicators() {
  ui.journalSortHeaders.forEach((th) => {
    const isActive = th.dataset.sort === state.journalSort.key;
    if (isActive) {
      th.setAttribute("aria-sort", state.journalSort.dir > 0 ? "ascending" : "descending");
    } else {
      th.removeAttribute("aria-sort");
    }
  });
}

/* ══ 1e TRADE REVIEW ═══════════════════════════════════════════════════════
   design-source/1e-review-calendar.html. Seven columns and a chevron instead
   of thirteen: Date, Symbol, Setup ("Liquidity Grab · H1 · London"), Net, R,
   Pips, Mood. Market, direction, result, execution, prices, checklist, tags,
   notes and the row actions all move into the detail the chevron opens.
   ═══════════════════════════════════════════════════════════════════════════ */

function formatIsoShort(iso) {
  const date = new Date(`${String(iso || "")}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? String(iso || "—")
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit" }).format(date);
}

// What the header line after "filtered to" says. Every clause is read off a
// filter that is actually applied — never a fixed "last 30 days".
function describeJournalFilters() {
  const parts = [];
  const { quick, dateFrom, dateTo, market, setup, session, timeframe, psychology, search } = state.filters;

  if (QUICK_FILTER_LABELS[quick]) {
    parts.push(QUICK_FILTER_LABELS[quick]);
  }
  if (dateFrom && dateTo) {
    parts.push(dateFrom === dateTo ? formatIsoShort(dateFrom) : `${formatIsoShort(dateFrom)} – ${formatIsoShort(dateTo)}`);
  } else if (dateFrom) {
    parts.push(`from ${formatIsoShort(dateFrom)}`);
  } else if (dateTo) {
    parts.push(`up to ${formatIsoShort(dateTo)}`);
  }
  [market, setup, session, timeframe, psychology].forEach((value) => {
    if (value && value !== "all") {
      parts.push(value);
    }
  });
  if (search) {
    parts.push(`“${search}”`);
  }

  return parts;
}

function renderReviewHeader(shownCount) {
  const noNote = state.trades.filter((trade) => trade.status !== "open" && !isTradeJournalled(trade)).length;
  if (ui.reviewNoNoteCount) {
    ui.reviewNoNoteCount.textContent = String(noNote);
  }

  ui.reviewChips.forEach((chip) => {
    const active = (chip.dataset.quick || "all") === state.filters.quick;
    chip.classList.toggle("is-active", active);
    chip.setAttribute("aria-pressed", active ? "true" : "false");
  });

  if (!ui.reviewCount) {
    return;
  }

  const total = state.trades.length;
  if (!total) {
    ui.reviewCount.textContent = "No trades logged yet.";
    return;
  }

  const parts = describeJournalFilters();
  const noun = `trade${total === 1 ? "" : "s"}`;
  ui.reviewCount.innerHTML = parts.length
    ? `${shownCount} of ${total} ${noun} · filtered to <strong>${escapeHtml(parts.join(" · "))}</strong>`
    : `${total} ${noun} · <strong>all time</strong>`;
}

/* id -> seconds, read ONCE per table render. Calling voiceClipFor() per row
   would JSON.parse the whole clip store — up to a megabyte of base64 — for
   every visible trade, and the store is read on every filter keystroke. */
function voiceDurationIndex() {
  const map = voiceStoreRead();
  const index = new Map();
  Object.keys(map).forEach((id) => {
    const data = map[id]?.data;
    if (typeof data === "string" && data.startsWith("data:audio/")) {
      index.set(id, Number(map[id].seconds) || 0);
    }
  });
  return index;
}

function buildTradeDetailRow(trade, isOpen, voiceIndex = new Map()) {
  const id = escapeHtml(String(trade.id || ""));
  const resultClass = isOpen
    ? "pill"
    : trade.result === "Win"
      ? "pill pill-win"
      : trade.result === "Loss"
        ? "pill pill-loss"
        : "pill pill-be";

  const facts = [
    ["Result", `<span class="${resultClass}">${escapeHtml(isOpen ? "Open" : trade.result)}</span>`],
    ["Market", escapeHtml(trade.market)],
    ["Direction", escapeHtml(trade.direction)],
    ["Timeframe", escapeHtml(trade.timeframe)],
    ["Session", escapeHtml(trade.session)],
    ["Execution", escapeHtml(trade.executionQuality)],
    ["Entry", trade.entryPrice > 0 ? escapeHtml(formatProgressTradePrice(trade.entryPrice)) : "—"],
    [isOpen ? "Stop" : "Exit", (isOpen ? trade.stopLoss : trade.exitPrice) > 0
      ? escapeHtml(formatProgressTradePrice(isOpen ? trade.stopLoss : trade.exitPrice))
      : "—"],
    ["Risk", `${Number(trade.riskPercent || 0).toFixed(2)}%${isRuleBroken(trade) ? ' <span class="rev-flag">over cap</span>' : ""}`]
  ];

  const asked = trade.preTradeRulesAsked || [];
  const ticked = trade.preTradeRules || [];
  const checklist = ticked.map(preTradeRuleLabel);
  // Only a trade that was actually SHOWN the checklist can have skipped it.
  const skipped = asked.filter((id) => !ticked.includes(id)).map(preTradeRuleLabel);

  const extras = [];
  if (checklist.length) {
    extras.push(`<p class="rev-detail-note"><span class="rev-detail-key">Checked before entry</span>${escapeHtml(checklist.join(" · "))}</p>`);
  }
  if (skipped.length) {
    extras.push(`<p class="rev-detail-note is-warn"><span class="rev-detail-key">Skipped</span>${escapeHtml(skipped.join(" · "))}</p>`);
  }
  if (trade.cooldownOverride) {
    extras.push(
      `<p class="rev-detail-note is-warn"><span class="rev-detail-key">Cooldown override</span>${escapeHtml(
        trade.cooldownNote || "Taken through a cooldown prompt."
      )}</p>`
    );
  }
  if ((trade.mistakeTags || []).length) {
    extras.push(`<p class="rev-detail-note"><span class="rev-detail-key">What went wrong</span>${escapeHtml(trade.mistakeTags.join(" · "))}</p>`);
  }
  if (trade.notes) {
    extras.push(`<p class="rev-detail-note"><span class="rev-detail-key">Note</span>${escapeHtml(trade.notes)}</p>`);
  }
  /* 1f #06: a button, not an <audio src>. Every detail row is in the DOM
     whether expanded or not, so inlining the data URL would put every clip in
     the journal on the page at once. The element is built on the click. */
  if (voiceIndex.has(String(trade.id))) {
    extras.push(
      `<p class="rev-detail-note"><span class="rev-detail-key">Voice note</span>` +
        `<button class="mini-btn" data-action="voice" data-id="${id}" type="button">Play ${escapeHtml(
          formatVoiceDuration(voiceIndex.get(String(trade.id)))
        )}</button>` +
        `<span class="rev-voice-hint">audio only — not searchable, this device only</span></p>`
    );
  }

  return `
    <tr class="trade-detail-row" id="trade-detail-${id}" data-detail-for="${id}"${expandedTradeIds.has(String(trade.id)) ? "" : " hidden"}>
      <td colspan="8">
        <div class="rev-detail">
          <dl class="rev-detail-facts">
            ${facts.map(([key, value]) => `<div><dt>${key}</dt><dd>${value}</dd></div>`).join("")}
          </dl>
          ${extras.join("")}
          <div class="rev-detail-actions">
            ${isOpen
              ? `<button class="mini-btn mini-btn-close" data-action="close" data-id="${id}" type="button">Close at market</button>`
              : `<button class="mini-btn" data-action="journal" data-id="${id}" type="button">Journal</button>`}
            <button class="mini-btn" data-action="edit" data-id="${id}" type="button">Edit</button>
            <button class="mini-btn danger" data-action="delete" data-id="${id}" type="button">Delete</button>
          </div>
        </div>
      </td>
    </tr>
  `;
}

function renderJournalTable() {
  // The table re-renders wholesale, so any open swipe reveal is about to be
  // detached along with its row. Drop the reference rather than leak it.
  swipedRow = null;
  swipeTrack.row = null;
  syncJournalSortIndicators();
  const filtered = getFilteredTrades();
  renderReviewHeader(filtered.length);

  if (!filtered.length) {
    ui.tradesBody.innerHTML = `<tr class="empty-row"><td colspan="8">${
      state.trades.length ? "No trades match current filters." : "No trades logged yet."
    }</td></tr>`;
    return;
  }

  // Header sort applies to the filtered array; the default order stays the
  // existing newest-first sequence.
  const { key: sortKey, dir: sortDir } = state.journalSort;
  const sorted = sortKey
    ? [...filtered].sort((a, b) => compareTradeField(a, b, sortKey) * sortDir || sortTradesDesc(a, b))
    : filtered.sort(sortTradesDesc);

  // Drop expansions for rows that are no longer on screen, so the set cannot
  // grow without bound across a session of filtering.
  const visibleIds = new Set(sorted.map((trade) => String(trade.id)));
  expandedTradeIds.forEach((id) => {
    if (!visibleIds.has(id)) {
      expandedTradeIds.delete(id);
    }
  });

  // Depth scales with size, relative to the biggest result on screen — the
  // same four-step ramp the calendar tiles use, so a big loss is visibly
  // deeper than a scratch. Purely decorative: colour and sign carry the state.
  const peakAbsPnl = sorted.reduce((peak, trade) => Math.max(peak, Math.abs(trade.netPnl || 0)), 0);
  const voiceIndex = voiceDurationIndex();

  ui.tradesBody.innerHTML = sorted
    .map((trade) => {
      const id = escapeHtml(String(trade.id || ""));
      const isOpen = trade.status === "open";
      const livePercent = getOpenTradePnlPercent(trade);
      const pnlClass = isOpen
        ? getLiveToneClass(livePercent)
        : trade.netPnl > 0
          ? "pnl-positive"
          : trade.netPnl < 0
            ? "pnl-negative"
            : "";
      const pipClass = isOpen ? "" : trade.pips > 0 ? "pnl-positive" : trade.pips < 0 ? "pnl-negative" : "";
      // Clay V2 §5c: depth as data — a winning row is raised, a losing row is
      // pressed. Open rows stay flat (the outcome is not known yet). The money
      // colour, the signed +/- glyph on Net and R, and the Result pill in the
      // row detail all carry the state too, so the depth flip is never the
      // sole signal (WCAG 1.4.1).
      const rowClasses = [
        isOpen ? "trade-row-open" : trade.netPnl > 0 ? "trade-row-win" : trade.netPnl < 0 ? "trade-row-loss" : "",
        expandedTradeIds.has(String(trade.id)) ? "is-expanded" : ""
      ].filter(Boolean).join(" ");

      // "Liquidity Grab · H1 · London" — the mockup's one-line context.
      const setupLine = [trade.setupType, trade.timeframe, trade.session].filter(Boolean).join(" · ");
      const moodTone = MOOD_TONES[trade.psychology] || "";
      const intensity = !isOpen && peakAbsPnl > 0
        ? Math.ceil(clamp(Math.abs(trade.netPnl) / peakAbsPnl, 0, 1) * 4) / 4
        : 0;

      return `
        <tr${rowClasses ? ` class="${rowClasses}"` : ""} data-trade-id="${id}" style="--row-intensity:${intensity};">
          <td data-label="Date" class="rev-date">${escapeHtml(formatIsoShort(trade.date))}</td>
          <td data-label="Symbol" class="rev-symbol">${escapeHtml(trade.asset)}</td>
          <td data-label="Setup" class="rev-setup">${escapeHtml(setupLine)}</td>
          <td data-label="Net" class="num rev-net ${pnlClass}${isOpen ? " live-cell" : ""}"${isOpen ? ` ${liveCellAttrs(trade, "livePercent")}` : ""}>${isOpen ? escapeHtml(formatLivePercentLabel(livePercent, "OPEN")) : escapeHtml(trade.netPnl === 0 ? formatCurrency(0) : formatSignedCurrency(trade.netPnl))}</td>
          <td data-label="R" class="num">${isOpen ? "—" : escapeHtml(formatSignedR(trade.rMultiple))}</td>
          <td data-label="Pips" class="num ${pipClass}">${isOpen ? "—" : Number.isFinite(trade.pips) ? trade.pips.toFixed(2) : "0.00"}</td>
          <td data-label="Mood"><span class="rev-mood ${moodTone}">${escapeHtml(trade.psychology)}</span></td>
          <td class="rev-chev-cell">
            <button
              class="rev-chev"
              type="button"
              data-action="expand"
              data-id="${id}"
              aria-expanded="${expandedTradeIds.has(String(trade.id)) ? "true" : "false"}"
              aria-controls="trade-detail-${id}"
            >
              <span class="rev-chev-glyph" aria-hidden="true">›</span>
              <span class="visually-hidden">Details for ${escapeHtml(trade.asset)} on ${escapeHtml(formatIsoShort(trade.date))}</span>
            </button>
          </td>
        </tr>
        ${buildTradeDetailRow(trade, isOpen, voiceIndex)}
      `;
    })
    .join("");
}

function formatSignedR(value) {
  if (!Number.isFinite(value)) {
    return "0.00R";
  }
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(2)}R`;
}

/* The chip-styled dropdowns show their own name when unset ("Setup", not
   "All"), so the placeholder label is a parameter. Values are derived from the
   journal, never a hard-coded list — a setup the trader invented yesterday is
   filterable today. */
function hydrateFilterSelect(select, values, placeholder) {
  if (!select) {
    return;
  }

  const options = Array.from(new Set(values.filter(Boolean))).sort();
  const currentValue = select.value;

  select.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = placeholder;
  select.appendChild(allOption);

  options.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });

  select.value = options.includes(currentValue) ? currentValue : "all";
}

function hydrateSetupFilter() {
  hydrateFilterSelect(ui.filters.setup, state.trades.map((trade) => trade.setupType), "Setup");
  hydrateFilterSelect(ui.filters.session, state.trades.map((trade) => trade.session), "Session");
}

function getFilteredTrades() {
  return state.trades.filter((trade) => {
    if (state.filters.dateFrom && trade.date < state.filters.dateFrom) {
      return false;
    }

    if (state.filters.dateTo && trade.date > state.filters.dateTo) {
      return false;
    }

    if (state.filters.market !== "all" && trade.market !== state.filters.market) {
      return false;
    }

    if (state.filters.setup !== "all" && trade.setupType !== state.filters.setup) {
      return false;
    }

    if (state.filters.session !== "all" && trade.session !== state.filters.session) {
      return false;
    }

    if (state.filters.timeframe !== "all" && trade.timeframe !== state.filters.timeframe) {
      return false;
    }

    if (state.filters.psychology !== "all" && trade.psychology !== state.filters.psychology) {
      return false;
    }

    // 1e chips.
    const quick = state.filters.quick;
    if (quick === "wins" && trade.result !== "Win") {
      return false;
    }
    if (quick === "losses" && trade.result !== "Loss") {
      return false;
    }
    if (quick === "rules" && !isRuleBroken(trade)) {
      return false;
    }
    if (quick === "nonote" && (trade.status === "open" || isTradeJournalled(trade))) {
      return false;
    }

    if (state.filters.search) {
      const haystack = `${trade.asset} ${trade.setupType} ${trade.notes}`.toLowerCase();
      if (!haystack.includes(state.filters.search)) {
        return false;
      }
    }

    return true;
  });
}

/* ══ 1f #07 — the Sunday digest ════════════════════════════════════════════
   design-source/1f-features.html: "A drafted weekly review — your numbers,
   your worst rule break, your best trade — which you edit rather than write.
   Feeds the Monthly Review that currently starts as a blank textarea."

   THE HONESTY RULE FOR THIS WHOLE BLOCK: there is no language model here and
   none may be added. Every sentence below is a fixed template wrapped around
   a figure computed from this account's closed trades. A clause whose data is
   missing is DROPPED — never softened, never guessed, never padded with
   "roughly" or "it seems". If the week is thin, the draft is short, and the
   trader writes the rest. That is the honest failure mode.

   It is not a Sunday-only screen either: pick any day and the Monday–Sunday
   week around it is what gets drafted. The draft fills the reflection form,
   so the trader edits prose rather than starting from a blank box, and the
   form's own save path files it — with a weekOf stamp — as that week's
   reflection. buildMonthlySeed() then stitches a month's worth into the
   Monthly Review textarea that used to open empty. */

// Nothing here is a module-level binding: every one is a hoisted function
// declaration, so the file's init()-at-top-level trap does not apply.
function plural(count) {
  return count === 1 ? "" : "s";
}

function digestMoney(value) {
  return formatSignedCurrency(round(Number(value) || 0));
}

// Monday..Sunday around any date, keyed with the SAME ISO week key the weekly
// loss limit already uses (src/lib/core.js getWeekKey) so a breach the risk
// engine reports and a week the digest drafts are the same seven days.
function weekBoundsFor(dateString) {
  const date = new Date(`${String(dateString || "")}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const offset = (date.getUTCDay() + 6) % 7; // Monday = 0
  const from = new Date(date.getTime() - offset * 86400000).toISOString().slice(0, 10);
  const to = new Date(date.getTime() + (6 - offset) * 86400000).toISOString().slice(0, 10);
  return {
    from,
    to,
    key: getWeekKey(from),
    label: `Week of ${formatIsoShort(from)} – ${formatIsoShort(to)}`
  };
}

// Account-scoped for free: state.trades holds only the active account.
function digestWeekTrades(from, to) {
  return getClosedTrades().filter((trade) => trade.date >= from && trade.date <= to);
}

/* The rule this week skipped most often, among the trades that were actually
   SHOWN a checklist. Everything logged before the checklist existed, every
   import and every command-bar capture has no answer to compare, so it is out
   of both sides — the same population rule computeRuleCosts() uses. */
function worstWeekRule(trades) {
  const asked = trades.filter((trade) => (trade.preTradeRulesAsked || []).length > 0);
  if (!asked.length) {
    return null;
  }

  return (
    getPreTradeRules()
      .map((rule) => {
        const seen = asked.filter((trade) => trade.preTradeRulesAsked.includes(rule.id));
        const skipped = seen.filter((trade) => !(trade.preTradeRules || []).includes(rule.id));
        return {
          label: rule.label,
          asked: seen.length,
          skipped: skipped.length,
          pnl: round(skipped.reduce((total, trade) => total + (Number(trade.netPnl) || 0), 0))
        };
      })
      .filter((entry) => entry.skipped > 0)
      // Most often skipped first; ties go to the one that cost more.
      .sort((a, b) => b.skipped - a.skipped || a.pnl - b.pnl)[0] || null
  );
}

/* "Dominant" means at least two losses carrying the same tag AND strictly more
   of them than any other tag. One loss tagged Emotional is an anecdote and a
   two-way tie is not a pattern — both return null and the clause disappears. */
function dominantLosingMood(trades) {
  const losers = trades.filter((trade) => trade.result === "Loss");
  const counts = new Map();
  losers.forEach((trade) => {
    const label = String(trade.psychology || "").trim();
    if (label) {
      counts.set(label, (counts.get(label) || 0) + 1);
    }
  });

  const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0][1] < 2 || (ranked[1] && ranked[1][1] === ranked[0][1])) {
    return null;
  }

  return { label: ranked[0][0], count: ranked[0][1], of: losers.length };
}

// The setup that cost the most this week, over at least two trades so one bad
// morning does not get named as a pattern.
function worstWeekSetup(trades) {
  const bySetup = new Map();
  trades.forEach((trade) => {
    const label = String(trade.setupType || "").trim();
    if (!label) {
      return;
    }
    const bucket = bySetup.get(label) || { label, count: 0, pnl: 0 };
    bucket.count += 1;
    bucket.pnl = round(bucket.pnl + (Number(trade.netPnl) || 0));
    bySetup.set(label, bucket);
  });

  return (
    Array.from(bySetup.values())
      .filter((entry) => entry.count >= 2 && entry.pnl < 0)
      .sort((a, b) => a.pnl - b.pnl)[0] || null
  );
}

/* The limits the app already enforces, re-read for this week alone. Each line
   states the figure AND the limit it passed, so the sentence survives being
   copied out of the app. `hard` is a breached loss limit; `soft` is an
   oversized trade or a cooldown taken through — the two feed the "did I follow
   my rules" answer differently. */
function weekBreaches(trades, net) {
  const { dailyMaxLoss, weeklyMaxLoss, riskPerTrade } = state.settings;
  const lines = [];

  const byDay = new Map();
  trades.forEach((trade) => {
    byDay.set(trade.date, round((byDay.get(trade.date) || 0) + (Number(trade.netPnl) || 0)));
  });
  const overDays = Array.from(byDay.entries())
    .filter(([, pnl]) => pnl < -dailyMaxLoss)
    .sort((a, b) => a[0].localeCompare(b[0]));
  if (overDays.length) {
    lines.push(
      `The ${formatCurrency(dailyMaxLoss)} daily loss limit went on ${overDays.length} day${plural(
        overDays.length
      )}: ${overDays.map(([day, pnl]) => `${formatIsoShort(day)} ${digestMoney(pnl)}`).join(", ")}.`
    );
  }

  const weeklyBreached = net < -weeklyMaxLoss;
  if (weeklyBreached) {
    lines.push(
      `The week closed at ${digestMoney(net)}, past your ${formatCurrency(weeklyMaxLoss)} weekly loss limit.`
    );
  }

  const oversized = trades.filter((trade) => Number(trade.riskPercent) > riskPerTrade);
  if (oversized.length) {
    const worst = Math.max(...oversized.map((trade) => Number(trade.riskPercent)));
    lines.push(
      `${oversized.length} trade${plural(oversized.length)} risked more than your ${riskPerTrade}% per-trade cap, up to ${worst.toFixed(
        2
      )}%.`
    );
  }

  const cooled = trades.filter((trade) => trade.cooldownOverride);
  if (cooled.length) {
    lines.push(
      `${cooled.length} trade${plural(cooled.length)} taken through a cooldown prompt: ${digestMoney(
        cooled.reduce((total, trade) => total + (Number(trade.netPnl) || 0), 0)
      )}.`
    );
  }

  return {
    lines,
    hard: overDays.length > 0 || weeklyBreached,
    soft: oversized.length > 0 || cooled.length > 0
  };
}

// The draft itself. Returns the three prose blocks the reflection form wants,
// plus the rules answer and the figures the summary line quotes.
function buildWeeklyDigest(dateString) {
  const week = weekBoundsFor(dateString);
  if (!week) {
    return null;
  }

  const trades = digestWeekTrades(week.from, week.to);
  const count = trades.length;
  const net = round(trades.reduce((total, trade) => total + (Number(trade.netPnl) || 0), 0));
  if (!count) {
    return { ...week, count: 0, net: 0, wentWell: "", mistake: "", improveTomorrow: "", followRules: "Yes" };
  }

  const wins = trades.filter((trade) => trade.result === "Win").length;
  const losses = trades.filter((trade) => trade.result === "Loss").length;
  const scratches = count - wins - losses;
  const days = new Set(trades.map((trade) => trade.date)).size;
  const journalled = trades.filter(isTradeJournalled).length;
  const ranked = [...trades].sort((a, b) => (Number(b.netPnl) || 0) - (Number(a.netPnl) || 0));
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  const setupOf = (trade) => String(trade.setupType || "").trim() || "an untagged setup";

  // --- the numbers, and what went right --------------------------------
  const well = [
    `${week.label}: ${count} closed trade${plural(count)}, ${digestMoney(net)} net across ${days} trading day${plural(
      days
    )}.`,
    `${wins} win${plural(wins)}, ${losses} loss${losses === 1 ? "" : "es"}${
      scratches ? `, ${scratches} scratch${scratches === 1 ? "" : "es"}` : ""
    } — a ${((wins / count) * 100).toFixed(1)}% win rate.`,
    `Expectancy ran ${digestMoney(net / count)} per trade.`
  ];
  if (best && Number(best.netPnl) > 0) {
    well.push(
      `Best trade: ${best.asset} ${digestMoney(best.netPnl)} on ${setupOf(best)}, ${formatIsoShort(best.date)}.`
    );
  }
  const previous = digestWeekTrades(shiftDateString(week.from, -7), shiftDateString(week.from, -1));
  if (previous.length) {
    const previousNet = round(previous.reduce((total, trade) => total + (Number(trade.netPnl) || 0), 0));
    const delta = round(net - previousNet);
    well.push(
      `The week before was ${previous.length} trade${plural(previous.length)} for ${digestMoney(
        previousNet
      )} — ${delta >= 0 ? "up" : "down"} ${formatCurrency(Math.abs(delta))} on that.`
    );
  }
  well.push(
    journalled === count
      ? count === 1
        ? "It carries a journal note."
        : `All ${count} carry a journal note.`
      : `${journalled} of the ${count} carry a journal note.`
  );

  // --- what it cost -----------------------------------------------------
  const rule = worstWeekRule(trades);
  const mood = dominantLosingMood(trades);
  const breaches = weekBreaches(trades, net);
  const bad = [];
  if (worst && Number(worst.netPnl) < 0) {
    bad.push(
      `Worst trade: ${worst.asset} ${digestMoney(worst.netPnl)} on ${setupOf(worst)}, ${formatIsoShort(worst.date)}.`
    );
  }
  if (rule) {
    bad.push(
      `You skipped “${rule.label}” on ${rule.skipped} of the ${rule.asked} trade${plural(
        rule.asked
      )} that asked; those ${rule.skipped} are ${digestMoney(rule.pnl)}.`
    );
  }
  if (mood) {
    bad.push(
      mood.count === mood.of
        ? `Every one of your ${mood.of} losing trades was tagged “${mood.label}”.`
        : `${mood.count} of your ${mood.of} losing trades were tagged “${mood.label}”.`
    );
  }
  bad.push(...breaches.lines);
  if (!bad.length) {
    // Only reachable when nothing closed red, no shown rule was skipped and no
    // limit moved — so this is a statement of fact, not a consolation.
    bad.push("No trade closed red, no rule you were shown was skipped, and no limit moved.");
  }

  // --- the one lever, or nothing ---------------------------------------
  // Exactly one, chosen by what the data actually supports. When none of the
  // four apply the box is left EMPTY on purpose: the app has no computed
  // improvement to offer and will not invent one.
  const lever = [];
  const unjournalled = count - journalled;
  const worstSetup = worstWeekSetup(trades);
  if (rule && rule.pnl < 0) {
    lever.push(
      `Tick “${rule.label}” before every entry — the ${rule.skipped} trade${plural(
        rule.skipped
      )} that skipped it this week are ${digestMoney(rule.pnl)}.`
    );
  } else if (unjournalled > 0) {
    lever.push(
      `Journal the ${unjournalled} trade${plural(unjournalled)} from this week that still ${
        unjournalled === 1 ? "has" : "have"
      } no note.`
    );
  } else if (mood) {
    lever.push(
      `Watch the “${mood.label}” entries — they are ${mood.count} of your ${mood.of} losses this week.`
    );
  } else if (worstSetup) {
    lever.push(
      `“${worstSetup.label}” cost ${formatCurrency(Math.abs(worstSetup.pnl))} across ${
        worstSetup.count
      } trades this week.`
    );
  }

  return {
    ...week,
    count,
    net,
    wentWell: well.join(" "),
    mistake: bad.join(" "),
    improveTomorrow: lever.join(" "),
    // A breached loss limit is a No. A skipped rule, an oversized trade or a
    // cooldown taken through is a Partially. The trader can overrule all of it
    // in the select — it is their answer, this is only the starting position.
    followRules: breaches.hard ? "No" : breaches.soft || rule ? "Partially" : "Yes"
  };
}

function setDigestSummary(text, tone = "") {
  if (!ui.digestSummary) {
    return;
  }
  ui.digestSummary.textContent = text;
  ui.digestSummary.className = `digest-summary${tone ? ` ${tone}` : ""}`;
}

// The passive line: which week the picker is on and what is in it. Re-run from
// renderAll, so logging a trade updates the count without touching the picker.
function renderDigestSummary() {
  const week = weekBoundsFor(ui.digestDate?.value || "");
  if (!week) {
    setDigestSummary("Pick any day and the Monday-to-Sunday week around it gets drafted.", "is-empty");
    return;
  }

  const trades = digestWeekTrades(week.from, week.to);
  if (!trades.length) {
    setDigestSummary(`${week.label} · no closed trades in this account`, "is-empty");
    return;
  }

  const net = round(trades.reduce((total, trade) => total + (Number(trade.netPnl) || 0), 0));
  setDigestSummary(`${week.label} · ${trades.length} closed trade${plural(trades.length)} · ${digestMoney(net)} net`);
}

function stepDigestWeek(days) {
  if (!ui.digestDate) {
    return;
  }
  ui.digestDate.value = shiftDateString(ui.digestDate.value || toDateInputValue(new Date()), days);
  renderDigestSummary();
}

// Draft → fill the reflection form → the trader edits → the form's own submit
// saves it. Deliberately no second save path.
function applyWeeklyDigest() {
  const digest = buildWeeklyDigest(ui.digestDate?.value || toDateInputValue(new Date()));
  if (!digest) {
    setDigestSummary("Pick any day and the Monday-to-Sunday week around it gets drafted.", "is-empty");
    return;
  }

  if (!digest.count) {
    setDigestSummary(`${digest.label}: no closed trades, so there is nothing to draft.`, "is-empty");
    return;
  }

  const reflectionDate = document.getElementById("reflectionDate");
  const today = toDateInputValue(new Date());
  // The week's Sunday, unless that has not happened yet — a reflection dated
  // in the future is a lie about when it was written.
  reflectionDate.value = digest.to > today ? today : digest.to;
  document.getElementById("wentWell").value = digest.wentWell;
  document.getElementById("mistake").value = digest.mistake;
  document.getElementById("improveTomorrow").value = digest.improveTomorrow;
  document.getElementById("followRules").value = digest.followRules;
  ui.reflectionForm.dataset.weekOf = digest.key;

  const replacing = state.reflections.some((entry) => entry.weekOf === digest.key);
  setDigestSummary(
    `${digest.label} drafted — ${digest.count} trade${plural(digest.count)}, ${digestMoney(digest.net)}. ` +
      "Edit it below, then save." +
      (digest.improveTomorrow ? "" : " Nothing computed for “what will I improve” — that one is yours.") +
      (replacing ? " Saving replaces the digest already filed for this week." : "")
  );
  document.getElementById("wentWell").focus();
}

/* The Monthly Review textarea used to open blank. It now opens on the month's
   weekly digests: your saved edit where you saved one, a fresh draft where you
   did not. Only weeks with a closed trade in the month appear — an empty week
   contributes nothing rather than a paragraph saying so. */
function buildMonthlySeed(month) {
  const weeks = new Map();
  getClosedTrades()
    .filter((trade) => String(trade.date || "").startsWith(month))
    .forEach((trade) => {
      const week = weekBoundsFor(trade.date);
      if (week) {
        weeks.set(week.key, week);
      }
    });

  return Array.from(weeks.values())
    .sort((a, b) => a.from.localeCompare(b.from))
    .map((week) => {
      const saved = state.reflections.find((entry) => entry.weekOf === week.key);
      const source = saved || buildWeeklyDigest(week.from);
      const body = [source?.wentWell, source?.mistake, source?.improveTomorrow]
        .map((text) => String(text || "").trim())
        .filter(Boolean);
      // A fresh draft opens with the week label already, so heading it again
      // would stutter. A saved digest may have been edited past recognition,
      // so that one keeps its label.
      const head = saved ? `${week.label} (your saved digest)` : "";
      return body.length ? [head, ...body].filter(Boolean).join("\n") : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function renderReflections() {
  renderDigestSummary();

  if (!state.reflections.length) {
    ui.reflectionsList.innerHTML = '<li class="muted">No reflections yet.</li>';
    return;
  }

  const recent = [...state.reflections].sort((a, b) => {
    const byDate = b.date.localeCompare(a.date);
    if (byDate !== 0) {
      return byDate;
    }

    return (b.createdAt || "").localeCompare(a.createdAt || "");
  });

  ui.reflectionsList.innerHTML = recent
    .slice(0, 40)
    .map((entry) => {
      const tagText = entry.tags?.length ? entry.tags.join(", ") : "no tags";
      return `
        <li>
          <h4>${escapeHtml(entry.date)} | Followed Rules: ${escapeHtml(entry.followRules)}${
            entry.weekOf ? ` | Weekly digest ${escapeHtml(entry.weekOf)}` : ""
          }</h4>
          <p><strong>Went Well:</strong> ${escapeHtml(entry.wentWell)}</p>
          <p><strong>Mistake:</strong> ${escapeHtml(entry.mistake)}</p>
          <p><strong>Improve:</strong> ${escapeHtml(entry.improveTomorrow)}</p>
          <p><strong>Tags:</strong> ${escapeHtml(tagText)}</p>
        </li>
      `;
    })
    .join("");
}

function renderMonthlyReview() {
  const month = ui.reviewMonth.value;
  if (!month) {
    return;
  }

  const monthTrades = getClosedTrades().filter((trade) => trade.date.startsWith(month));
  const total = monthTrades.length;
  const net = monthTrades.reduce((sum, trade) => sum + trade.netPnl, 0);
  const wins = monthTrades.filter((trade) => trade.result === "Win").length;
  const winRate = total > 0 ? (wins / total) * 100 : 0;

  const setupMap = new Map();
  monthTrades.forEach((trade) => {
    setupMap.set(trade.setupType, (setupMap.get(trade.setupType) || 0) + trade.netPnl);
  });

  let bestSetup = "-";
  let bestSetupValue = Number.NEGATIVE_INFINITY;
  setupMap.forEach((value, key) => {
    if (value > bestSetupValue) {
      bestSetupValue = value;
      bestSetup = key;
    }
  });

  ui.monthlyNet.textContent = formatCurrency(net);
  ui.monthlyNet.classList.toggle("pnl-positive", net >= 0);
  ui.monthlyNet.classList.toggle("pnl-negative", net < 0);
  ui.monthlyWinRate.textContent = `${winRate.toFixed(1)}%`;
  ui.monthlyTrades.textContent = String(total);
  ui.monthlyBestSetup.textContent = bestSetup;

  // This runs on every renderAll, so it must never overwrite what is being
  // typed. (It always could — the guard is a fix, not a new restriction.)
  if (document.activeElement === ui.replayNotes) {
    return;
  }

  // 1f #07: saved text always wins, and "saved" means the key EXISTS — a month
  // deliberately cleared to empty stays empty rather than re-seeding itself.
  const hasSaved = Object.prototype.hasOwnProperty.call(state.replayNotes, month);
  const seed = hasSaved ? "" : buildMonthlySeed(month);
  ui.replayNotes.value = hasSaved ? state.replayNotes[month] : seed;
  if (ui.replaySeedNote) {
    ui.replaySeedNote.hidden = !seed;
  }
}

// The one place that decides WHERE the journal lives. Demo mode gets
// sessionStorage (dies with the tab) under a prefixed key, so a demo can
// never read, overwrite or leak into a real user's localStorage journal.
function journalStore() {
  return state.auth.guestMode ? window.sessionStorage : window.localStorage;
}

function journalKey(key) {
  return state.auth.guestMode ? `${GUEST_KEY_PREFIX}${key}` : key;
}

function loadState() {
  const store = journalStore();
  state.settings = normalizeSettings(readStorageJson(journalKey(STORAGE_KEYS.settings), DEFAULT_SETTINGS, store));
  state.reflections = normalizeReflections(readStorageJson(journalKey(STORAGE_KEYS.reflections), [], store));
  state.replayNotes = normalizeReplayNotes(readStorageJson(journalKey(STORAGE_KEYS.replay), {}, store));
  // The stored trades key holds the WHOLE journal, every account. adoptAllTrades
  // splits it around the active one and runs the pre-accounts migration.
  adoptAllTrades(normalizeTrades(readStorageJson(journalKey(STORAGE_KEYS.trades), [], store)));
  applyActiveAccount();
}

function persistState(options = {}) {
  const { skipServerSync = false } = options;
  const store = journalStore();
  writeStorageJson(journalKey(STORAGE_KEYS.settings), state.settings, store);
  // Both halves, always. Writing state.trades alone would delete every other
  // account's journal on the next save.
  writeStorageJson(journalKey(STORAGE_KEYS.trades), allTrades(), store);
  writeStorageJson(journalKey(STORAGE_KEYS.reflections), state.reflections, store);
  writeStorageJson(journalKey(STORAGE_KEYS.replay), state.replayNotes, store);
  try {
    store.setItem(journalKey(STORAGE_KEYS.lastSaved), new Date().toISOString());
  } catch (error) {
    console.error("Storage write failed:", error);
  }
  renderLastSaved();

  if (!skipServerSync) {
    queueServerAutosave();
  }
}

function queueServerAutosave() {
  if (!state.auth.isAuthenticated) {
    return;
  }

  if (state.serverSync.timerId) {
    clearTimeout(state.serverSync.timerId);
  }

  state.serverSync.timerId = window.setTimeout(async () => {
    state.serverSync.timerId = null;
    if (state.serverSync.inFlight) {
      queueServerAutosave();
      return;
    }
    await saveToPhpStorage({ silent: true });
  }, SERVER_AUTOSAVE_DEBOUNCE_MS);
}

function cancelServerAutosave() {
  if (state.serverSync.timerId) {
    clearTimeout(state.serverSync.timerId);
    state.serverSync.timerId = null;
  }
}

function renderLastSaved() {
  let iso = null;
  try {
    iso = journalStore().getItem(journalKey(STORAGE_KEYS.lastSaved));
  } catch (error) {
    ui.lastSaved.textContent = "Autosave: browser storage unavailable";
    return;
  }

  if (!iso) {
    ui.lastSaved.textContent = state.auth.guestMode
      ? "Demo mode: nothing is saved"
      : "Autosave: waiting for first update";
    return;
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    ui.lastSaved.textContent = "Autosave: waiting for first update";
    return;
  }

  ui.lastSaved.textContent = state.auth.guestMode
    ? `Demo mode: not saved (${date.toLocaleTimeString()})`
    : `Autosave: ${date.toLocaleString()}`;
}

function normalizeSettings(input) {
  const value = input && typeof input === "object" ? input : {};
  return {
    journalName: normalizeJournalName(value.journalName),
    startingBalance: ensurePositiveNumber(value.startingBalance, DEFAULT_SETTINGS.startingBalance),
    balanceOverride: ensureNonNegative(value.balanceOverride, DEFAULT_SETTINGS.balanceOverride),
    dailyMaxLoss: ensureNonNegative(value.dailyMaxLoss, DEFAULT_SETTINGS.dailyMaxLoss),
    weeklyMaxLoss: ensureNonNegative(value.weeklyMaxLoss, DEFAULT_SETTINGS.weeklyMaxLoss),
    riskPerTrade: ensureNonNegative(value.riskPerTrade, DEFAULT_SETTINGS.riskPerTrade),
    equityGoal: ensurePositiveNumber(value.equityGoal, DEFAULT_SETTINGS.equityGoal),
    // 1f #02. ABSENT (every journal saved before this ships) → the seed list,
    // so nothing changes for an existing trader. PRESENT AND EMPTY → empty,
    // because deleting every rule is a legitimate choice and must survive a
    // reload. That distinction is why this is not a `|| DEFAULT` fallback.
    preTradeRules: Array.isArray(value.preTradeRules)
      ? normalizePreTradeRules(value.preTradeRules)
      : DEFAULT_PRE_TRADE_RULES.map((rule) => ({ ...rule })),
    // 1f #03.
    cooldownEnabled: value.cooldownEnabled === undefined ? true : Boolean(value.cooldownEnabled),
    cooldownLossStreak: clamp(
      Math.round(ensureNonNegative(value.cooldownLossStreak, DEFAULT_SETTINGS.cooldownLossStreak)),
      0,
      20
    ),
    // Multi-account. Absent on every journal written before this ships;
    // ensureAccounts() fills it from the trader's existing starting balance on
    // the first load, so nothing has to be re-entered.
    accounts: normalizeAccounts(value.accounts),
    activeAccountId: String(value.activeAccountId || "")
  };
}

// Ids are persisted on trades, so a rule keeps whatever id it was created
// with; only new rules mint one, and it is slugged from the label with a
// numeric tail when that slug is already taken.
function normalizePreTradeRules(input) {
  const seen = new Set();
  return input
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const label = String(item.label || "").trim().slice(0, 90);
      if (!label) {
        return null;
      }
      let id = String(item.id || "").trim() || slugifyRuleId(label);
      while (seen.has(id)) {
        id = `${id}-2`;
      }
      seen.add(id);
      return { id, label };
    })
    .filter(Boolean)
    .slice(0, 8);
}

function slugifyRuleId(label) {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return slug || `rule-${createId()}`;
}

function getPreTradeRules() {
  return Array.isArray(state.settings.preTradeRules) ? state.settings.preTradeRules : [];
}

// Historic trades carry ids of rules that may since have been renamed or
// deleted, so the lookup falls back to the seed list and then to the raw id —
// a stored tick always renders as something.
function preTradeRuleLabel(id) {
  const match =
    getPreTradeRules().find((rule) => rule.id === id) ||
    DEFAULT_PRE_TRADE_RULES.find((rule) => rule.id === id);
  return match ? match.label : String(id);
}

function normalizeTrades(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter((item) => item && typeof item === "object" && item.id && item.date)
    .map((item) => {
      const baseTrade = {
        id: String(item.id),
        createdAt: String(item.createdAt || ""),
        closedAt: String(item.closedAt || item.updatedAt || ""),
        updatedAt: String(item.updatedAt || ""),
        date: String(item.date),
        session: String(item.session || "Custom"),
        market: String(item.market || "Forex"),
        asset: String(item.asset || "UNKNOWN"),
        direction: String(item.direction || "Buy"),
        entryPrice: ensurePositiveNumber(item.entryPrice, 0),
        stopLoss: ensurePositiveNumber(item.stopLoss, 0),
        takeProfit: ensurePositiveNumber(item.takeProfit, 0),
        exitPrice: ensurePositiveNumber(item.exitPrice, 0),
        riskPercent: ensureNonNegative(item.riskPercent, 0),
        positionSize: ensurePositiveNumber(item.positionSize, 0),
        tradeResult: String(item.tradeResult || "Auto"),
        status: item.status === "open" ? "open" : "closed",
        setupType: String(item.setupType || "Custom"),
        timeframe: String(item.timeframe || "M15"),
        psychology: String(item.psychology || "Focused"),
        executionQuality: String(item.executionQuality || "B"),
        screenshotName: String(item.screenshotName || ""),
        screenshotData: String(item.screenshotData || ""),
        importBatchId: String(item.importBatchId || ""),
        // Multi-account. Empty on every trade written before this ships;
        // adoptAllTrades() adopts those rows into the migrated default account
        // rather than leaving them ownerless (and therefore invisible).
        accountId: String(item.accountId || ""),
        // 1b pre-trade checklist. Absent on every trade logged before this
        // ships and on every imported row — an empty array is "not asked",
        // not "ticked nothing", and nothing scores off it yet.
        preTradeRules: Array.isArray(item.preTradeRules) ? item.preTradeRules.map(String) : [],
        // 1f #02: the ids the checklist ACTUALLY SHOWED for this trade. Without
        // it, preTradeRules: [] is ambiguous — "never asked" and "asked, ticked
        // nothing" are opposite facts and only one of them is a skipped rule.
        // Empty here means the trade never saw a checklist, so the rule-cost
        // report ignores it rather than counting it as a skip.
        preTradeRulesAsked: Array.isArray(item.preTradeRulesAsked)
          ? item.preTradeRulesAsked.map(String)
          : [],
        // 1f #03: this trade was opened through a cooldown prompt, and what the
        // trader answered to unlock it.
        cooldownOverride: Boolean(item.cooldownOverride),
        cooldownReason: String(item.cooldownReason || ""),
        cooldownNote: String(item.cooldownNote || ""),
        // 1c close sheet. Absent on every trade saved before this ships: an
        // empty tag list is "never asked", and an empty journalledAt on a
        // trade that already has notes still counts as journalled — see
        // isTradeJournalled().
        mistakeTags: Array.isArray(item.mistakeTags) ? item.mistakeTags.map(String) : [],
        journalledAt: String(item.journalledAt || ""),
        notes: String(item.notes || "")
      };

      const metrics = calculateTradeMetrics(baseTrade);
      const manualResult = String(item.result || "").trim();
      const safeManualResult =
        manualResult === "Win" || manualResult === "Loss" || manualResult === "Break Even"
          ? manualResult
          : metrics.autoResult;
      const resolvedResult = baseTrade.status === "open"
        ? "Open"
        : baseTrade.tradeResult === "Auto"
          ? metrics.autoResult
          : safeManualResult;

      return {
        ...baseTrade,
        result: resolvedResult,
        netPnl: baseTrade.status === "open" ? 0 : metrics.netPnl,
        riskAmount: metrics.riskAmount,
        rMultiple: baseTrade.status === "open" ? 0 : metrics.rMultiple,
        rrRatio: metrics.rrRatio,
        pips: baseTrade.status === "open" ? 0 : metrics.pips,
        pipSize: metrics.pipSize,
        pipValuePerLot: metrics.pipValuePerLot,
        dollarPerPip: metrics.dollarPerPip
      };
    });
}

function normalizeReflections(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter((item) => item && typeof item === "object" && item.date)
    .map((item) => ({
      id: String(item.id || createId()),
      date: String(item.date),
      wentWell: String(item.wentWell || ""),
      mistake: String(item.mistake || ""),
      followRules: String(item.followRules || "Partially"),
      improveTomorrow: String(item.improveTomorrow || ""),
      tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
      // 1f #07. Absent on every pre-digest reflection, which reads correctly as
      // "this was not a weekly digest" — nothing to migrate.
      weekOf: String(item.weekOf || ""),
      createdAt: String(item.createdAt || "")
    }));
}

function normalizeReplayNotes(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  const result = {};
  Object.entries(input).forEach(([key, value]) => {
    result[String(key)] = String(value || "");
  });
  return result;
}

function normalizeJournalName(value) {
  const trimmed = String(value || "").trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return DEFAULT_SETTINGS.journalName;
  }

  return trimmed.slice(0, 24);
}

function updateBranding() {
  const prefix = normalizeJournalName(state.settings.journalName);

  if (state.settings.journalName !== prefix) {
    state.settings.journalName = prefix;
  }

  if (ui.brandTitle) {
    ui.brandTitle.innerHTML = PRODUCT_BRAND_MARKUP;
  }
  ui.brandTitles.forEach((node) => {
    node.innerHTML = PRODUCT_BRAND_MARKUP;
  });

  if (ui.riskInputs.journalName && ui.riskInputs.journalName.value !== prefix) {
    ui.riskInputs.journalName.value = prefix;
  }

  document.title = `${PRODUCT_BRAND_TEXT} | Trading Analytics`;
}

async function loadRecentTrades(options = {}) {
  const { silent = false } = options;

  if (!state.auth.isAuthenticated) {
    state.recentTrades = [];
    renderHeroRecentTrades();
    return false;
  }

  try {
    const response = await fetch("trade_handler.php?action=recent_trades", {
      method: "GET",
      credentials: "same-origin"
    });
    const body = await response.json();
    if (!response.ok || !body.ok || !Array.isArray(body.trades)) {
      throw new Error(body.error || "Recent trades load failed");
    }

    state.recentTrades = normalizeRecentTrades(body.trades);
    renderHeroRecentTrades();
    refreshLivePrices({ immediate: true });
    return true;
  } catch (error) {
    state.recentTrades = [];
    renderHeroRecentTrades();
    if (!silent) {
      setMessage(ui.authMessage, error.message || "Recent trades load failed.", "error");
    }
    return false;
  }
}

async function loadPublicRecentTrades(options = {}) {
  const { silent = false } = options;

  try {
    const response = await fetch("trade_handler.php?action=public_recent_trades", {
      method: "GET",
      credentials: "same-origin"
    });
    const body = await response.json();
    if (!response.ok || !body.ok || !Array.isArray(body.trades)) {
      throw new Error(body.error || "Public recent trades load failed");
    }

    state.publicRecentTrades = normalizeRecentTrades(body.trades);
    renderHeroRecentTrades();
    renderDashLeonTape();
    refreshLivePrices({ immediate: true });
    return true;
  } catch (error) {
    state.publicRecentTrades = [];
    renderHeroRecentTrades();
    renderDashLeonTape();
    if (!silent) {
      setMessage(ui.authMessage, error.message || "Public recent trades load failed.", "error");
    }
    return false;
  }
}

function startLivePriceLoop() {
  if (state.marketData.timerId) {
    clearInterval(state.marketData.timerId);
  }

  // One 5s loop serves both shells — landing and app tick at the same rate,
  // which is what lets the strips say "live · 5s" and mean it.
  state.marketData.timerId = window.setInterval(() => {
    refreshLivePrices();
    leonFeedTick += 1;
    if (
      leonFeedTick % 12 === 0 &&
      !state.auth.previewMode &&
      !state.auth.guestMode &&
      !state.auth.landingPreviewMode &&
      document.visibilityState === "visible"
    ) {
      loadPublicRecentTrades({ silent: true });
    }
  }, LIVE_PRICE_REFRESH_MS);

  refreshLivePrices({ immediate: true });
}

async function refreshLivePrices(options = {}) {
  const { immediate = false } = options;
  if (state.marketData.inFlight) {
    return;
  }

  if (!immediate && document.visibilityState === "hidden") {
    return;
  }

  const symbols = collectTrackedSymbols();
  if (!symbols.length) {
    return;
  }

  state.marketData.inFlight = true;
  try {
    const updates = await fetchLivePricesFromBackend(symbols);
    if (Object.keys(updates).length === 0) {
      // Failed or empty poll: the ticker keeps its last known prices on
      // screen and marks them stale — the strip never blanks.
      setTickerStale(true);
      return;
    }

    state.marketData.currentPrices = {
      ...state.marketData.currentPrices,
      ...updates
    };

    // Poll path: patch tagged nodes in place. No innerHTML rebuild here, so
    // scroll position, focus, and text selection survive every tick.
    // renderAll still owns real state mutations.
    patchLiveNodes();
    renderTickerPair();
  } finally {
    state.marketData.inFlight = false;
  }
}

// Live-field registry: how each tagged node ("data-live-field") derives its
// text, numeric value (for tick direction), and tone from an open trade's
// live snapshot. Tone groups swap mutually exclusive classes in place.
const LIVE_TONE_GROUPS = {
  pnl: {
    classes: ["pnl-positive", "pnl-negative"],
    map: (tone) => tone
  }
};

const LIVE_FIELD_SPECS = {
  livePercent: {
    value: (s) => s?.livePercent,
    text: (s) => formatLivePercentLabel(s?.livePercent, "OPEN"),
    tone: (s) => getLiveToneClass(s?.livePercent),
    toneGroup: "pnl"
  },
  priceMove: {
    value: (s) => s?.priceMove,
    text: (s) => formatPriceMove(s?.priceMove ?? NaN),
    tone: (s) => getLiveToneClass(s?.livePercent),
    toneGroup: "pnl"
  },
  currentPrice: {
    value: (s) => s?.currentPrice,
    text: (s) => (Number.isFinite(s?.currentPrice) ? formatProgressTradePrice(s.currentPrice) : "—"),
    tone: (s) => getLiveToneClass(s?.livePercent),
    toneGroup: "pnl"
  },
  dollarPnl: {
    value: (s) => s?.dollarPnl,
    text: (s) => formatSignedCurrency(s?.dollarPnl ?? NaN),
    tone: (s) => getLiveToneClass(s?.livePercent),
    toneGroup: "pnl"
  },
  livePips: {
    value: (s) => s?.pips,
    text: (s) => (Number.isFinite(s?.pips) ? `${s.pips >= 0 ? "+" : "\u2212"}${formatPips(Math.abs(s.pips))} pips` : "—"),
    tone: (s) => getLiveToneClass(s?.livePercent),
    toneGroup: "pnl"
  },
};

function patchLiveNodes() {
  const nodes = document.querySelectorAll("[data-live-field]");
  if (!nodes.length) {
    return;
  }

  const tradesById = new Map();
  [state.trades, state.publicRecentTrades, state.recentTrades].forEach((list) => {
    (Array.isArray(list) ? list : []).forEach((trade) => {
      const id = String(trade?.id || "");
      if (id && !tradesById.has(id)) {
        tradesById.set(id, trade);
      }
    });
  });

  const snapshots = new Map();
  nodes.forEach((node) => {
    const spec = LIVE_FIELD_SPECS[node.dataset.liveField];
    const tradeId = String(node.dataset.liveTrade || "");
    const trade = tradesById.get(tradeId);
    if (!spec || !trade) {
      return;
    }

    if (!snapshots.has(tradeId)) {
      snapshots.set(tradeId, getOpenTradeLiveSnapshot(trade));
    }
    const snapshot = snapshots.get(tradeId);

    if (spec.toneGroup) {
      const group = LIVE_TONE_GROUPS[spec.toneGroup];
      const nextTone = group.map(spec.tone(snapshot));
      group.classes.forEach((cls) => node.classList.toggle(cls, cls === nextTone));
    }

    if (!spec.text) {
      return;
    }

    const nextText = spec.text(snapshot);
    const nextValue = Number(spec.value(snapshot));
    const previousValue = Number(node.dataset.liveValue);
    node.dataset.liveValue = Number.isFinite(nextValue) ? String(nextValue) : "NaN";
    if (node.textContent !== nextText) {
      node.textContent = nextText;
      flashPnlTick(
        node,
        Number.isFinite(nextValue) && Number.isFinite(previousValue) ? nextValue - previousValue : 0
      );
    }
  });
}

// pnl-tick: directional background flash on value change; the class is
// removed on animationend (delegated listener in bindEvents).
function flashPnlTick(node, delta) {
  if (!delta || prefersReducedMotion()) {
    return;
  }

  node.classList.remove("tick-up", "tick-down");
  // Force reflow so re-adding the class restarts the animation.
  void node.offsetWidth;
  node.classList.add(delta > 0 ? "tick-up" : "tick-down");
}

function collectTrackedSymbols() {
  const symbols = new Set();
  const trades = canAccessApp()
    ? state.trades
    : Array.isArray(state.publicRecentTrades) && state.publicRecentTrades.length
      ? state.publicRecentTrades
      : state.recentTrades;

  trades.forEach((trade) => {
    const normalized = normalizeMarketSymbol(trade.asset);
    if (normalized) {
      symbols.add(normalized);
    }
  });

  // The hero/dashboard ticker pair is always tracked, journal or no journal.
  TICKER_SYMBOLS.forEach((symbol) => symbols.add(symbol));

  return Array.from(symbols);
}

/* ── Landing + dashboard ticker pair ───────────────────────────────────────
   One render path for both strips: every [data-ticker-price] and
   [data-ticker-delta] node is patched in place (marquee duplicates included),
   the change flash reuses pnl-tick, and the last live prices are cached in
   sessionStorage so a revisit paints instantly — marked stale until the
   first fresh poll lands. */
function setupLandingTicker() {
  let cached = null;
  try {
    cached = JSON.parse(window.sessionStorage.getItem(TICKER_CACHE_KEY) || "null");
  } catch (error) {
    cached = null;
  }
  if (!cached || typeof cached !== "object") {
    return;
  }
  TICKER_SYMBOLS.forEach((symbol) => {
    const price = Number(cached[symbol]);
    if (Number.isFinite(price) && price > 0 && !Number.isFinite(state.marketData.currentPrices[symbol])) {
      state.marketData.currentPrices[symbol] = price;
    }
  });
  renderTickerPair({ stale: true });
}

/* The dock pill is position:fixed, so it costs no layout and cannot flap:
   it slides in when the dashboard header's bottom edge crosses the top of
   the viewport, and only while the dashboard view is the active one. */
function setupStickyDashTicker() {
  const dock = document.getElementById("dashTickerDock");
  const head = document.querySelector(".dash-head");
  if (!dock || !head) {
    return;
  }
  // No rAF throttle: one rect read + class toggle is cheaper than the jam a
  // queued-but-never-run frame causes in a hidden tab (raf id never clears,
  // and every later scroll gets swallowed by the guard).
  const update = () => {
    const dashboardActive = canAccessApp() && document.getElementById("dashboard")?.classList.contains("is-active");
    dock.classList.toggle("is-docked", dashboardActive && head.getBoundingClientRect().bottom < 0);
  };
  window.addEventListener("scroll", update, { passive: true });
}

/* Landing showcase: five sample scenes in one phone frame, chip-switched.
   Pure class swaps — every scene loops on CSS alone once it is visible. */
function setupShowcaseChooser() {
  const stage = document.querySelector(".lnd-show-stage");
  if (!stage) {
    return;
  }
  stage.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-show-scene]");
    if (!chip) {
      return;
    }
    const target = chip.dataset.showScene;
    stage.querySelectorAll("[data-show-scene]").forEach((button) => {
      const active = button === chip;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    stage.querySelectorAll("[data-scene]").forEach((scene) => {
      scene.classList.toggle("is-active", scene.dataset.scene === target);
    });
  });
}

function setTickerStale(stale) {
  document.querySelectorAll("[data-ticker-strip]").forEach((strip) => {
    strip.classList.toggle("is-stale", Boolean(stale));
  });
}

// Delta magnitudes span BTC's ±100s and EURUSD's ±0.0004 — decimals follow
// the delta itself, not the price, so XAU never prints 0.299805 again.
function formatTickerDelta(delta) {
  const abs = Math.abs(delta);
  const decimals = abs >= 100 ? 0 : abs >= 1 ? 1 : abs >= 0.01 ? 2 : 4;
  return abs.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}

function renderTickerPair(options = {}) {
  const stale = Boolean(options.stale);
  setTickerStale(stale);
  let anyChange = false;

  TICKER_SYMBOLS.forEach((symbol) => {
    const price = state.marketData.currentPrices[symbol];
    if (!Number.isFinite(price) || price <= 0) {
      return;
    }

    const previous = tickerShown[symbol];
    const text = formatCapturePrice(price);
    document.querySelectorAll(`[data-ticker-price="${symbol}"]`).forEach((node) => {
      if (node.textContent !== text) {
        node.textContent = text;
        if (Number.isFinite(previous)) {
          anyChange = true;
          flashPnlTick(node, price - previous);
        }
      }
    });

    if (Number.isFinite(previous) && price !== previous) {
      const delta = price - previous;
      const deltaText = `${delta > 0 ? "\u25b2" : "\u25bc"} ${formatTickerDelta(delta)}`;
      document.querySelectorAll(`[data-ticker-delta="${symbol}"]`).forEach((node) => {
        node.textContent = deltaText;
        node.classList.toggle("pnl-positive", delta > 0);
        node.classList.toggle("pnl-negative", delta < 0);
      });
    }
    tickerShown[symbol] = price;
  });

  // One breath of the dock per tick that actually moved a number.
  if (anyChange && !prefersReducedMotion()) {
    const dock = document.getElementById("dashTickerDock");
    if (dock) {
      dock.classList.remove("is-ticking");
      void dock.offsetWidth;
      dock.classList.add("is-ticking");
    }
  }

  if (!stale) {
    try {
      const cache = {};
      TICKER_SYMBOLS.forEach((symbol) => {
        if (Number.isFinite(state.marketData.currentPrices[symbol])) {
          cache[symbol] = state.marketData.currentPrices[symbol];
        }
      });
      window.sessionStorage.setItem(TICKER_CACHE_KEY, JSON.stringify(cache));
    } catch (error) {
      /* storage blocked: the strip still works, it just cold-starts next visit */
    }
  }
}

/* ── Scripted product demo ─────────────────────────────────────────────────
   Replays the two real flows (command-bar open, close-and-journal) inside a
   device frame built from the live component markup. Every frame is derived
   from one small state object, so animated playback and the reduced-motion
   step-through render pixel-identical frames. */
function lndDemoState(overrides) {
  return {
    scene: "capture",
    typed: 0,
    entered: false,
    toast: false,
    mood: false,
    grade: false,
    note: 0,
    saved: false,
    ...overrides
  };
}

function buildLndDemoTimeline() {
  const cmdLen = LND_DEMO_COMMAND.length;
  const noteLen = LND_DEMO_NOTE_TEXT.length;
  const keyframes = [];
  const steps = [];
  const key = (frame, label, holdMs) => {
    keyframes.push({ state: frame, label });
    steps.push({ state: frame, label, ms: holdMs });
  };
  const tween = (base, prop, target, msPerChar) => {
    for (let i = base[prop] + 1; i < target; i += 1) {
      steps.push({ state: { ...base, [prop]: i }, ms: msPerChar });
    }
  };

  const s0 = lndDemoState({});
  key(s0, "The command bar. One line describes the whole trade.", 950);

  tween(s0, "typed", cmdLen, 52);
  const s1 = lndDemoState({ typed: cmdLen });
  key(s1, "Parsed as you type — entry, stop, target, all measured in pips.", 1500);

  const s2 = lndDemoState({ typed: cmdLen, entered: true });
  key(s2, "Enter.", 520);

  const s3 = lndDemoState({ typed: cmdLen, entered: true, toast: true });
  key(s3, "Position open. 0.02 lots — the risk is derived for you: $20.", 1700);

  const s4 = lndDemoState({ scene: "close" });
  key(s4, "The trade closed. Journalling it: two taps and a sentence.", 1300);

  const s5 = lndDemoState({ scene: "close", mood: true });
  key(s5, "Tap — how it felt.", 900);

  const s6 = lndDemoState({ scene: "close", mood: true, grade: true });
  key(s6, "Tap — how you executed.", 900);

  tween(s6, "note", noteLen, 34);
  const s7 = lndDemoState({ scene: "close", mood: true, grade: true, note: noteLen });
  key(s7, "One honest sentence.", 900);

  const s8 = lndDemoState({ scene: "close", mood: true, grade: true, note: noteLen, saved: true });
  key(s8, "Saved. That is the whole loop.", 2600);

  return { keyframes, steps };
}

// Chip thresholds are the character counts at which each token of
// LND_DEMO_COMMAND is complete — the chips appear exactly where the real
// parser would produce them for this input on a $10,000 demo account.
function renderLndDemoFrame(frame) {
  const d = lndDemoPlayer.ui;
  if (!d) {
    return;
  }

  d.scenes.forEach((scene) => {
    scene.classList.toggle("is-active", scene.dataset.demoScene === frame.scene);
  });

  // Scene 1 — the command bar.
  d.typed.textContent = LND_DEMO_COMMAND.slice(0, frame.typed);
  d.caretBar.hidden = frame.scene !== "capture" || frame.entered;
  const chips = [];
  if (frame.typed >= 6) chips.push('<span class="cmdk-chip cmdk-chip-accent">XAUUSD</span>');
  if (frame.typed >= 12) chips.push('<span class="cmdk-chip cmdk-chip-neg">SHORT</span>');
  if (frame.typed >= 17) chips.push('<span class="cmdk-chip">entry 4,234</span>');
  if (frame.typed >= 25) chips.push('<span class="cmdk-chip">stop 4,244 · 10.0 pips</span>');
  if (frame.typed >= 43) {
    chips.push('<span class="cmdk-chip">risk $20.00 = 0.2% (from size)</span>');
    chips.push('<span class="cmdk-chip">size 0.02 lots</span>');
  }
  if (frame.typed >= 33) chips.push('<span class="cmdk-chip">target 4,214 · 20.0 pips · R:R 2.00</span>');
  // Rebuild only when the chip count changes, so the pop-in animation fires
  // once per chip instead of once per keystroke.
  if (d.chips.dataset.rendered !== String(chips.length)) {
    d.chips.innerHTML = chips.join("");
    d.chips.dataset.rendered = String(chips.length);
  }
  d.status.hidden = frame.typed < 43;
  d.enterKey.classList.toggle("is-pressed", frame.entered);
  d.toast.hidden = !frame.toast;

  // Scene 2 — close & journal.
  d.mood.setAttribute("aria-pressed", frame.mood ? "true" : "false");
  d.grade.setAttribute("aria-pressed", frame.grade ? "true" : "false");
  d.note.textContent = LND_DEMO_NOTE_TEXT.slice(0, frame.note);
  d.noteCaret.hidden = !(frame.scene === "close" && frame.note > 0 && !frame.saved);
  d.save.classList.toggle("is-pressed", frame.saved);
  d.frame.classList.toggle("is-saved", frame.saved);
}

function setupLandingDemo() {
  const frame = document.getElementById("lndDemoFrame");
  const button = document.getElementById("lndDemoBtn");
  const caption = document.getElementById("lndDemoCaption");
  if (!frame || !button || !caption) {
    return;
  }

  lndDemoPlayer.ui = {
    frame,
    scenes: Array.from(frame.querySelectorAll("[data-demo-scene]")),
    typed: document.getElementById("lndDemoTyped"),
    caretBar: document.getElementById("lndDemoCaretBar"),
    chips: document.getElementById("lndDemoChips"),
    status: document.getElementById("lndDemoStatus"),
    enterKey: document.getElementById("lndDemoEnterKey"),
    toast: document.getElementById("lndDemoToast"),
    mood: document.getElementById("lndDemoMood"),
    grade: document.getElementById("lndDemoGrade"),
    note: document.getElementById("lndDemoNote"),
    noteCaret: document.getElementById("lndDemoNoteCaret"),
    save: document.getElementById("lndDemoSave"),
    caption,
    progress: document.getElementById("lndDemoProgress"),
    button
  };

  const { keyframes, steps } = buildLndDemoTimeline();
  lndDemoPlayer.keyframes = keyframes;
  lndDemoPlayer.steps = steps;
  lndDemoPlayer.staticMode = prefersReducedMotion();

  if (lndDemoPlayer.staticMode) {
    // Reduced motion: the final composed frame, plus a button that walks the
    // keyframes one static step per press. Nothing moves on its own.
    lndDemoPlayer.index = keyframes.length - 1;
    renderLndDemoFrame(keyframes[lndDemoPlayer.index].state);
    caption.textContent = keyframes[lndDemoPlayer.index].label;
    button.textContent = "Play demo";
    button.addEventListener("click", () => {
      lndDemoPlayer.index = (lndDemoPlayer.index + 1) % keyframes.length;
      const kf = keyframes[lndDemoPlayer.index];
      renderLndDemoFrame(kf.state);
      caption.textContent = kf.label;
      button.textContent = lndDemoPlayer.index === keyframes.length - 1 ? "Play demo" : "Next step";
    });
    return;
  }

  renderLndDemoFrame(steps[0].state);

  button.addEventListener("click", () => {
    lndDemoStop();
    lndDemoPlayFrom(0);
  });

  // Autoplay on first sight; pause whenever the frame leaves the viewport,
  // resume where it left off when it comes back.
  if (!("IntersectionObserver" in window)) {
    lndDemoPlayer.started = true;
    lndDemoPlayFrom(0);
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          if (!lndDemoPlayer.started) {
            lndDemoPlayer.started = true;
            lndDemoPlayFrom(0);
          } else if (!lndDemoPlayer.playing) {
            // Resume wherever it paused — the loop means every index is valid.
            lndDemoPlayFrom(lndDemoPlayer.index);
          }
        } else if (lndDemoPlayer.playing) {
          lndDemoStop();
        }
      });
    },
    { threshold: 0.35 }
  );
  observer.observe(frame);
}

function lndDemoPlayFrom(index) {
  const step = lndDemoPlayer.steps[index];
  if (!step) {
    lndDemoPlayer.playing = false;
    return;
  }
  lndDemoPlayer.index = index;
  lndDemoPlayer.playing = true;
  renderLndDemoFrame(step.state);
  if (lndDemoPlayer.ui.progress) {
    const pct = (index / (lndDemoPlayer.steps.length - 1)) * 100;
    lndDemoPlayer.ui.progress.style.width = `${pct.toFixed(1)}%`;
  }
  if (step.label) {
    lndDemoPlayer.ui.caption.textContent = step.label;
  }
  // The demo loops: the final frame holds for its own duration, then the
  // sequence restarts from the top. Halting here is what made the demo feel
  // stuck after it ended — and the viewport observer could never restart it,
  // because its resume condition required index < last.
  const nextIndex = index === lndDemoPlayer.steps.length - 1 ? 0 : index + 1;
  lndDemoPlayer.timer = window.setTimeout(() => lndDemoPlayFrom(nextIndex), step.ms);
}

function lndDemoStop() {
  window.clearTimeout(lndDemoPlayer.timer);
  lndDemoPlayer.playing = false;
}

