// ========================================
// SUPABASE CONFIGURATION
// ========================================

const SUPABASE_URL =
    "https://poxftbzgcguzpdsjkbrs.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
    "sb_publishable_klfcdMI4YZ20UC4YNj465w_2Qxefr_J";

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
);


// ========================================
// VARIABLES
// ========================================

let patients = [];
let currentPatient = null;


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


// ========================================
// STAFF AUTHENTICATION
// ========================================

async function checkStaffLogin() {

    const { data, error } =
        await supabaseClient.auth.getSession();

    if (error) {
        console.error("Session error:", error);

        window.location.replace("staff-login.html");

        return false;
    }

    if (!data.session) {
        window.location.replace("staff-login.html");

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

function showToast(message) {

    if (!toast) return;

    toast.textContent = message;
    toast.classList.add("show");

    setTimeout(() => {
        toast.classList.remove("show");
    }, 3000);
}


// ========================================
// LOAD PATIENTS
// ========================================

async function loadPatients() {

    if (connectionText) {
        connectionText.textContent = "Loading...";
    }

    const { data, error } = await supabaseClient
        .from("patients")
        .select("*")
        .order("created_at", {
            ascending: true
        });

    if (error) {

        console.error("Error loading patients:", error);

        if (connectionText) {
            connectionText.textContent = "Database Error";
        }

        patientsTableBody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-cell">
                    Unable to load patients.
                </td>
            </tr>
        `;

        showToast("Unable to load patients.");

        return;
    }

    patients = data || [];

    if (connectionText) {
        connectionText.textContent = "Connected";
    }

    updateStatistics();
    displayPatients();
    updateCurrentPatient();
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
                <td colspan="8" class="empty-cell">
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

        row.innerHTML = `
            <td class="token-cell">
                ${escapeHTML(patient.token)}
            </td>

            <td>
                ${escapeHTML(patient.full_name)}
            </td>

            <td>
                ${patient.age || "-"}
            </td>

            <td>
                ${escapeHTML(patient.mobile)}
            </td>

            <td>
                ${escapeHTML(patient.department)}
            </td>

            <td>
                <span class="status-badge ${statusClass}">
                    ${escapeHTML(patient.status)}
                </span>
            </td>

            <td>
                ${escapeHTML(patient.estimated_time || "-")}
            </td>

            <td>
                ${
                    patient.status === "Waiting"
                        ? `
                            <button
                                class="table-action"
                                onclick="callSpecificPatient('${patient.id}')"
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

    const alreadyServing = patients.find(patient =>
        patient.status === "Serving" &&
        (
            department === "All" ||
            patient.department === department
        )
    );

    if (alreadyServing) {

        showToast(
            `${alreadyServing.token} is already serving.`
        );

        return;
    }

    const nextPatient = patients.find(patient =>
        patient.status === "Waiting" &&
        (
            department === "All" ||
            patient.department === department
        )
    );

    if (!nextPatient) {

        showToast("No waiting patients found.");

        return;
    }

    await updatePatientStatus(
        nextPatient.id,
        "Serving",
        "Now"
    );
}


// ========================================
// CALL SPECIFIC PATIENT
// ========================================

async function callSpecificPatient(id) {

    const patient = patients.find(
        item => item.id === id
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

    await updatePatientStatus(
        patient.id,
        "Serving",
        "Now"
    );
}


// ========================================
// COMPLETE PATIENT
// ========================================

async function completeCurrentPatient() {

    if (!currentPatient) return;

    await updatePatientStatus(
        currentPatient.id,
        "Completed",
        "Completed"
    );
}


// ========================================
// SKIP PATIENT
// ========================================

async function skipCurrentPatient() {

    if (!currentPatient) return;

    await updatePatientStatus(
        currentPatient.id,
        "Waiting",
        "Skipped"
    );
}


// ========================================
// UPDATE PATIENT STATUS
// ========================================

async function updatePatientStatus(
    patientId,
    status,
    estimatedTime
) {

    const { error } = await supabaseClient
        .from("patients")
        .update({
            status: status,
            estimated_time: estimatedTime
        })
        .eq("id", patientId);

    if (error) {

        console.error("Update error:", error);

        showToast("Unable to update patient.");

        return;
    }

    showToast("Patient queue updated successfully.");

    await loadPatients();
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
                        Click "Call Next Patient" to begin.
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
            function () {
                loadPatients();
            }
        )
        .subscribe();
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
        loadPatients
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
}


// ========================================
// START DASHBOARD
// ========================================

async function startDashboard() {

    const loggedIn = await checkStaffLogin();

    if (!loggedIn) return;

    setupEventListeners();

    await loadPatients();

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