// ========================================
// SUPABASE CONFIGURATION
// (URL + key now live in config.js)
// ========================================

const {
    SUPABASE_URL,
    SUPABASE_KEY,
    QUEUE_WINDOW_HOURS = 24,
    AVG_MIN_PER_PATIENT = 5
} = window.SMARTCARE_CONFIG;

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY,
    {
        auth: {
            // Staff sessions end when the browser tab is closed.
            storage: window.sessionStorage,
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
        }
    }
);


// ========================================
// VARIABLES
// ========================================

let patients = [];
let currentPatient = null;
let announcements = [];
let reloadTimer = null;


// ========================================
// ELEMENTS
// ========================================

const patientsTableBody =
    document.getElementById("patientsTableBody");

const departmentFilter =
    document.getElementById("departmentFilter");

const statusFilter =
    document.getElementById("statusFilter");

const searchInput =
    document.getElementById("searchInput");

const callNextBtn =
    document.getElementById("callNextBtn");

const completeBtn =
    document.getElementById("completeBtn");

const skipBtn =
    document.getElementById("skipBtn");

const refreshBtn =
    document.getElementById("refreshBtn");

const currentPatientElement =
    document.getElementById("currentPatient");

const toast =
    document.getElementById("toast");

const connectionText =
    document.getElementById("connectionText");

const logoutBtn =
    document.getElementById("logoutBtn");

const announceForm =
    document.getElementById("announceForm");

const noticeKind =
    document.getElementById("noticeKind");

const noticeMessage =
    document.getElementById("noticeMessage");

const noticeBtn =
    document.getElementById("noticeBtn");

const noticeError =
    document.getElementById("noticeError");

const noticeList =
    document.getElementById("noticeList");


// ========================================
// STAFF AUTHENTICATION
// A login alone is not enough: the account
// must also have the "staff" role.
// ========================================

async function checkStaffLogin() {

    const { data, error } =
        await supabaseClient.auth.getSession();

    if (error || !data.session) {

        if (error) console.error("Session error:", error);

        window.location.replace("staff-login.html");

        return false;
    }

    const { data: isStaff, error: roleError } =
        await supabaseClient.rpc("is_staff");

    if (roleError) {
        // Could be a network problem: do not sign the user out.
        console.error("Role check error:", roleError);

        window.location.replace("staff-login.html");

        return false;
    }

    if (isStaff !== true) {

        await supabaseClient.auth.signOut();

        window.location.replace("staff-login.html?denied=1");

        return false;
    }

    return true;
}


// ========================================
// LOGOUT
// ========================================

async function logoutStaff() {

    logoutBtn.disabled = true;
    logoutBtn.textContent = "Logging out...";

    const { error } =
        await supabaseClient.auth.signOut();

    if (error) {
        console.error("Logout error:", error);

        showToast("Unable to logout.");

        logoutBtn.disabled = false;
        logoutBtn.textContent = "Logout";

        return;
    }

    window.location.replace("staff-login.html");
}


// ========================================
// TOAST MESSAGE
// ========================================

let toastTimer;

function showToast(message) {

    if (!toast) return;

    toast.textContent = message;
    toast.classList.add("show");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
        toast.classList.remove("show");
    }, 3000);
}


// ========================================
// QUEUE MATHS
// Estimated time is calculated from the live
// queue instead of being stored, so it never
// goes out of date.
// ========================================

function sameId(a, b) {
    return String(a) === String(b);
}

function waitingAhead(patient) {

    const mine = new Date(patient.queue_at).getTime();

    return patients.filter(item =>
        item.department === patient.department &&
        item.status === "Waiting" &&
        new Date(item.queue_at).getTime() < mine
    ).length;
}

function estimateFor(patient) {

    if (patient.status === "Serving") return "Now";
    if (patient.status === "Completed") return "—";

    return (waitingAhead(patient) + 1) * AVG_MIN_PER_PATIENT + " min";
}


// ========================================
// LOAD PATIENTS
// ========================================

