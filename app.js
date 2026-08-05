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
import {
  normalizeMarketSymbol,
  fetchLivePricesFromBackend
} from "./src/modules/livePrices.js";
import { createTradeDisplayHelpers, liveCellAttrs } from "./src/modules/tradeDisplay.js";
import { createRecentTradesView } from "./src/modules/recentTradesView.js";
import { createChartsModule, traceSmoothPath } from "./src/modules/charts.js";

const STORAGE_KEYS = {
  trades: "axiom_journal_trades_v1",
  settings: "axiom_journal_settings_v1",
  reflections: "axiom_journal_reflections_v1",
  replay: "axiom_journal_replay_v1",
  lastSaved: "axiom_journal_last_saved_v1",
  adminPanels: "axiom_journal_admin_panels_v1"
};

const DEFAULT_SETTINGS = {
  journalName: "Your",
  startingBalance: 10000,
  balanceOverride: 0,
  dailyMaxLoss: 300,
  weeklyMaxLoss: 1000,
  riskPerTrade: 1,
  equityGoal: 15000
};

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
  trades: [],
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
  landingFeed: {
    closedExpanded: false,
    openExpanded: false
  },
  filters: {
    dateFrom: "",
    dateTo: "",
    market: "all",
    setup: "all",
    timeframe: "all",
    result: "all",
    psychology: "all",
    search: ""
  },
  dashboard: {
    performanceDimension: "setup",
    performanceMetric: "pnl"
  },
  journalSort: {
    key: "",
    dir: 1
  },
  analytics: null
};

const ui = {
  authShell: document.getElementById("authShell"),
  sidebar: document.getElementById("sidebar"),
  mainNav: document.getElementById("mainNav"),
  navToggleBtn: document.getElementById("navToggleBtn"),
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
  landingScrollHint: document.getElementById("landingScrollHint"),
  authControls: document.getElementById("authControls"),
  authIdentifier: document.getElementById("authIdentifier"),
  authPassword: document.getElementById("authPassword"),
  loginBtn: document.getElementById("loginBtn"),
  registerBtn: document.getElementById("registerBtn"),
  forgotPasswordBtn: document.getElementById("forgotPasswordBtn"),
  heroRegisterBtn: document.getElementById("heroRegisterBtn"),
  heroLoginBtn: document.getElementById("heroLoginBtn"),
  ctaRegisterBtn: document.getElementById("ctaRegisterBtn"),
  landingAtmos: document.getElementById("landingAtmos"),
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
    equityGoal: document.getElementById("equityGoal")
  },
  disciplineScore: document.getElementById("disciplineScore"),
  dailyTradingScore: document.getElementById("dailyTradingScore"),
  goalProgress: document.getElementById("goalProgress"),
  riskViolations: document.getElementById("riskViolations"),
  edgeRows: document.getElementById("edgeRows"),
  equityChart: document.getElementById("equityChart"),
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
  tradeAdvancedDetails: document.getElementById("tradeAdvancedDetails"),
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
    timeframe: document.getElementById("filterTimeframe"),
    result: document.getElementById("filterResult"),
    psychology: document.getElementById("filterPsychology"),
    search: document.getElementById("filterSearch")
  },
  clearFiltersBtn: document.getElementById("clearFiltersBtn"),
  journalSortHeaders: Array.from(document.querySelectorAll("#journal th[data-sort]")),
  journalNewTradeBtn: document.getElementById("journalNewTradeBtn"),
  exportCsvBtn: document.getElementById("exportCsvBtn"),
  progressTradeSummary: document.getElementById("progressTradeSummary"),
  progressTradeLabel: document.getElementById("progressTradeLabel"),
  progressTradeTrack: document.getElementById("progressTradeTrack"),
  backupJsonBtn: document.getElementById("backupJsonBtn"),
  importJsonBtn: document.getElementById("importJsonBtn"),
  jsonImportInput: document.getElementById("jsonImportInput"),
  savePhpBtn: document.getElementById("savePhpBtn"),
  loadPhpBtn: document.getElementById("loadPhpBtn"),

  reflectionForm: document.getElementById("reflectionForm"),
  reflectionMessage: document.getElementById("reflectionMessage"),
  reflectionsList: document.getElementById("reflectionsList"),

  reviewMonth: document.getElementById("reviewMonth"),
  monthlyNet: document.getElementById("monthlyNet"),
  monthlyWinRate: document.getElementById("monthlyWinRate"),
  monthlyTrades: document.getElementById("monthlyTrades"),
  monthlyBestSetup: document.getElementById("monthlyBestSetup"),
  dashboardCalendarMonth: document.getElementById("dashboardCalendarMonth"),
  calendarSummary: document.getElementById("calendarSummary"),
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
  syncLandingExpandedLayout,
  isMobileViewport,
  formatCompactTradeDate,
  sortRecentTradeRowsDesc
});
const {
  renderHeroRecentTrades,
  handleRecentTradesClick,
  normalizeRecentTrades
} = recentTradesView;

