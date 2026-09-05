/* ========================================
   SUPABASE CONNECTION
======================================== */

const SUPABASE_URL =
    "https://poxftbzgcguzpdsjkbrs.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
    "sb_publishable_klfcdMI4YZ20UC4YNj465w_2Qxefr_J";

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
);


/* ========================================
   DATA
======================================== */

let queueData = [];
let nextTokenNumber = 1;


/* ========================================
   HTML ELEMENTS
======================================== */

const registrationForm =
    document.getElementById("registrationForm");

const registrationSuccess =
    document.getElementById("registrationSuccess");

const generatedToken =
    document.getElementById("generatedToken");

const registerAnotherBtn =
    document.getElementById("registerAnotherBtn");

const queueTableBody =
    document.getElementById("queueTableBody");

const registeredCount =
    document.getElementById("registeredCount");

const tokenSearchInput =
    document.getElementById("tokenSearchInput");

const trackTokenBtn =
    document.getElementById("trackTokenBtn");

const dashboardResult =
    document.getElementById("dashboardResult");

const heroServingToken =
    document.getElementById("heroServingToken");

const heroNextToken =
    document.getElementById("heroNextToken");

const heroWaitingCount =
    document.getElementById("heroWaitingCount");

const heroProgress =
    document.getElementById("heroProgress");


/* ========================================
   LOAD PATIENTS FROM SUPABASE
======================================== */

async function loadQueueData() {
    const { data, error } = await supabaseClient
        .from("patients")
        .select("*")
        .order("created_at", {
            ascending: true
        });

    if (error) {
        console.error("Error loading patients:", error);

        queueTableBody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align:center;">
                    Unable to load queue. Please check your database connection.
                </td>
            </tr>
        `;

        return;
    }

    queueData = data || [];

    nextTokenNumber = getNextTokenNumber();

    displayQueue();
    updateHeroQueue();

    registeredCount.textContent = queueData.length;
}


/* ========================================
   GET NEXT TOKEN NUMBER
======================================== */

function getNextTokenNumber() {
    let highestNumber = 0;

    queueData.forEach((patient) => {
        const number = parseInt(
            String(patient.token).replace("A-", ""),
            10
        );

        if (!isNaN(number) && number > highestNumber) {
            highestNumber = number;
        }
    });

    return highestNumber + 1;
}


/* ========================================
   GENERATE TOKEN
======================================== */

function generateToken() {
    const token = `A-${String(nextTokenNumber).padStart(3, "0")}`;

    nextTokenNumber++;

    return token;
}


/* ========================================
   DISPLAY QUEUE
======================================== */

function displayQueue() {
    queueTableBody.innerHTML = "";

    if (queueData.length === 0) {
        queueTableBody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align:center;">
                    No patients in the queue.
                </td>
            </tr>
        `;

        return;
    }

    queueData.forEach((patient) => {
        const row = document.createElement("tr");

        let statusClass = "completed";

        if (patient.status === "Serving") {
            statusClass = "serving";
        } else if (patient.status === "Waiting") {
            statusClass = "waiting";
        }

        row.innerHTML = `
            <td>
                <span class="token-number">
                    ${patient.token}
                </span>
            </td>

            <td>${escapeHTML(patient.full_name)}</td>

            <td>${escapeHTML(patient.department)}</td>

            <td>
                <span class="${statusClass}">
                    ${patient.status}
                </span>
            </td>

            <td>${patient.estimated_time || "5 min"}</td>
        `;

        queueTableBody.appendChild(row);
    });
}


/* ========================================
   UPDATE HERO QUEUE
======================================== */

