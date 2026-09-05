// ===============================
// SUPABASE CONFIGURATION
// ===============================

const SUPABASE_URL =
    "https://poxftbzgcguzpdsjkbrs.supabase.co";

const SUPABASE_KEY =
    "sb_publishable_klfcdMI4YZ20UC4YNj465w_2Qxefr_J";

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
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
// CHECK EXISTING LOGIN
// ===============================

async function checkExistingSession() {
    const { data, error } =
        await supabaseClient.auth.getSession();

    if (error) {
        console.error("Session error:", error);
        return;
    }

    if (data.session) {
        window.location.replace("staff.html");
    }
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