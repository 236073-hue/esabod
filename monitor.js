import { supabase, requireUser } from "./supabase.js";

const $ = (id) => document.getElementById(id);
const page = document.body.dataset.page;
const FEEDING_SCHEDULE = [
  { stage: 0, label: "Days 1–7",   week: "Week 1",       feedType: "Starter",  minRate: 15, maxRate: 20, days: 7,  category: "starter" },
  { stage: 1, label: "Days 8–14",  week: "Week 2",       feedType: "Starter",  minRate: 25, maxRate: 30, days: 7,  category: "starter" },
  { stage: 2, label: "Days 15–21", week: "Week 3",       feedType: "Grower",   minRate: 35, maxRate: 40, days: 7,  category: "grower"  },
  { stage: 3, label: "Days 22–28", week: "Week 4",       feedType: "Grower",   minRate: 45, maxRate: 50, days: 7,  category: "grower"  },
  { stage: 4, label: "Days 29–35", week: "Week 5",       feedType: "Finisher", minRate: 60, maxRate: 65, days: 7,  category: "finisher"},
  { stage: 5, label: "Days 36–42", week: "Week 6",       feedType: "Finisher", minRate: 70, maxRate: 75, days: 7,  category: "finisher"},
  { stage: 6, label: "Days 43–45", week: "Final 3 days", feedType: "Finisher", minRate: 80, maxRate: 85, days: 3,  category: "finisher"},
];
const feedRates = FEEDING_SCHEDULE.map(s => Math.round((s.minRate + s.maxRate) / 2));
const feedTimes = [
  { hour: 7,  minute: 0, label: "7:00 AM",  name: "Breakfast" },
  { hour: 12, minute: 0, label: "12:00 PM", name: "Lunch"     },
  { hour: 18, minute: 0, label: "6:00 PM",  name: "Dinner"    }
];
let user;
let settings;
let visibleMonth = new Date();
let lastAutomaticFeed = "";

const formatFeed = (grams) => `${(grams / 1000).toFixed(3)} kg`;
const toast = (message) => {
  const element = $("toast");
  if (!element) return;
  element.textContent = message;
  element.classList.add("show");
  setTimeout(() => element.classList.remove("show"), 3200);
};
const percent = (value) => Math.max(0, Math.min(100, Number(value)));

// A device is considered online if it has sent a reading within the last 20 seconds
const ONLINE_TIMEOUT_MS = 20000;

function isDeviceOnline() {
  if (!settings || !settings.last_measured_at) return false;
  const measuredAt = new Date(settings.last_measured_at).getTime();
  const diff = Date.now() - measuredAt;
  // Account for slight client/server clock skew (-5s to 20s)
  return diff >= -5000 && diff <= ONLINE_TIMEOUT_MS;
}