async function loadPatients(silent = false) {

    if (!silent && connectionText) {
        connectionText.textContent = "Loading...";
    }

    // const since = new Date(
    //     Date.now() - QUEUE_WINDOW_HOURS * 60 * 60 * 1000
    // ).toISOString();

    // const { data, error } = await supabaseClient
    //     .from("patients")
    //     .select("*")
    //     .gte("created_at", since)
    //     .order("queue_at", {
    //         ascending: true
    //     })
    //     .limit(500);

    
const { data, error } = await supabaseClient
    .from("patients")
    .select("*")
    .order("queue_at", { ascending: true })
    .limit(500);


    if (error) {

        console.error("Error loading patients:", error);

        if (connectionText) {
            connectionText.textContent = "Database Error";
        }

        if (!silent) {
            patientsTableBody.innerHTML = `
                <tr>
                    <td colspan="9" class="empty-cell">
                        Unable to load patients.
                    </td>
                </tr>
            `;

            showToast("Unable to load patients.");
        }

        return;
    }

    patients = data || [];

    if (connectionText && !silent) {
        connectionText.textContent = "Connected";
    }

    updateStatistics();
    displayPatients();
    updateCurrentPatient();
}

// Many realtime events can arrive at once: reload only once.
function scheduleReload() {

    clearTimeout(reloadTimer);

    reloadTimer = setTimeout(() => loadPatients(true), 300);
}


// ========================================
// STATISTICS
// ========================================

function updateStatistics() {

    document.getElementById("totalPatients").textContent =
        patients.length;

    document.getElementById("waitingPatients").textContent =
        patients.filter(
            patient => patient.status === "Waiting"
        ).length;

    document.getElementById("servingPatients").textContent =
        patients.filter(
            patient => patient.status === "Serving"
        ).length;

    document.getElementById("completedPatients").textContent =
        patients.filter(
            patient => patient.status === "Completed"
        ).length;
}


// ========================================
// FILTER PATIENTS
// ========================================

function getFilteredPatients() {

    const department = departmentFilter.value;
    const status = statusFilter.value;
    const search = searchInput.value.trim().toLowerCase();

    return patients.filter(patient => {

        const matchesDepartment =
            department === "All" ||
            patient.department === department;

        const matchesStatus =
            status === "All" ||
            patient.status === status;

        const matchesSearch =
            !search ||
            String(patient.token ?? "")
                .toLowerCase()
                .includes(search) ||
            String(patient.full_name ?? "")
                .toLowerCase()
                .includes(search);

        return (
            matchesDepartment &&
            matchesStatus &&
            matchesSearch
        );
    });
}


// ========================================
// DISPLAY PATIENTS
// ========================================

function displayPatients() {

    const filteredPatients = getFilteredPatients();

    patientsTableBody.innerHTML = "";

    if (filteredPatients.length === 0) {

        patientsTableBody.innerHTML = `
            <tr>
                <td colspan="9" class="empty-cell">
                    No patients found.
                </td>
            </tr>
        `;

        return;
    }

    filteredPatients.forEach(patient => {

        const row = document.createElement("tr");

        let statusClass = "status-completed";

        if (patient.status === "Waiting") {
            statusClass = "status-waiting";
        }

        if (patient.status === "Serving") {
            statusClass = "status-serving";
        }

        const reason = String(patient.reason ?? "");

        // NOTE: "age ?? '-'" so a newborn (age 0) is shown as 0, not "-"
        row.innerHTML = `
            <td class="token-cell">
                ${escapeHTML(patient.token)}
            </td>

            <td>
                ${escapeHTML(patient.full_name)}
            </td>

            <td>
                ${escapeHTML(patient.age ?? "-")}
            </td>

            <td>
                ${escapeHTML(patient.mobile)}
            </td>

            <td>
                ${escapeHTML(patient.department)}
            </td>

            <td title="${escapeHTML(reason)}">
                ${escapeHTML(reason ? reason.slice(0, 40) : "-")}
            </td>

            <td>
                <span class="status-badge ${statusClass}">
                    ${escapeHTML(patient.status)}
                </span>
            </td>

            <td>
                ${escapeHTML(estimateFor(patient))}
            </td>

            <td>
                ${
                    patient.status === "Waiting"
                        ? `
                            <button
                                class="table-action"
                                type="button"
                                data-call="${escapeHTML(patient.id)}"
                            >
                                Call
                            </button>
                        `
                        : "-"
                }
            </td>
        `;

        patientsTableBody.appendChild(row);
    });
}


