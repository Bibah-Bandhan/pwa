const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzLkF6r0cwJfohCmL92OTVZ-oRRCXDNU7Uj2tUjFsUv4a7giy7mW1JlIn-XDLeR8SuPtg/exec";

const state = {
  profiles: [],
  agents: [],
  payments: [],
  filtered: [],
  session: null,
  activeTab: "profiles",
  dashboardSearch: "",
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const INACTIVITY_TIMEOUT_MS = 2 * 60 * 1000;
let inactivityTimer = null;
let activeReceiptTitle = "";

document.addEventListener("DOMContentLoaded", () => {
  bindUi();
  bindCodeProtection();
  bindActivityTracking();
  loadPublicData();
});

function bindActivityTracking() {
  ["click", "keydown", "mousemove", "touchstart", "scroll"].forEach((eventName) => {
    document.addEventListener(eventName, resetInactivityTimer, { passive: true });
  });
}

function resetInactivityTimer() {
  if (!state.session) return;
  clearInactivityTimer();
  inactivityTimer = setTimeout(() => {
    toast("Session expired due to inactivity");
    logout();
  }, INACTIVITY_TIMEOUT_MS);
}

function clearInactivityTimer() {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = null;
}

function bindCodeProtection() {
  const blockedKeys = ["u", "i", "j", "c", "s"];
  document.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    
  });
  document.addEventListener("keydown", (event) => {
    const key = String(event.key || "").toLowerCase();
    const blockedCombo =
      event.key === "F12" ||
      (event.ctrlKey && key === "u") ||
      (event.ctrlKey && event.shiftKey && blockedKeys.includes(key)) ||
      (event.metaKey && event.altKey && blockedKeys.includes(key));

    if (blockedCombo) {
      event.preventDefault();
      event.stopPropagation();
      
    }
  }, true);
  document.addEventListener("dragstart", (event) => event.preventDefault());
}

function bindUi() {
    const loginDropdown = $(".login-dropdown");
  const loginToggle = $(".login-toggle");
  if (loginDropdown && loginToggle) {
    loginToggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const isOpen = loginDropdown.classList.toggle("open");
      loginToggle.setAttribute("aria-expanded", String(isOpen));
    });
    document.addEventListener("click", (event) => {
      if (!loginDropdown.contains(event.target)) {
        loginDropdown.classList.remove("open");
        loginToggle.setAttribute("aria-expanded", "false");
      }
    });
  }
  if ($("#paymentForm")) $("#paymentForm").addEventListener("submit", submitPayment);
  if ($("#printReceiptBtn")) $("#printReceiptBtn").addEventListener("click", printReceipt);
  if ($("#dashboardSearch")) {
    $("#dashboardSearch").addEventListener("input", (event) => {
      state.dashboardSearch = event.target.value || "";
      renderDashboard();
    });
  }
  $$("[data-open-profile]").forEach((button) => button.addEventListener("click", () => openProfileForm()));
  $$("[data-open-login]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      $(".login-dropdown")?.classList.remove("open");
      $(".login-toggle")?.setAttribute("aria-expanded", "false");
      openLogin(button.dataset.openLogin || "agent");
    });
  });
  $$("[data-close-modal]").forEach((button) => button.addEventListener("click", closeModals));
  $$("[data-close-message]").forEach((button) => button.addEventListener("click", closeMessageModal));
  $$(".modal").forEach((modal) => {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        modal.id === "messageModal" ? closeMessageModal() : closeModals();
      }
    });
  });

  $("#quickSearch").addEventListener("submit", (event) => {
    event.preventDefault();
    applyFilters(new FormData(event.target));
    document.getElementById("browse").scrollIntoView({ behavior: "smooth" });
  });
  $("#sideFilters").addEventListener("submit", (event) => {
    event.preventDefault();
    applyFilters(new FormData(event.target));
  });
  $("#resetFilters").addEventListener("click", () => {
    $("#quickSearch").reset();
    $("#sideFilters").reset();
    state.filtered = state.profiles.filter((profile) => profile.status === "verified");
    renderCards(state.filtered);
  });

  $("#loginForm").addEventListener("submit", submitLogin);
  $("#profileForm").addEventListener("submit", submitProfile);
  $("#agentForm").addEventListener("submit", submitAgent);
  $("#clearAgentForm").addEventListener("click", () => $("#agentForm").reset());
  $("#logoutBtn").addEventListener("click", logout);
}

async function api(action, payload = {}) {
  const response = await fetch(SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, ...payload }),
  });
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (error) {
    return { ok: false, error: text || "Invalid server response" };
  }
}

async function loadPublicData() {
  $("#cards").innerHTML = emptyMessage("Loading profiles...");
  try {
    const response = await fetch(`${SCRIPT_URL}?view=public`);
    const data = await response.json();
    state.profiles = cleanProfiles(Array.isArray(data.profiles) ? data.profiles : Array.isArray(data) ? data : []);
    state.agents = cleanAgents(Array.isArray(data.agents) ? data.agents : []);
    state.filtered = state.profiles.filter((profile) => profile.status === "verified");
    renderStats();
    renderCards(state.filtered);
  } catch (error) {
    $("#cards").innerHTML = emptyMessage("Could not load profiles. Check Apps Script deployment URL.");
  }
}