function timeAgo(date) {
  if (!date) return "";
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

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

function renderStatusBanner() {
  const banner = $("statusBanner");
  if (!banner || !settings) return;
  const online = isDeviceOnline();
  const dot = banner.querySelector(".status-dot");
  const title = $("statusTitle");
  const text = $("statusText");
  const lastSync = $("lastSync");

  if (online) {
    banner.classList.remove("offline");
    if (dot) dot.classList.remove("offline");
    const rawWeight = Number(settings.feed_weight_g || 0);
    const measuredGrams = rawWeight < 1 ? 0 : rawWeight;
    if (title) title.textContent = "ESP32 is online";
    if (text) text.textContent = `ESABOD is connected. Current feed weight: ${formatFeed(measuredGrams)}.`;
    if (lastSync) lastSync.textContent = "Live · Connected";
  } else {
    banner.classList.add("offline");
    if (dot) dot.classList.add("offline");
    if (title) title.textContent = "ESP32 is offline";
    if (text) text.textContent = "Waiting for scale. Turn on your ESP32 to start live feed monitoring.";
    if (lastSync) {
      lastSync.textContent = settings.last_measured_at
        ? `Last seen ${timeAgo(settings.last_measured_at)}`
        : "Waiting for scale";
    }
  }
}

function renderAlerts() {
  if (!$("alertList") || !settings) return;
  const alerts = [];
  if (isDeviceOnline() && settings.feed_level <= 20) {
    alerts.push({ type: "feed", title: "Feed level is low", text: "Refill the feed container soon." });
  }
  if (settings.water_level <= 20) {
    alerts.push({ type: "water", title: "Water level is low", text: "Refill the water container soon." });
  }
  $("alertCount").textContent = `${alerts.length} alert${alerts.length === 1 ? "" : "s"}`;
  $("alertList").innerHTML = alerts.length
    ? alerts.map((alert) => `<div class="alert-item ${alert.type}"><span class="alert-icon">!</span><div><strong>${alert.title}</strong><small>${alert.text}</small></div></div>`).join("")
    : '<p class="empty-state">No alerts. Feed and water levels are being monitored.</p>';
}

function calcFeedTotals(birds) {
  const fg = (g) => `${(g / 1000).toFixed(3)} kg`;
  let starterMin = 0, starterMax = 0, growerMin = 0, growerMax = 0, finisherMin = 0, finisherMax = 0;
  for (const s of FEEDING_SCHEDULE) {
    const lo = s.minRate * birds * s.days;
    const hi = s.maxRate * birds * s.days;
    if (s.category === "starter")  { starterMin += lo;  starterMax += hi; }
    if (s.category === "grower")   { growerMin += lo;   growerMax += hi; }
    if (s.category === "finisher") { finisherMin += lo; finisherMax += hi; }
  }
  return { starterMin, starterMax, growerMin, growerMax, finisherMin, finisherMax,
    grandMin: starterMin + growerMin + finisherMin,
    grandMax: starterMax + growerMax + finisherMax };
}

function renderFeedSummaryCards(birds) {
  const t = calcFeedTotals(birds);
  const r = (lo, hi) => `${(lo/1000).toFixed(3)} – ${(hi/1000).toFixed(3)} kg`;

  if ($("starterTotalKg"))    $("starterTotalKg").textContent  = r(t.starterMin,  t.starterMax);
  if ($("starterDailyRange")) $("starterDailyRange").textContent = `${(t.starterMin/14000).toFixed(3)} – ${(t.starterMax/14000).toFixed(3)} kg/day`;
  if ($("growerTotalKg"))     $("growerTotalKg").textContent   = r(t.growerMin,   t.growerMax);
  if ($("growerDailyRange"))  $("growerDailyRange").textContent  = `${(t.growerMin/14000).toFixed(3)} – ${(t.growerMax/14000).toFixed(3)} kg/day`;
  if ($("finisherTotalKg"))   $("finisherTotalKg").textContent  = r(t.finisherMin, t.finisherMax);
  if ($("finisherDailyRange"))$("finisherDailyRange").textContent=`${(t.finisherMin/17000).toFixed(3)} – ${(t.finisherMax/17000).toFixed(3)} kg/day`;
  if ($("grandTotalKg"))      $("grandTotalKg").textContent    = r(t.grandMin,    t.grandMax);
  if ($("flockSummaryFooter"))$("flockSummaryFooter").textContent = `Calculated for ${birds.toLocaleString()} bird${birds !== 1 ? "s" : ""}`;
}

function renderFeedScheduleTable(birds, activeStage) {
  const tbody = $("feedingScheduleBody");
  if (!tbody) return;
  tbody.innerHTML = FEEDING_SCHEDULE.map((s) => {
    const isActive = s.stage === activeStage;
    const dailyMinG = s.minRate * birds;
    const dailyMaxG = s.maxRate * birds;
    const stageMinKg = (dailyMinG * s.days / 1000).toFixed(3);
    const stageMaxKg = (dailyMaxG * s.days / 1000).toFixed(3);
    const mealMinKg  = (dailyMinG / 3 / 1000).toFixed(3);
    const mealMaxKg  = (dailyMaxG / 3 / 1000).toFixed(3);
    const badgeCls   = s.category;
    return `<tr class="${isActive ? "active-stage-row" : ""}">
      <td>${s.label} <small style="color:#8b96a8">(${s.week})</small>${isActive ? '<span class="active-tag">NOW</span>' : ""}</td>
      <td><span class="feed-badge ${badgeCls}">${s.feedType}</span></td>
      <td>${s.feedType} feeds</td>
      <td>${s.minRate}–${s.maxRate} g/bird</td>
      <td>${(dailyMinG/1000).toFixed(3)} – ${(dailyMaxG/1000).toFixed(3)} kg</td>
      <td>${mealMinKg} – ${mealMaxKg} kg</td>
      <td>${stageMinKg} – ${stageMaxKg} kg</td>
    </tr>`;
  }).join("");
  if ($("scheduleTotalSubtitle")) {
    $("scheduleTotalSubtitle").textContent = `${birds.toLocaleString()} bird${birds !== 1 ? "s" : ""}`;
  }
}

let userEditingChicks = false;

function getActiveStage() {
  const select = $("batchStageSelect");
  return select ? Number(select.value) : Number(settings?.current_stage ?? 0);
}

function updateCalculationsForCount(count) {
  const activeStage = getActiveStage();
  const currentStageData = FEEDING_SCHEDULE[activeStage] ?? FEEDING_SCHEDULE[0];
  const avgRateG = Math.round((currentStageData.minRate + currentStageData.maxRate) / 2);
  const dailyFeedG = count * avgRateG;

  document.querySelectorAll(".preset-pill").forEach(p => {
    p.classList.toggle("active", Number(p.dataset.count) === count);
  });

  if ($("nextFeedAmount")) {
    $("nextFeedAmount").textContent = `${formatFeed(dailyFeedG / 3)} · next automatic portion (${currentStageData.feedType})`;
  }
  if ($("planTotal")) {
    $("planTotal").textContent = `${currentStageData.label} · ${currentStageData.minRate}–${currentStageData.maxRate}g/bird · ${formatFeed(dailyFeedG)} daily`;
  }
  if ($("scheduleList")) {
    $("scheduleList").innerHTML = feedTimes.map(feed => `<div class="schedule-item"><span class="time">${feed.label}</span><span class="schedule-detail"><strong>${feed.name}</strong><small>${formatFeed(dailyFeedG / 3)} · ${currentStageData.feedType} feed · automatic</small></span><span class="upcoming-badge">Active</span></div>`).join("");
  }

  renderFeedSummaryCards(count);
  renderFeedScheduleTable(count, activeStage);

  if ($("batchSaved")) {
    if (settings && count === Number(settings.chick_count)) {
      $("batchSaved").textContent = "Saved to your account";
      $("batchSaved").style.color = "#429c66";
    } else {
      $("batchSaved").textContent = "Click 'Save Batch Size' to save";
      $("batchSaved").style.color = "#d35400";
    }
  }
}

function setupBatchControls() {
  const input = $("chickCount");
  if (!input) return;

  const adjustCount = (delta) => {
    let current = Number(input.value) || 100;
    let next = Math.max(1, Math.min(100000, current + delta));
    input.value = next;
    userEditingChicks = true;
    updateCalculationsForCount(next);
  };

  const setCount = (val) => {
    let next = Math.max(1, Math.min(100000, Number(val) || 1));
    input.value = next;
    userEditingChicks = true;
    updateCalculationsForCount(next);
  };

  const sub10 = $("sub10Btn");
  const sub1 = $("sub1Btn");
  const add1 = $("add1Btn");
  const add10 = $("add10Btn");

  if (sub10) sub10.addEventListener("click", () => adjustCount(-10));
  if (sub1)  sub1.addEventListener("click", () => adjustCount(-1));
  if (add1)  add1.addEventListener("click", () => adjustCount(1));
  if (add10) add10.addEventListener("click", () => adjustCount(10));

  document.querySelectorAll(".preset-pill").forEach(pill => {
    pill.addEventListener("click", () => {
      const val = Number(pill.dataset.count);
      if (val) setCount(val);
    });
  });

  input.addEventListener("input", () => {
    let val = Number(input.value);
    if (val < 1) val = 1;
    userEditingChicks = true;
    updateCalculationsForCount(val);
  });

  const stageSelect = $("batchStageSelect");
  if (stageSelect) {
    stageSelect.addEventListener("change", () => {
      const count = Number(input.value) || (settings?.chick_count ?? 100);
      updateCalculationsForCount(count);
    });
  }
}

function renderFeed() {
  if (!$("chickCount") || !settings) return;

  const inputCount = Number($("chickCount").value);
  const birds = (userEditingChicks && inputCount > 0) ? inputCount : (Number(settings.chick_count) || 100);
  const activeStage = getActiveStage();
  const currentStageData = FEEDING_SCHEDULE[activeStage] ?? FEEDING_SCHEDULE[0];
  const avgRateG = Math.round((currentStageData.minRate + currentStageData.maxRate) / 2);
  const dailyFeedG = birds * avgRateG;

  if (document.activeElement !== $("chickCount") && !userEditingChicks) {
    $("chickCount").value = birds;
  }
  if ($("batchSaved") && !userEditingChicks) {
    $("batchSaved").textContent = "Saved to your account";
    $("batchSaved").style.color = "#429c66";
  }
  if ($("batchStageSelect") && !userEditingChicks) {
    $("batchStageSelect").value = String(activeStage);
  }

  // Update preset pill active state
  document.querySelectorAll(".preset-pill").forEach(p => {
    p.classList.toggle("active", Number(p.dataset.count) === birds);
  });

  // Scale live status
  const online = isDeviceOnline();
  const capacityGrams = Number(settings.feed_capacity_g || 10000);
  const rawMeasured = Number(settings.feed_weight_g || 0);
  const measuredGrams = rawMeasured < 1 ? 0 : rawMeasured;

  if ($("foodLevel")) {
    if (!online) {
      $("foodLevel").textContent = "Waiting for scale";
      if ($("foodProgress")) $("foodProgress").style.width = "0%";
      if ($("foodLabel")) $("foodLabel").textContent = "Scale is offline";
      if ($("feedStatus")) { $("feedStatus").textContent = "Waiting for ESP32"; $("feedStatus").classList.remove("online"); }
      if ($("foodMeasuredAt")) $("foodMeasuredAt").textContent = settings.last_measured_at ? `Last seen ${timeAgo(settings.last_measured_at)}` : "Not connected yet";
      const offCard = $("feedLevelCard");
      if (offCard) offCard.className = "feed-hero-card metric-card";
      if ($("feedLevelTag")) $("feedLevelTag").style.display = "none";
    } else {
      $("foodLevel").textContent = formatFeed(measuredGrams);
      const levelPct = capacityGrams > 0 ? Math.min(100, Math.max(0, Math.round((measuredGrams / capacityGrams) * 100))) : 0;
      if ($("foodProgress")) $("foodProgress").style.width = `${levelPct}%`;
      if ($("foodLabel")) $("foodLabel").textContent = `${levelPct}% of ${formatFeed(capacityGrams)} capacity`;
      if ($("feedStatus")) { $("feedStatus").textContent = "● ESP32 Online"; $("feedStatus").classList.add("online"); }
      if ($("foodMeasuredAt")) $("foodMeasuredAt").textContent = `Live · Updated ${timeAgo(settings.last_measured_at)}`;
      // Apply level highlight
      let levelClass, tagText;
      if (levelPct <= 10)      { levelClass = "feed-level-critical"; tagText = "⚠ Critical — Refill now!"; }
      else if (levelPct <= 25) { levelClass = "feed-level-low";      tagText = "↓ Low — Refill soon"; }
      else if (levelPct <= 60) { levelClass = "feed-level-medium";   tagText = "◑ Medium"; }
      else                     { levelClass = "feed-level-good";     tagText = "✔ Good — Well stocked"; }
      const card = $("feedLevelCard");
      const tag  = $("feedLevelTag");
      if (card) card.className = `feed-hero-card metric-card ${levelClass}`;
      if (tag)  { tag.textContent = tagText; tag.style.display = "inline-block"; }
    }
  }

  // Next feed portion info (based on current stage)
  if ($("nextFeedAmount")) $("nextFeedAmount").textContent = `${formatFeed(dailyFeedG / 3)} · next automatic portion (${currentStageData.feedType})`;
  if ($("planTotal")) $("planTotal").textContent = `${currentStageData.label} · ${currentStageData.minRate}–${currentStageData.maxRate}g/bird · ${formatFeed(dailyFeedG)} daily`;

  // Schedule list (3 daily feedings)
  if ($("scheduleList")) {
    $("scheduleList").innerHTML = feedTimes.map(feed => `<div class="schedule-item"><span class="time">${feed.label}</span><span class="schedule-detail"><strong>${feed.name}</strong><small>${formatFeed(dailyFeedG / 3)} · ${currentStageData.feedType} feed · automatic</small></span><span class="upcoming-badge">Active</span></div>`).join("");
  }

  // Summary cards
  renderFeedSummaryCards(birds);

  // 45-day schedule table
  renderFeedScheduleTable(birds, activeStage);
}

function renderWater() {
  // Water sensor not connected — keep static offline/zero state
  if ($("waterLevel")) $("waterLevel").textContent = "0%";
  if ($("waterProgress")) $("waterProgress").style.width = "0%";
  if ($("waterLabel")) $("waterLabel").textContent = "No sensor connected";
  if ($("waterStatus")) $("waterStatus").textContent = "Waiting for sensor";
  if ($("sensorStatusTitle")) $("sensorStatusTitle").textContent = "Offline";
  if ($("sensorStatusSub")) $("sensorStatusSub").textContent = "No water sensor connected";
  if ($("sensorStatusFooter")) {
    $("sensorStatusFooter").textContent = "Waiting for sensor";
    $("sensorStatusFooter").classList.remove("online");
  }
}

function renderTemperature() {
  // Temperature sensor not connected — keep static offline/zero state
  if ($("temperatureLevel")) $("temperatureLevel").textContent = "0.0°C";
  if ($("temperatureLabel")) $("temperatureLabel").textContent = "No sensor connected";
  if ($("temperatureStatus")) {
    $("temperatureStatus").textContent = "Waiting for sensor";
    $("temperatureStatus").classList.remove("online");
  }
}

async function renderActivity() {
  if (!$("activityList")) return;
  const { data, error } = await supabase.from("feeder_activity").select("title, detail, kind, created_at").order("created_at", { ascending: false }).limit(8);
  if (error) return toast(`Could not load activity: ${error.message}`);
  $("activityList").innerHTML = data.length
    ? data.map((item) => `<div class="activity-item"><span class="activity-dot ${item.kind}"></span><div><strong>${item.title}</strong><small>${new Date(item.created_at).toLocaleString([], { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" })} · ${item.detail}</small></div></div>`).join("")
    : '<p class="empty-state">No recent activity.</p>';
}

function drawMonth() {
  if (!$("calendarGrid")) return;
  const year = visibleMonth.getFullYear(), month = visibleMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay(), daysInMonth = new Date(year, month + 1, 0).getDate(), today = new Date();
  $("calendarMonth").textContent = visibleMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  $("calendarGrid").innerHTML = `${Array.from({ length: firstDay }, () => '<span class="calendar-day empty"></span>').join("")}${Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
    return `<span class="calendar-day ${isToday ? "today" : ""}"><strong>${day}</strong><small>7 AM · 12 PM · 6 PM</small></span>`;
  }).join("")}`;
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
    await addActivity(`Automatic ${current.name.toLowerCase()} served`, "Scheduled feed dispensed", "feed");
    toast(`${current.name} feed dispensed automatically.`);
  }
}