// ========================================
// CALL NEXT PATIENT
// ========================================

async function callNextPatient() {

    const department = departmentFilter.value;

    // Each department has its own queue, so pick one first.
    if (department === "All") {

        showToast("Select a department first, then call the next patient.");

        departmentFilter.focus();

        return;
    }

    const alreadyServing = patients.find(patient =>
        patient.status === "Serving" &&
        patient.department === department
    );

    if (alreadyServing) {

        showToast(
            `${alreadyServing.token} is already serving.`
        );

        return;
    }

    // "patients" is sorted by queue position, so the first match is next.
    const nextPatient = patients.find(patient =>
        patient.status === "Waiting" &&
        patient.department === department
    );

    if (!nextPatient) {

        showToast("No waiting patients found.");

        return;
    }

    await updatePatient(nextPatient.id, {
        status: "Serving",
        estimated_time: "Now"
    });
}


// ========================================
// CALL SPECIFIC PATIENT
// ========================================

async function callSpecificPatient(id) {

    const patient = patients.find(
        item => sameId(item.id, id)
    );

    if (!patient) return;

    const alreadyServing = patients.find(item =>
        item.status === "Serving" &&
        item.department === patient.department
    );

    if (alreadyServing) {

        showToast(
            `${alreadyServing.token} is already serving.`
        );

        return;
    }

    await updatePatient(patient.id, {
        status: "Serving",
        estimated_time: "Now"
    });
}


// ========================================
// COMPLETE PATIENT
// ========================================

async function completeCurrentPatient() {

    if (!currentPatient) return;

    await updatePatient(currentPatient.id, {
        status: "Completed",
        estimated_time: "Completed"
    });
}


// ========================================
// SKIP PATIENT
// The patient goes to the BACK of the line
// (queue_at = now). Before, a skipped patient
// stayed first in line and was called again.
// ========================================

async function skipCurrentPatient() {

    if (!currentPatient) return;

    await updatePatient(currentPatient.id, {
        status: "Waiting",
        estimated_time: "Skipped",
        queue_at: new Date().toISOString()
    });
}


// ========================================
// UPDATE PATIENT
// ========================================

async function updatePatient(patientId, fields) {

    const { data, error } = await supabaseClient
        .from("patients")
        .update(fields)
        .eq("id", patientId)
        .select("id");

    if (error) {

        console.error("Update error:", error);

        // 23505 = the "one Serving patient per department" rule was hit
        if (error.code === "23505") {
            showToast("Another patient is already being served in this department.");
        } else {
            showToast("Unable to update patient.");
        }

        await loadPatients(true);

        return false;
    }

    // Row Level Security silently updates 0 rows when not allowed
    if (!data || data.length === 0) {

        showToast("You do not have permission to update this patient.");

        return false;
    }

    showToast("Patient queue updated successfully.");

    await loadPatients(true);

    return true;
}


// ========================================
// CURRENT PATIENT
// ========================================

