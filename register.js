import { supabase } from "./supabase.js";

const form = document.getElementById("registerForm");
const errorMsg = document.getElementById("errorMsg");
const submitBtn = document.getElementById("submitBtn");

document.getElementById("email").addEventListener("input", (event) => {
  event.target.value = event.target.value.replace(/\\@/g, "@");
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorMsg.style.display = "none";

  // Some keyboards and copied text escape @ as \@. Supabase correctly rejects
  // that literal backslash, so normalize it before validating and submitting.
  const email = document.getElementById("email").value.trim().replace(/\\@/g, "@");
  const password = document.getElementById("password").value;
  const confirmPassword = document.getElementById("confirmPassword").value;

  if (password !== confirmPassword) {
    showError("Passwords do not match.");
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showError("Enter a valid email address, for example boss@gmail.com.");
    return;
  }
  if (password.length < 6) {
    showError("Password must be at least 6 characters.");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Creating account...";

  try {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    if (!data.session) {
      form.reset();
      showError("Check your email to confirm your account, then log in.", false);
      return;
    }
    window.location.href = "dashboard.html";
  } catch (err) {
    showError(friendlyError(err));
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Register";
  }
});

function showError(message, isError = true) {
  errorMsg.textContent = message;
  errorMsg.style.display = "block";
  errorMsg.style.color = isError ? "" : "#147d78";
}

function friendlyError(error) {
  const message = error.message || "";
  if (message.toLowerCase().includes("already registered")) return "That email is already registered.";
  if (message.toLowerCase().includes("password")) return "Choose a stronger password.";
  return message || "Something went wrong. Please try again.";
}
