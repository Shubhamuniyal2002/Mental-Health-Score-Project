/* =========================================================
   MindScore — frontend logic (vanilla ES6+)

   Sections
     1. Configuration            (edit this first)
     2. Constants and helpers
     3. Google Sign-In + profile card
     4. Form: sliders, validation, payload
     5. FastAPI prediction request
     6. Result card (gauge, animated score, share)
     7. Leaderboard (localStorage)
     8. Boot

   IMPORTANT LIMITATIONS (also explained in the instructions):
   - Google Sign-In here is frontend-only. The browser receives a signed ID
     token from Google and we read the name, picture, email and unique id
     from it for DISPLAY. A page cannot securely verify that token on its
     own; real verification needs a server that checks the signature.
     Anyone who edits this page or its storage can pretend to be anyone.
   - The leaderboard is stored in this browser's localStorage. It is not
     shared between visitors and can be edited with browser dev tools.
   - We never store the Google ID token, and never send profile data to the
     prediction API.
   ========================================================= */
(() => {
  "use strict";

  /* -------------------------------------------------------
     1. CONFIGURATION
     ------------------------------------------------------- */
  const CONFIG = {
    // Web client ID from Google Cloud Console (APIs & Services > Credentials >
    // OAuth client ID > Web application). Looks like "1234-abcd.apps.googleusercontent.com".
    // This is public by design. NEVER put a client secret in this file.
    GOOGLE_CLIENT_ID: "",

    // Base URL of your FastAPI backend (no trailing slash).
    // 127.0.0.1 only works on your own computer; use the deployed URL when you publish.
    API_BASE_URL: "http://127.0.0.1:8000",

    // Firebase web config (Firebase console > Project settings > Your apps > Web app).
    // These values are public by design; security comes from the Firestore rules.
    // Leave apiKey empty to use this browser's local storage only.
    FIREBASE: {
      apiKey: "",
      authDomain: "",
      projectId: "",
      appId: "",
    },

    REQUEST_TIMEOUT_MS: 25000,   // free hosts can take a while to wake up
    GAUGE_MAX: 10,               // maximum possible score (the gauge ring is full at this value)
    LEADERBOARD_SIZE: 10,
    MAX_STORED_ENTRIES: 500,
  };

  const STORE = {
    board: "mindscore.leaderboard.v1",   // localStorage: [{id,name,picture,score,updatedAt}]
    session: "mindscore.session.v1",     // sessionStorage: signed-in profile (cleared when the tab closes)
    guest: "mindscore.guest.v1",         // localStorage: name typed in the form (no Google needed)
  };

  /* -------------------------------------------------------
     2. CONSTANTS AND HELPERS
     ------------------------------------------------------- */
  // Names and allowed values mirror the Pydantic model exactly.
  const NUMERIC = {
    Age:                     { min: 18, max: 100, int: true,  label: "Age" },
    Avg_Daily_Usage_Hours:   { min: 0,  max: 12,  int: false, label: "Daily social media use", slider: true },
    Daily_Unlocks:           { min: 0,  max: 200, int: true,  label: "Phone unlocks per day",  slider: true },
    Study_Hours:             { min: 0,  max: 10,  int: false, label: "Study hours" },
    Physical_Activity_Hours: { min: 0,  max: 3,   int: false, label: "Physical activity" },
    Sleep_Hours_Per_Night:   { min: 4,  max: 18,  int: false, label: "Sleep per night" },
  };
  const CHOICES = {
    Gender: ["Male", "Female"],
    Academic_Level: ["Undergraduate", "Graduate", "High School"],
    Most_Used_Platform: ["Facebook", "LinkedIn", "Instagram", "Snapchat", "Twitter", "YouTube", "TikTok", "LINE", "KakaoTalk", "VKontakte", "WhatsApp", "WeChat"],
    Purpose_Of_Use: ["Networking", "Education", "Entertainment", "News"],
    Stress_Level: ["Low", "Medium", "High", "Very High"],
  };
  const FIELD_ORDER = ["Name", "Age", "Gender", "Country", "Academic_Level", "Most_Used_Platform", "Purpose_Of_Use",
    "Avg_Daily_Usage_Hours", "Daily_Unlocks", "Study_Hours", "Physical_Activity_Hours", "Sleep_Hours_Per_Night", "Stress_Level"];
  const LABELS = {
    Name: "Name", Age: "Age", Gender: "Gender", Country: "Country", Academic_Level: "Academic level",
    Most_Used_Platform: "Most used platform", Purpose_Of_Use: "Purpose of use",
    Avg_Daily_Usage_Hours: "Daily social media use", Daily_Unlocks: "Phone unlocks per day",
    Study_Hours: "Study hours", Physical_Activity_Hours: "Physical activity",
    Sleep_Hours_Per_Night: "Sleep per night", Stress_Level: "Stress level",
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const API_URL = CONFIG.API_BASE_URL.replace(/\/+$/, "");
  const scrollToEl = (el, block = "start") => el.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block });

  // Safe element builder: text always goes through textContent, never innerHTML.
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // Safe wrappers: storage can be blocked (private mode) or corrupted.
  const safeGet = (area, key) => { try { return area.getItem(key); } catch { return null; } };
  const safeSet = (area, key, value) => { try { area.setItem(key, value); return true; } catch { return false; } };
  const safeRemove = (area, key) => { try { area.removeItem(key); } catch { /* ignore */ } };

  // Toast notifications
  function toast(message, type = "success") {
    const box = $("#toasts");
    const t = el("div", `toast ${type}`);
    const icon = el("i", `fa-solid ${type === "error" ? "fa-circle-exclamation" : "fa-circle-check"}`);
    icon.setAttribute("aria-hidden", "true");
    t.append(icon, el("span", "", message));
    box.append(t);
    setTimeout(() => t.remove(), 4200);
  }

  // Avatar: Google picture if it looks safe, otherwise initials (or a user icon for guests)
  function isSafePicture(url) {
    try {
      const u = new URL(url);
      return u.protocol === "https:" && /(^|\.)googleusercontent\.com$/.test(u.hostname);
    } catch { return false; }
  }
  function initialsOf(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    const letters = parts.slice(0, 2).map((p) => Array.from(p)[0]);
    return (letters.join("") || "?").toUpperCase();
  }
  function makeAvatar(name, picture, sizeClass, guest = false) {
    const a = el("div", `avatar ${sizeClass}`);
    a.setAttribute("aria-hidden", "true");
    const showInitials = () => { a.textContent = initialsOf(name); };
    if (guest) {
      a.classList.add("is-guest");
      const i = el("i", "fa-solid fa-user");
      a.append(i);
    } else if (picture && isSafePicture(picture)) {
      const img = document.createElement("img");
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.addEventListener("error", () => { img.remove(); showInitials(); });
      img.src = picture;
      a.append(img);
    } else {
      showInitials();
    }
    return a;
  }

  /* -------------------------------------------------------
     3. GOOGLE SIGN-IN + PROFILE CARD
     ------------------------------------------------------- */
  let profile = null;   // { id, name, email, picture } or null

  // Decode the payload of a JWT (no signature check is possible here).
  function decodeJwtPayload(token) {
    try {
      const part = String(token).split(".")[1];
      const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch { return null; }
  }

  // Sanity checks on the claims. This is NOT a security guarantee (see header comment).
  function profileFromClaims(c) {
    if (!c || typeof c !== "object") return null;
    const issuerOk = c.iss === "https://accounts.google.com" || c.iss === "accounts.google.com";
    const audienceOk = c.aud === CONFIG.GOOGLE_CLIENT_ID;
    const notExpired = typeof c.exp === "number" && c.exp * 1000 > Date.now();
    if (!issuerOk || !audienceOk || !notExpired || typeof c.sub !== "string" || !c.sub) return null;
    return {
      id: c.sub,                                                             // stable Google account id
      name: typeof c.name === "string" && c.name.trim() ? c.name.trim().slice(0, 80) : "Google user",
      email: typeof c.email === "string" ? c.email : "",
      picture: typeof c.picture === "string" ? c.picture : "",
    };
  }

  function loadSession() {
    const read = (area, key) => {
      try {
        const p = JSON.parse(safeGet(area, key) || "null");
        if (p && typeof p.id === "string" && typeof p.name === "string") {
          return { id: p.id, name: p.name, email: String(p.email || ""), picture: String(p.picture || "") };
        }
      } catch { /* ignore */ }
      return null;
    };
    return read(sessionStorage, STORE.session) || read(localStorage, STORE.guest);
  }

  function setAuthNote(message, isError = false) {
    const note = $("#authNote");
    note.replaceChildren();
    if (!message) { note.hidden = true; return; }
    note.hidden = false;
    note.classList.toggle("is-error", isError);
    // message may be a string or an array of nodes/strings
    note.append(...(Array.isArray(message) ? message : [message]));
  }

  function renderProfile() {
    const avatarSlot = $("#profileAvatar");
    avatarSlot.replaceWith(Object.assign(
      makeAvatar(profile?.name, profile?.picture, "avatar-lg", !profile),
      { id: "profileAvatar" }
    ));
    $("#profileName").textContent = profile ? profile.name : "Guest";
    $("#profileEmail").textContent = profile ? (profile.email || (profile.id.startsWith("name:") ? "Playing as a guest" : "Signed in with Google")) : "Not signed in";
    $("#gsiButton").hidden = Boolean(profile) || !CONFIG.GOOGLE_CLIENT_ID;
    $("#btnSignOut").hidden = !profile;
    if (profile) setAuthNote("");
    renderBoard();
  }

  function onCredential(response) {
    const claims = decodeJwtPayload(response && response.credential);
    const p = profileFromClaims(claims);
    // The token itself is dropped here; only the display profile is kept.
    if (!p) {
      setAuthNote("Google sign-in could not be confirmed for this app. Check that your OAuth client ID is correct and try again.", true);
      toast("Sign-in failed", "error");
      return;
    }
    profile = p;
    safeSet(sessionStorage, STORE.session, JSON.stringify(profile));
    renderProfile();
    toast(`Signed in as ${profile.name}`);
  }

  function signOut() {
    try { window.google?.accounts?.id?.disableAutoSelect(); } catch { /* ignore */ }
    profile = null;
    safeRemove(sessionStorage, STORE.session);
    safeRemove(localStorage, STORE.guest);
    renderProfile();
    toast("Signed out");
  }

  function initGoogle() {
    if (!CONFIG.GOOGLE_CLIENT_ID) {
      $("#gsiButton").hidden = true;   // Google not configured: the name + email form is used instead
      return;
    }
    const start = () => {
      try {
        window.google.accounts.id.initialize({
          client_id: CONFIG.GOOGLE_CLIENT_ID,
          callback: onCredential,
          auto_select: false,
          cancel_on_tap_outside: true,
        });
        window.google.accounts.id.renderButton($("#gsiButton"), {
          type: "standard", theme: "outline", size: "large", text: "continue_with",
          shape: "pill", logo_alignment: "left", width: 280,
        });
      } catch {
        setAuthNote("Google Sign-In failed to start. Check your client ID and that this page's address is an authorized JavaScript origin.", true);
      }
    };
    if (window.google?.accounts?.id) { start(); return; }
    const script = $("#gsiScript");
    script.addEventListener("load", start);
    script.addEventListener("error", () => setAuthNote("Google Sign-In couldn't load. Check your internet connection or ad blocker and reload the page.", true));
  }

  /* -------------------------------------------------------
     4. FORM
     ------------------------------------------------------- */
  const form = $("#predictForm");
  const fieldWrap = (name) => $(`#err-${name}`)?.closest(".field");

  function setError(name, message) {
    fieldWrap(name)?.classList.toggle("has-error", Boolean(message));
    const slot = $(`#err-${name}`);
    if (slot) slot.textContent = message || "";
  }
  function clearErrors() {
    FIELD_ORDER.forEach((n) => setError(n, ""));
    const a = $("#formAlert"); a.hidden = true; a.replaceChildren();
  }
  function showFormAlert(title, items = []) {
    const a = $("#formAlert");
    a.replaceChildren();
    const icon = el("i", "fa-solid fa-circle-exclamation"); icon.setAttribute("aria-hidden", "true");
    const body = el("div");
    body.append(el("strong", "", title));
    if (items.length) {
      const ul = el("ul");
      items.forEach((it) => ul.append(typeof it === "string" ? el("li", "", it) : it));
      body.append(ul);
    }
    a.append(icon, body);
    a.hidden = false;
    scrollToEl(a, "center");
  }

  // Sliders show "Not set" until touched, so nothing is submitted by accident.
  function initSliders() {
    $$(".range").forEach((range) => {
      const out = $(`#out-${range.id}`);
      const unit = range.dataset.unit || "";
      range.classList.add("is-unset");
      const paint = () => {
        range.style.setProperty("--p", ((range.value - range.min) / (range.max - range.min)) * 100 + "%");
        if (range.dataset.touched) {
          out.textContent = range.value + unit;
          out.classList.remove("is-unset");
          range.classList.remove("is-unset");
        }
      };
      const touch = () => { range.dataset.touched = "1"; paint(); setError(range.id, ""); };
      range.addEventListener("input", touch);
      range.addEventListener("pointerup", touch);   // allows choosing 0 explicitly
      range.addEventListener("keydown", (e) => { if (e.key === "Home" || e.key === "End") setTimeout(touch); });
      paint();
    });
  }

  function validateField(name) {
    if (name === "Name") {
      const v = $("#Name").value.trim();
      if (!v) return "Enter your name.";
      if (v.length < 2) return "Name must be at least 2 characters.";
      return null;
    }
    if (name === "Country") {
      const v = $("#Country").value;
      if (!v) return "Select your country.";
      if (v === "Other" && !$("#CountryOther").value.trim()) return "Enter your country name.";
      return null;
    }
    if (name === "Most_Used_Platform") {
      return CHOICES[name].includes($("#Most_Used_Platform").value) ? null : "Select a platform.";
    }
    if (CHOICES[name]) {
      const checked = form.querySelector(`input[name="${name}"]:checked`);
      return checked && CHOICES[name].includes(checked.value) ? null : "Choose one option.";
    }
    const rule = NUMERIC[name];
    const input = form.elements[name];
    if (rule.slider && !input.dataset.touched) return "Move the slider to set a value.";
    const raw = String(input.value).trim();
    if (raw === "") return "Enter a value.";
    const n = Number(raw);
    if (!Number.isFinite(n)) return "Enter a number.";
    if (rule.int && !Number.isInteger(n)) return "Use a whole number.";
    if (n < rule.min || n > rule.max) return `${rule.label} must be between ${rule.min} and ${rule.max}.`;
    return null;
  }

  function focusField(name) {
    let target;
    if (name === "Country") target = ($("#Country").value === "Other" && !$("#CountryOther").value.trim()) ? $("#CountryOther") : $("#Country");
    else target = form.querySelector(`[name="${name}"]`);
    target?.focus();
    if (target) scrollToEl(target, "center");
  }

  // Exactly the 12 fields the API expects. No profile data goes in here.
  function collectPayload() {
    const num = (n) => Number(form.elements[n].value);
    const radio = (n) => form.querySelector(`input[name="${n}"]:checked`).value;
    return {
      Age: num("Age"),
      Gender: radio("Gender"),
      Country: $("#Country").value === "Other" ? $("#CountryOther").value.trim() : $("#Country").value,
      Academic_Level: radio("Academic_Level"),
      Most_Used_Platform: $("#Most_Used_Platform").value,
      Purpose_Of_Use: radio("Purpose_Of_Use"),
      Avg_Daily_Usage_Hours: num("Avg_Daily_Usage_Hours"),
      Daily_Unlocks: num("Daily_Unlocks"),
      Study_Hours: num("Study_Hours"),
      Physical_Activity_Hours: num("Physical_Activity_Hours"),
      Sleep_Hours_Per_Night: num("Sleep_Hours_Per_Night"),
      Stress_Level: radio("Stress_Level"),
    };
  }

  function resetForm() {
    form.reset();
    $$(".range").forEach((r) => {
      delete r.dataset.touched;
      r.value = r.min;
      r.classList.add("is-unset");
      r.style.setProperty("--p", "0%");
      const out = $(`#out-${r.id}`);
      out.textContent = "Not set";
      out.classList.add("is-unset");
    });
    $("#countryOtherWrap").hidden = true;
    clearErrors();
  }

  function initForm() {
    initSliders();
    $("#Country").addEventListener("change", (e) => {
      $("#countryOtherWrap").hidden = e.target.value !== "Other";
      if (e.target.value === "Other") $("#CountryOther").focus();
    });
    form.addEventListener("input", (e) => {
      const name = e.target.name || (e.target.id === "CountryOther" ? "Country" : "");
      if (name) setError(name, "");
    });
    $("#btnReset").addEventListener("click", () => { resetForm(); hideResult(); });
    $("#btnTryAgain").addEventListener("click", () => { hideResult(); resetForm(); scrollToEl($("#predict")); });
    $("#btnSignOut").addEventListener("click", signOut);
    $("#btnShare").addEventListener("click", shareResult);
    form.addEventListener("submit", onSubmit);
  }

  /* -------------------------------------------------------
     5. FASTAPI PREDICTION REQUEST
     ------------------------------------------------------- */
  let submitting = false;

  async function checkApi() {
    const pill = $("#apiStatus"), text = $("#apiStatusText");
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(API_URL + "/", { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error();
      pill.className = "api-status is-up";
      text.textContent = "Prediction API is online";
    } catch {
      pill.className = "api-status is-down";
      text.textContent = "Prediction API is not reachable. Start the FastAPI server first.";
    }
  }

  async function requestPrediction(payload) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CONFIG.REQUEST_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(API_URL + "/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      throw { kind: err && err.name === "AbortError" ? "timeout" : "network" };
    }
    clearTimeout(timer);

    let body = null;
    try { body = await res.json(); } catch { /* not JSON */ }
    if (res.status === 422) throw { kind: "validation", detail: body && body.detail };
    if (!res.ok) throw { kind: "http", status: res.status };
    if (!body || typeof body.Mental_Health_Score !== "number" || !Number.isFinite(body.Mental_Health_Score)) throw { kind: "invalid" };
    return body.Mental_Health_Score;
  }

  function reportError(err) {
    const code = (t) => el("code", "", t);
    const li = (...parts) => { const n = el("li"); n.append(...parts); return n; };
    switch (err.kind) {
      case "network":
        showFormAlert("Could not reach the prediction API.", [
          li("Start your FastAPI server (", code("uvicorn main:app --reload"), ")."),
          li("Check the API address in script.js: ", code(API_URL)),
          li("If this page is online, the backend must be deployed too and must allow this site in CORS."),
        ]);
        $("#apiStatus").className = "api-status is-down";
        $("#apiStatusText").textContent = "Prediction API is not reachable.";
        break;
      case "timeout":
        showFormAlert("The API took too long to respond.", ["If your backend is on free hosting it may be waking up. Try again in a minute."]);
        break;
      case "invalid":
        showFormAlert("The API answered, but not with a usable score.", [li("Expected JSON like ", code('{"Mental_Health_Score": 72.45}'), ".")]);
        break;
      case "http":
        showFormAlert(`The API returned an error (HTTP ${err.status}).`, ["Check the terminal running uvicorn for details."]);
        break;
      case "validation": {
        const items = (Array.isArray(err.detail) ? err.detail : []).map((d) => {
          const field = Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : "";
          if (LABELS[field]) setError(field, String(d.msg || "Invalid value"));
          return `${LABELS[field] || field || "Request"}: ${d.msg || "invalid value"}`;
        });
        showFormAlert("The API rejected some values.", items.length ? items : ["Check the values and try again."]);
        break;
      }
      default:
        showFormAlert("Something went wrong. Please try again.");
    }
    toast("Prediction failed", "error");
  }

  function setLoading(on) {
    submitting = on;
    const btn = $("#btnSubmit");
    btn.disabled = on;
    btn.classList.toggle("is-loading", on);
    btn.setAttribute("aria-busy", String(on));
    $(".btn-label", btn).textContent = on ? "Calculating…" : "Calculate My MindScore";
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (submitting) return;                     // block duplicate submissions
    clearErrors();

    const bad = FIELD_ORDER.filter((n) => { const m = validateField(n); setError(n, m); return m; });
    if (bad.length) {
      showFormAlert(`Please fix ${bad.length} ${bad.length === 1 ? "field" : "fields"} before calculating.`);
      focusField(bad[0]);
      return;
    }

    setLoading(true);
    try {
      const score = await requestPrediction(collectPayload());
      onPredictionSuccess(score);
    } catch (err) {
      reportError(err);                         // no leaderboard entry on failure
    } finally {
      setLoading(false);
    }
  }

  /* -------------------------------------------------------
     6. RESULT CARD
     ------------------------------------------------------- */
  const CIRC = 2 * Math.PI * 84;
  let lastScore = null;

  async function onPredictionSuccess(score) {
    lastScore = score;
    const note = $("#saveNote");
    note.className = "save-note";
    note.textContent = "Saving your score…";
    showResult(score);

    const name = $("#Name").value.trim().slice(0, 60);
    // Google-signed-in visitors keep their account id; everyone else is identified by name.
    if (!profile || profile.id.startsWith("name:")) {
      profile = { id: "name:" + name.toLowerCase(), name, email: "", picture: "" };
      safeSet(localStorage, STORE.guest, JSON.stringify(profile));
    } else {
      profile = { ...profile, name };
    }
    const savedLocal = upsertEntry(profile, score);   // fallback copy
    const savedRemote = await postScore(name, score);

    if (savedRemote) {
      note.textContent = `Saved to the shared leaderboard as ${name}.`;
      note.classList.add("ok");
      toast("Leaderboard updated");
    } else if (savedLocal) {
      note.textContent = "The shared leaderboard couldn't be reached, so your score was saved on this browser only. Other people won't see it.";
    } else {
      note.textContent = "Your score couldn't be saved.";
    }
    renderProfile();   // also redraws the leaderboard
  }

  function showResult(score) {
    const box = $("#result");
    box.hidden = false;
    $("#gaugeMax").textContent = CONFIG.GAUGE_MAX;
    const fill = $("#gaugeFill");
    const ratio = Math.max(0, Math.min(1, score / CONFIG.GAUGE_MAX));
    fill.style.strokeDasharray = CIRC;
    fill.style.strokeDashoffset = CIRC;
    requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.strokeDashoffset = CIRC * (1 - ratio); }));
    $("#gaugeSvg").setAttribute("aria-label", `Your MindScore is ${score.toFixed(2)}`);
    animateCount($("#scoreNum"), score);
    scrollToEl(box);
    box.focus({ preventScroll: true });
  }

  function hideResult() { $("#result").hidden = true; lastScore = null; }

  function animateCount(node, target) {
    const fmt = (v) => v.toFixed(2);
    if (reduceMotion()) { node.textContent = fmt(target); return; }
    const t0 = performance.now(), dur = 1500;
    const tick = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      node.textContent = fmt(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) requestAnimationFrame(tick); else node.textContent = fmt(target);
    };
    requestAnimationFrame(tick);
  }

  async function shareResult() {
    const text = lastScore !== null ? `I got a MindScore of ${lastScore.toFixed(2)}. Try MindScore, a machine learning project.` : "Try MindScore, a machine learning project.";
    const data = { title: "MindScore", text, url: location.href };
    try {
      if (navigator.share) { await navigator.share(data); return; }
      await navigator.clipboard.writeText(`${text} ${location.href}`);
      toast("Link copied to clipboard");
    } catch (err) {
      if (err && err.name === "AbortError") return;     // user closed the share sheet
      toast("Couldn't share. Copy the address bar link instead.", "error");
    }
  }

  /* -------------------------------------------------------
     7. LEADERBOARD (localStorage, one entry per Google account id)
     ------------------------------------------------------- */
  function loadBoard() {
    let list = [];
    try { list = JSON.parse(safeGet(localStorage, STORE.board) || "[]"); } catch { list = []; }
    if (!Array.isArray(list)) return [];
    return list
      .filter((e) => e && typeof e.id === "string" && typeof e.name === "string" && typeof e.score === "number" && Number.isFinite(e.score))
      .map((e) => ({ id: e.id, name: e.name.slice(0, 80), picture: typeof e.picture === "string" ? e.picture : "", score: e.score, updatedAt: Number(e.updatedAt) || 0 }));
  }

  const byRank = (a, b) => b.score - a.score || b.updatedAt - a.updatedAt || a.name.localeCompare(b.name);

  // Replace the participant's score (never add a duplicate). Returns false if storage is unavailable.
  function upsertEntry(p, score) {
    const map = new Map(loadBoard().map((e) => [e.id, e]));
    map.set(p.id, { id: p.id, name: p.name, picture: p.picture, score, updatedAt: Date.now() });
    const list = [...map.values()].sort(byRank).slice(0, CONFIG.MAX_STORED_ENTRIES);
    return safeSet(localStorage, STORE.board, JSON.stringify(list));
  }

  // Shared leaderboard lives on the FastAPI server; this browser's copy is only a fallback.
  const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

  // ---- Firebase Firestore (shared leaderboard, works from GitHub Pages) ----
  let fsDb = null;
  function getDb() {
    if (fsDb) return fsDb;
    const f = CONFIG.FIREBASE;
    if (!f.apiKey || !f.projectId || typeof firebase === "undefined") return null;
    if (!firebase.apps.length) firebase.initializeApp(f);
    fsDb = firebase.firestore();
    return fsDb;
  }
  const docIdFor = (name) => name.trim().toLowerCase().replace(/[\/\\.#$\[\]]/g, "_").slice(0, 60);
  const withTimeout = (p, ms = 8000) =>
    Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

  async function fetchFirebaseBoard() {
    const db = getDb();
    if (!db) throw new Error("not configured");
    const snap = await withTimeout(db.collection("scores").orderBy("score", "desc").limit(CONFIG.MAX_STORED_ENTRIES).get());
    const all = snap.docs
      .map((d) => d.data())
      .filter((e) => typeof e.name === "string" && Number.isFinite(e.score))
      .sort((a, b) => b.score - a.score || (a.updatedAt || 0) - (b.updatedAt || 0));
    const idx = profile ? all.findIndex((e) => sameName(e.name, profile.name)) : -1;
    return {
      shared: true,
      top: all.slice(0, CONFIG.LEADERBOARD_SIZE).map((e) => ({ name: e.name, score: e.score })),
      me: idx >= 0 ? { rank: idx + 1, name: all[idx].name, score: all[idx].score } : null,
    };
  }

  function localBoard() {
    const all = loadBoard().sort(byRank);
    const idx = profile ? all.findIndex((e) => e.id === profile.id) : -1;
    return {
      shared: false,
      top: all.slice(0, CONFIG.LEADERBOARD_SIZE).map((e) => ({ name: e.name, score: e.score })),
      me: idx >= 0 ? { rank: idx + 1, name: all[idx].name, score: all[idx].score } : null,
    };
  }

  async function postFirebaseScore(name, score) {
    try {
      const db = getDb();
      if (!db) return false;
      await withTimeout(db.collection("scores").doc(docIdFor(name)).set({ name, score, updatedAt: Date.now() }));
      return true;
    } catch { return false; }
  }

  // ---- FastAPI (leaderboard routes inside main.py) ----
  async function fetchApiBoard() {
    const q = new URLSearchParams({ limit: String(CONFIG.LEADERBOARD_SIZE) });
    if (profile) q.set("name", profile.name);
    const res = await withTimeout(fetch(`${API_URL}/leaderboard?${q}`, { headers: { Accept: "application/json" } }), 20000);
    if (!res.ok) throw new Error("bad status");
    const body = await res.json();
    if (!body || !Array.isArray(body.top)) throw new Error("bad body");
    return {
      shared: true,
      top: body.top.map((e) => ({ name: String(e.name), score: Number(e.score) })),
      me: body.me ? { rank: Number(body.me.rank), name: String(body.me.name), score: Number(body.me.score) } : null,
    };
  }

  async function postApiScore(name, score) {
    try {
      const res = await withTimeout(fetch(API_URL + "/leaderboard", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ name, score }),
      }), 20000);
      return res.ok;
    } catch { return false; }
  }

  // Firebase is used when its config is filled in; otherwise the FastAPI routes in main.py are used.
  const useFirebase = () => Boolean(CONFIG.FIREBASE.apiKey && CONFIG.FIREBASE.projectId);
  const fetchRemoteBoard = () => (useFirebase() ? fetchFirebaseBoard() : fetchApiBoard());
  const postScore = (name, score) => (useFirebase() ? postFirebaseScore(name, score) : postApiScore(name, score));

  let boardSeq = 0;
  async function renderBoard() {
    const seq = ++boardSeq;
    let data;
    try { data = await fetchRemoteBoard(); } catch { data = localBoard(); }
    if (seq !== boardSeq) return;   // a newer render is already running
    drawBoard(data);
  }

  function drawBoard(data) {
    const top = data.top;
    const list = $("#boardList");
    list.replaceChildren();
    $("#boardEmpty").hidden = top.length > 0;
    list.hidden = top.length === 0;
    $(".lb-cols").hidden = top.length === 0;

    top.forEach((entry, i) => {
      const rank = i + 1;
      const isMe = profile && sameName(profile.name, entry.name);
      const cls = rank === 1 ? " gold" : rank === 2 ? " silver" : rank === 3 ? " bronze" : "";
      const row = el("li", "lb-row" + cls + (isMe ? " is-me" : ""));
      row.style.animationDelay = `${i * 40}ms`;

      const rankCell = el("span", "rank-cell");
      if (rank <= 3) {
        const crown = el("span", "crown " + ["gold", "silver", "bronze"][i]);
        const icon = el("i", "fa-solid fa-crown"); icon.setAttribute("aria-hidden", "true");
        crown.append(icon, el("b", "", String(rank)));
        rankCell.append(crown);
      } else {
        rankCell.textContent = String(rank);
      }

      const name = el("span", "name-cell", entry.name);
      if (isMe) name.append(el("span", "you", "You"));
      const score = el("span", "score-cell");
      score.append(el("span", "pill-score", entry.score.toFixed(2)));
      row.append(rankCell, name, score);
      list.append(row);
    });

    // Visitor outside the top 10: show their own row below the table
    const me = $("#myRank");
    me.replaceChildren();
    if (data.me && data.me.rank > CONFIG.LEADERBOARD_SIZE) {
      const score = el("span", "score-cell"); score.append(el("span", "pill-score", data.me.score.toFixed(2)));
      me.append(el("span", "rank-bubble", String(data.me.rank)), el("span", "name-cell", data.me.name), score);
      me.hidden = false;
    } else {
      me.hidden = true;
    }

    const warn = $("#boardWarn");
    if (warn) warn.hidden = data.shared;
  }

  /* -------------------------------------------------------
     8. BOOT
     ------------------------------------------------------- */
  function boot() {
    $("#apiUrlShown").textContent = API_URL + "/predict";
    profile = loadSession();
    initForm();
    renderProfile();            // also renders the leaderboard
    initGoogle();
    checkApi();
    // Keep the board in sync across tabs
    window.addEventListener("storage", (e) => { if (e.key === STORE.board) renderBoard(); });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) renderBoard(); });
  }
  boot();
})();
