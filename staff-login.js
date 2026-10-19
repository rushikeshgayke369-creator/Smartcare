// ===============================
// SUPABASE CONFIGURATION
// (URL + key now live in config.js)
// ===============================

const { SUPABASE_URL, SUPABASE_KEY } = window.SMARTCARE_CONFIG;

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


// ===============================
// ELEMENTS
// ===============================

const loginForm = document.getElementById("loginForm");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const message = document.getElementById("message");
const signInButton = document.getElementById("signInButton");


// ===============================
// ROLE CHECK
// A valid login is not enough any more: patients can have accounts too,
// so the account must have the "staff" role (profiles table).
// ===============================

async function isStaffUser() {
    const { data, error } = await supabaseClient.rpc("is_staff");

    if (error) {
        console.error("Role check error:", error);
        return false;
    }

    return data === true;
}


// ===============================
// CHECK EXISTING LOGIN
// ===============================

async function checkExistingSession() {
    const { data, error } =
        await supabaseClient.auth.getSession();

    if (error) {
        console.error("Session error:", error);
        return;
    }

    if (!data.session) return;

    if (await isStaffUser()) {
        window.location.replace("staff.html");
    } else {
        // Logged in, but not as staff: clear it so there is no redirect loop.
        await supabaseClient.auth.signOut();
    }
}

// Message when staff.html sent someone back here
if (new URLSearchParams(window.location.search).get("denied") === "1") {
    message.textContent =
        "This account does not have staff access. Patients can log in on the patient website.";
    message.className = "error";
}

checkExistingSession();


// ===============================
// STAFF LOGIN
// ===============================

loginForm.addEventListener("submit", async function (event) {

    event.preventDefault();

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
        message.textContent = "Please enter email and password.";
        message.className = "error";
        return;
    }

    signInButton.disabled = true;
    signInButton.textContent = "Signing in...";

    message.textContent = "";
    message.className = "";

    try {

        const { data, error } =
            await supabaseClient.auth.signInWithPassword({
                email: email,
                password: password
            });

        if (error) {
            console.error("Login error:", error);

            message.textContent =
                "Login failed: " + error.message;

            message.className = "error";

            // Keep the email so the user does not need
            // to type it again.
            passwordInput.value = "";

            return;
        }

        if (!data.session) {
            message.textContent =
                "Login failed. No session was created.";

            message.className = "error";
            return;
        }

        // NEW: only accounts with the staff role may continue
        if (!(await isStaffUser())) {
            await supabaseClient.auth.signOut();

            message.textContent =
                "This account does not have staff access. Patients can log in on the patient website.";

            message.className = "error";
            passwordInput.value = "";
            return;
        }

        message.textContent =
            "Login successful. Opening dashboard...";

        message.className = "success";

        setTimeout(function () {
            window.location.replace("staff.html");
        }, 500);

    } catch (error) {

        console.error("Unexpected login error:", error);

        message.textContent =
            "Unable to connect to Supabase. Check your internet connection.";

        message.className = "error";

    } finally {

        signInButton.disabled = false;
        signInButton.textContent = "Sign In";

    }

});
