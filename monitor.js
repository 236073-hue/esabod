import { supabase, requireUser } from "./supabase.js";

const $ = (id) => document.getElementById(id);
const page = document.body.dataset.page;
const feedRates = [15, 20, 28, 38, 50, 65, 75];
const feedTimes = [{ hour: 7, minute: 0, label: "7:00 AM", name: "Breakfast" }, { hour: 12, minute: 0, label: "12:00 PM", name: "Lunch" }, { hour: 18, minute: 0, label: "6:00 PM", name: "Dinner" }];
let user;
let settings;
let visibleMonth = new Date();
let lastAutomaticFeed = "";

const formatFeed = (grams) => grams >= 1000 ? `${(grams / 1000).toFixed(2)} kg` : `${Math.round(grams)} g`;
const toast = (message) => { const element = $("toast"); if (!element) return; element.textContent = message; element.classList.add("show"); setTimeout(() => element.classList.remove("show"), 3200); };
const percent = (value) => Math.max(0, Math.min(100, Number(value)));

async function loadSettings() {
  const { data, error } = await supabase.from("feeder_settings").select("*").single();
  if (error) return toast(`Could not load your feeder data: ${error.message}`);
  settings = data;
  renderAll();
}

async function saveSettings(changes) {
  const next = { ...changes, updated_at: new Date().toISOString() };
  const { data, error } = await supabase.from("feeder_settings").update(next).eq("user_id", user.id).select().single();
  if (error) return toast(`Could not save: ${error.message}`);
  settings = data;
  renderAll();
}

async function addActivity(title, detail, kind = "system") {
  const { error } = await supabase.from("feeder_activity").insert({ user_id: user.id, title, detail, kind });
  if (error) toast(`Could not save activity: ${error.message}`);
}

function renderAlerts() {
  if (!$("alertList") || !settings) return;
  const alerts = [];
  if (settings.feed_level <= 20) alerts.push({ type: "feed", title: "Feed level is low", text: "Refill the feed container soon." });
  if (settings.water_level <= 20) alerts.push({ type: "water", title: "Water level is low", text: "Refill the water container soon." });
  $("alertCount").textContent = `${alerts.length} alert${alerts.length === 1 ? "" : "s"}`;
  $("alertList").innerHTML = alerts.length ? alerts.map((alert) => `<div class="alert-item ${alert.type}"><span class="alert-icon">!</span><div><strong>${alert.title}</strong><small>${alert.text}</small></div></div>`).join("") : '<p class="empty-state">No alerts. Feed and water levels are being monitored.</p>';
}

function renderFeed() {
  if (!$("chickCount") || !settings) return;
  const dailyFeed = settings.chick_count * feedRates[0];
  const totalGrams = feedRates.reduce((total, rate, index) => total + settings.chick_count * rate * (index === 6 ? 3 : 7), 0);
  $("chickCount").value = settings.chick_count;
  $("batchSaved").textContent = "Saved to your account";
  $("foodLevel").textContent = formatFeed(dailyFeed);
  $("foodLabel").textContent = `${settings.chick_count} chicks · week 1 daily allowance`;
  $("foodProgress").style.width = `${settings.feed_level}%`;
  $("nextFeedAmount").textContent = `${formatFeed(dailyFeed / 3)} · next automatic portion`;
  $("planTotal").textContent = `${formatFeed(totalGrams)} for 45 days · ${formatFeed(dailyFeed)} daily`;
  $("scheduleList").innerHTML = feedTimes.map((feed) => `<div class="schedule-item"><span class="time">${feed.label}</span><span class="schedule-detail"><strong>${feed.name}</strong><small>${formatFeed(dailyFeed / 3)} · automatic</small></span><span class="upcoming-badge">Active</span></div>`).join("");
}

function renderWater() {
  if (!$("waterLevel") || !settings) return;
  const level = settings.water_level;
  $("waterLevel").textContent = `${level}%`;
  $("waterProgress").style.width = `${level}%`;
  $("waterLabel").textContent = level <= 20 ? "Refill required now" : `Enough for about ${Math.max(1, Math.round(level / 20))} days`;
  $("waterStatus").textContent = level <= 20 ? "Refill needed" : "Water level is normal";
}

function renderTemperature() {
  if (!$("temperatureLevel") || !settings) return;
  const temperature = Number(settings.temperature);
  $("temperatureLevel").textContent = `${temperature.toFixed(1)}°C`;
  const withinRange = temperature >= 24 && temperature <= 30;
  $("temperatureStatus").textContent = withinRange ? "Within range" : "Needs attention";
}