async function loadDashboardData() {
  if (!state.session) return;
  const payload = {
    token: state.session.token,
    role: state.session.role,
    agentId: state.session.agentId || "",
  };
  const result = await api("dashboard", payload);
  if (!result.ok) {
    toast(result.error || "Dashboard loading failed");
    return;
  }
  state.profiles = cleanProfiles(result.profiles || []);
  state.agents = cleanAgents(result.agents || []);
  state.payments = cleanPayments(result.payments || []);
  renderStats();
  renderDashboard();
}

function applyFilters(formData) {
  const filters = Object.fromEntries(formData.entries());
  state.filtered = state.profiles.filter((profile) => {
    if (profile.status !== "verified") return false;
    if (filters.ageMin && Number(profile.age || 0) < Number(filters.ageMin)) return false;
    if (filters.ageMax && Number(profile.age || 0) > Number(filters.ageMax)) return false;
    if (filters.gender && !sameChoice(profile.gender, filters.gender)) return false;
    if (filters.religion && !sameChoice(profile.religion, filters.religion)) return false;
    if (filters.city && !includes(profile.city, filters.city)) return false;
    if (filters.education && !includes(profile.education, filters.education)) return false;
    if (filters.occupation && !includes(profile.occupation, filters.occupation)) return false;
    if (filters.community && !includes(profile.community, filters.community)) return false;
    if (filters.maritalStatus && normalize(profile.maritalStatus) !== normalize(filters.maritalStatus)) return false;
    return true;
  });
  renderCards(state.filtered);
}

function renderCards(list) {
  const cards = $("#cards");
  list = cleanProfiles(list);
  cards.innerHTML = "";
  if (!list.length) {
    cards.innerHTML = emptyMessage("No verified profiles found.");
    return;
  }
  list.forEach((profile) => cards.appendChild(profileCard(profile)));
}

function profileCard(profile) {
  const card = document.createElement("article");
  card.className = "profile-card";
  const photo = photoUrl(profile.photo);
  card.innerHTML = `
    <div class="cover">
      <span class="pill">${profile.status === "verified" ? "Verified" : "New"}</span>
      <div class="avatar">${photo ? `<img src="${escapeAttr(photo)}" referrerpolicy="no-referrer" alt="${escapeAttr(profile.fullName || "Profile")}">` : initials(profile.fullName)}</div>
    </div>
    <div class="card-body">
      <div class="card-title">
        <strong>${escapeHtml(profile.fullName || "Profile")}</strong>
        <span class="id">#${escapeHtml(profile.id || "")}</span>
      </div>
      <div class="meta">
        ${chip(profile.age ? `${profile.age} yrs` : "")}
        ${chip(profile.height)}
        ${chip(profile.complexion)}
        ${chip([profile.thana || profile.block, profile.district].filter(Boolean).join(", "))}
      </div>
      <div class="meta">
        ${chip(profile.religion)}
        ${chip(profile.community)}
        ${chip(profile.occupation)}
      </div>
    </div>
    <div class="card-actions">
      <button class="btn btn-soft" type="button">Shortlist</button>
      <button class="btn btn-primary" type="button">View</button>
    </div>`;
  card.querySelector(".btn-soft").addEventListener("click", () => toast("Added to shortlist"));
  card.querySelector(".btn-primary").addEventListener("click", () => openDetails(profile));
  return card;
}

function renderStats() {
  const total = state.profiles.length;
  const verified = state.profiles.filter((profile) => profile.status === "verified").length;
  $("#statProfiles").textContent = total;
  $("#statVerified").textContent = verified;
  $("#statAgents").textContent = state.agents.length;
}

function openLogin(role) {
  $("#loginTitle").textContent = role === "admin" ? "Admin Login" : "Agent Login";
  $("#loginForm [name='role']").value = role;
  $("#loginForm").reset();
  $("#loginForm [name='role']").value = role;
  openModal("loginModal");
}

async function submitLogin(event) {
  event.preventDefault();
  const button = event.target.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "Checking...";
  const payload = Object.fromEntries(new FormData(event.target).entries());
  try {
    const result = await api("login", payload);
    if (!result.ok) throw new Error(result.error || "Login failed");
    state.session = result.session;
    closeModals();
    showDashboard();
    await loadDashboardData();
    resetInactivityTimer();
    toast("Login successful");
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Login";
  }
}

function restoreSession() {
  localStorage.removeItem("bandhanSession");
}

function showDashboard() {
  document.body.classList.add("dashboard-mode");
  document.body.classList.toggle("admin-mode", state.session.role === "admin");
  document.body.classList.toggle("agent-mode", state.session.role === "agent");
  $$(".public-view").forEach((element) => element.classList.add("hidden"));
  $("#dashboardSection").classList.remove("hidden");
  $("#dashboardTitle").textContent = state.session.role === "admin" ? "Admin Dashboard" : "Agent Dashboard";
  $("#dashboardSub").textContent = state.session.role === "admin"
    ? "View, edit, approve and delete client profiles. Create and manage agent accounts."
    : "View public submissions, edit assigned clients and approve profiles.";
  $("#sessionName").textContent = state.session.name || state.session.role;
  $("#sessionInfo").textContent = state.session.role === "admin"
    ? "Admin can see every profile and every agent."
    : `Agent ID: ${state.session.agentId || ""} · Public profiles are visible until assigned.`;
  $("#agentTools").classList.toggle("hidden", true);
  renderTabs();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderTabs() {
  const tabs = $("#dashboardTabs");
  const items = state.session.role === "admin"
    ? [["profiles", "Profiles"], ["payments", "Payments"], ["agents", "Agents"], ["agentForm", "Create Agent"]]
    : [["profiles", "My Clients"], ["payments", "Payments"]];
  tabs.innerHTML = "";
  items.forEach(([key, label]) => {
    const button = document.createElement("button");
    button.className = `btn tab ${state.activeTab === key ? "active" : ""}`;
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => {
      state.activeTab = key;
      renderTabs();
      renderDashboard();
    });
    tabs.appendChild(button);
  });
}

