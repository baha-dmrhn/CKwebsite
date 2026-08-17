(() => {
  "use strict";
  const byId = (id) => document.getElementById(id);
  const storagePrefix = "ck-tv-preferences:";
  const slideKeys = ["overview", "market", "dam", "production", "consumption", "currency"];
  const defaultProfile = "Varsayılan";

  const userKey = () => String(window.__ckTvUserKey || "local").toLowerCase();
  const userLabel = () => String(window.__ckTvUserLabel || "yerel").trim() || "yerel";
  const storageKey = () => `${storagePrefix}${userKey()}`;
  const normalize = (raw) => {
    const slides = [...new Set(Array.isArray(raw?.slides) ? raw.slides.filter((key) => slideKeys.includes(key)) : [])];
    const selected = slides.length ? slides : [...slideKeys];
    return { mode: raw?.mode === "fixed" ? "fixed" : "rotate", slides: selected, fixedSlide: selected.includes(raw?.fixedSlide) ? raw.fixedSlide : selected[0] };
  };
  const normalizeName = (value) => String(value || "").trim().replace(/\s+/g, " ").slice(0, 40) || defaultProfile;
  function normalizePreferences(raw) {
    const profiles = {};
    if (raw?.profiles && typeof raw.profiles === "object") Object.entries(raw.profiles).slice(0, 12).forEach(([name, settings]) => {
      const clean = normalizeName(name); if (!profiles[clean]) profiles[clean] = normalize(settings);
    });
    if (!Object.keys(profiles).length) profiles[defaultProfile] = normalize(raw);
    const activeProfile = profiles[normalizeName(raw?.activeProfile)] ? normalizeName(raw.activeProfile) : Object.keys(profiles)[0];
    return { activeProfile, profiles };
  }
  function safePreferences(raw) {
    let normalized;
    try { normalized = normalizePreferences(raw); } catch { normalized = null; }
    const profiles = normalized?.profiles && typeof normalized.profiles === "object"
      ? { ...normalized.profiles }
      : {};
    if (!Object.keys(profiles).length) profiles[defaultProfile] = normalize(null);
    const activeProfile = typeof normalized?.activeProfile === "string" && profiles[normalized.activeProfile]
      ? normalized.activeProfile
      : Object.keys(profiles)[0];
    return { activeProfile, profiles };
  }
  function readPreferences() { try { return safePreferences(JSON.parse(localStorage.getItem(storageKey()) || "null")); } catch { return safePreferences(null); } }
  function activeSettings(preferences) {
    const normalized = safePreferences(preferences);
    return normalized.profiles[normalized.activeProfile] || normalize(null);
  }
  function apply(preferences) {
    const normalized = safePreferences(preferences);
    try { localStorage.setItem(storageKey(), JSON.stringify(normalized)); } catch { /* local fallback */ }
    window.__ckTvPreferences = normalized;
    window.__ckTvSettings = activeSettings(normalized);
    window.dispatchEvent(new CustomEvent("ck-tv-settings-change", { detail: window.__ckTvSettings }));
    return normalized;
  }
  async function readServerPreferences() {
    const response = await fetch("/api/tv-settings", { credentials: "include" });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) return readPreferences();
    if (!response.ok) throw new Error(payload.error || "TV tercihleri okunamadı.");
    if (payload.userKey) window.__ckTvUserKey = payload.userKey;
    return apply(payload.preferences || { ["profiles"]: { [defaultProfile]: payload.settings }, activeProfile: defaultProfile });
  }
  async function saveServerPreferences(preferences) {
    const normalized = apply(preferences);
    const response = await fetch("/api/tv-settings", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preferences: normalized }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "TV tercihleri kaydedilemedi.");
    if (payload.userKey) window.__ckTvUserKey = payload.userKey;
    return apply(payload.preferences || normalized);
  }
  function currentPreferences() {
    return safePreferences(window.__ckTvPreferences || readPreferences());
  }
  function fillForm(preferences = currentPreferences()) {
    const normalized = safePreferences(preferences || currentPreferences());
    const settings = activeSettings(normalized);
    const profileSelect = byId("tvProfile");
    if (profileSelect) { profileSelect.innerHTML = Object.keys(normalized.profiles).map((name) => `<option value="${name.replace(/[&<>\"]/g, "")}">${name}</option>`).join(""); profileSelect.value = normalized.activeProfile; }
    document.querySelectorAll('input[name="tvSlide"]').forEach((input) => { input.checked = settings.slides.includes(input.value); });
    document.querySelectorAll('input[name="tvMode"]').forEach((input) => { input.checked = input.value === settings.mode; });
    if (byId("tvSettingsUser")) byId("tvSettingsUser").textContent = `Tercihler ${userLabel()} kullanıcısı için saklanır.`;
  }
  function formSettings() {
    const slides = [...document.querySelectorAll('input[name="tvSlide"]:checked')].map((input) => input.value);
    const mode = document.querySelector('input[name="tvMode"]:checked')?.value;
    return normalize({ mode, slides, fixedSlide: slides[0] });
  }
  function formPreferences() {
    const preferences = safePreferences(currentPreferences());
    const profiles = { ...(preferences.profiles || {}) };
    const profileName = typeof preferences.activeProfile === "string" && preferences.activeProfile.trim()
      ? preferences.activeProfile
      : Object.keys(profiles)[0] || defaultProfile;
    profiles[profileName] = formSettings();
    return safePreferences({ activeProfile: profileName, profiles });
  }
  function openPanel() { const panel = byId("tvSettingsPanel"); if (!panel) return; byId("tvLoading")?.classList.add("hidden"); byId("tvSettingsToggle").checked = true; setProfileCreatorOpen(false); fillForm(); panel.classList.add("open"); panel.setAttribute("aria-hidden", "false"); byId("tvSettings")?.setAttribute("aria-expanded", "true"); }
  function closePanel() { const panel = byId("tvSettingsPanel"); if (!panel) return; setProfileCreatorOpen(false); byId("tvSettingsToggle").checked = false; panel.classList.remove("open"); panel.setAttribute("aria-hidden", "true"); byId("tvSettings")?.setAttribute("aria-expanded", "false"); }
  async function persist(preferences) { try { return await saveServerPreferences(preferences); } catch (error) { if (byId("tvSettingsUser")) byId("tvSettingsUser").textContent = `${error.message || "Sunucuya ulaşılamadı."} Bu cihazdaki yedek uygulandı.`; return apply(preferences); } }
  function setStatus(message, state = "") { const status = byId("tvSettingsStatus"); if (!status) return; status.textContent = message; status.dataset.state = state; }
  function setProfileCreatorOpen(open) {
    const creator = byId("tvProfileCreator");
    const trigger = byId("tvProfileNew");
    if (creator) creator.hidden = !open;
    if (trigger) trigger.setAttribute("aria-expanded", String(open));
    if (open) byId("tvProfileName")?.focus();
  }
  function selectedProfileName() {
    const select = byId("tvProfile");
    return normalizeName(select?.value || defaultProfile);
  }
  async function saveAndApply() {
    const button = byId("tvSettingsSave");
    if (!button || button.disabled) return;
    button.disabled = true;
    button.textContent = "Kaydediliyor…";
    setStatus("Tercihler uygulanıyor…", "pending");
    try {
      const saved = await persist(formPreferences());
      fillForm(saved);
      setStatus("Kaydedildi ve uygulandı.", "success");
      window.setTimeout(closePanel, 220);
    } catch (error) {
      setStatus(error.message || "Tercihler uygulanamadı.", "error");
    } finally {
      button.disabled = false;
      button.textContent = "Kaydet ve uygula";
    }
  }
  function bindSettingsPanel() {
    byId("tvSettings")?.addEventListener("click", (event) => { event.preventDefault(); if (event.currentTarget.getAttribute("aria-disabled") === "true") return; byId("tvSettingsPanel")?.classList.contains("open") ? closePanel() : openPanel(); });
    byId("tvSettingsClose")?.addEventListener("click", closePanel);
    byId("tvProfile")?.addEventListener("change", async (event) => { const preferences = formPreferences(); preferences.activeProfile = normalizeName(event.target.value); fillForm(await persist(preferences)); });
    byId("tvProfileNew")?.addEventListener("click", () => {
      setProfileCreatorOpen(byId("tvProfileCreator")?.hidden);
    });
    byId("tvProfileAdd")?.addEventListener("click", async () => {
      const addButton = byId("tvProfileAdd");
      if (addButton?.disabled) return;
      const input = byId("tvProfileName");
      const typedName = String(input?.value || "").trim();
      if (!typedName) { setStatus("Yeni profil için bir ad yazın.", "error"); input?.focus(); return; }
      if (addButton) addButton.disabled = true;
      const name = normalizeName(typedName);
      try {
        // Seçiciyi anında güncelle; kayıt işlemi bu görünür adımı engellemez.
        const profileSelect = byId("tvProfile");
        if (profileSelect && ![...profileSelect.options].some((option) => option.value === name)) {
          profileSelect.add(new Option(name, name, true, true));
        }
        if (profileSelect) profileSelect.value = name;
        const preferences = safePreferences(formPreferences());
        if (!preferences.profiles[name]) preferences.profiles[name] = normalize(formSettings());
        preferences.activeProfile = name;
        fillForm(apply(preferences));
        if (input) input.value = "";
        setProfileCreatorOpen(false);
        setStatus(`“${name}” profili eklendi; hesabına kaydediliyor…`, "pending");
        fillForm(await saveServerPreferences(preferences));
        setStatus(`“${name}” profili eklendi.`, "success");
      } catch (error) {
        setStatus(`${error.message || "Kaydetme hatası."} Profil bu ekranda seçili kaldı.`, "error");
      } finally {
        if (addButton) addButton.disabled = false;
      }
    });
    byId("tvProfileDelete")?.addEventListener("click", async () => { const preferences = safePreferences(formPreferences()); const activeProfile = selectedProfileName(); if (Object.keys(preferences.profiles).length <= 1) return; delete preferences.profiles[activeProfile]; preferences.activeProfile = Object.keys(preferences.profiles)[0] || defaultProfile; fillForm(await persist(preferences)); });
    byId("tvSettingsSave")?.addEventListener("click", saveAndApply);
    byId("tvSettingsReset")?.addEventListener("click", async () => { const preferences = formPreferences(); preferences.profiles[preferences.activeProfile] = normalize(null); fillForm(await persist(preferences)); });
    byId("tvSettingsPanel")?.addEventListener("click", (event) => { if (event.target === byId("tvSettingsPanel")) closePanel(); });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") closePanel(); });
    apply(readPreferences());
  }
  window.__ckTvReloadSettings = async () => {
    const localPreferences = apply(readPreferences());
    fillForm(localPreferences);
    try {
      const serverPreferences = await readServerPreferences();
      fillForm(serverPreferences);
    } catch {
      fillForm(localPreferences);
    }
  };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", bindSettingsPanel) : bindSettingsPanel();
})();