function updateHeroQueue() {
    const servingPatient = queueData.find(
        (patient) => patient.status === "Serving"
    );

    const waitingPatients = queueData.filter(
        (patient) => patient.status === "Waiting"
    );

    heroServingToken.textContent = servingPatient
        ? servingPatient.token
        : "None";

    heroNextToken.textContent = waitingPatients.length > 0
        ? waitingPatients[0].token
        : "None";

    heroWaitingCount.textContent = waitingPatients.length;

    const progress = Math.min(
        100,
        25 + waitingPatients.length * 12
    );

    heroProgress.style.width = `${progress}%`;

    registeredCount.textContent = queueData.length;
}


/* ========================================
   REGISTER PATIENT
======================================== */

registrationForm.addEventListener(
    "submit",
    async function (event) {
        event.preventDefault();

        const fullName =
            document.getElementById("fullName").value.trim();

        const age =
            document.getElementById("age").value;

        const mobile =
            document.getElementById("mobile").value.trim();

        const gender =
            document.getElementById("gender").value;

        const department =
            document.getElementById("department").value;

        const reason =
            document.getElementById("reason").value.trim();

        if (
            !fullName ||
            !age ||
            !mobile ||
            !gender ||
            !department
        ) {
            alert("Please fill in all required fields.");
            return;
        }

        if (!/^[0-9]{10}$/.test(mobile)) {
            alert("Please enter a valid 10-digit mobile number.");
            return;
        }

        const submitButton =
            registrationForm.querySelector("button[type='submit']");

        submitButton.disabled = true;
        submitButton.textContent = "Registering...";

        const newToken = generateToken();

        const waitingPatients = queueData.filter(
            (patient) => patient.status === "Waiting"
        );

        const estimatedTime =
            `${(waitingPatients.length + 1) * 5} min`;

        /*
           Column names must match your Supabase patients table.
        */

        const patientData = {
            token: newToken,
            full_name: fullName,
            age: Number(age),
            mobile: mobile,
            gender: gender,
            department: department,
            reason: reason,
            status: "Waiting",
            estimated_time: estimatedTime
        };

        const { data, error } = await supabaseClient
            .from("patients")
            .insert([patientData])
            .select()
            .single();

        if (error) {
            console.error("Registration error:", error);

            alert(
                "Registration failed. Please check your Supabase table and RLS policies."
            );

            submitButton.disabled = false;
            submitButton.textContent =
                "Generate Digital Token →";

            return;
        }

        queueData.push(data);

        generatedToken.textContent = data.token;

        registrationForm.hidden = true;
        registrationSuccess.hidden = false;

        displayQueue();
        updateHeroQueue();

        showPatientDashboard(data.token);

        submitButton.disabled = false;
        submitButton.textContent =
            "Generate Digital Token →";

        alert(
            `Registration successful! Your token number is ${data.token}`
        );
    }
);


/* ========================================
   REGISTER ANOTHER PATIENT
======================================== */

registerAnotherBtn.addEventListener(
    "click",
    function () {
        registrationSuccess.hidden = true;
        registrationForm.hidden = false;

        registrationForm.reset();

        window.location.hash = "registration";
    }
);


/* ========================================
   TRACK TOKEN
======================================== */

trackTokenBtn.addEventListener(
    "click",
    function () {
        const enteredToken =
            tokenSearchInput.value.trim().toUpperCase();

        if (!enteredToken) {
            alert("Please enter a token number.");
            return;
        }

        showPatientDashboard(enteredToken);
    }
);


/* ========================================
   SHOW PATIENT DASHBOARD
======================================== */