function renderAll() {
  renderFeed();
  renderStatusBanner();
  renderWater();
  renderTemperature();
  renderAlerts();
  drawMonth();
  updateNextFeed();
}

function subscribeToChanges() {
  supabase.channel(`feeder-${user.id}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "feeder_settings", filter: `user_id=eq.${user.id}` }, (payload) => {
      settings = payload.new;
      renderAll();
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "feeder_activity", filter: `user_id=eq.${user.id}` }, renderActivity)
    .subscribe();
}

async function loadDeviceCredentials() {
  if (!$("devIdInput")) return;
  try {
    let { data } = await supabase.from("feeder_devices").select("id, device_secret").limit(1).maybeSingle();
    if (!data) {
      const rpcRes = await supabase.rpc("get_or_create_my_device");
      if (rpcRes.data && rpcRes.data.length > 0) {
        data = rpcRes.data[0];
      }
    }
    if (data) {
      $("devIdInput").value = data.id;
      $("devSecretInput").value = data.device_secret;
      if ($("deviceStatusBadge")) $("deviceStatusBadge").textContent = "Credentials active";
    } else {
      $("devIdInput").value = "Run updated SQL in Supabase";
      $("devSecretInput").value = "Run updated SQL in Supabase";
      if ($("deviceStatusBadge")) $("deviceStatusBadge").textContent = "Setup needed";
    }
  } catch (e) {
    console.error("Device fetch error:", e);
  }
}

function setupDeviceCopyButtons() {
  const setupBtn = (btnId, inputId, label) => {
    const btn = $(btnId);
    if (!btn) return;
    btn.addEventListener("click", () => {
      const input = $(inputId);
      if (!input || !input.value || input.value.startsWith("Run") || input.value.startsWith("Loading")) return;
      navigator.clipboard.writeText(input.value);
      toast(`Copied ${label} to clipboard!`);
    });
  };

  setupBtn("copyDevIdBtn", "devIdInput", "DEVICE_ID");
  setupBtn("copyDevSecretBtn", "devSecretInput", "DEVICE_SECRET");

  if ($("toggleSecretBtn")) {
    $("toggleSecretBtn").addEventListener("click", () => {
      const input = $("devSecretInput");
      const btn = $("toggleSecretBtn");
      if (input.type === "password") {
        input.type = "text";
        btn.textContent = "Hide";
      } else {
        input.type = "password";
        btn.textContent = "Show";
      }
    });
  }
}

async function init() {
  user = await requireUser();
  if (!user) return;
  if ($("userEmail")) $("userEmail").textContent = user.email;
  if ($("userName")) {
    const name = user.email.split("@")[0].replace(/[._-]/g, " ");
    $("userName").textContent = name.charAt(0).toUpperCase() + name.slice(1);
  }
  await loadSettings();
  await renderActivity();
  await loadDeviceCredentials();
  setupDeviceCopyButtons();
  setupBatchControls();
  subscribeToChanges();

  // Regularly check connection heartbeat so offline/online switches dynamically
  setInterval(() => {
    if (settings) {
      renderFeed();
      renderStatusBanner();
      renderWater();
    }
  }, 2000);

  if ($("logoutBtn")) $("logoutBtn").addEventListener("click", async () => {
    await supabase.auth.signOut();
    window.location.replace("index.html");
  });
  if ($("batchForm")) $("batchForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const count = Number($("chickCount").value);
    if (!Number.isInteger(count) || count < 1) return toast("Enter at least 1 chick.");
    userEditingChicks = false;
    await saveSettings({ chick_count: count });
    if ($("batchSaved")) {
      $("batchSaved").textContent = "Saved to your account";
      $("batchSaved").style.color = "#429c66";
    }
    toast(`45-day plan saved for ${count.toLocaleString()} chicks.`);
  });
  if ($("feedNowBtn")) $("feedNowBtn").addEventListener("click", async () => {
    await addActivity("Manual feeding requested", "Awaiting feeder hardware", "feed");
    toast("Feeding request recorded. The scale reading will update after dispensing.");
  });
  if ($("clearActivityBtn")) $("clearActivityBtn").addEventListener("click", async () => {
    const { error } = await supabase.from("feeder_activity").delete().eq("user_id", user.id);
    if (error) return toast(`Could not clear activity: ${error.message}`);
    renderActivity();
    toast("Activity cleared.");
  });
  if ($("previousMonth")) $("previousMonth").addEventListener("click", () => {
    visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1);
    drawMonth();
  });
  if ($("nextMonth")) $("nextMonth").addEventListener("click", () => {
    visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1);
    drawMonth();
  });
}

init();