function renderDashboard() {
  const visibleProfiles = state.profiles;
  const filteredProfiles = filterDashboardProfiles(visibleProfiles);
  $("#dashTotal").textContent = visibleProfiles.length;
  $("#dashPending").textContent = visibleProfiles.filter((profile) => profile.status === "pending").length;
  $("#dashVerified").textContent = visibleProfiles.filter((profile) => profile.status === "verified").length;
  $("#dashAgents").textContent = state.agents.length;

  const filterPanel = $("#dashboardFilter");
  if (filterPanel) {
    const showFilter = state.activeTab === "profiles";
    filterPanel.classList.toggle("hidden", !showFilter);
    $("#dashboardSearch").value = state.dashboardSearch || "";
    $("#dashboardSearchCount").textContent = showFilter
      ? `${filteredProfiles.length} / ${visibleProfiles.length} client`
      : "";
  }

  $("#agentTools").classList.toggle("hidden", !(state.activeTab === "agentForm" && state.session.role === "admin"));

  if (state.activeTab === "payments") {
    renderPaymentTable();
  } else if (state.activeTab === "agents" && state.session.role === "admin") {
    renderAgentTable();
  } else if (state.activeTab === "agentForm" && state.session.role === "admin") {
    renderAgentFormView();
  } else {
    renderProfileTable(filteredProfiles);
  }
}

function filterDashboardProfiles(list) {
  const query = normalize(state.dashboardSearch || "");
  if (!query) return cleanProfiles(list);
  return cleanProfiles(list).filter((profile) => {
    const haystack = [
      profile.id,
      profile.fullName,
      profile.phone,
      profile.email,
      profile.agentId,
      profile.district,
      profile.villageTown,
      profile.city,
      profile.status
    ].map(normalize).join(" ");
    return haystack.includes(query);
  });
}

