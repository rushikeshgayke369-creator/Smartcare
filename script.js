/* =========================================================
   SmartCare — script.js  (patient website, Supabase version)

   1. Config, Supabase client & state
   2. Helpers
   3. API layer   (every database call lives here)
   4. Auth        (sign up / log in / log out)
   5. Queue maths (position + estimated time)
   6. Rendering
   7. Receipt (print / download)
   8. Forms       (registration, token lookup)
   9. UI          (nav, theme, dialog, toast)
  10. Init + polling

   How privacy works:
   - The public queue comes from the database function get_public_queue(),
     which returns MASKED names only (no age / mobile / reason).
   - A logged-in patient reads ONLY their own rows (Row Level Security).
   - New visits are created ONLY by register_patient(), which re-validates
     everything on the server.
   Rules for all of this live in database/smartcare_setup.sql.
   ========================================================= */
"use strict";

/* ---------- 1. Config, client, state ---------- */
const CFG = window.SMARTCARE_CONFIG || {};
const AVG_MIN = CFG.AVG_MIN_PER_PATIENT || 5;
const POLL_MS = 5000;
const STATUS = { WAITING: "Waiting", SERVING: "Serving", DONE: "Completed" };

const sb = window.supabase && CFG.SUPABASE_URL
  ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    })
  : null;

const state = {
  user: null,          // Supabase auth user
  profile: null,       // { full_name, mobile, role }
  queue: [],           // public, masked queue rows
  myVisits: [],        // the logged-in patient's own rows
  notices: [],
  registered: 0,
  lookup: null,        // { token, error }
  online: true
};

const ICONS = {
  gm:  '<path d="M6 3v6a4 4 0 0 0 8 0V3"/><path d="M10 13v2a4 4 0 0 0 8 0v-1"/><circle cx="18" cy="12" r="2"/>',
  car: '<path d="M12 21s-7-4.6-9.3-9A5.3 5.3 0 0 1 12 6.5 5.3 5.3 0 0 1 21.3 12C19 16.4 12 21 12 21z"/>',
  der: '<path d="M12 3s6 6.2 6 10.5A6 6 0 0 1 6 13.5C6 9.2 12 3 12 3z"/>',
  ort: '<path d="M8 16l8-8"/><circle cx="6.3" cy="14.3" r="2"/><circle cx="9.7" cy="17.7" r="2"/><circle cx="14.3" cy="6.3" r="2"/><circle cx="17.7" cy="9.7" r="2"/>',
  ped: '<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2.5 4 2.5S16 14 16 14"/><path d="M9 9.5h.01M15 9.5h.01"/>',
  ent: '<path d="M7 9a5 5 0 0 1 10 0c0 3-3 3.5-3 6.5a2.5 2.5 0 0 1-5 0"/><path d="M10 9a2 2 0 0 1 4 0"/>'
};

const DEPARTMENTS = [
  { name: "General Medicine", icon: "gm",  desc: "Everyday health concerns, fever, checkups and referrals.",  bg: "linear-gradient(135deg,#16B5AA,#0B7F78)" },
  { name: "Cardiology",       icon: "car", desc: "Heart and blood-pressure care, ECG and follow-ups.",         bg: "linear-gradient(135deg,#E0566B,#A8324A)" },
  { name: "Dermatology",      icon: "der", desc: "Skin, hair and nail conditions and consultations.",          bg: "linear-gradient(135deg,#8E6CD8,#5B3FA8)" },
  { name: "Orthopedics",      icon: "ort", desc: "Bones, joints and muscles — injuries and mobility care.",    bg: "linear-gradient(135deg,#3B82C4,#123B5D)" },
  { name: "Pediatrics",       icon: "ped", desc: "Friendly care for infants, children and teenagers.",         bg: "linear-gradient(135deg,#F0A33A,#C7741A)" },
  { name: "ENT",              icon: "ent", desc: "Ear, nose and throat checkups and treatment.",               bg: "linear-gradient(135deg,#2FA37A,#16694E)" }
];