function updateCurrentPatient() {

    const department = departmentFilter.value;

    currentPatient = patients.find(patient =>
        patient.status === "Serving" &&
        (
            department === "All" ||
            patient.department === department
        )
    ) || null;

    if (!currentPatient) {

        currentPatientElement.innerHTML = `
            <div class="current-patient-empty">
                <span>🎟️</span>

                <div>
                    <h3>No Patient Currently Serving</h3>

                    <p>
                        Select a department and click "Call Next Patient" to begin.
                    </p>
                </div>
            </div>
        `;

        completeBtn.disabled = true;
        skipBtn.disabled = true;

        return;
    }

    currentPatientElement.innerHTML = `
        <div class="current-patient-active">

            <div class="current-token">
                ${escapeHTML(currentPatient.token)}
            </div>

            <div class="current-patient-details">

                <h3>
                    ${escapeHTML(currentPatient.full_name)}
                </h3>

                <p>
                    Department:
                    ${escapeHTML(currentPatient.department)}
                </p>

                <p>
                    Mobile:
                    ${escapeHTML(currentPatient.mobile)}
                </p>

            </div>

            <span class="current-status">
                CURRENTLY SERVING
            </span>

        </div>
    `;

    completeBtn.disabled = false;
    skipBtn.disabled = false;
}


// ========================================
// ANNOUNCEMENTS
// ========================================

async function loadAnnouncements() {

    const { data, error } = await supabaseClient
        .from("announcements")
        .select("*")
        .order("created_at", {
            ascending: false
        })
        .limit(20);

    if (error) {

        console.error("Announcements error:", error);

        noticeList.innerHTML = `
            <li class="notice-empty">
                Unable to load announcements. Has the database script been run?
            </li>
        `;

        return;
    }

    announcements = data || [];

    displayAnnouncements();
}

function displayAnnouncements() {

    if (announcements.length === 0) {

        noticeList.innerHTML = `
            <li class="notice-empty">
                No announcements yet.
            </li>
        `;

        return;
    }

    noticeList.innerHTML = announcements.map(item => `
        <li class="${item.is_active ? "" : "notice-hidden"}">

            <span>
                <span class="notice-kind ${item.kind === "doctor" ? "doctor" : ""}">
                    ${item.kind === "doctor" ? "Doctor availability" : "Department notice"}
                </span>
                ${escapeHTML(item.message)}
                ${item.is_active ? "" : "<em>(hidden)</em>"}
            </span>

            <span class="notice-buttons">
                <button
                    class="table-action"
                    type="button"
                    data-toggle-notice="${escapeHTML(item.id)}"
                >
                    ${item.is_active ? "Hide" : "Show"}
                </button>

                <button
                    class="table-action danger"
                    type="button"
                    data-delete-notice="${escapeHTML(item.id)}"
                >
                    Delete
                </button>
            </span>

        </li>
    `).join("");
}

async function publishAnnouncement(event) {

    event.preventDefault();

    const message = noticeMessage.value.trim();

    noticeError.textContent = "";

    if (message.length < 5 || message.length > 140) {

        noticeError.textContent =
            "Enter a message between 5 and 140 characters.";

        noticeMessage.focus();

        return;
    }

    noticeBtn.disabled = true;

    const { error } = await supabaseClient
        .from("announcements")
        .insert({
            kind: noticeKind.value,
            message: message
        });

    noticeBtn.disabled = false;

    if (error) {

        console.error("Publish error:", error);

        noticeError.textContent = "Unable to publish the announcement.";

        return;
    }

    noticeMessage.value = "";

    showToast("Announcement published.");

    await loadAnnouncements();
}

async function toggleAnnouncement(id) {

    const item = announcements.find(
        entry => sameId(entry.id, id)
    );

    if (!item) return;

    const { error } = await supabaseClient
        .from("announcements")
        .update({ is_active: !item.is_active })
        .eq("id", item.id);

    if (error) {
        console.error("Toggle error:", error);
        showToast("Unable to update announcement.");
        return;
    }

    await loadAnnouncements();
}

async function deleteAnnouncement(id) {

    if (!window.confirm("Delete this announcement permanently?")) return;

    const { error } = await supabaseClient
        .from("announcements")
        .delete()
        .eq("id", id);

    if (error) {
        console.error("Delete error:", error);
        showToast("Unable to delete announcement.");
        return;
    }

    showToast("Announcement deleted.");

    await loadAnnouncements();
}


