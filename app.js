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
import { createChartsModule } from "./src/modules/charts.js";

const STORAGE_KEYS = {
  trades: "axiom_journal_trades_v1",
  settings: "axiom_journal_settings_v1",
  reflections: "axiom_journal_reflections_v1",
  replay: "axiom_journal_replay_v1",
  lastSaved: "axiom_journal_last_saved_v1"
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
  balanceCard: document.querySelector(".metric-card-balance"),
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
  bulkMessage: document.getElementById("bulkMessage"),
  bulkPreviewWrap: document.getElementById("bulkPreviewWrap"),
  bulkPreviewBody: document.getElementById("bulkPreviewBody"),
  tradeAdvancedDetails: document.getElementById("tradeAdvancedDetails"),
  loginLogsPanel: document.getElementById("loginLogsPanel"),
  refreshLoginLogsBtn: document.getElementById("refreshLoginLogsBtn"),
  loginLogsMessage: document.getElementById("loginLogsMessage"),
  loginLogsBody: document.getElementById("loginLogsBody"),
  adminUsersPanel: document.getElementById("adminUsersPanel"),
  refreshAdminUsersBtn: document.getElementById("refreshAdminUsersBtn"),
  adminUsersMessage: document.getElementById("adminUsersMessage"),
  adminUsersBody: document.getElementById("adminUsersBody"),
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
  collapseAdminPanels();
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
  startLivePriceLoop();
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

function collapseAdminPanels() {
  if (ui.loginLogsPanel) {
    ui.loginLogsPanel.open = false;
    ui.loginLogsPanel.removeAttribute("open");
  }
  if (ui.adminUsersPanel) {
    ui.adminUsersPanel.open = false;
    ui.adminUsersPanel.removeAttribute("open");
  }
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
  window.addEventListener("scroll", handleLandingPreviewAutoExpand, { passive: true });
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
    ui.bulkImportBtn.addEventListener("click", handleBulkImport);
  }
  if (ui.bulkClearBtn) {
    ui.bulkClearBtn.addEventListener("click", clearBulkImport);
  }
  if (ui.refreshLoginLogsBtn) {
    ui.refreshLoginLogsBtn.addEventListener("click", () => {
      loadLoginLogs({ silent: false });
    });
  }
  if (ui.refreshAdminUsersBtn) {
    ui.refreshAdminUsersBtn.addEventListener("click", () => {
      loadAdminUsers({ silent: false });
    });
  }

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

  ui.savePhpBtn.addEventListener("click", saveToPhpStorage);
  ui.loadPhpBtn.addEventListener("click", loadFromPhpStorage);

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

  if (isMobileViewport()) {
    toggleMobileNav(false);
  }
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

function handleLandingPreviewAutoExpand() {
  return;
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
    collapseAdminPanels();
    const loaded = await loadFromPhpStorage({ silent: true, source: "session", preferLocalIfServerEmpty: true });
    await loadRecentTrades({ silent: true });
    if (loaded) {
      setMessage(ui.authMessage, `Session restored for ${state.auth.username}.`, "success");
    }
    await loadLoginLogs({ silent: true });
    await loadAdminUsers({ silent: true });
    refreshLivePrices({ immediate: true });
    switchView("dashboard");
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

async function handleLogin() {
  setAuthIntent("login");
  const credentials = readAuthForm(false);
  if (!credentials.ok) {
    setMessage(ui.authMessage, credentials.error, "error");
    return;
  }

  await submitAuth("login", credentials.password, "Logged in.", credentials.identifier);
}

async function handleRegister() {
  setAuthIntent("register");
  const credentials = readAuthForm(true);
  if (!credentials.ok) {
    setMessage(ui.authMessage, credentials.error, "error");
    return;
  }

  await submitAuth("register", credentials.password, "Account created and logged in.", credentials.identifier);
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
  collapseAdminPanels();
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
    collapseAdminPanels();
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

  parsed.trades.forEach((tradeInput) => {
    if (isLikelyDuplicateTrade(tradeInput)) {
      duplicates += 1;
      return;
    }

    state.trades.push(buildTradeRecord(tradeInput));
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
        <td colspan="9">No preview rows.</td>
      </tr>
    `;
    return;
  }

  ui.bulkPreviewWrap.hidden = false;
  ui.bulkPreviewBody.innerHTML = trades
    .slice(0, 30)
    .map((trade) => `
      <tr>
        <td data-label="Date">${escapeHtml(trade.date)}</td>
        <td data-label="Asset">${escapeHtml(trade.asset)}</td>
        <td data-label="Market">${escapeHtml(trade.market)}</td>
        <td data-label="Direction">${escapeHtml(trade.direction)}</td>
        <td data-label="Entry">${escapeHtml(String(trade.entryPrice))}</td>
        <td data-label="Stop">${escapeHtml(String(trade.stopLoss))}</td>
        <td data-label="Take">${escapeHtml(String(trade.takeProfit))}</td>
        <td data-label="Exit">${escapeHtml(String(trade.exitPrice))}</td>
        <td data-label="Size">${escapeHtml(String(trade.positionSize))}</td>
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

  let stopLoss = parseImportNumber(getBulkValue(row, ["stop", "stop_loss", "sl", "stoploss"]));
  let takeProfit = parseImportNumber(getBulkValue(row, ["take", "take_profit", "tp", "target"]));
  let exitPrice = parseImportNumber(getBulkValue(row, ["exit", "exit_price", "close", "close_price"]));

  const isBuy = direction === "Buy";
  if (!Number.isFinite(stopLoss) || stopLoss <= 0) {
    stopLoss = entryPrice * (isBuy ? 0.99 : 1.01);
  }
  if (!Number.isFinite(takeProfit) || takeProfit <= 0) {
    takeProfit = entryPrice * (isBuy ? 1.01 : 0.99);
  }
  if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
    exitPrice = takeProfit;
  }

  if (isBuy && stopLoss >= entryPrice) {
    stopLoss = entryPrice * 0.99;
  }
  if (!isBuy && stopLoss <= entryPrice) {
    stopLoss = entryPrice * 1.01;
  }
  if (isBuy && takeProfit <= entryPrice) {
    takeProfit = entryPrice * 1.01;
  }
  if (!isBuy && takeProfit >= entryPrice) {
    takeProfit = entryPrice * 0.99;
  }

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
      tradeResult,
      status: "closed",
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
  const directedMoveToExit = (trade.exitPrice - trade.entryPrice) * directionFactor;
  const rawPips = pipSpec.pipSize > 0 ? directedMoveToExit / pipSpec.pipSize : 0;
  const pips = round(rawPips);

  const pipDistanceToStop = pipSpec.pipSize > 0
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
    riskFromStructure = round(Math.abs(trade.entryPrice - trade.stopLoss) * trade.positionSize);
    dollarPerPip = round(pipSpec.pipSize * trade.positionSize);
  }

  const fallbackRisk = state.settings.startingBalance * (trade.riskPercent / 100);
  const riskAmount = round(riskFromStructure > 0 ? riskFromStructure : fallbackRisk);
  const rMultiple = riskAmount > 0 ? round(netPnl / riskAmount) : 0;

  const rrDenominator = Math.abs(trade.entryPrice - trade.stopLoss);
  const rrNumerator = Math.abs(trade.takeProfit - trade.entryPrice);
  const rrRatio = rrDenominator > 0 ? round(rrNumerator / rrDenominator) : 0;

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

  if (button.dataset.action === "edit") {
    loadTradeIntoForm(id);
  }
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

function renderLoginLogs() {
  if (!ui.loginLogsBody || !ui.loginLogsPanel) {
    return;
  }

  if (!state.auth.isAuthenticated || !state.auth.isAdmin) {
    ui.loginLogsPanel.hidden = true;
    ui.loginLogsPanel.open = false;
    ui.loginLogsPanel.removeAttribute("open");
    ui.loginLogsBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="6">Admin login required.</td>
      </tr>
    `;
    return;
  }

  ui.loginLogsPanel.hidden = false;
  ui.loginLogsPanel.open = false;
  ui.loginLogsPanel.removeAttribute("open");

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
  if (!ui.adminUsersPanel || !ui.adminUsersBody) {
    return;
  }

  if (!state.auth.isAuthenticated || !state.auth.isAdmin) {
    ui.adminUsersPanel.hidden = true;
    ui.adminUsersPanel.open = false;
    ui.adminUsersPanel.removeAttribute("open");
    ui.adminUsersBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="9">Admin login required.</td>
      </tr>
    `;
    return;
  }

  ui.adminUsersPanel.hidden = false;
  ui.adminUsersPanel.open = false;
  ui.adminUsersPanel.removeAttribute("open");

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
    disciplineScore,
    dailyTradingScore,
    goalProgress,
    traderScore
  };
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
    bestDay: analytics.bestDay.day === "-" ? "-" : `${formatCurrency(analytics.bestDay.pnl)} (${analytics.bestDay.day})`,
    worstDay: analytics.worstDay.day === "-" ? "-" : `${formatCurrency(analytics.worstDay.pnl)} (${analytics.worstDay.day})`,
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

  renderMetricDeltas();

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

function renderJournalTable() {
  const filtered = getFilteredTrades();

  if (!filtered.length) {
    ui.tradesBody.innerHTML = '<tr class="empty-row"><td colspan="13">No trades match current filters.</td></tr>';
    return;
  }

  const sorted = filtered.sort(sortTradesDesc);

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