/* ---------- 2. Helpers ---------- */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
/* Only touch the DOM when the HTML really changed (keeps keyboard focus during auto-refresh). */
function setHTML(el, html) {
  if (el && el.dataset.last !== html) { el.innerHTML = html; el.dataset.last = html; }
}
function normalizeToken(raw) {
  const m = String(raw).trim().toUpperCase().match(/^A-?(\d{1,6})$/);
  return m ? "A-" + String(parseInt(m[1], 10)).padStart(3, "0") : null;
}
function fmtTime(iso) {
  try { return new Date(iso).toLocaleString([], { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch (e) { return iso; }
}
const ts = v => new Date(v).getTime();

const validEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
const validMobile = v => /^[6-9]\d{9}$/.test(v);
const validName = v => /^[\p{L}][\p{L}\s.'-]{1,59}$/u.test(v.trim());
const validPassword = v => v.length >= 8 && /[A-Za-z]/.test(v) && /\d/.test(v);

function setError(fieldId, message) {
  const input = document.getElementById(fieldId);
  const err = document.getElementById("err-" + fieldId);
  if (err) err.textContent = message || "";
  if (input) { message ? input.setAttribute("aria-invalid", "true") : input.removeAttribute("aria-invalid"); }
  return !message;
}
function clearErrors(form) {
  $$(".field-error", form).forEach(e => (e.textContent = ""));
  $$("[aria-invalid]", form).forEach(i => i.removeAttribute("aria-invalid"));
}

let toastTimer;
function toast(message, ms = 3200) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}
function busy(btn, isBusy, label) {
  if (!btn) return;
  if (isBusy) { btn.dataset.label = btn.innerHTML; btn.textContent = label || "Please wait…"; }
  else if (btn.dataset.label) { btn.innerHTML = btn.dataset.label; }
  btn.disabled = isBusy;
}

/* ---------- 3. API layer (the only place that talks to Supabase) ---------- */
const Api = {
  async queue() {
    const { data, error } = await sb.rpc("get_public_queue");
    if (error) throw error;
    return data || [];
  },
  async registeredCount() {
    const { data, error } = await sb.rpc("get_registered_count");
    if (error) throw error;
    return data || 0;
  },
  async notices() {
    const { data, error } = await sb.from("announcements").select("id, kind, message, is_active, created_at")
      .eq("is_active", true).order("created_at", { ascending: false }).limit(6);
    if (error) throw error;
    return data || [];
  },
  async myVisits() {
    const { data, error } = await sb.from("patients").select("*")
      .eq("user_id", state.user.id).order("created_at", { ascending: false }).limit(50);
    if (error) throw error;
    return data || [];
  },
  async profile(id) {
    const { data } = await sb.from("profiles").select("full_name, mobile, role").eq("id", id).maybeSingle();
    return data || null;
  },
  async register(p) {
    const { data, error } = await sb.rpc("register_patient", p);
    if (error) throw error;
    return Array.isArray(data) ? data[0] : data;
  }
};

/* ---------- 4. Auth ---------- */
let failedLogins = 0;
let lockedUntil = 0;

async function loadSession() {
  const { data } = await sb.auth.getSession();
  state.user = data && data.session ? data.session.user : null;
  state.profile = state.user ? await Api.profile(state.user.id) : null;
  if (!state.user) { state.myVisits = []; state.lookup = null; }
}

function friendlyAuthError(error) {
  const m = (error && error.message) || "Something went wrong.";
  if (/invalid login/i.test(m)) return "Incorrect email or password.";
  if (/not confirmed/i.test(m)) return "Please confirm your email first — check your inbox, then log in.";
  if (/already registered|already exists/i.test(m)) return "An account with this email already exists. Please log in.";
  if (/rate limit|too many/i.test(m)) return "Too many attempts. Please wait a minute and try again.";
  if (/password/i.test(m) && /weak|least/i.test(m)) return "Please choose a stronger password.";
  return m;
}

async function handleSignup(e) {
  e.preventDefault();
  const form = e.currentTarget;
  clearErrors(form);
  const name = $("#signupName").value.trim(), mobile = $("#signupMobile").value.trim();
  const email = $("#signupEmail").value.trim(), pw = $("#signupPassword").value, confirm = $("#signupConfirm").value;
  let ok = true;
  ok = setError("signupName", validName(name) ? "" : "Enter your full name (letters only).") && ok;
  ok = setError("signupMobile", validMobile(mobile) ? "" : "Enter a valid 10-digit mobile number.") && ok;
  ok = setError("signupEmail", validEmail(email) ? "" : "Enter a valid email address.") && ok;
  ok = setError("signupPassword", validPassword(pw) ? "" : "Use at least 8 characters with a letter and a number.") && ok;
  ok = setError("signupConfirm", pw === confirm ? "" : "Passwords do not match.") && ok;
  if (!ok) return;

  const btn = $("#signupSubmit");
  busy(btn, true, "Creating account…");
  try {
    const options = { data: { full_name: name, mobile } };
    if (/^https?:$/.test(location.protocol)) options.emailRedirectTo = location.origin + location.pathname;
    const { data, error } = await sb.auth.signUp({ email, password: pw, options });
    if (error) { $("#signupError").textContent = friendlyAuthError(error); return; }
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      $("#signupError").textContent = "An account with this email already exists. Please log in."; return;
    }
    form.reset();
    closeAuth();
    if (data.session) { toast("Account created. You are now logged in."); }
    else { toast("Account created. Please check your email to confirm it, then log in.", 7000); }
  } catch (err) {
    $("#signupError").textContent = "Could not reach the server. Check your internet connection.";
  } finally { busy(btn, false); }
}

async function handleLogin(e) {
  e.preventDefault();
  const form = e.currentTarget;
  clearErrors(form);
  $("#loginError").textContent = "";
  const email = $("#loginEmail").value.trim(), pw = $("#loginPassword").value;
  let ok = true;
  ok = setError("loginEmail", validEmail(email) ? "" : "Enter your email address.") && ok;
  ok = setError("loginPassword", pw ? "" : "Enter your password.") && ok;
  if (!ok) return;

  if (Date.now() < lockedUntil) {
    $("#loginError").textContent = "Too many attempts. Please wait " + Math.ceil((lockedUntil - Date.now()) / 1000) + " seconds.";
    return;
  }
  const btn = $("#loginSubmit");
  busy(btn, true, "Logging in…");
  try {
    const { error } = await sb.auth.signInWithPassword({ email, password: pw });
    if (error) {
      failedLogins++;
      if (failedLogins >= 5) { lockedUntil = Date.now() + 30000; failedLogins = 0; }
      $("#loginError").textContent = friendlyAuthError(error);
      return;
    }
    failedLogins = 0;
    form.reset();
    closeAuth();
    await loadSession();
    await refreshAll();
    toast("Welcome back" + (state.profile && state.profile.full_name ? ", " + state.profile.full_name.split(" ")[0] : "") + ".");
  } catch (err) {
    $("#loginError").textContent = "Could not reach the server. Check your internet connection.";
  } finally { busy(btn, false); }
}

async function logout() {
  await sb.auth.signOut();
  await loadSession();
  $("#registerForm").reset();
  const rr = $("#registerResult"); rr.dataset.last = ""; rr.innerHTML = placeholderHTML();
  const lr = $("#lookupResult"); lr.dataset.last = ""; lr.innerHTML = "";
  await refreshAll();
  toast("You have been logged out.");
}

/* ---------- 5. Queue maths ---------- */
function waitingAhead(visit) {
  const mine = ts(visit.queue_at);
  return state.queue.filter(q => q.department === visit.department && q.status === STATUS.WAITING && ts(q.queue_at) < mine).length;
}
function estimateText(v) {
  if (v.status === STATUS.SERVING) return "Now";
  if (v.status === STATUS.DONE) return "—";
  return (waitingAhead(v) + 1) * AVG_MIN + " min";
}
function positionText(v) {
  if (v.status === STATUS.SERVING) return "Being served now";
  if (v.status === STATUS.DONE) return "Visit complete";
  return "#" + (waitingAhead(v) + 1) + " in line";
}

/* ---------- 6. Rendering ---------- */
function placeholderHTML() {
  return '<div class="result-placeholder"><svg viewBox="0 0 24 24" width="38" height="38" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h10M7 16h6"/></svg><p>Your generated token and receipt will appear here.</p></div>';
}
function badge(status) {
  const cls = status === STATUS.SERVING ? "badge-serving" : status === STATUS.WAITING ? "badge-waiting" : "badge-completed";
  return '<span class="badge ' + cls + '">' + esc(status) + "</span>";
}
const displayName = () => (state.profile && state.profile.full_name) || (state.user && state.user.email) || "Patient";

function renderAuthArea() {
  const html = state.user
    ? '<span class="user-chip" title="' + esc(displayName()) + '"><span>' + esc(displayName()) + "</span></span>" +
      '<button type="button" class="btn btn-outline btn-sm" id="logoutBtn">Log Out</button>'
    : '<button type="button" class="btn btn-outline btn-sm auth-secondary" data-open-auth="login">Log In</button>' +
      '<button type="button" class="btn btn-primary btn-sm" data-open-auth="register">Register</button>';
  setHTML($("#authArea"), html);
}

function renderAnnouncements() {
  const list = state.notices.filter(n => n.is_active !== false);
  $("#announcements").hidden = list.length === 0;
  setHTML($("#announcementList"), list.map(n =>
    '<li><span class="announce-tag ' + (n.kind === "doctor" ? "doctor" : "") + '">' +
    (n.kind === "doctor" ? "Doctor availability" : "Department notice") + "</span>" + esc(n.message) + "</li>"
  ).join(""));
}

function renderStats() { $("#statRegistered").textContent = state.registered; }

function renderPreview() {
  let best = DEPARTMENTS[0].name, bestScore = -1;
  DEPARTMENTS.forEach(d => {
    const score = state.queue.filter(v => v.department === d.name && v.status !== STATUS.DONE).length;
    if (score > bestScore) { bestScore = score; best = d.name; }
  });
  const list = state.queue.filter(v => v.department === best);
  const serving = list.find(v => v.status === STATUS.SERVING);
  const waiting = list.filter(v => v.status === STATUS.WAITING);
  const done = list.filter(v => v.status === STATUS.DONE).length;
  const pct = list.length ? Math.round((done / list.length) * 100) : 0;
  $("#previewDept").textContent = best;
  $("#previewServing").textContent = serving ? serving.token : "—";
  $("#previewNext").textContent = waiting[0] ? waiting[0].token : "—";
  $("#previewWaiting").textContent = waiting.length;
  $("#previewProgress").style.width = pct + "%";
  $("#previewBar").setAttribute("aria-valuenow", String(pct));
}

function renderDepartments() {
  setHTML($("#deptGrid"), DEPARTMENTS.map(d => {
    const w = state.queue.filter(v => v.department === d.name && v.status === STATUS.WAITING).length;
    return '<article class="dept-card">' +
      '<div class="dept-art" style="background:' + d.bg + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[d.icon] + "</svg></div>" +
      '<div class="dept-body"><h3>' + esc(d.name) + "</h3><p>" + esc(d.desc) + "</p>" +
      '<div class="dept-meta"><span class="dept-wait">' + w + " waiting</span>" +
      '<a href="#register" class="btn btn-outline btn-sm" data-dept="' + esc(d.name) + '">Register</a></div></div></article>';
  }).join(""));
}

function renderQueueTable() {
  const order = { [STATUS.SERVING]: 0, [STATUS.WAITING]: 1, [STATUS.DONE]: 2 };
  const active = state.queue.filter(v => v.status !== STATUS.DONE)
    .sort((a, b) => (order[a.status] - order[b.status]) || (ts(a.queue_at) - ts(b.queue_at)));
  const recentDone = state.queue.filter(v => v.status === STATUS.DONE).sort((a, b) => ts(b.queue_at) - ts(a.queue_at)).slice(0, 5);
  const rows = active.concat(recentDone);
  setHTML($("#queueTableBody"), rows.length ? rows.map(v =>
    '<tr><td class="tok">' + esc(v.token) + "</td><td>" + esc(v.display_name) + "</td><td>" + esc(v.department) + "</td><td>" +
    badge(v.status) + "</td><td>" + esc(estimateText(v)) + "</td></tr>"
  ).join("") : '<tr class="empty-row"><td colspan="5">No patients in the queue right now.</td></tr>');
}

function renderGates() {
  const loggedIn = !!state.user;
  $("#registerGate").hidden = loggedIn;
  $("#registerForm").hidden = !loggedIn;
  $("#myTokenGate").hidden = loggedIn;
  $("#myTokenBody").hidden = !loggedIn;
  if (loggedIn && state.profile) {
    if (!$("#fullName").value && state.profile.full_name) $("#fullName").value = state.profile.full_name;
    if (!$("#mobile").value && state.profile.mobile) $("#mobile").value = state.profile.mobile;
  }
}

function renderMyVisits() {
  const box = $("#myVisits");
  if (!state.user) { setHTML(box, ""); return; }
  setHTML(box, state.myVisits.length ? state.myVisits.map(v =>
    '<div class="visit-row"><div><div class="tk">' + esc(v.token) + '</div><div class="meta">' + esc(v.full_name) + " · " + esc(v.department) + " · " + esc(fmtTime(v.created_at)) + "</div></div>" +
    '<div class="visit-actions">' + badge(v.status) +
    '<button type="button" class="btn btn-outline btn-sm" data-view="' + esc(v.token) + '">Track</button>' +
    '<button type="button" class="btn btn-outline btn-sm" data-print="' + esc(v.token) + '">Print receipt</button></div></div>'
  ).join("") : '<p class="empty-note">You have not registered any visits yet.</p>');
}

function renderLookup() {
  const out = $("#lookupResult");
  if (!state.lookup || !state.user) { setHTML(out, ""); return; }
  if (state.lookup.error) { setHTML(out, '<div class="lookup-message error">' + esc(state.lookup.error) + "</div>"); return; }
  const v = findOwnVisit(state.lookup.token);
  if (!v) { setHTML(out, '<div class="lookup-message error">No token ' + esc(state.lookup.token) + " was found on your account. Check the number and try again.</div>"); return; }
  setHTML(out, '<dl class="token-card">' +
    "<div><dt>Patient name</dt><dd>" + esc(v.full_name) + "</dd></div>" +
    '<div><dt>Token number</dt><dd class="big">' + esc(v.token) + "</dd></div>" +
    "<div><dt>Department</dt><dd>" + esc(v.department) + "</dd></div>" +
    "<div><dt>Queue position</dt><dd>" + esc(positionText(v)) + "</dd></div>" +
    "<div><dt>Current status</dt><dd>" + badge(v.status) + "</dd></div>" +
    "<div><dt>Estimated waiting time</dt><dd>" + esc(estimateText(v)) + "</dd></div></dl>");
}

function renderAll() {
  renderAuthArea();
  renderAnnouncements();
  renderStats();
  renderPreview();
  renderDepartments();
  renderQueueTable();
  renderGates();
  renderMyVisits();
  renderLookup();
}

/* ---------- 7. Receipt (on screen + printable) ---------- */
function receiptRows(v) {
  return [["Patient", v.full_name], ["Age / Gender", v.age + " / " + (v.gender || "—")], ["Department", v.department], ["Registered", fmtTime(v.created_at)]];
}
function showReceipt(v) {
  const rows = receiptRows(v).concat([["Queue position", positionText(v)], ["Estimated wait", estimateText(v)]])
    .map(r => "<div><dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd></div>").join("");
  const box = $("#registerResult");
  box.dataset.last = "";
  box.innerHTML =
    '<div tabindex="-1" id="receiptBox"><span class="receipt-ok">✓ Registration successful</span>' +
    '<div class="receipt-token" aria-label="Your token number ' + esc(v.token) + '">' + esc(v.token) + "</div>" +
    '<p class="receipt-sub">Keep this token. You can track it under "My Token".</p>' +
    '<dl class="receipt-rows">' + rows + "</dl>" +
    '<div class="receipt-actions">' +
    '<button type="button" class="btn btn-primary" data-print="' + esc(v.token) + '">Print / Save as PDF</button>' +
    '<button type="button" class="btn btn-outline" data-download="' + esc(v.token) + '">Download .txt</button>' +
    '<button type="button" class="btn btn-outline" id="anotherBtn">Register another patient</button></div></div>';
  const rb = $("#receiptBox"); if (rb) rb.focus({ preventScroll: true });
}

/* Only the owner can fetch their rows — the database enforces this too (RLS). */
function findOwnVisit(token) {
  return state.myVisits.find(v => v.token === token) || null;
}

function printReceipt(token) {
  const v = findOwnVisit(token);
  if (!v) { toast("Receipt not available."); return; }
  const rows = receiptRows(v).concat([["Queue position", positionText(v)], ["Estimated wait", estimateText(v)]])
    .map(r => "<tr><td>" + esc(r[0]) + "</td><td>" + esc(r[1]) + "</td></tr>").join("");
  $("#printArea").innerHTML =
    "<h1>SmartCare — Token Receipt</h1><div>Digital Patient Registration and Guidance System</div>" +
    '<div class="p-token">' + esc(v.token) + "</div><table>" + rows + "</table>" +
    '<p class="p-note">Please keep this receipt. SmartCare provides registration and queue guidance only — it is not a medical diagnosis service.</p>';
  window.print();
}
window.addEventListener("afterprint", () => { $("#printArea").innerHTML = ""; });

function downloadReceipt(token) {
  const v = findOwnVisit(token);
  if (!v) { toast("Receipt not available."); return; }
  const lines = ["SmartCare — Token Receipt", "=========================", "Token: " + v.token]
    .concat(receiptRows(v).map(r => r[0] + ": " + r[1]))
    .concat(["Queue position: " + positionText(v), "Estimated wait: " + estimateText(v), "", "Registration and queue guidance only. Not a medical diagnosis."]);
  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url; a.download = "SmartCare-" + v.token + ".txt";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- 8. Forms ---------- */
async function handleRegister(e) {
  e.preventDefault();
  if (!state.user) { openAuth("login"); return; }
  const form = e.currentTarget;
  clearErrors(form);

  const name = $("#fullName").value, ageRaw = $("#age").value.trim(), mobile = $("#mobile").value.trim();
  const gender = $("#gender").value, dept = $("#department").value, reason = $("#reason").value.trim();
  const age = Number(ageRaw);

  let ok = true;
  ok = setError("fullName", validName(name) ? "" : "Please enter a valid full name.") && ok;
  ok = setError("age", ageRaw !== "" && Number.isInteger(age) && age >= 0 && age <= 120 ? "" : "Enter a valid age between 0 and 120.") && ok;
  ok = setError("mobile", validMobile(mobile) ? "" : "Enter a valid 10-digit mobile number (starting with 6–9).") && ok;
  ok = setError("gender", gender ? "" : "Please select a gender.") && ok;
  ok = setError("department", dept ? "" : "Please select a department.") && ok;
  if (!ok) { const first = $("[aria-invalid='true']", form); if (first) first.focus(); return; }

  const btn = $(".btn-submit", form);
  busy(btn, true, "Generating token…");
  try {
    const row = await Api.register({
      p_full_name: name.trim(), p_age: age, p_mobile: mobile, p_gender: gender,
      p_department: dept, p_reason: reason || null
    });
    await refreshAll();
    showReceipt(findOwnVisit(row.token) || row);
    toast("Token " + row.token + " generated.");
  } catch (err) {
    const msg = (err && err.message) || "Registration failed. Please try again.";
    if (/already has an active token/i.test(msg)) { setError("department", msg); $("#department").focus(); }
    else if (/log in/i.test(msg)) { openAuth("login"); }
    else { toast(msg, 5000); }
  } finally { busy(btn, false); }
}

function resetRegistrationForm() {
  const form = $("#registerForm");
  form.reset();
  clearErrors(form);
  if (state.profile) {
    $("#fullName").value = "";                       // another patient: leave the name empty
    if (state.profile.mobile) $("#mobile").value = state.profile.mobile;
  }
  const box = $("#registerResult"); box.dataset.last = ""; box.innerHTML = placeholderHTML();
  $("#fullName").focus();
}

async function runLookup(raw) {
  const token = normalizeToken(raw);
  if (!token) { state.lookup = { token: raw, error: "Please enter a valid token such as A-003." }; renderLookup(); return; }
  try { state.myVisits = await Api.myVisits(); } catch (e) { /* fall back to cached rows */ }
  state.lookup = { token };
  renderMyVisits();
  renderLookup();
}

/* ---------- 9. UI ---------- */
const authDialog = () => $("#authDialog");

function switchAuthTab(which) {
  const login = which !== "register";
  $("#tabLogin").setAttribute("aria-selected", String(login));
  $("#tabRegister").setAttribute("aria-selected", String(!login));
  $("#tabLogin").tabIndex = login ? 0 : -1;
  $("#tabRegister").tabIndex = login ? -1 : 0;
  $("#loginForm").hidden = !login;
  $("#signupForm").hidden = login;
  $("#authTitle").textContent = login ? "Log in to SmartCare" : "Create your patient account";
}
function openAuth(which) {
  switchAuthTab(which);
  closeNav();
  const d = authDialog();
  if (!d.open) d.showModal();
  setTimeout(() => (which === "register" ? $("#signupName") : $("#loginEmail")).focus(), 30);
}
function closeAuth() { const d = authDialog(); if (d.open) d.close(); }

function closeNav() {
  $("#navLinks").classList.remove("open");
  const t = $("#navToggle"); t.setAttribute("aria-expanded", "false"); t.setAttribute("aria-label", "Open menu");
}
function toggleNav() {
  const open = $("#navLinks").classList.toggle("open");
  const t = $("#navToggle"); t.setAttribute("aria-expanded", String(open)); t.setAttribute("aria-label", open ? "Close menu" : "Open menu");
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try { localStorage.setItem("sc_theme", theme); } catch (e) {}
  const btn = $("#themeToggle");
  btn.setAttribute("aria-pressed", String(theme === "dark"));
  btn.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
}

function bindEvents() {
  $("#navToggle").addEventListener("click", toggleNav);
  $("#themeToggle").addEventListener("click", () => applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark"));
  $("#authClose").addEventListener("click", closeAuth);
  $("#tabLogin").addEventListener("click", () => switchAuthTab("login"));
  $("#tabRegister").addEventListener("click", () => switchAuthTab("register"));
  $(".auth-tabs").addEventListener("keydown", e => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const toRegister = $("#tabLogin").getAttribute("aria-selected") === "true";
      switchAuthTab(toRegister ? "register" : "login");
      (toRegister ? $("#tabRegister") : $("#tabLogin")).focus();
    }
  });
  authDialog().addEventListener("click", e => { if (e.target === authDialog()) closeAuth(); });

  $("#loginForm").addEventListener("submit", handleLogin);
  $("#signupForm").addEventListener("submit", handleSignup);
  $("#registerForm").addEventListener("submit", handleRegister);
  $("#lookupForm").addEventListener("submit", e => { e.preventDefault(); runLookup($("#lookupInput").value); });

  ["mobile", "signupMobile"].forEach(id => $("#" + id).addEventListener("input", e => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 10); }));
  $$("input, select, textarea").forEach(el => el.addEventListener("input", () => { if (el.id) setError(el.id, ""); }));

  document.addEventListener("click", e => {
    const t = e.target.closest("button, a");
    if (!t) return;
    if (t.dataset.openAuth) { openAuth(t.dataset.openAuth); return; }
    if (t.id === "logoutBtn") { logout(); return; }
    if (t.id === "anotherBtn") { resetRegistrationForm(); return; }
    if (t.dataset.print) { printReceipt(t.dataset.print); return; }
    if (t.dataset.download) { downloadReceipt(t.dataset.download); return; }
    if (t.dataset.view) { $("#lookupInput").value = t.dataset.view; runLookup(t.dataset.view); $("#lookupResult").scrollIntoView({ behavior: "smooth", block: "nearest" }); return; }
    if (t.dataset.dept) { if (state.user) $("#department").value = t.dataset.dept; }
    if (t.closest("#navLinks") && t.tagName === "A") closeNav();
  });

  document.addEventListener("keydown", e => { if (e.key === "Escape") closeNav(); });
  window.addEventListener("resize", () => { if (window.innerWidth > 1240) closeNav(); });

  const links = $$("#navLinks .nav-link");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (en.isIntersecting) links.forEach(l => (l.getAttribute("href") === "#" + en.target.id ? l.setAttribute("aria-current", "true") : l.removeAttribute("aria-current")));
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    ["departments", "register", "my-token", "queue", "guidance"].forEach(id => { const s = document.getElementById(id); if (s) io.observe(s); });
  }
}