// ========================================
// ESCAPE HTML
// ========================================

function escapeHTML(value) {

    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


// ========================================
// REAL-TIME UPDATES
// Realtime pushes changes instantly. A slow
// background refresh is kept as a safety net
// in case the realtime connection drops.
// ========================================

function subscribeToRealtime() {

    supabaseClient
        .channel("staff-patients-realtime")
        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: "patients"
            },
            scheduleReload
        )
        .subscribe(function (status) {

            if (!connectionText) return;

            if (status === "SUBSCRIBED") {
                connectionText.textContent = "Live";
            } else if (
                status === "CHANNEL_ERROR" ||
                status === "TIMED_OUT"
            ) {
                connectionText.textContent = "Connected (auto-refresh)";
            }
        });

    setInterval(function () {
        if (!document.hidden) loadPatients(true);
    }, 15000);
}


// ========================================
// EVENT LISTENERS
// ========================================

function setupEventListeners() {

    logoutBtn.addEventListener(
        "click",
        logoutStaff
    );

    callNextBtn.addEventListener(
        "click",
        callNextPatient
    );

    completeBtn.addEventListener(
        "click",
        completeCurrentPatient
    );

    skipBtn.addEventListener(
        "click",
        skipCurrentPatient
    );

    refreshBtn.addEventListener(
        "click",
        function () {
            loadPatients();
            loadAnnouncements();
        }
    );

    departmentFilter.addEventListener(
        "change",
        function () {
            displayPatients();
            updateCurrentPatient();
        }
    );

    statusFilter.addEventListener(
        "change",
        displayPatients
    );

    searchInput.addEventListener(
        "input",
        displayPatients
    );

    // "Call" buttons inside the table
    patientsTableBody.addEventListener(
        "click",
        function (event) {

            const button = event.target.closest("[data-call]");

            if (button) {
                callSpecificPatient(button.dataset.call);
            }
        }
    );

    announceForm.addEventListener(
        "submit",
        publishAnnouncement
    );

    noticeList.addEventListener(
        "click",
        function (event) {

            const toggle =
                event.target.closest("[data-toggle-notice]");

            const remove =
                event.target.closest("[data-delete-notice]");

            if (toggle) toggleAnnouncement(toggle.dataset.toggleNotice);
            if (remove) deleteAnnouncement(remove.dataset.deleteNotice);
        }
    );

    // If the session ends (expired / signed out elsewhere), leave the dashboard
    supabaseClient.auth.onAuthStateChange(function (event) {

        if (event === "SIGNED_OUT") {
            window.location.replace("staff-login.html");
        }
    });
}


// ========================================
// START DASHBOARD
// ========================================

async function startDashboard() {

    const loggedIn = await checkStaffLogin();

    if (!loggedIn) return;

    setupEventListeners();

    await loadPatients();
    await loadAnnouncements();

    subscribeToRealtime();

    console.log("Staff dashboard started successfully.");
}


// ========================================
// INITIALIZE
// ========================================

document.addEventListener(
    "DOMContentLoaded",
    startDashboard
);

/* =========================================================
   SmartCare — staff-ui.js
   Theme toggle for the staff pages. Uses the same saved
   setting ("sc_theme") as the patient website.
   Kept separate so staff.js does not need to change.
   ========================================================= */
(function () {
    "use strict";

    var button = document.getElementById("themeToggle");

    if (!button) return;

    function applyTheme(theme) {
        document.documentElement.setAttribute("data-theme", theme);

        try {
            localStorage.setItem("sc_theme", theme);
        } catch (e) { /* storage blocked: theme still changes for this visit */ }

        button.setAttribute("aria-pressed", String(theme === "dark"));
        button.setAttribute(
            "aria-label",
            theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
        );
    }

    applyTheme(document.documentElement.getAttribute("data-theme") || "light");

    button.addEventListener("click", function () {
        var isDark = document.documentElement.getAttribute("data-theme") === "dark";
        applyTheme(isDark ? "light" : "dark");
    });
})();
