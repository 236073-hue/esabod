const setConnectionState = () => {
  document.documentElement.dataset.connection = navigator.onLine ? "online" : "offline";
};

const addAppSidebar = () => {
  if (!document.body.classList.contains("dashboard-body")) return;
  const currentPage = window.location.pathname.split("/").pop() || "dashboard.html";
  const links = [
    ["dashboard.html", "Overview", "⌂"],
    ["feed.html", "Feed monitoring", "◒"],
    ["water.html", "Water monitoring", "♧"],
    ["temperature.html", "Temperature", "°"],
    ["alerts.html", "Notifications", "!"],
    ["calendar.html", "Calendar", "□"]
  ];
  document.body.classList.add("has-sidebar");
  document.body.insertAdjacentHTML("afterbegin", `<aside class="app-sidebar"><a class="sidebar-brand" href="dashboard.html"><img class="sidebar-logo-img" src="LOGO.jpg" alt="ESABOD" /><span>ESABOD</span></a><nav class="sidebar-nav" aria-label="Main navigation">${links.map(([href, label, icon]) => `<a class="${href === currentPage ? "active" : ""}" href="${href}"><span class="sidebar-icon">${icon}</span><span>${label}</span></a>`).join("")}</nav><div class="sidebar-footer">Live flock care<br><span>Connected workspace</span></div></aside>`);
};

setConnectionState();
addAppSidebar();
window.addEventListener("online", setConnectionState);
window.addEventListener("offline", setConnectionState);

if ("serviceWorker" in navigator && window.location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
}