/* ---------- 10. Init + polling ---------- */
let offlineShown = false;

async function refreshAll() {
  try {
    const jobs = [Api.queue(), Api.registeredCount(), Api.notices()];
    if (state.user) jobs.push(Api.myVisits());
    const [queue, count, notices, mine] = await Promise.all(jobs);
    state.queue = queue; state.registered = count; state.notices = notices;
    if (state.user) state.myVisits = mine;
    if (offlineShown) { offlineShown = false; toast("Back online."); }
  } catch (err) {
    console.error("Refresh failed:", err);
    if (!offlineShown) { offlineShown = true; toast("Connection problem — retrying…", 4000); }
  }
  renderAll();
}

function startPolling() {
  setInterval(() => { if (!document.hidden) refreshAll(); }, POLL_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshAll(); });
}

function showFatal(message) {
  const bar = document.createElement("div");
  bar.setAttribute("role", "alert");
  bar.style.cssText = "background:#B3261E;color:#fff;padding:14px 20px;text-align:center;font-weight:600";
  bar.textContent = message;
  document.body.prepend(bar);
}

async function init() {
  $("#year").textContent = new Date().getFullYear();
  applyTheme(document.documentElement.getAttribute("data-theme") || "light");
  bindEvents();
  renderAll();

  if (!sb) {
    showFatal("Cannot connect to the database. Check your internet connection and that config.js is loaded.");
    return;
  }
  sb.auth.onAuthStateChange((event, session) => {
    // Never await Supabase calls inside this callback — defer them.
    const id = session && session.user ? session.user.id : null;
    if (event === "SIGNED_OUT" || (event === "SIGNED_IN" && id !== (state.user && state.user.id))) {
      setTimeout(async () => { await loadSession(); await refreshAll(); }, 0);
    }
  });
  await loadSession();
  await refreshAll();
  startPolling();
}

document.addEventListener("DOMContentLoaded", init);