const { renderCharts } = createChartsModule({ ui, state, prefersReducedMotion });

// Declared before init() so first-render code can reach them (module-level
// let/const below init() are in the temporal dead zone during the first
// render). Equity-sparkline draw-in state: the hash guard replays the
// animation only when the dataset changes, so live ticks never restart it.
let dashSparkHash = "";
let dashSparkFrame = 0;

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

init();

function init() {
  const localPreview = isLocalPreviewMode();
  state.auth.landingPreviewMode = localPreview && isLocalLandingPreviewRequested();
  state.auth.previewMode = localPreview && !state.auth.landingPreviewMode;
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
  setupLandingAtmos();
  setupHeroTilt();
  setupLandingParallax();
  startLivePriceLoop();
  // Hash router: restore the deep-linked view for preview sessions; the
  // authenticated flow restores in checkAuthSession once the gate opens.
  if (canAccessApp()) {
    const initialView = getViewFromHash();
    if (initialView && initialView !== "dashboard") {
      switchView(initialView);
    }
  }
  if (state.auth.previewMode) {
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
    button.textContent = next === "light" ? "Light" : "Dark";
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
        drawDashSparkline(
          ui.dashSparkline,
          Array.isArray(state.analytics.equity) ? state.analytics.equity.filter(Number.isFinite) : [],
          1
        );
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
  if (ui.landingScrollHint) {
    ui.landingScrollHint.addEventListener("click", () => {
      toggleLandingTradePreview();
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
    if (id && !isViewActive(id)) {
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

  ui.journalNewTradeBtn.addEventListener("click", openFreshTradeEntry);
  ui.dashboardEmptyCta?.addEventListener("click", openFreshTradeEntry);
  ui.exportCsvBtn.addEventListener("click", exportTradesCsv);
  ui.backupJsonBtn.addEventListener("click", exportBackupJson);
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
  ui.reviewMonth.addEventListener("change", renderMonthlyReview);
  ui.dashboardCalendarMonth.addEventListener("change", renderCalendarView);
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

    if (ui.sidebar.contains(event.target)) {
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
    if (isActive) {
      btn.setAttribute("aria-current", "page");
    } else {
      btn.removeAttribute("aria-current");
    }
  });

  ui.views.forEach((view) => {
    view.classList.toggle("is-active", view.id === id);
  });

  // Hash router: keep location.hash in sync so refresh/back/forward restore
  // the view. The first programmatic set uses replaceState so page load does
  // not burn a history entry; later switches push normally.
  if (window.location.hash !== `#${id}`) {
    if (window.location.hash) {
      window.location.hash = id;
    } else {
      try {
        window.history.replaceState(null, "", `#${id}`);
      } catch (error) {
        window.location.hash = id;
      }
    }
  }

  if (isMobileViewport()) {
    toggleMobileNav(false);
  }
}

function getViewFromHash() {
  const id = window.location.hash.replace(/^#/, "");
  return id && ui.views.some((view) => view.id === id) ? id : "";
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
  ui.sidebar.classList.toggle("nav-open", nextState);
  ui.navToggleBtn.classList.toggle("is-open", nextState);
  ui.navToggleBtn.setAttribute("aria-expanded", String(nextState));
}

function syncMobileNavState() {
  if (!ui.sidebar || !ui.navToggleBtn) {
    return;
  }

  if (!isMobileViewport()) {
    ui.sidebar.classList.remove("nav-open");
    ui.navToggleBtn.classList.remove("is-open");
    ui.navToggleBtn.setAttribute("aria-expanded", "false");
  }
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
  return state.auth.previewMode || (state.auth.checked && state.auth.isAuthenticated);
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

function toggleLandingTradePreview(forceExpanded) {
  if (!ui.recentTradesList || !ui.landingScrollHint) {
    return;
  }

  const nextExpanded = typeof forceExpanded === "boolean"
    ? forceExpanded
    : !ui.recentTradesList.classList.contains("is-preview-expanded");

  ui.recentTradesList.classList.toggle("is-preview-expanded", nextExpanded);
  ui.landingScrollHint.classList.toggle("is-open", nextExpanded);
  ui.landingScrollHint.querySelector(".landing-scroll-hint-label").textContent = nextExpanded ? "Hide trades" : "View trades";

  if (nextExpanded) {
    ui.recentTradesList.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function syncLandingExpandedLayout() {
  if (!ui.authShell) {
    return;
  }

  const layoutExpanded = state.landingFeed.closedExpanded || state.landingFeed.openExpanded
    || ui.recentTradesList?.classList.contains("is-preview-expanded");
  ui.authShell.classList.toggle("is-trades-expanded", Boolean(layoutExpanded));
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
  const locked = !previewMode && state.auth.checked && !state.auth.isAuthenticated;
  const disableNavigation = !canAccessApp();
  const authenticated = state.auth.checked && state.auth.isAuthenticated;

  document.body.classList.toggle("auth-locked", locked);
  document.body.classList.add("auth-ready");
  document.body.classList.toggle("is-authenticated", authenticated);
  document.body.classList.toggle("is-preview", previewMode);

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
    switchView(getViewFromHash() || "dashboard");
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
  try {
    const response = await fetch(`trade_handler.php?action=${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ identifier, password })
    });
    const body = await response.json();
    if (!response.ok || !body.ok) {
      throw new Error(body.error || `${action} failed`);
    }

    if (body.csrfToken) {
      csrfToken = String(body.csrfToken);
    }

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
      const saved = await saveToPhpStorage({ silent: true });
      if (saved) {
        setMessage(ui.authMessage, `${successMessage} Fresh journal ready.`, "success");
      } else {
        setMessage(ui.authMessage, `${successMessage} Fresh journal created locally.`, "success");
      }
    } else {
      const loaded = await loadFromPhpStorage({ silent: true, source: "auth", preferLocalIfServerEmpty: true });
      if (loaded) {
        setMessage(ui.authMessage, `${successMessage} Server journal loaded.`, "success");
      } else {
        setMessage(ui.authMessage, `${successMessage} Using local journal until server load succeeds.`, "error");
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
  ui.heroRegisterBtn?.classList.add("primary");
  ui.heroRegisterBtn?.classList.remove("hero-cta-btn-secondary");
  ui.heroLoginBtn?.classList.remove("primary");
  ui.heroLoginBtn?.classList.add("hero-cta-btn-secondary");

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
    equityGoal: parseNumber(ui.riskInputs.equityGoal.value)
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
  const trade = buildTradeRecord(payload.value, {
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

function setTradeAdvancedDetailsOpen(isOpen) {
  if (!ui.tradeAdvancedDetails) {
    return;
  }

  ui.tradeAdvancedDetails.open = Boolean(isOpen);
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

  const numericFields = [
    ["Entry Price", value.entryPrice, ui.tradeFields.entryPrice],
    ["Stop Loss", value.stopLoss, ui.tradeFields.stopLoss],
    ["Take Profit", value.takeProfit, ui.tradeFields.takeProfit],
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

function handleScreenshotUpload(event) {
  const file = event.target.files?.[0];
  if (!file) {
    clearScreenshotPreview();
    return;
  }

  ui.tradeFields.screenshotLabel.textContent = file.name;

  const maxInlineBytes = 350 * 1024;
  if (file.size > maxInlineBytes) {
    ui.tradeFields.screenshotData.value = "";
    ui.tradeFields.screenshotPreview.textContent = "Screenshot attached (too large for inline storage).";
    setMessage(
      ui.tradeFormMessage,
      "Screenshot name saved, but image data skipped (file too large for localStorage).",
      "error"
    );
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const result = typeof reader.result === "string" ? reader.result : "";
    ui.tradeFields.screenshotData.value = result;
    ui.tradeFields.screenshotPreview.innerHTML = `<img src="${result}" alt="Trade screenshot preview" />`;
    setMessage(ui.tradeFormMessage, "Screenshot embedded with this trade.", "success");
  };
  reader.onerror = () => {
    ui.tradeFields.screenshotData.value = "";
    setMessage(ui.tradeFormMessage, "Failed to read screenshot file.", "error");
  };
  reader.readAsDataURL(file);
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
  setTradeAdvancedDetailsOpen(false);
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
  state.filters.timeframe = ui.filters.timeframe.value;
  state.filters.result = ui.filters.result.value;
  state.filters.psychology = ui.filters.psychology.value;
  state.filters.search = ui.filters.search.value.trim().toLowerCase();
  renderJournalTable();
}

function clearFilters() {
  ui.filters.dateFrom.value = "";
  ui.filters.dateTo.value = "";
  ui.filters.market.value = "all";
  ui.filters.setup.value = "all";
  ui.filters.timeframe.value = "all";
  ui.filters.result.value = "all";
  ui.filters.psychology.value = "all";
  ui.filters.search.value = "";
  handleFilterChange();
}

function openFreshTradeEntry() {
  resetTradeForm(false);
  switchView("trade-entry");
  ui.tradeFields.asset.focus();
  setMessage(ui.tradeFormMessage, "Ready for a new trade entry.", "success");
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

  if (button.dataset.action === "delete") {
    deleteTrade(id);
    return;
  }

  if (button.dataset.action === "close") {
    closeTradeAtMarket(id);
    return;
  }

  if (button.dataset.action === "edit") {
    loadTradeIntoForm(id);
  }
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

  state.trades = state.trades.filter((item) => item.id !== id);
  persistState();
  renderAll();
  setMessage(ui.journalMessage, "Trade deleted.", "success");
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
  ui.tradeFields.takeProfit.value = trade.takeProfit;
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
  setTradeAdvancedDetailsOpen(true);
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

  state.reflections.unshift({
    id: createId(),
    date,
    wentWell,
    mistake,
    followRules,
    improveTomorrow,
    tags,
    createdAt: new Date().toISOString()
  });

  if (state.reflections.length > 180) {
    state.reflections = state.reflections.slice(0, 180);
  }

  persistState();
  renderAll();
  ui.reflectionForm.reset();
  document.getElementById("reflectionDate").value = toDateInputValue(new Date());
  setMessage(ui.reflectionMessage, "Reflection saved.", "success");
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

  const headers = [
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
    "notes"
  ];

  const rows = state.trades.map((trade) => {
    return headers.map((field) => escapeCsvValue(trade[field] ?? "")).join(",");
  });

  const csv = [headers.join(","), ...rows].join("\n");
  triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8" }), `trading-journal-${Date.now()}.csv`);
  setMessage(ui.journalMessage, "CSV exported.", "success");
}

function exportBackupJson() {
  const backup = {
    exportedAt: new Date().toISOString(),
    settings: state.settings,
    trades: state.trades,
    reflections: state.reflections,
    replayNotes: state.replayNotes
  };

  const payload = JSON.stringify(backup, null, 2);
  triggerDownload(new Blob([payload], { type: "application/json" }), `trading-journal-backup-${Date.now()}.json`);
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
      state.trades = normalizeTrades(parsed.trades);
      state.reflections = normalizeReflections(parsed.reflections);
      state.replayNotes = normalizeReplayNotes(parsed.replayNotes);

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
      setMessage(ui.journalMessage, "Login first to save on server database.", "error");
    }
    return;
  }

  const payload = {
    settings: state.settings,
    trades: state.trades,
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
      setMessage(ui.journalMessage, "Login first to load server database.", "error");
    }
    return false;
  }

  // Skeleton pulse on metric values + journal rows while the server journal
  // loads (auth restore or manual load). Cleared in finally.
  document.body.classList.add("is-journal-loading");
  try {
    const localSnapshot = {
      settings: { ...state.settings },
      trades: [...state.trades],
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
      state.trades = localSnapshot.trades;
      state.reflections = localSnapshot.reflections;
      state.replayNotes = localSnapshot.replayNotes;
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
    state.trades = serverTrades;
    state.reflections = serverReflections;
    state.replayNotes = serverReplayNotes;

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
  state.analytics = calculateAnalytics(state.trades, state.settings, state.reflections);
  renderHeroRecentTrades();
  renderProgressTradeSummary();
  renderDashboardMetrics(state.analytics);
  renderRiskStrip(state.analytics);
  syncBulkUndoButton();
  renderRiskViolations(state.analytics);
  renderEdgeTable(state.analytics);
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

  ui.progressTradeLabel.textContent = openTrades.length === 1 ? "In Progress Trade" : "In Progress Trades";
  ui.progressTradeTrack.innerHTML = openTrades
    .map((trade) => {
      const liveSnapshot = getOpenTradeLiveSnapshot(trade);
      const currentPrice = liveSnapshot?.currentPrice ?? null;
      const livePercent = liveSnapshot?.livePercent ?? null;
      const pnlToneClass = liveSnapshot?.toneClass ?? "";
      const priceMove = liveSnapshot?.priceMove ?? null;
      const dollarMove = liveSnapshot?.dollarPnl ?? null;
      const directionClass = String(trade.direction || "").toLowerCase() === "sell" ? "recent-trade-direction-sell" : "recent-trade-direction-buy";

      return `
        <article class="progress-trade-card">
          <div class="progress-trade-card-top">
            <div class="progress-trade-card-top-main">
              <strong class="progress-trade-card-symbol">${escapeHtml(trade.asset || "—")}</strong>
              <span class="recent-trade-direction ${directionClass}">${escapeHtml(trade.direction || "Buy")}</span>
              <span class="progress-trade-badge">OPEN</span>
            </div>
            <span class="progress-trade-live-inline ${pnlToneClass} live-cell" ${liveCellAttrs(trade, "livePercent")}>${escapeHtml(formatLivePercentLabel(livePercent, "OPEN"))}</span>
          </div>
          <div class="progress-trade-card-prices">
            <span class="progress-trade-price-chip"><em>Move</em><strong class="${pnlToneClass} live-cell" ${liveCellAttrs(trade, "priceMove")}>${formatPriceMove(priceMove)}</strong></span>
            <span class="progress-trade-price-chip"><em>Entry</em><strong>${formatProgressTradePrice(trade.entryPrice)}</strong></span>
            <span class="progress-trade-price-chip progress-trade-price-chip-live"><em>Current Price</em><strong class="${pnlToneClass} live-cell" ${liveCellAttrs(trade, "currentPrice")}>${Number.isFinite(currentPrice) ? formatProgressTradePrice(currentPrice) : "—"}</strong></span>
            <button class="progress-trade-price-chip progress-trade-price-chip-toggle" type="button" data-progress-details-toggle aria-expanded="false">
              <strong>Show</strong>
            </button>
            <button class="progress-trade-price-chip progress-trade-price-chip-close" type="button" data-close-trade="${escapeHtml(String(trade.id || ""))}" aria-label="Close ${escapeHtml(trade.asset || "")} at market price">
              <strong>Close</strong>
            </button>
          </div>
          <div class="progress-trade-card-meta progress-trade-card-meta-hidden">
              <span class="progress-trade-stat"><em>SL</em><strong>${formatProgressTradePrice(trade.stopLoss)}</strong></span>
              <span class="progress-trade-stat"><em>TP</em><strong>${formatProgressTradePrice(trade.takeProfit)}</strong></span>
              <span class="progress-trade-stat"><em>$ Move</em><strong class="${pnlToneClass} live-cell" ${liveCellAttrs(trade, "dollarPnl")}>${formatSignedCurrency(dollarMove)}</strong></span>
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

  const toggle = event.target.closest("[data-progress-details-toggle]");
  if (!toggle) {
    return;
  }

  const card = toggle.closest(".progress-trade-card");
  if (!card) {
    return;
  }

  const isOpen = card.classList.toggle("is-details-open");
  toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
  const label = toggle.querySelector("strong");
  if (label) {
    label.textContent = isOpen ? "Hide" : "Show";
  }
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
      return;
    }

    const delta = spec.read(current) - spec.read(previous);
    const tone = spec.neutral ? 0 : spec.invert ? -delta : delta;
    node.textContent = `${delta > 0 ? "+" : ""}${spec.format(delta)} ${windows.label}`;
    node.classList.toggle("is-pos", tone > 0);
    node.classList.toggle("is-neg", tone < 0);
    node.hidden = false;
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
  renderDashHeroToday(analytics);
  renderDashSparkline(analytics);

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

// Balance hero: today's realized P&L as a toned chip beside the delta.
function renderDashHeroToday(analytics) {
  if (!ui.dashHeroToday) {
    return;
  }

  const hasTrades = state.trades.length > 0;
  ui.dashHeroToday.hidden = !hasTrades;
  if (!hasTrades) {
    return;
  }

  // A flat day reads "$0.00", not the ± sentinel formatSignedCurrency returns.
  const todayText = analytics.todayPnl === 0 ? formatCurrency(0) : formatSignedCurrency(analytics.todayPnl);
  ui.dashHeroToday.textContent = `Today ${todayText}`;
  ui.dashHeroToday.classList.toggle("is-pos", analytics.todayPnl > 0);
  ui.dashHeroToday.classList.toggle("is-neg", analytics.todayPnl < 0);
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

  const points = Array.isArray(analytics.equity) ? analytics.equity.filter(Number.isFinite) : [];
  const hash = `${points.length}:${points[points.length - 1]}:${points[0]}`;
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

// Landing hero atmosphere: a deterministic equity-shaped curve that draws
// itself once behind the headline. Deterministic (no RNG) so the landing
// looks identical on every visit; theme colours come from the tokens.
function drawLandingAtmos(canvas, progress) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 1200;
  const height = canvas.clientHeight || 420;
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const styles = getComputedStyle(document.documentElement);
  const read = (name, fallback) => (styles.getPropertyValue(name) || "").trim() || fallback;
  const line = read("--chart-line", "#5b8def");
  const glow = read("--chart-glow", "rgba(91, 141, 239, 0.55)");
  const areaTop = read("--chart-area-top", "rgba(91, 141, 239, 0.42)");
  const areaMid = read("--chart-area-mid", "rgba(91, 141, 239, 0.13)");
  const areaBottom = read("--chart-area-bottom", "rgba(91, 141, 239, 0)");

  // A rising walk with a mid-course drawdown — the shape of a real curve.
  const steps = 72;
  const values = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const trend = Math.pow(t, 1.08);
    const wobble = Math.sin(t * 11.4) * 0.05 + Math.sin(t * 4.1) * 0.035;
    const dip = Math.exp(-Math.pow((t - 0.46) / 0.11, 2)) * 0.16;
    values.push(trend + wobble - dip);
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const padTop = height * 0.3;
  const usable = height - padTop - height * 0.12;
  const stepX = width / steps;
  const yFor = (value) => padTop + (1 - (value - min) / span) * usable;
  const lastIndex = Math.max(1, Math.round(steps * clamp(progress, 0, 1)));
  const points = [];
  for (let i = 0; i <= lastIndex; i += 1) {
    points.push({ x: i * stepX, y: yFor(values[i]) });
  }

  const head = points[points.length - 1];

  // Area first, curve on top: same smoothing maths as the real equity chart
  // (traceSmoothPath is charts.js's export) so the decoration cannot drift
  // away from the product's own line language.
  ctx.save();
  ctx.beginPath();
  traceSmoothPath(ctx, points);
  ctx.lineTo(head.x, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  const area = ctx.createLinearGradient(0, padTop, 0, height);
  area.addColorStop(0, areaTop);
  area.addColorStop(0.55, areaMid);
  area.addColorStop(1, areaBottom);
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = area;
  ctx.fill();
  ctx.restore();

  // Two-pass stroke: a wide shadow-blurred halo, then a crisp core.
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.globalAlpha = 0.42;
  ctx.strokeStyle = glow;
  ctx.lineWidth = 5;
  ctx.shadowColor = glow;
  ctx.shadowBlur = 22;
  ctx.beginPath();
  traceSmoothPath(ctx, points);
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.globalAlpha = 0.7;
  ctx.strokeStyle = line;
  ctx.lineWidth = 1.75;
  ctx.beginPath();
  traceSmoothPath(ctx, points);
  ctx.stroke();

  // Head marker rides the draw-in and settles as a lit dot.
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = line;
  ctx.shadowColor = glow;
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.arc(head.x, head.y, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function setupLandingAtmos() {
  const canvas = ui.landingAtmos;
  if (!canvas) {
    return;
  }

  const paint = (progress) => drawLandingAtmos(canvas, progress);

  if (prefersReducedMotion()) {
    paint(1);
  } else {
    const startTime = performance.now();
    const step = (now) => {
      const t = Math.min((now - startTime) / 1400, 1);
      paint(1 - Math.pow(1 - t, 3));
      if (t < 1) {
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  }

  window.addEventListener("themechange", () => paint(1));
  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => paint(1), 150);
  });
}

// Hero terminal 3D tilt. The resting rotation is pure CSS (scoped to
// >=980px there); this only adds the pointer response, and only for a real
// mouse on a hover-capable device with motion allowed. Touch and reduced
// motion never bind a listener at all, so the panel simply sits still.
function setupHeroTilt() {
  const panel = document.querySelector("[data-hero-tilt]");
  if (!panel || prefersReducedMotion()) {
    return;
  }

  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine) and (min-width: 980px)");
  const stage = panel.closest(".hero-terminal-stage") || panel;
  const MAX_TILT = 5;
  let rect = null;
  let frame = 0;
  let nextX = 0;
  let nextY = 0;

  const commit = () => {
    frame = 0;
    panel.style.setProperty("--tilt-x", `${nextX.toFixed(2)}deg`);
    panel.style.setProperty("--tilt-y", `${nextY.toFixed(2)}deg`);
  };

  const reset = () => {
    rect = null;
    nextX = 0;
    nextY = 0;
    if (!frame) {
      frame = requestAnimationFrame(commit);
    }
  };

  // Rect is cached on enter (and dropped on leave/resize) so the pointer
  // handler never forces a synchronous layout while the tape is repainting.
  stage.addEventListener("pointerenter", (event) => {
    if (event.pointerType !== "mouse" || !finePointer.matches) {
      return;
    }
    rect = stage.getBoundingClientRect();
  });

  stage.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse" || !finePointer.matches) {
      return;
    }
    if (!rect) {
      rect = stage.getBoundingClientRect();
    }
    const px = (event.clientX - rect.left) / (rect.width || 1) - 0.5;
    const py = (event.clientY - rect.top) / (rect.height || 1) - 0.5;
    nextY = clamp(px, -0.5, 0.5) * 2 * MAX_TILT;
    nextX = clamp(-py, -0.5, 0.5) * 2 * MAX_TILT;
    if (!frame) {
      frame = requestAnimationFrame(commit);
    }
  });

  stage.addEventListener("pointerleave", reset);
  window.addEventListener("resize", reset, { passive: true });
  // Older Safari only has the deprecated addListener; optional call keeps the
  // tilt working there instead of throwing during init.
  finePointer.addEventListener?.("change", reset);
}

// Landing parallax: one passive scroll listener writing a single custom
// property on the shell. CSS consumes it (grid floor, hero canvas) with
// transforms only, so scrolling stays a composite — no layout, no repaint of
// the live tape. Reduced motion never binds.
function setupLandingParallax() {
  const shell = ui.authShell;
  if (!shell || prefersReducedMotion()) {
    return;
  }

  let frame = 0;
  const commit = () => {
    frame = 0;
    shell.style.setProperty("--landing-scroll", String(Math.round(window.scrollY)));
  };

  window.addEventListener(
    "scroll",
    () => {
      if (!frame) {
        frame = requestAnimationFrame(commit);
      }
    },
    { passive: true }
  );
  commit();
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
    { key: "day", pnl: analytics.todayPnl, limit: state.settings.dailyMaxLoss, period: "today" },
    { key: "week", pnl: analytics.weekPnl, limit: state.settings.weeklyMaxLoss, period: "this week" }
  ];

  const visible = state.trades.length > 0 && entries.some((entry) => entry.limit > 0);
  ui.riskStrip.hidden = !visible;
  if (!visible) {
    return;
  }

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
    const breached = entry.pnl < -entry.limit;
    item.classList.toggle("is-breach", breached);
    item.classList.toggle("is-warn", !breached && ratio >= 0.6);

    const fill = item.querySelector(".risk-strip-fill");
    if (fill) {
      fill.style.width = `${Math.round(ratio * 100)}%`;
    }
    const value = item.querySelector(".risk-strip-value");
    if (value) {
      value.textContent = `${formatCurrency(entry.pnl)} ${entry.period} / ${formatCurrency(entry.limit)} limit`;
    }
    // Headline numeral: budget still available — the actionable number.
    const remain = item.querySelector(".risk-strip-remain");
    if (remain) {
      const left = Math.max(entry.limit - used, 0);
      remain.textContent = breached ? "Limit breached" : `${formatCurrency(left)} left`;
    }
  });
}

function renderCalendarView() {
  if (!ui.calendarGrid || !ui.dashboardCalendarMonth || !ui.calendarSummary) {
    return;
  }

  const monthValue = ui.dashboardCalendarMonth.value || toDateInputValue(new Date()).slice(0, 7);
  const [yearText, monthText] = monthValue.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;

  if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    ui.calendarGrid.innerHTML = "";
    ui.calendarSummary.innerHTML = `
      <div class="calendar-summary-empty">Choose a valid month.</div>
    `;
    return;
  }

  const dayStats = buildCalendarDayStats(monthValue);
  const firstDay = new Date(year, monthIndex, 1);
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const startOffset = firstDay.getDay();
  const monthTrades = getClosedTrades().filter((trade) => trade.date.startsWith(monthValue));
  const monthPnl = monthTrades.reduce((sum, trade) => sum + trade.netPnl, 0);
  const monthWins = monthTrades.filter((trade) => trade.result === "Win").length;
  const monthWinRate = monthTrades.length ? (monthWins / monthTrades.length) * 100 : 0;

  const pnlClass = monthPnl > 0 ? "pnl-positive" : monthPnl < 0 ? "pnl-negative" : "";
  ui.calendarSummary.innerHTML = `
    <article class="calendar-summary-card">
      <span class="calendar-summary-label">Total Trades</span>
      <strong class="calendar-summary-value">${monthTrades.length}</strong>
      <span class="calendar-summary-subtext">${monthWinRate.toFixed(1)}% win rate</span>
    </article>
    <article class="calendar-summary-card ${pnlClass}">
      <span class="calendar-summary-label">P&amp;L</span>
      <strong class="calendar-summary-value ${pnlClass}">${formatCurrency(monthPnl)}</strong>
      <span class="calendar-summary-subtext">${monthValue}</span>
    </article>
  `;

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
    const cellBody = `
        <span class="calendar-cell-day">${day}</span>
        <span class="calendar-cell-pnl ${pnlClass}">${hasTrades ? formatCurrency(stats.pnl) : "-"}</span>
        <span class="calendar-cell-meta">${stats.trades} trade${stats.trades === 1 ? "" : "s"} | ${stats.winRate.toFixed(0)}% win</span>
        <span class="calendar-cell-meta">${escapeHtml(stats.topAsset)}</span>
    `;

    // Traded days are real buttons (graft): click filters the journal to that day.
    cells.push(hasTrades
      ? `<button type="button" class="${cellClasses}" data-date="${isoDate}" style="--day-intensity:${intensity};" aria-label="Review trades from ${isoDate} in the journal">${cellBody}</button>`
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
      return `
        <tr>
          <td data-label="Setup">${escapeHtml(row.setup)}</td>
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

function renderJournalTable() {
  syncJournalSortIndicators();
  const filtered = getFilteredTrades();

  if (!filtered.length) {
    ui.tradesBody.innerHTML = '<tr class="empty-row"><td colspan="13">No trades match current filters.</td></tr>';
    return;
  }

  // Header sort applies to the filtered array; the default order stays the
  // existing newest-first sequence.
  const { key: sortKey, dir: sortDir } = state.journalSort;
  const sorted = sortKey
    ? [...filtered].sort((a, b) => compareTradeField(a, b, sortKey) * sortDir || sortTradesDesc(a, b))
    : filtered.sort(sortTradesDesc);

  ui.tradesBody.innerHTML = sorted
    .map((trade) => {
      const isOpen = trade.status === "open";
      const livePercent = getOpenTradePnlPercent(trade);
      const resultClass = isOpen
        ? "pill"
        : trade.result === "Win"
          ? "pill pill-win"
          : trade.result === "Loss"
            ? "pill pill-loss"
            : "pill pill-be";
      const pnlClass = isOpen
        ? getLiveToneClass(livePercent)
        : trade.netPnl >= 0
          ? "pnl-positive"
          : "pnl-negative";
      const pipClass = isOpen ? "" : trade.pips > 0 ? "pnl-positive" : trade.pips < 0 ? "pnl-negative" : "";

      return `
        <tr>
          <td data-label="Date">${escapeHtml(trade.date)}</td>
          <td data-label="Asset">${escapeHtml(trade.asset)}</td>
          <td data-label="Market">${escapeHtml(trade.market)}</td>
          <td data-label="Direction">${escapeHtml(trade.direction)}</td>
          <td data-label="Setup">${escapeHtml(trade.setupType)}</td>
          <td data-label="Timeframe">${escapeHtml(trade.timeframe)}</td>
          <td data-label="Result"><span class="${resultClass}">${escapeHtml(trade.result)}</span></td>
          <td data-label="Pips" class="num ${pipClass}">${isOpen ? "—" : Number.isFinite(trade.pips) ? trade.pips.toFixed(2) : "0.00"}</td>
          <td data-label="Net P&L" class="num ${pnlClass}${isOpen ? " live-cell" : ""}"${isOpen ? ` ${liveCellAttrs(trade, "livePercent")}` : ""}>${isOpen ? escapeHtml(formatLivePercentLabel(livePercent, "OPEN")) : formatCurrency(trade.netPnl)}</td>
          <td data-label="R-Multiple" class="num">${isOpen ? "—" : Number.isFinite(trade.rMultiple) ? trade.rMultiple.toFixed(2) : "0.00"}R</td>
          <td data-label="Psychology">${escapeHtml(trade.psychology)}</td>
          <td data-label="Execution">${escapeHtml(trade.executionQuality)}</td>
          <td class="row-actions">
            ${isOpen ? `<button class="mini-btn mini-btn-close" data-action="close" data-id="${trade.id}" type="button">Close</button>` : ""}
            <button class="mini-btn" data-action="edit" data-id="${trade.id}" type="button">Edit</button>
            <button class="mini-btn danger" data-action="delete" data-id="${trade.id}" type="button">Delete</button>
          </td>
        </tr>
      `;
    })
    .join("");
}

function hydrateSetupFilter() {
  const setups = Array.from(new Set(state.trades.map((trade) => trade.setupType).filter(Boolean))).sort();
  const currentValue = ui.filters.setup.value;

  ui.filters.setup.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "All";
  ui.filters.setup.appendChild(allOption);

  setups.forEach((setup) => {
    const option = document.createElement("option");
    option.value = setup;
    option.textContent = setup;
    ui.filters.setup.appendChild(option);
  });

  ui.filters.setup.value = setups.includes(currentValue) ? currentValue : "all";
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

    if (state.filters.timeframe !== "all" && trade.timeframe !== state.filters.timeframe) {
      return false;
    }

    if (state.filters.result !== "all" && trade.result !== state.filters.result) {
      return false;
    }

    if (state.filters.psychology !== "all" && trade.psychology !== state.filters.psychology) {
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

function renderReflections() {
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
          <h4>${escapeHtml(entry.date)} | Followed Rules: ${escapeHtml(entry.followRules)}</h4>
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

  ui.replayNotes.value = state.replayNotes[month] || "";
}

function loadState() {
  state.settings = normalizeSettings(readStorageJson(STORAGE_KEYS.settings, DEFAULT_SETTINGS));
  state.trades = normalizeTrades(readStorageJson(STORAGE_KEYS.trades, []));
  state.reflections = normalizeReflections(readStorageJson(STORAGE_KEYS.reflections, []));
  state.replayNotes = normalizeReplayNotes(readStorageJson(STORAGE_KEYS.replay, {}));
}

function persistState(options = {}) {
  const { skipServerSync = false } = options;
  writeStorageJson(STORAGE_KEYS.settings, state.settings);
  writeStorageJson(STORAGE_KEYS.trades, state.trades);
  writeStorageJson(STORAGE_KEYS.reflections, state.reflections);
  writeStorageJson(STORAGE_KEYS.replay, state.replayNotes);
  try {
    localStorage.setItem(STORAGE_KEYS.lastSaved, new Date().toISOString());
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
    iso = localStorage.getItem(STORAGE_KEYS.lastSaved);
  } catch (error) {
    ui.lastSaved.textContent = "Autosave: browser storage unavailable";
    return;
  }

  if (!iso) {
    ui.lastSaved.textContent = "Autosave: waiting for first update";
    return;
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    ui.lastSaved.textContent = "Autosave: waiting for first update";
    return;
  }

  ui.lastSaved.textContent = `Autosave: ${date.toLocaleString()}`;
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
    equityGoal: ensurePositiveNumber(value.equityGoal, DEFAULT_SETTINGS.equityGoal)
  };
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
    refreshLivePrices({ immediate: true });
    return true;
  } catch (error) {
    state.publicRecentTrades = [];
    renderHeroRecentTrades();
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

  state.marketData.timerId = window.setInterval(() => {
    refreshLivePrices();
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

  return Array.from(symbols);
}