async function renderActivity() {
  if (!$("activityList")) return;
  const { data, error } = await supabase.from("feeder_activity").select("title, detail, kind, created_at").order("created_at", { ascending: false }).limit(8);
  if (error) return toast(`Could not load activity: ${error.message}`);
  $("activityList").innerHTML = data.length ? data.map((item) => `<div class="activity-item"><span class="activity-dot ${item.kind}"></span><div><strong>${item.title}</strong><small>${new Date(item.created_at).toLocaleString([], { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" })} · ${item.detail}</small></div></div>`).join("") : '<p class="empty-state">No recent activity.</p>';
}

function drawMonth() {
  if (!$("calendarGrid")) return;
  const year = visibleMonth.getFullYear(), month = visibleMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay(), daysInMonth = new Date(year, month + 1, 0).getDate(), today = new Date();
  $("calendarMonth").textContent = visibleMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  $("calendarGrid").innerHTML = `${Array.from({ length: firstDay }, () => '<span class="calendar-day empty"></span>').join("")}${Array.from({ length: daysInMonth }, (_, index) => { const day = index + 1; const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear(); return `<span class="calendar-day ${isToday ? "today" : ""}"><strong>${day}</strong><small>7 AM · 12 PM · 6 PM</small></span>`; }).join("")}`;
  if ($("calendarBatch") && settings) $("calendarBatch").textContent = `${settings.chick_count} chicks · 45-day program`;
}

async function updateNextFeed() {
  if (!$("nextFeed") || !settings) return;
  const now = new Date();
  const current = feedTimes.find((feed) => feed.hour === now.getHours() && feed.minute === now.getMinutes());
  const next = feedTimes.find((feed) => feed.hour > now.getHours() || (feed.hour === now.getHours() && feed.minute > now.getMinutes())) || feedTimes[0];
  $("nextFeed").textContent = next.label;
  const key = `${now.toDateString()}-${current?.label}`;
  if (current && lastAutomaticFeed !== key) {
    lastAutomaticFeed = key;
    await saveSettings({ feed_level: percent(settings.feed_level - 4) });
    await addActivity(`Automatic ${current.name.toLowerCase()} served`, "Scheduled feed dispensed", "feed");
    toast(`${current.name} feed dispensed automatically.`);
  }
}

function renderAll() { renderFeed(); renderWater(); renderTemperature(); renderAlerts(); drawMonth(); updateNextFeed(); }

function subscribeToChanges() {
  supabase.channel(`feeder-${user.id}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "feeder_settings", filter: `user_id=eq.${user.id}` }, (payload) => { settings = payload.new; renderAll(); })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "feeder_activity", filter: `user_id=eq.${user.id}` }, renderActivity)
    .subscribe();
}

async function init() {
  user = await requireUser();
  if (!user) return;
  if ($("userEmail")) $("userEmail").textContent = user.email;
  if ($("userName")) { const name = user.email.split("@")[0].replace(/[._-]/g, " "); $("userName").textContent = name.charAt(0).toUpperCase() + name.slice(1); }
  await loadSettings();
  await renderActivity();
  subscribeToChanges();
  if ($("logoutBtn")) $("logoutBtn").addEventListener("click", async () => { await supabase.auth.signOut(); window.location.replace("index.html"); });
  if ($("batchForm")) $("batchForm").addEventListener("submit", async (event) => { event.preventDefault(); const count = Number($("chickCount").value); if (!Number.isInteger(count) || count < 1) return toast("Enter at least 1 chick."); await saveSettings({ chick_count: count }); toast(`45-day plan saved for ${count} chicks.`); });
  if ($("feedNowBtn")) $("feedNowBtn").addEventListener("click", async () => { await saveSettings({ feed_level: percent(settings.feed_level - 4) }); await addActivity("Manual feeding started", "Food dispensed", "feed"); toast("Food is being dispensed."); });
  if ($("clearActivityBtn")) $("clearActivityBtn").addEventListener("click", async () => { const { error } = await supabase.from("feeder_activity").delete().eq("user_id", user.id); if (error) return toast(`Could not clear activity: ${error.message}`); renderActivity(); toast("Activity cleared."); });
  if ($("previousMonth")) $("previousMonth").addEventListener("click", () => { visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1); drawMonth(); });
  if ($("nextMonth")) $("nextMonth").addEventListener("click", () => { visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1); drawMonth(); });
}

init();
