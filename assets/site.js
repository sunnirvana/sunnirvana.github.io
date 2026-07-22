(function () {
  "use strict";

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