function renderAgentFormView() {
  $("#tableHead").innerHTML = "";
  const body = $("#tableBody");
  body.innerHTML = `<tr><td>Create or update agent details using the form above.</td></tr>`;
}
function renderProfileTable(list) {
  list = cleanProfiles(list);
  $("#tableHead").innerHTML = `<tr><th>ID</th><th>ছবি</th><th>নাম</th><th>যোগাযোগ</th><th>ঠিকানা</th><th>স্ট্যাটাস</th><th>এজেন্ট</th><th>কাজ</th></tr>`;
  const body = $("#tableBody");
  body.innerHTML = "";
  if (!list.length) {
    body.innerHTML = `<tr><td colspan="8">কোনো client পাওয়া যায়নি। Search spelling বা ID আরেকবার দেখুন।</td></tr>`;
    return;
  }
  list.forEach((profile) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(profile.id || "")}</td>
      <td>${photoUrl(profile.photo) ? `<img class="thumb" src="${escapeAttr(photoUrl(profile.photo))}" referrerpolicy="no-referrer" alt="">` : ""}</td>
      <td><strong>${escapeHtml(profile.fullName || "")}</strong><br><span class="note">${escapeHtml(profile.gender || "")}, ${escapeHtml(profile.age || "")}</span></td>
      <td>${escapeHtml(profile.phone || "")}<br><span class="note">${escapeHtml(profile.email || "")}</span></td>
      <td>${escapeHtml([profile.villageTown || profile.city, profile.district, profile.state].filter(Boolean).join(", "))}</td>
      <td>${statusBadge(profile.status || "pending")}</td>
      <td>${escapeHtml(profile.agentId || "Public")}</td>
      <td><div class="row-actions"></div></td>`;
    const actions = tr.querySelector(".row-actions");
    addAction(actions, "View", "btn-blue", () => openDetails(profile));
    addAction(actions, "Edit", "btn-gold", () => openProfileForm(profile));
    addAction(actions, "Payment", "btn-green", () => openPaymentModal(profile));
    if (state.session.role === "admin" || state.session.role === "agent") {
      addAction(actions, profile.status === "verified" ? "Pending" : "Approve", "btn-green", () => setProfileStatus(profile, profile.status === "verified" ? "pending" : "verified"));
    }
    if (state.session.role === "admin") {
      addAction(actions, "Delete", "btn-danger", () => deleteProfile(profile));
    }
    body.appendChild(tr);
  });
}

function renderPaymentTable() {
  const payments = cleanPayments(state.payments || []);
  $("#tableHead").innerHTML = `<tr><th>Payment ID</th><th>Client</th><th>Type</th><th>Amount</th><th>Balance</th><th>Date</th><th>Mode</th><th>Purpose</th><th>Received By</th><th>Receipt</th></tr>`;
  const body = $("#tableBody");
  body.innerHTML = "";
  if (!payments.length) {
    body.innerHTML = `<tr><td colspan="10">No payments yet.</td></tr>`;
    return;
  }
  payments.forEach((payment) => {
    const type = paymentDirection(payment);
    const balance = payment.balanceAfter !== undefined && payment.balanceAfter !== ""
      ? Number(payment.balanceAfter || 0)
      : paymentBalanceForProfile(payment.profileId);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(payment.paymentId || "")}</td>
      <td><strong>${escapeHtml(payment.clientName || "")}</strong><br><span class="note">${escapeHtml(payment.profileId || "")}</span></td>
      <td><span class="ledger-type ${type}">${type === "debit" ? "Debit" : "Receive"}</span></td>
      <td><strong class="amount-${type}">${type === "debit" ? "-" : "+"}₹${escapeHtml(payment.amount || "0")}</strong></td>
      <td><strong>₹${escapeHtml(balance)}</strong></td>
      <td>${escapeHtml(formatDate(payment.paymentDate) || payment.paymentDate || "")}</td>
      <td>${escapeHtml(payment.mode || "")}</td>
      <td>${escapeHtml(payment.purpose || "")}</td>
      <td>${escapeHtml(payment.receivedByName || payment.receivedByRole || "")}</td>
      <td><div class="row-actions"></div></td>`;
    const actions = tr.querySelector(".row-actions");
    addAction(actions, "Receipt", "btn-blue", () => openReceiptModal(payment));
    body.appendChild(tr);
  });
}
function renderAgentTable() {
  $("#tableHead").innerHTML = `<tr><th>ID</th><th>Name</th><th>Phone</th><th>Email</th><th>Area</th><th>Password</th><th>Status</th><th>Clients</th><th>Actions</th></tr>`;
  const body = $("#tableBody");
  body.innerHTML = "";
  if (!state.agents.length) {
    body.innerHTML = `<tr><td colspan="9">No agents yet.</td></tr>`;
    return;
  }
  state.agents.forEach((agent) => {
    const count = state.profiles.filter((profile) => String(profile.agentId || "") === String(agent.id || "")).length;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(agent.id || "")}</td>
      <td><strong>${escapeHtml(agent.name || "")}</strong></td>
      <td>${escapeHtml(agent.phone || "")}</td>
      <td>${escapeHtml(agent.email || "")}</td>
      <td>${escapeHtml(agent.area || "")}</td>
      <td><code>${escapeHtml(agent.password || "Set new password")}</code></td>
      <td>${statusBadge(agent.status || "active")}</td>
      <td>${count}</td>
      <td><div class="row-actions"></div></td>`;
    const actions = tr.querySelector(".row-actions");
    addAction(actions, "Edit", "btn-gold", () => fillAgentForm(agent));
    addAction(actions, agent.status === "blocked" ? "Activate" : "Block", "btn-blue", () => toggleAgent(agent));
    addAction(actions, "Delete", "btn-danger", () => deleteAgent(agent));
    body.appendChild(tr);
  });
}

function cleanProfiles(list) {
  return (Array.isArray(list) ? list : []).filter((profile) =>
    String(profile?.id || "").trim() ||
    String(profile?.fullName || "").trim() ||
    String(profile?.phone || "").trim()
  );
}

function cleanAgents(list) {
  return (Array.isArray(list) ? list : []).filter((agent) =>
    String(agent?.id || "").trim() ||
    String(agent?.name || "").trim() ||
    String(agent?.phone || "").trim() ||
    String(agent?.email || "").trim()
  );
}

function cleanPayments(list) {
  return (Array.isArray(list) ? list : []).filter((payment) =>
    String(payment?.paymentId || "").trim() ||
    String(payment?.profileId || "").trim() ||
    String(payment?.amount || "").trim()
  );
}
function addAction(container, label, className, handler) {
  const button = document.createElement("button");
  button.className = `btn ${className}`;
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", handler);
  container.appendChild(button);
}

function openProfileForm(profile = {}) {
  $("#profileModalTitle").textContent = profile.id ? "প্রোফাইল এডিট" : "প্রোফাইল তৈরি";
  const form = $("#profileForm");
  form.reset();
  Object.entries(profile).forEach(([key, value]) => {
    const input = form.elements[key];
    if (input) input.value = key === "dob" ? formatDate(value) : value || "";
  });
  if ($("#photoFile")) $("#photoFile").value = "";
  if ($("#docFile")) $("#docFile").value = "";
  if (state.session?.role === "agent" && !profile.id) {
    form.elements.agentId.value = state.session.agentId || "";
  }
  openModal("profileModal");
}

async function submitProfile(event) {
  event.preventDefault();
  const agreeCheckbox = $("#agreeTerms");
  if (agreeCheckbox && !agreeCheckbox.checked) {
    alert("❌ অনুগ্রহ করে 'বিবাহ বন্ধন ম্যারেজ ব্যুরো'-এর আইনি শর্তাবলীতে সম্মত হয়ে চেকবক্সে টিক দিন।");
    agreeCheckbox.focus();
    return;
  }

  const form = event.target;
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "Saving...";
  try {
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.phone = String(payload.phone || "").replace(/\D/g, "");
    payload.pin = String(payload.pin || "").replace(/\D/g, "");
    if (!/^[6-9]\d{9}$/.test(payload.phone)) {
      throw new Error("সঠিক ১০ সংখ্যার ভারতীয় মোবাইল নম্বর দিন");
    }
    if (payload.pin && !/^\d{6}$/.test(payload.pin)) {
      throw new Error("সঠিক ৬ সংখ্যার পিন কোড দিন");
    }
    const file = $("#photoFile").files[0];
    if (file) payload.photo = await fileToDataUrl(file);
    const docFile = $("#docFile").files[0];
    if (docFile) payload.document = await fileToDataUrl(docFile);
    payload.token = state.session?.token || "";
    payload.role = state.session?.role || "public";
    if (state.session?.role === "agent" && !payload.agentId) payload.agentId = state.session.agentId;
    const action = payload.id ? "editProfile" : "createProfile";
    const result = await api(action, payload);
    if (!result.ok) throw new Error(result.error || "Profile save failed");
    const savedId = result.id || payload.id || "";
    closeModals();
    await (state.session ? loadDashboardData() : loadPublicData());
    showProfileSuccess(payload.fullName, savedId, Boolean(payload.id));
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Save Profile";
  }
}

async function setProfileStatus(profile, status) {
  const result = await api("setProfileStatus", { token: state.session.token, id: profile.id, status });
  if (!result.ok) return toast(result.error || "Status update failed");
  toast("Status updated");
  loadDashboardData();
}

async function deleteProfile(profile) {
  if (!confirm(`Delete ${profile.fullName || profile.id}?`)) return;
  const result = await api("deleteProfile", { token: state.session?.token || "", role: state.session?.role || "", agentId: state.session?.agentId || "", id: profile.id });
  if (!result.ok) return toast(result.error || "Delete failed");
  toast("Profile deleted");
  state.session ? loadDashboardData() : loadPublicData();
}

async function submitAgent(event) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.target).entries());
  payload.token = state.session.token;
  const result = await api("saveAgent", payload);
  if (!result.ok) return toast(result.error || "Agent save failed");
  toast("Agent saved");
  event.target.reset();
  state.activeTab = "agents";
  await loadDashboardData();
  renderTabs();
}

function fillAgentForm(agent) {
  state.activeTab = "agentForm";
  renderTabs();
  renderDashboard();
  const form = $("#agentForm");
  form.reset();
  Object.entries(agent).forEach(([key, value]) => {
    const input = form.elements[key];
    if (input) input.value = value || "";
  });
  form.elements.password.value = agent.password || "";
  $("#agentTools").scrollIntoView({ behavior: "smooth", block: "center" });
}

async function toggleAgent(agent) {
  const status = agent.status === "blocked" ? "active" : "blocked";
  const result = await api("saveAgent", { ...agent, status, token: state.session.token });
  if (!result.ok) return toast(result.error || "Agent update failed");
  toast("Agent status updated");
  loadDashboardData();
}

async function deleteAgent(agent) {
  if (!confirm(`Delete agent ${agent.name || agent.id}?`)) return;
  const result = await api("deleteAgent", { token: state.session.token, id: agent.id });
  if (!result.ok) return toast(result.error || "Agent delete failed");
  toast("Agent deleted");
  $("#agentForm").reset();
  loadDashboardData();
}

function paymentDirection(payment) {
  const type = String(payment?.transactionType || "").toLowerCase();
  const status = String(payment?.status || "").toLowerCase();
  return type === "debit" || status === "debited" || status === "refund" || status === "service" ? "debit" : "credit";
}

function signedPaymentAmount(payment) {
  const amount = Number(payment?.amount || 0);
  return paymentDirection(payment) === "debit" ? -amount : amount;
}

function paymentBalanceForProfile(profileId) {
  return cleanPayments(state.payments || [])
    .filter((payment) => String(payment.profileId || "") === String(profileId || ""))
    .reduce((sum, payment) => sum + signedPaymentAmount(payment), 0);
}

function openReceiptModal(payment) {
  const type = paymentDirection(payment);
  const balance = payment.balanceAfter !== undefined && payment.balanceAfter !== ""
    ? Number(payment.balanceAfter || 0)
    : paymentBalanceForProfile(payment.profileId);
  const receipt = {
    paymentId: payment.paymentId || "",
    clientName: payment.clientName || "",
    profileId: payment.profileId || "",
    transactionType: type,
    amount: payment.amount || "0",
    balanceAfter: balance,
    paymentDate: formatDate(payment.paymentDate) || payment.paymentDate || "",
    mode: payment.mode || "",
    purpose: payment.purpose || "",
    receivedBy: payment.receivedByName || payment.receivedByRole || ""
  };
  activeReceiptTitle = receiptFileName(receipt);
  $("#receiptBody").innerHTML = receiptTemplate(receipt);
  openModal("receiptModal");
}

function receiptTemplate(receipt) {
  const isDebit = receipt.transactionType === "debit";
  return `
    <div class="receipt-paper receipt-4x6" id="receiptPrintArea">
      <div class="receipt-top">
        <div class="receipt-brand">
          <div class="receipt-logo">BB</div>
          <div>
            <h3>বিবাহ বন্ধন 2026</h3>
            <p>${isDebit ? "Debit Voucher" : "Money Receipt"}</p>
          </div>
        </div>
        <div class="receipt-no">
          <span>Receipt No</span>
          <strong>${escapeHtml(receipt.paymentId || "N/A")}</strong>
        </div>
      </div>
      <div class="receipt-money-row">
        <div class="receipt-amount ${isDebit ? "debit" : "credit"}">
          <span>${isDebit ? "Debited Amount" : "Received Amount"}</span>
          <strong>${isDebit ? "-" : "+"}Rs. ${escapeHtml(receipt.amount || "0")}</strong>
        </div>
        <div class="receipt-balance">
          <span>Customer Total Balance</span>
          <strong>Rs. ${escapeHtml(receipt.balanceAfter || 0)}</strong>
        </div>
      </div>
      <div class="receipt-grid">
        <p><span>Client</span><strong>${escapeHtml(receipt.clientName || "N/A")}</strong></p>
        <p><span>Profile ID</span><strong>${escapeHtml(receipt.profileId || "N/A")}</strong></p>
        <p><span>Date</span><strong>${escapeHtml(receipt.paymentDate || "N/A")}</strong></p>
        <p><span>Mode</span><strong>${escapeHtml(receipt.mode || "N/A")}</strong></p>
        <p><span>Purpose</span><strong>${escapeHtml(receipt.purpose || "N/A")}</strong></p>
        <p><span>Received By</span><strong>${escapeHtml(receipt.receivedBy || "N/A")}</strong></p>
      </div>
      <div class="receipt-footer single">
        <div><span>Receiver Signature</span></div>
      </div>
    </div>`;
}

function setReceiptPrintSize(size) {
  const selectedSize = size === "a4" ? "a4" : "4x6";
  const style = $("#receiptPageStyle") || document.createElement("style");
  style.id = "receiptPageStyle";
  style.textContent = selectedSize === "a4"
    ? "@page { size: A4; margin: 0; }"
    : "@page { size: 4in 6in; margin: 0; }";
  if (!style.parentNode) document.head.appendChild(style);
  $("#receiptPrintArea")?.classList.toggle("receipt-a4", selectedSize === "a4");
  $("#receiptPrintArea")?.classList.toggle("receipt-4x6", selectedSize !== "a4");
}

function printReceipt() {
  setReceiptPrintSize($("#receiptSize")?.value || "4x6");
  const previousTitle = document.title;
  if (activeReceiptTitle) document.title = activeReceiptTitle;
  const restoreTitle = () => {
    document.title = previousTitle;
    window.removeEventListener("afterprint", restoreTitle);
  };
  window.addEventListener("afterprint", restoreTitle);
  window.print();
}

function receiptFileName(receipt) {
  const client = String(receipt?.clientName || "Client").trim() || "Client";
  return `${sanitizeFileName(client)} payment receipt`;
}

function sanitizeFileName(value) {
  return String(value || "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
async function submitPayment(event) {
  event.preventDefault();
  if (!state.session?.token) return toast("Login required");
  const form = event.target;
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "Saving...";
  try {
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.token = state.session.token;
    const result = await api("savePayment", payload);
    if (!result.ok) throw new Error(result.error || "Payment save failed");
    closeModals();
    openReceiptModal(result.payment || payload);
    state.activeTab = "payments";
    await loadDashboardData();
    renderTabs();
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Save Payment";
  }
}
function openDetails(profile) {
  $("#detailTitle").textContent = profile.fullName || "Profile";
  const photo = photoUrl(profile.photo);
  const isLoggedIn = Boolean(state.session);
  const profilePayments = cleanPayments(state.payments || []).filter((payment) => String(payment.profileId || "") === String(profile.id || ""));
  const totalPaid = profilePayments.reduce((sum, payment) => sum + signedPaymentAmount(payment), 0);
  const lastPayment = profilePayments[profilePayments.length - 1];
  const publicFields = [
    ["ID", profile.id], ["বয়স", profile.age], ["লিঙ্গ", profile.gender],
    ["উচ্চতা", profile.height], ["গায়ের রং", profile.complexion],
    ["ধর্ম", profile.religion], ["সম্প্রদায়", profile.community], ["জাতি", profile.caste],
    ["শিক্ষা", profile.education], ["নিজের পেশা", profile.occupation],
    ["বৈবাহিক অবস্থা", profile.maritalStatus], ["খাদ্যাভ্যাস", profile.diet],
    ["জেলা", profile.district], ["রাজ্য", profile.state],
    ["পছন্দের গায়ের রং", profile.prefComplexion], ["পছন্দের শিক্ষা", profile.prefEducationLevel],
    ["পছন্দের বয়স", profile.prefAgeRange], ["পছন্দের উচ্চতা", profile.prefHeight],
    ["পছন্দের পেশা", profile.prefLivelihood], ["নিজের সম্পর্কে", profile.about],
    ["যোগাযোগ", "অফিস বা এজেন্টের সাথে যোগাযোগ করুন"]
  ];
  const privateFields = [
    ["ID", profile.id], ["বয়স", profile.age], ["লিঙ্গ", profile.gender],
    ["বাবার নাম", profile.fatherName], ["মায়ের নাম", profile.motherName],
    ["ওজন", profile.weight], ["উচ্চতা", profile.height], ["গায়ের রং", profile.complexion],
    ["ধর্ম", profile.religion], ["সম্প্রদায়", profile.community], ["জাতি", profile.caste],
    ["গোত্র", profile.gotra], ["লগ্ন / রাশি", profile.rashi], ["শিক্ষা", profile.education],
    ["নিজের পেশা", profile.occupation], ["বাবার পেশা", profile.fatherProfession],
    ["মায়ের পেশা", profile.motherProfession], ["আয়", profile.income],
    ["বাড়ির ধরন", profile.homeType], ["কত নম্বর সন্তান", profile.childOrder],
    ["ভাই সংখ্যা", profile.brothersCount], ["বোন সংখ্যা", profile.sistersCount], ["জীবনের ইচ্ছা", profile.lifeWish],
    ["বৈবাহিক অবস্থা", profile.maritalStatus], ["প্রথম বিবাহ", profile.firstMarriage], ["খাদ্যাভ্যাস", profile.diet],
    ["ঠিকানা", [profile.addressLine, profile.villageTown, profile.postOffice, profile.policestation, profile.district, profile.state, profile.pin].filter(Boolean).join(", ")],
    ["পছন্দের গায়ের রং", profile.prefComplexion], ["পছন্দের শিক্ষা", profile.prefEducationLevel],
    ["পছন্দের বয়স", profile.prefAgeRange], ["পছন্দের উচ্চতা", profile.prefHeight],
    ["পছন্দের পেশা", profile.prefLivelihood], ["পছন্দের আয়", profile.prefIncomeType],
    ["নিজের সম্পর্কে", profile.about], ["মোবাইল", profile.phone], ["ইমেল", profile.email],
    ["ডকুমেন্ট টাইপ", profile.documentType], ["ডকুমেন্ট", profile.document]
  ];
  const fields = isLoggedIn ? privateFields : publicFields;
  const paymentPanel = isLoggedIn ? `
    <div class="detail-payment-panel">
      <div class="detail-payment-summary">
        <p><strong>₹${escapeHtml(totalPaid || 0)}</strong><span>Balance</span></p>
        <p><strong>${escapeHtml(profilePayments.length)}</strong><span>Payments</span></p>
        <p><strong>${escapeHtml(lastPayment?.paymentDate || "N/A")}</strong><span>Last Payment</span></p>
      </div>
      <div class="detail-payment-list">
        ${profilePayments.length ? profilePayments.map((payment) => `
          <div class="payment-mini-row">
            <strong>${paymentDirection(payment) === "debit" ? "-" : "+"}₹${escapeHtml(payment.amount || "0")}</strong>
            <span>${escapeHtml(payment.paymentDate || "")}</span>
            <span>${escapeHtml(payment.mode || "")}</span>
            <em>${escapeHtml(payment.purpose || "")}</em>
          </div>`).join("") : `<div class="payment-mini-row empty">No payment added yet.</div>`}
      </div>
    </div>` : "";
  $("#detailBody").innerHTML = `
    <div class="detail-hero">
      <div class="detail-photo-wrap">${photo ? `<img class="detail-photo" src="${escapeAttr(photo)}" referrerpolicy="no-referrer" alt="${escapeAttr(profile.fullName || "Profile")}">` : `<div class="detail-photo avatar" style="aspect-ratio:1">${initials(profile.fullName)}</div>`}</div>
      <div class="detail-summary">
        <span class="status ${escapeAttr(profile.status || "pending")}">${escapeHtml(profile.status || "pending")}</span>
        <h4>${escapeHtml(profile.fullName || "Profile")}</h4>
        <p>${escapeHtml([profile.age ? `${profile.age} yrs` : "", profile.height, profile.education, profile.occupation].filter(Boolean).join(" • "))}</p>
        <div class="detail-tags">${[profile.religion, profile.community, profile.district].filter(Boolean).map(chip).join("")}</div>
      </div>
    </div>
    ${paymentPanel}
    <div class="detail-list upgraded">${fields.map(([label, value]) => `<p><strong>${escapeHtml(label)}</strong>${formatDetailValue(value)}</p>`).join("")}</div>`;
  openModal("detailModal");
}
function formatDetailValue(value) {
  if (!value) return "N/A";
  const text = String(value);
  if (/^https?:\/\//i.test(text)) {
    return `<a href="${escapeAttr(text)}" target="_blank" rel="noopener">Open link</a>`;
  }
  return escapeHtml(text);
}
function showProfileSuccess(name, id, isUpdate) {
  $("#successTitle").textContent = isUpdate ? "প্রোফাইল আপডেট হয়েছে" : "প্রোফাইল তৈরি হয়েছে";
  $("#successMessage").textContent = `${name || "Client"} - এর profile সফলভাবে ${isUpdate ? "আপডেট" : "সেভ"} করা হয়েছে।`;
  $("#successProfileId").textContent = id ? `Profile ID: ${id}` : "Profile ID save হওয়ার পর পাওয়া যাবে";
  openModal("successModal");
}
function logout() {
  clearInactivityTimer();
  state.session = null;
  state.activeTab = "profiles";
  document.body.classList.remove("dashboard-mode", "admin-mode", "agent-mode");
  $("#dashboardSection").classList.add("hidden");
  $$(".public-view").forEach((element) => element.classList.remove("hidden"));
  window.scrollTo({ top: 0, behavior: "smooth" });
  toast("Logged out");
}

function openModal(id) {
  closeModals();
  const modal = document.getElementById(id);
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closeModals() {
  $$(".modal").forEach((modal) => {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  });
}

function closeMessageModal() {
  const modal = $("#messageModal");
  if (!modal) return;
  modal.classList.remove("open", "success", "error", "info");
  modal.setAttribute("aria-hidden", "true");
}

function toast(message, type) {
  showMessageModal(message, type);
}

function showMessageModal(message, type = "") {
  const modal = $("#messageModal");
  if (!modal) return;
  const normalized = normalizeMessage(message);
  const messageType = type || normalized.type;
  modal.classList.remove("success", "error", "info");
  modal.classList.add(messageType);
  $("#messageMark").textContent = messageType === "error" ? "!" : messageType === "info" ? "i" : "✓";
  $("#messageTitle").textContent = normalized.title;
  $("#messageText").textContent = normalized.text;
  $("#messageDetail").textContent = normalized.detail || "";
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function normalizeMessage(message) {
  const raw = String(message || "").trim();
  const isError = /failed|error|required|invalid|delete failed|save failed|login failed|loading failed|update failed|not allowed|expired|সঠিক|দিন/i.test(raw);
  const successMap = {
    "Login successful": ["লগইন সফল হয়েছে", "আপনি সফলভাবে dashboard-এ প্রবেশ করেছেন।"],
    "Logged out": ["লগআউট সম্পন্ন হয়েছে", "আপনি সফলভাবে account থেকে বের হয়েছেন।"],
    "Status updated": ["স্ট্যাটাস আপডেট হয়েছে", "Client profile-এর status সফলভাবে পরিবর্তন করা হয়েছে।"],
    "Profile deleted": ["প্রোফাইল ডিলিট হয়েছে", "Client profile list থেকে এই profile সরানো হয়েছে।"],
    "Agent saved": ["Agent সেভ হয়েছে", "Agent account সফলভাবে সেভ করা হয়েছে।"],
    "Agent status updated": ["Agent status আপডেট হয়েছে", "Agent account-এর status সফলভাবে পরিবর্তন করা হয়েছে।"],
    "Agent deleted": ["Agent ডিলিট হয়েছে", "Agent account list থেকে সরানো হয়েছে।"],
    "Added to shortlist": ["Shortlist-এ যোগ হয়েছে", "এই profile shortlist-এ রাখা হয়েছে।"]
  };
  if (successMap[raw]) {
    return { type: "success", title: successMap[raw][0], text: successMap[raw][1] };
  }
  if (raw.startsWith("Payment saved:")) {
    const id = raw.replace("Payment saved:", "").trim();
    return { type: "success", title: "Payment সেভ হয়েছে", text: "Client payment details সফলভাবে সেভ করা হয়েছে।", detail: id ? `Payment ID: ${id}` : "" };
  }
  if (raw === "Session expired due to inactivity") {
    return { type: "info", title: "Session শেষ হয়েছে", text: "২ মিনিট কোনো কাজ না হওয়ায় নিরাপত্তার জন্য আপনাকে logout করা হয়েছে।" };
  }
  if (isError) {
    return { type: "error", title: "কাজটি সম্পন্ন হয়নি", text: "দয়া করে তথ্যগুলো আরেকবার দেখে আবার চেষ্টা করুন।", detail: raw || "Unknown error" };
  }
  return { type: "info", title: "বার্তা", text: raw || "কাজটি সম্পন্ন হয়েছে।" };
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function statusBadge(status) {
  const clean = status || "pending";
  return `<span class="status ${escapeAttr(clean)}">${escapeHtml(clean)}</span>`;
}

function chip(value) {
  return value ? `<span>${escapeHtml(value)}</span>` : "";
}

function photoUrl(value) {
  if (!value) return "";
  const url = String(value).trim();
  if (url.startsWith("data:image/")) return url;
  const idMatch = url.match(/(?:id=|\/d\/)([-\w]{20,})/);
  if (url.includes("drive.google.com") && idMatch) {
    return `https://drive.google.com/thumbnail?id=${idMatch[1]}&sz=w1000`;
  }
  return url;
}

