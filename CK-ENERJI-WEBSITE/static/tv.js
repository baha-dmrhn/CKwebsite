(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const slides = [...document.querySelectorAll(".tv-slide")];
  const navButtons = [...document.querySelectorAll("#tvSlideNav button")];
  const ROTATE_MS = 15000;
  const DATA_REUSE_MS = 60000;
  const TV_CACHE_PREFIX = "ck-command-center:";
  const SLIDE_CONFIG = [
    { key: "overview", label: "Genel durum", index: 0 },
    { key: "market", label: "Piyasa", index: 1 },
    { key: "dam", label: "Barajlar", index: 2 },
    { key: "production", label: "Üretim", index: 3 },
    { key: "consumption", label: "Tüketim", index: 4 },
  ];
  const DEFAULT_SETTINGS = {
    mode: "rotate",
    slides: SLIDE_CONFIG.map((slide) => slide.key),
    fixedSlide: "overview",
  };
  let currentSlide = 0;
  let paused = false;
  let rotateTimer = 0;
  let refreshTimer = 0;
  let loadInProgress = false;
  let touchStartX = 0;
  let touchStartY = 0;
  let lastLoadedAt = 0;
  let currentUserKey = "local";
  let settings = { ...DEFAULT_SETTINGS };
  let enabledSlideIndexes = SLIDE_CONFIG.map((slide) => slide.index);
  let currentAlerts = [];
  let latestReport = null;

  const todayTR = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Istanbul" }).format(new Date());
  const fmt = (value, digits = 2) => Number.isFinite(Number(value)) ? new Intl.NumberFormat("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(value)) : "—";
  const fmtPercent = (value) => Number.isFinite(Number(value)) ? `${Number(value) < 0 ? "−" : ""}%${fmt(Math.abs(Number(value)))}` : "—";
  const pct = (value) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Number(value))) : 0;
  const numeric = (value) => value !== null && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
  const esc = (value) => String(value ?? "—").replace(/[&<>"']/g, (character) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[character]);
  const displayDate = (value) => value ? new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "long", year: "numeric", timeZone: "Europe/Istanbul" }).format(new Date(`${value}T12:00:00+03:00`)) : "—";

  const slideByKey = (key) => SLIDE_CONFIG.find((slide) => slide.key === key) || SLIDE_CONFIG[0];

  function normalizeSettings(candidate = {}) {
    const allowed = new Set(SLIDE_CONFIG.map((slide) => slide.key));
    const chosen = Array.isArray(candidate.slides)
      ? candidate.slides.filter((key) => allowed.has(key))
      : [];
    const uniqueSlides = [...new Set(chosen)];
    const selectedSlides = uniqueSlides.length ? uniqueSlides : [...DEFAULT_SETTINGS.slides];
    const fixedSlide = allowed.has(candidate.fixedSlide) && selectedSlides.includes(candidate.fixedSlide)
      ? candidate.fixedSlide
      : selectedSlides[0];
    return {
      mode: candidate.mode === "fixed" ? "fixed" : "rotate",
      slides: selectedSlides,
      fixedSlide,
    };
  }

  function loadSettings() {
    settings = normalizeSettings(window.__ckTvSettings || {});
  }

  function getEnabledIndexes() {
    return settings.slides.map((key) => slideByKey(key).index);
  }

  function readCachedReport(selectedDate) {
    try {
      const entry = JSON.parse(sessionStorage.getItem(`${TV_CACHE_PREFIX}${selectedDate}`) || "null");
      if (!entry?.report || !Number.isFinite(Number(entry.savedAt))) return null;
      return { report: entry.report, savedAt: Number(entry.savedAt) };
    } catch {
      return null;
    }
  }

  function storeCachedReport(selectedDate, report) {
    try {
      sessionStorage.setItem(
        `${TV_CACHE_PREFIX}${selectedDate}`,
        JSON.stringify({ report, savedAt: lastLoadedAt }),
      );
    } catch {
      // Depolama kapalıysa TV ekranı sunucu önbelleğiyle çalışmaya devam eder.
    }
  }

  function setText(id, value) { const node = $(id); if (node) node.textContent = value; }
  function setHeaderActionsReady(ready) {
    const actionIds = ["tvReport", "tvPause", "tvSettings", "tvFullscreen"];
    actionIds.forEach((id) => {
      const action = $(id);
      if (!action) return;
      if (action.tagName === "BUTTON") action.disabled = !ready;
      action.setAttribute("aria-disabled", String(!ready));
      action.tabIndex = ready ? 0 : -1;
    });
  }
  function showAlerts() {
    const panel = $("tvAlertPanel");
    if (!panel) return;
    $("tvAlertList").innerHTML = currentAlerts.length
      ? currentAlerts.map((alert) => `<article><b>${esc(alert.label)}</b><p>${esc(alert.detail)}</p></article>`).join("")
      : "<article><b>Tüm veri grupları hazır</b><p>TV ekranındaki kaynaklarda aktif bir veri uyarısı yok.</p></article>";
    panel.classList.add("open"); panel.setAttribute("aria-hidden", "false"); $("tvLive")?.setAttribute("aria-expanded", "true");
  }
  function hideAlerts() { $("tvAlertPanel")?.classList.remove("open"); $("tvAlertPanel")?.setAttribute("aria-hidden", "true"); $("tvLive")?.setAttribute("aria-expanded", "false"); }
  function startProgress() {
    const progress = $("tvProgress");
    progress.classList.remove("running");
    progress.style.width = "0";
    if (settings.mode !== "rotate" || enabledSlideIndexes.length < 2 || paused) return;
    void progress.offsetWidth;
    progress.classList.add("running");
  }
  function scheduleRotation() {
    clearTimeout(rotateTimer);
    startProgress();
    if (settings.mode !== "rotate" || enabledSlideIndexes.length < 2 || paused) return;
    rotateTimer = window.setTimeout(() => stepSlide(1), ROTATE_MS);
  }
  function showSlide(index) {
    if (!enabledSlideIndexes.includes(index)) index = enabledSlideIndexes[0] ?? 0;
    currentSlide = (index + slides.length) % slides.length;
    slides.forEach((slide, i) => slide.classList.toggle("active", i === currentSlide));
    navButtons.forEach((button, i) => button.classList.toggle("active", i === currentSlide));
    scheduleRotation();
  }

  function applySettings() {
    settings = normalizeSettings(settings);
    enabledSlideIndexes = getEnabledIndexes();
    const combinedFixedDashboard = settings.mode === "fixed" && settings.slides.length > 1;
    document.body.classList.toggle("tv-fixed-mode", settings.mode === "fixed");
    document.body.classList.toggle("tv-combined-fixed-mode", combinedFixedDashboard);
    const fixedDashboard = $("tvFixedDashboard");
    if (fixedDashboard) fixedDashboard.hidden = !combinedFixedDashboard;
    slides.forEach((slide, index) => {
      slide.hidden = combinedFixedDashboard || !enabledSlideIndexes.includes(index);
    });
    navButtons.forEach((button) => {
      const index = Number(button.dataset.target);
      button.hidden = combinedFixedDashboard || !enabledSlideIndexes.includes(index);
    });
    const fixedIndex = slideByKey(settings.fixedSlide).index;
    const targetIndex = settings.mode === "fixed"
      ? fixedIndex
      : enabledSlideIndexes.includes(currentSlide)
      ? currentSlide
      : enabledSlideIndexes[0];
    if ($("tvPause")) {
      const canPause = settings.mode === "rotate" && enabledSlideIndexes.length > 1;
      $("tvPause").hidden = !canPause;
      $("tvPause").disabled = !canPause;
    }
    if (combinedFixedDashboard) {
      if (latestReport) renderFixedDashboard(latestReport);
      scheduleRotation();
    } else {
      showSlide(targetIndex);
    }
  }

  function fixedKpi(label, value, detail = "") {
    return `<div class="tv-fixed-kpi"><span>${esc(label)}</span><strong>${esc(value)}</strong>${detail ? `<small>${esc(detail)}</small>` : ""}</div>`;
  }

  function renderFixedDashboard(report) {
    const target = $("tvFixedDashboardCards");
    if (!target) return;
    const modules = report.modules || {};
    const market = modules.market || {}, marketSummary = market.summary || {};
    const dams = modules.dams || {}, damSummary = report.damSummary || {};
    const production = modules.production || {}, productionSummary = production.summary || {};
    const consumption = modules.consumption || {}, consumptionSummary = consumption.summary || {};
    const ptfAverage = marketSummary.ptfAverageByCurrency?.TRY ?? marketSummary.ptfAverage;
    const cards = settings.slides.map((key) => {
      if (key === "market") return `<article class="tv-fixed-card market"><header><span>01 / PİYASA</span><b>PTF · SMF · Dengeleme</b></header><div class="tv-fixed-kpis">${fixedKpi("PTF ORT.", `${fmt(ptfAverage)} TL/MWh`, `${marketSummary.ptfPublishedHours || 0} saat yayımlandı`)}${fixedKpi("SMF ORT.", `${fmt(marketSummary.smfAverage)} TL/MWh`)}${fixedKpi("TOPLAM YAL", `${fmt(marketSummary.yalTotal)} MWh`)}${fixedKpi("TOPLAM YAT", `${fmt(marketSummary.yatTotal)} MWh`)}</div></article>`;
      if (key === "dam") return `<article class="tv-fixed-card dam"><header><span>02 / BARAJLAR</span><b>Aktif doluluk görünümü</b></header><div class="tv-fixed-kpis">${fixedKpi("ORTALAMA DOLULUK", Number.isFinite(Number(damSummary.average)) ? `%${fmt(damSummary.average)}` : "—", `${damSummary.count || 0} baraj`)}${fixedKpi("EN YÜKSEK", damSummary.highest ? `${damSummary.highest.name} · %${fmt(damSummary.highest.value)}` : "—")}${fixedKpi("EN DÜŞÜK", damSummary.lowest ? `${damSummary.lowest.name} · %${fmt(damSummary.lowest.value)}` : "—")}</div></article>`;
      if (key === "production") return `<article class="tv-fixed-card production"><header><span>03 / ÜRETİM</span><b>UEVM · UEÇM dengesi</b></header><div class="tv-fixed-kpis">${fixedKpi("TOPLAM UEVM", `${fmt(productionSummary.uevmTotal)} MWh`, `${production.period?.uevmHours || 0} saat`)}${fixedKpi("TOPLAM UEÇM", `${fmt(productionSummary.uecmTotal)} MWh`)}${fixedKpi("SAPMA", fmtPercent(productionSummary.deviationPct))}</div></article>`;
      if (key === "consumption") return `<article class="tv-fixed-card consumption"><header><span>04 / TÜKETİM</span><b>Gerçek zamanlı tüketim</b></header><div class="tv-fixed-kpis">${fixedKpi("SON TÜKETİM", `${fmt(consumptionSummary.latest)} MWh`, consumptionSummary.latestHour || "—")}${fixedKpi("GÜNLÜK ORT.", `${fmt(consumptionSummary.average)} MWh`)}${fixedKpi("ZİRVE", `${fmt(consumptionSummary.maximum)} MWh`, consumptionSummary.maximumHour || "—")}</div></article>`;
      return `<article class="tv-fixed-card overview"><header><span>GENEL DURUM</span><b>Sistemin bugünkü nabzı</b></header><div class="tv-overview-summary"><div class="tv-overview-lead"><span>GÜNÜN PİYASA GÖSTERGESİ</span><strong>${esc(`${fmt(ptfAverage)} TL/MWh`)}</strong><small>${esc(`${marketSummary.ptfPublishedHours || 0} saatlik PTF verisi yayınlandı`)}</small></div><div class="tv-overview-metrics">${fixedKpi("ORTALAMA BARAJ DOLULUĞU", Number.isFinite(Number(damSummary.average)) ? `%${fmt(damSummary.average)}` : "—", `${damSummary.count || 0} baraj`)}${fixedKpi("TÜKETİM ZİRVESİ", `${fmt(consumptionSummary.maximum)} MWh`, consumptionSummary.maximumHour || "—")}</div><div class="tv-overview-status"><i></i><span>Piyasa, baraj ve tüketim verileri tek özette izleniyor</span></div></div></article>`;
    });
    target.dataset.count = String(cards.length);
    target.innerHTML = cards.join("");
    setText("tvFixedDashboardMeta", `${displayDate(report.date)} · ${settings.slides.length} seçili veri grubu`);
  }

  function lineChart(targetId, series) {
    const target = $(targetId);
    if (!target) return;
    const valid = series.flatMap((item) => item.values.filter(Number.isFinite));
    if (!valid.length) { target.textContent = "Bu tarih için grafik verisi bulunamadı."; return; }
    const min = Math.min(...valid), max = Math.max(...valid), range = max - min || 1;
    const x = (index, count) => 55 + (index / Math.max(1, count - 1)) * 900;
    const y = (value) => 330 - ((value - min) / range) * 280;
    const paths = series.map((item) => {
      const points = item.values.map((value, index) => Number.isFinite(value) ? `${x(index, item.values.length)},${y(value)}` : null);
      const segments = []; let active = [];
      points.forEach((point) => { if (point) active.push(point); else if (active.length) { segments.push(active); active = []; } });
      if (active.length) segments.push(active);
      return segments.map((segment) => `<polyline points="${segment.join(" ")}" fill="none" stroke="${item.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`).join("");
    }).join("");
    const grids = [50, 143, 236, 330].map((value) => `<line x1="55" y1="${value}" x2="955" y2="${value}" stroke="#253854" stroke-width="1" stroke-dasharray="8 8"/>`).join("");
    const labels = [[0,"00:00"],[6,"06:00"],[12,"12:00"],[18,"18:00"],[23,"23:00"]].map(([index,label]) => `<text x="${x(index,24)}" y="382" text-anchor="middle" fill="#7186a6" font-size="12">${label}</text>`).join("");
    target.innerHTML = `<svg viewBox="0 0 1000 400" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Saatlik grafik">${grids}${paths}${labels}</svg>`;
  }

  function render(report) {
    latestReport = report;
    const modules = report.modules || {};
    const market = modules.market || {}, marketSummary = market.summary || {};
    const next = modules.nextDayPtf || {}, nextSummary = next.summary || {};
    const dams = modules.dams || {}, damSummary = report.damSummary || {};
    const production = modules.production || {}, productionSummary = production.summary || {};
    const consumption = modules.consumption || {}, consumptionSummary = consumption.summary || {};
    const ptfAverage = marketSummary.ptfAverageByCurrency?.TRY ?? marketSummary.ptfAverage;

    setText("overviewMeta", `${displayDate(report.date)} · ${report.availableModules?.length || 0}/5 veri grubu hazır`);
    setText("tvPtf", fmt(ptfAverage));
    setText("tvPtfMeta", `${marketSummary.ptfPublishedHours ?? market.rows?.filter((row) => Number.isFinite(row.ptf)).length ?? 0} saat yayımlandı`);
    setText("tvDeviation", fmtPercent(productionSummary.deviationPct));
    setText("tvProductionMeta", `${production.period?.comparableHours ?? 0} ortak saat`);
    setText("tvDamAverage", Number.isFinite(Number(damSummary.average)) ? `%${fmt(damSummary.average)}` : "—");
    setText("tvDamMeta", `${damSummary.count || 0} baraj · ${damSummary.source || "veri bekleniyor"}`);
    setText("tvConsumptionPeak", fmt(consumptionSummary.maximum));
    setText("tvConsumptionMeta", `${consumptionSummary.maximumHour || "—"} · ${consumptionSummary.availableHours || 0}/24 saat`);
    setText("tvNextStatus", next.publication?.label || "Yayın bekleniyor");
    setText("tvNextAverage", `${fmt(nextSummary.ptfAverageByCurrency?.TRY)} TL/MWh`);
    setText("tvNextHours", `${nextSummary.publishedHours || 0} / 24 saat`);

    setText("tvMarketDate", displayDate(market.date || report.date));
    setText("tvMarketPtf", fmt(ptfAverage)); setText("tvMarketSmf", fmt(marketSummary.smfAverage));
    setText("tvMarketYal", fmt(marketSummary.yalTotal)); setText("tvMarketYat", fmt(marketSummary.yatTotal));
    lineChart("tvMarketChart", [
      { color: "#3478f6", values: (market.rows || []).map((row) => numeric(row.ptf)) },
      { color: "#8767ed", values: (market.rows || []).map((row) => numeric(row.smfPublished === false ? null : row.smf)) },
    ]);

    setText("tvDamSource", `${displayDate(damSummary.date || report.date)} · ${damSummary.source || "—"}`);
    setText("tvDamGaugeValue", `%${fmt(damSummary.average)}`);
    $("tvDamGauge")?.style.setProperty("--fill", `${pct(damSummary.average) * 3.6}deg`);
    setText("tvDamHighest", damSummary.highest ? `${damSummary.highest.name} · %${fmt(damSummary.highest.value)}` : "—");
    setText("tvDamLowest", damSummary.lowest ? `${damSummary.lowest.name} · %${fmt(damSummary.lowest.value)}` : "—");
    setText("tvDamCount", `${damSummary.count || 0} baraj`);
    const ranked = [...(dams.items || [])].filter((item) => Number.isFinite(Number(item.activeFullnessAmount))).sort((a,b) => Number(b.activeFullnessAmount) - Number(a.activeFullnessAmount)).slice(0,8);
    $("tvDamRanking").innerHTML = ranked.map((item,index) => `<div class="tv-rank-row"><span>${String(index+1).padStart(2,"0")}</span><b>${esc(item.dam)}</b><div class="tv-rank-track"><i style="width:${pct(item.activeFullnessAmount)}%"></i></div><span>%${fmt(item.activeFullnessAmount,1)}</span></div>`).join("") || "Baraj verisi bulunamadı.";

    setText("tvProductionPeriod", production.period ? `${displayDate(production.period.start)} · ${production.period.uevmHours || 0} UEVM saati` : "—");
    setText("tvUevm", fmt(productionSummary.uevmTotal)); setText("tvUecm", fmt(productionSummary.uecmTotal));
    $("tvGroupBars").innerHTML = (production.groups || []).map((group) => `<div class="tv-group-row"><div><span>${esc(group.label)}</span><small>${fmt(group.value)} MWh</small></div><div class="tv-group-track"><i style="width:${pct(group.share)}%"></i></div><b>%${fmt(group.share,1)}</b></div>`).join("") || "Üretim verisi bulunamadı.";

    setText("tvConsumptionDate", displayDate(consumption.date || report.date));
    setText("tvLatestConsumption", fmt(consumptionSummary.latest)); setText("tvAverageConsumption", fmt(consumptionSummary.average));
    setText("tvConsumptionHour", consumptionSummary.maximumHour || "—"); setText("tvConsumptionCoverage", `${consumptionSummary.availableHours || 0} / 24 saat yayımlandı`);
    lineChart("tvConsumptionChart", [{ color: "#44bfd0", values: (consumption.rows || []).map((row) => numeric(row.consumption)) }]);

    const labels = { market: "Piyasa", nextDayPtf: "Ertesi gün PTF", dams: "Barajlar", production: "Üretim", consumption: "Tüketim" };
    currentAlerts = Object.entries(report.errors || {}).map(([key, detail]) => ({ label: labels[key] || key, detail: String(detail || "Veri geçici olarak alınamadı.") }));
    const errorCount = currentAlerts.length;
    $("tvLive").classList.toggle("warning", errorCount > 0);
    $("tvLive").querySelector("span").textContent = errorCount ? `${errorCount} veri grubunda uyarı` : "EPİAŞ · Canlı veri bağlantısı";
    setText("tvUpdated", `Güncelleme ${new Date(report.generatedAt).toLocaleTimeString("tr-TR", { hour:"2-digit", minute:"2-digit" })}`);
    $("tvReport").href = `/rapor?date=${encodeURIComponent(report.date)}`;
    setHeaderActionsReady(true);
    if (settings.slides.length > 1) renderFixedDashboard(report);
  }

  function scheduleDataRefresh(report = null) {
    clearTimeout(refreshTimer);
    const marketFreshness = report?.modules?.market?.freshness || {};
    const requestedDelay = Number(marketFreshness.nextRefreshMs);
    const requestedBaseDelay = marketFreshness.smfIncomplete
      ? Math.max(30_000, Number.isFinite(requestedDelay) ? requestedDelay : 45_000)
      : 300_000;
    const elapsed = lastLoadedAt ? Math.max(0, Date.now() - lastLoadedAt) : 0;
    const delay = Math.max(15_000, requestedBaseDelay - elapsed);
    refreshTimer = window.setTimeout(() => {
      if (document.hidden) scheduleDataRefresh(report);
      else load();
    }, delay);
  }

  async function load() {
    if (loadInProgress) return;
    loadInProgress = true;
    try {
      const response = await fetch(`/api/command-center?date=${encodeURIComponent(todayTR())}`, { credentials: "include" });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { window.location.replace("/login"); return; }
      if (!response.ok) throw new Error(data.error || "Veriler alınamadı.");
      lastLoadedAt = Date.now();
      storeCachedReport(todayTR(), data);
      render(data); $("tvLoading").classList.add("hidden"); scheduleDataRefresh(data);
    } catch (error) {
      $("tvLive").classList.add("warning");
      $("tvLive").querySelector("span").textContent = error.message || "Bağlantı hatası";
      currentAlerts = [{ label: "Komuta merkezi", detail: error.message || "Veriler yenilenirken bağlantı hatası oluştu." }];
      $("tvLoading").querySelector("span").textContent = error.message || "Veriler alınamadı.";
      scheduleDataRefresh();
    } finally {
      loadInProgress = false;
    }
  }

  function updateClock() {
    const now = new Date();
    setText("tvClock", now.toLocaleTimeString("tr-TR", { timeZone:"Europe/Istanbul", hour:"2-digit", minute:"2-digit", second:"2-digit" }));
    setText("tvDate", now.toLocaleDateString("tr-TR", { timeZone:"Europe/Istanbul", weekday:"long", day:"2-digit", month:"long", year:"numeric" }));
  }
  function stepSlide(direction) {
    if (!enabledSlideIndexes.length) return;
    const currentPosition = enabledSlideIndexes.indexOf(currentSlide);
    const nextPosition = currentPosition >= 0 ? currentPosition + direction : 0;
    showSlide(enabledSlideIndexes[(nextPosition + enabledSlideIndexes.length) % enabledSlideIndexes.length]);
  }
  async function initializeUserSettings() {
    try {
      const response = await fetch("/api/session", { credentials: "include" });
      const session = await response.json().catch(() => ({}));
      if (response.ok && session?.authenticated) {
        currentUserKey = String(session.email || session.username || session.name || "local").toLowerCase();
        window.__ckTvUserLabel = String(session.email || session.username || session.name || "kullanıcı");
      }
    } catch {
      currentUserKey = "local";
      window.__ckTvUserLabel = "yerel";
    }
    window.__ckTvUserKey = currentUserKey;
    if (typeof window.__ckTvReloadSettings === "function") {
      window.__ckTvReloadSettings();
      return;
    }
    loadSettings();
    applySettings();
  }
  navButtons.forEach((button) => button.addEventListener("click", () => showSlide(Number(button.dataset.target))));
  $("tvLive")?.addEventListener("click", showAlerts);
  $("tvAlertClose")?.addEventListener("click", hideAlerts);
  $("tvAlertPanel")?.addEventListener("click", (event) => { if (event.target === $("tvAlertPanel")) hideAlerts(); });
  document.querySelector(".tv-stage")?.addEventListener("touchstart", (event) => {
    const touch = event.changedTouches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
  }, { passive: true });
  document.querySelector(".tv-stage")?.addEventListener("touchend", (event) => {
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - touchStartX;
    const deltaY = touch.clientY - touchStartY;
    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
    stepSlide(deltaX < 0 ? 1 : -1);
  }, { passive: true });
  $("tvPause").addEventListener("click", () => { paused = !paused; $("tvPause").textContent = paused ? "Devam et" : "Duraklat"; $("tvPause").setAttribute("aria-pressed", String(paused)); scheduleRotation(); });
  $("tvFullscreen").addEventListener("click", async () => { if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.(); else await document.exitFullscreen?.(); });
  document.addEventListener("fullscreenchange", () => { $("tvFullscreen").textContent = document.fullscreenElement ? "Tam ekrandan çık" : "Tam ekran"; });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideAlerts();
    if (event.key === "ArrowRight") stepSlide(1);
    if (event.key === "ArrowLeft") stepSlide(-1);
    if (event.key === " ") { event.preventDefault(); $("tvPause").click(); }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && Date.now() - lastLoadedAt >= DATA_REUSE_MS) load();
  });
  window.addEventListener("ck-tv-settings-change", (event) => {
    settings = normalizeSettings(event.detail || window.__ckTvSettings || {});
    paused = false;
    applySettings();
  });
  updateClock();
  setHeaderActionsReady(false);
  window.setInterval(updateClock, 1000);
  initializeUserSettings();
  const cached = readCachedReport(todayTR());
  if (cached) {
    lastLoadedAt = cached.savedAt;
    render(cached.report);
    $("tvLoading").classList.add("hidden");
    scheduleDataRefresh(cached.report);
  }
  if (!cached || Date.now() - cached.savedAt >= DATA_REUSE_MS) load();
})();