function showPatientDashboard(token) {
    const patient = queueData.find(
        (item) =>
            String(item.token).toUpperCase() ===
            token.toUpperCase()
    );

    if (!patient) {
        dashboardResult.innerHTML = `
            <div class="empty-dashboard">
                <div>❌</div>
                <h3>Token Not Found</h3>
                <p>Please check your token number and try again.</p>
            </div>
        `;

        return;
    }

    let statusClass = "waiting";

    if (patient.status === "Serving") {
        statusClass = "serving";
    } else if (patient.status === "Completed") {
        statusClass = "completed";
    }

    dashboardResult.innerHTML = `
        <div class="patient-token-card">

            <div class="patient-token-header">
                <div>
                    <h3>Patient Token Details</h3>
                    <p>Your queue information is shown below.</p>
                </div>

                <span class="status-badge-dashboard ${statusClass}">
                    ${patient.status}
                </span>
            </div>

            <div class="patient-token-main">

                <div>
                    <div class="patient-token-number">
                        ${patient.token}
                    </div>

                    <p>Digital Token Number</p>
                </div>

                <div class="patient-details">

                    <div class="patient-detail">
                        <span>Patient Name</span>
                        <strong>
                            ${escapeHTML(patient.full_name)}
                        </strong>
                    </div>

                    <div class="patient-detail">
                        <span>Department</span>
                        <strong>
                            ${escapeHTML(patient.department)}
                        </strong>
                    </div>

                    <div class="patient-detail">
                        <span>Estimated Time</span>
                        <strong>
                            ${patient.estimated_time || "5 min"}
                        </strong>
                    </div>

                    <div class="patient-detail">
                        <span>Queue Position</span>
                        <strong>
                            ${getQueuePosition(patient.token)}
                        </strong>
                    </div>

                </div>

            </div>

        </div>
    `;
}


/* ========================================
   QUEUE POSITION
======================================== */

function getQueuePosition(token) {
    const index = queueData.findIndex(
        (patient) => patient.token === token
    );

    return index === -1 ? "N/A" : index + 1;
}


/* ========================================
   QUEUE SIMULATION
======================================== */

async function simulateQueue() {
    const waitingPatients = queueData.filter(
        (patient) => patient.status === "Waiting"
    );

    if (waitingPatients.length === 0) {
        return;
    }

    const servingPatient = queueData.find(
        (patient) => patient.status === "Serving"
    );

    /*
       Mark current serving patient as completed.
    */

    if (servingPatient) {
        const { error } = await supabaseClient
            .from("patients")
            .update({
                status: "Completed",
                estimated_time: "Completed"
            })
            .eq("id", servingPatient.id);

        if (error) {
            console.error("Error completing patient:", error);
            return;
        }
    }

    /*
       Move the next waiting patient to Serving.
    */

    const nextWaitingPatient = queueData.find(
        (patient) => patient.status === "Waiting"
    );

    if (nextWaitingPatient) {
        const { error } = await supabaseClient
            .from("patients")
            .update({
                status: "Serving",
                estimated_time: "Now"
            })
            .eq("id", nextWaitingPatient.id);

        if (error) {
            console.error("Error serving patient:", error);
            return;
        }
    }

    /*
       Reload the latest queue from Supabase.
    */

    await loadQueueData();

    const searchedToken =
        tokenSearchInput.value.trim();

    if (searchedToken) {
        showPatientDashboard(searchedToken);
    }
}


/* ========================================
   ESCAPE HTML
======================================== */

function escapeHTML(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


/* ========================================
   REAL-TIME DATABASE UPDATES
======================================== */

supabaseClient
    .channel("patients-realtime")
    .on(
        "postgres_changes",
        {
            event: "*",
            schema: "public",
            table: "patients"
        },
        function () {
            loadQueueData();
        }
    )
    .subscribe();


/* ========================================
   INITIAL LOAD
======================================== */

loadQueueData();


/* Queue simulation every 30 seconds */

// setInterval(simulateQueue, 30000);


/* ========================================
   SMOOTH NAVIGATION
======================================== */

document.querySelectorAll('a[href^="#"]').forEach(
    (link) => {
        link.addEventListener(
            "click",
            function (event) {
                const targetId =
                    this.getAttribute("href");

                const target =
                    document.querySelector(targetId);

                if (target) {
                    event.preventDefault();

                    target.scrollIntoView({
                        behavior: "smooth",
                        block: "start"
                    });
                }
            }
        );
    }
);