function initials(name = "") {
  const text = String(name).trim();
  if (!text) return "BB";
  return text.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function sameChoice(value, expected) {
  const aliases = {
    female: "মেয়ে",
    bride: "মেয়ে",
    male: "ছেলে",
    groom: "ছেলে",
    hindu: "হিন্দু",
    muslim: "মুসলিম",
    christian: "খ্রিস্টান",
    sikh: "শিখ",
    jain: "জৈন",
    buddhist: "বৌদ্ধ",
  };
  const left = aliases[normalize(value)] || normalize(value);
  const right = aliases[normalize(expected)] || normalize(expected);
  return left === right;
}

function includes(value, query) {
  return normalize(value).includes(normalize(query));
}

function emptyMessage(text) {
  return `<div class="panel" style="grid-column:1/-1;text-align:center">${escapeHtml(text)}</div>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function openPaymentModal(profile) {
  const form = $("#paymentForm");
  form.reset();
  form.profileId.value = profile.id || "";
  form.clientName.value = profile.fullName || "";
  form.agentId.value = profile.agentId || "";
  form.paymentDate.value = new Date().toISOString().slice(0, 10);
  if ($("#paymentClientName")) $("#paymentClientName").textContent = profile.fullName || "Client";
  if ($("#paymentProfileId")) $("#paymentProfileId").textContent = profile.id ? `Profile ID: ${profile.id}` : "";
  openModal("paymentModal");
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js")
      .then(() => console.log("Service Worker Registered"))
      .catch(err => console.log(err));
  });
}
