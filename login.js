import { supabase } from "./supabase.js";

const form = document.getElementById("loginForm");
const errorMsg = document.getElementById("errorMsg");
const submitBtn = document.getElementById("submitBtn");

document.getElementById("email").addEventListener("input", (event) => {
  event.target.value = event.target.value.replace(/\\@/g, "@");
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorMsg.style.display = "none";

  const email = document.getElementById("email").value.trim().replace(/\\@/g, "@");
  const password = document.getElementById("password").value;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showError("Enter a valid email address, for example boss@gmail.com.");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Logging in...";

  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    window.location.href = "dashboard.html";
  } catch (err) {
    showError(friendlyError(err));
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Log in";
  }
});

function showError(message) {
  errorMsg.textContent = message;
  errorMsg.style.display = "block";
}

function friendlyError(error) {
  if (error.message === "Invalid login credentials") return "Incorrect email or password.";
  return error.message || "Something went wrong. Please try again.";
}
