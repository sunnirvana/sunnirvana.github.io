(function () {
  "use strict";

  const themeStorageKey = "tools-site-theme";
  const root = document.documentElement;
  const themeToggle = document.querySelector("[data-theme-toggle]");
  const themeColor = document.querySelector('meta[name="theme-color"]');
  const defaultThemeColor = themeColor?.content || "#f6f2e8";

  function setTheme(theme, persist) {
    const isDark = theme === "dark";
    root.dataset.theme = isDark ? "dark" : "light";
    if (themeColor) themeColor.content = isDark ? "#171716" : defaultThemeColor;

    if (persist) {
      try {
        localStorage.setItem(themeStorageKey, root.dataset.theme);
      } catch {
        // Theme switching still works when local storage is unavailable.
      }
    }

    if (!themeToggle) return;
    themeToggle.setAttribute("aria-pressed", String(isDark));
    themeToggle.setAttribute("aria-label", isDark ? "切换为浅色模式" : "切换为深色模式");
    const label = themeToggle.querySelector("[data-theme-toggle-label]");
    if (label) label.textContent = isDark ? "模式：深色" : "模式：浅色";
  }

  setTheme(root.dataset.theme, false);
  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";
      setTheme(nextTheme, true);
      window.ToolsSiteAnalytics?.track("toggle_theme", { theme: nextTheme });
    });
  }

  const config = window.TOOLS_SITE_CONFIG || {};
  const measurementId = String(config.gaMeasurementId || "").trim();
  const validMeasurementId = /^G-[A-Z0-9]+$/i.test(measurementId);

  window.ToolsSiteAnalytics = {
    enabled: validMeasurementId,
    track(eventName, parameters) {
      if (!validMeasurementId || typeof window.gtag !== "function") return;
      window.gtag("event", eventName, parameters || {});
    }
  };

  if (!validMeasurementId) return;

  const script = document.createElement("script");
  script.async = true;
  script.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(measurementId);
  script.onload = () => {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", measurementId, {
      anonymize_ip: true,
      allow_google_signals: false,
      allow_ad_personalization_signals: false
    });
  };
  document.head.appendChild(script);
})();
