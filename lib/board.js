import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  push,
  onValue,
  remove,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyC-qq5wOMODRidgkdNc3KO04FmnkhTjAN0",
  authDomain: "chickcare-system-58daa.firebaseapp.com",
  databaseURL: "https://chickcare-system-58daa-default-rtdb.firebaseio.com",
  projectId: "chickcare-system-58daa",
  storageBucket: "chickcare-system-58daa.firebasestorage.app",
  messagingSenderId: "278708560153",
  appId: "1:278708560153:web:7127b7e894d81b03fb2588",
  measurementId: "G-71LP1DKBM0",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const userEmailEl = document.getElementById("userEmail");
const logoutBtn = document.getElementById("logoutBtn");
const statusList = document.getElementById("statusList");
const scheduleForm = document.getElementById("scheduleForm");
const scheduleListEl = document.getElementById("scheduleList");

let currentUid = null;

// Guard: if not logged in, kick back to login page
onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }
  currentUid = user.uid;
  userEmailEl.textContent = user.email;
  listenToStatus(user.uid);
  listenToSchedules(user.uid);
});

logoutBtn.addEventListener("click", () => {
  signOut(auth);
});

function listenToStatus(uid) {
  const statusRef = ref(db, `users/${uid}/device/status`);
  onValue(statusRef, (snapshot) => {
    const data = snapshot.val();
    if (!data) {
      statusList.innerHTML = "<li>No data yet — waiting for the device to connect.</li>";
      return;
    }
    statusList.innerHTML = `
      <li>Online: ${data.online ? "Yes" : "No"}</li>
      <li>Last fed: ${data.lastFed ? new Date(data.lastFed).toLocaleString() : "Never"}</li>
      <li>Food level: ${data.foodLevel ?? "Unknown"}%</li>
    `;
  });
}

function listenToSchedules(uid) {
  const schedulesRef = ref(db, `users/${uid}/schedules`);
  onValue(schedulesRef, (snapshot) => {
    const data = snapshot.val();
    if (!data) {
      scheduleListEl.innerHTML = "<li>No schedules yet.</li>";
      return;
    }
    scheduleListEl.innerHTML = "";
    Object.entries(data).forEach(([id, s]) => {
      const li = document.createElement("li");
      li.innerHTML = `
        <span>${s.day} at ${s.time} — ${s.portion} scoop(s)</span>
        <button data-id="${id}" class="deleteBtn">Delete</button>
      `;
      scheduleListEl.appendChild(li);
    });

    document.querySelectorAll(".deleteBtn").forEach((btn) => {
      btn.addEventListener("click", () => {
        remove(ref(db, `users/${currentUid}/schedules/${btn.dataset.id}`));
      });
    });
  });
}

scheduleForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const day = document.getElementById("day").value;
  const time = document.getElementById("time").value;
  const portion = Number(document.getElementById("portion").value);

  push(ref(db, `users/${currentUid}/schedules`), {
    day,
    time,
    portion,
    createdAt: Date.now(),
  });

  scheduleForm.reset();
  document.getElementById("day").value = "Mon";
  document.getElementById("time").value = "08:00";
  document.getElementById("portion").value = 1;
});