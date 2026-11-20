(function () {
  const scenarios = [
    { value: "idle", label: "Standby" },
    { value: "heating", label: "Winter - 1 warmtepomp" },
    { value: "dual", label: "Winter - duo-bedrijf", duoOnly: true },
    { value: "heating_stop_reasons", label: "Winter - verwarmstops vergeleken", duoOnly: true },
    { value: "start_blocked", label: "Winter - start wacht", duoOnly: true },
    { value: "flow_hold", label: "Waterflow - voor/naloop" },
    { value: "summer_idle", label: "Zomer - pompbescherming" },
    { value: "cooling", label: "Zomer - koeling vrijgegeven" },
    { value: "cooling_startup_wait", label: "Zomer - wacht na herstart" },
    { value: "cooling_limited", label: "Zomer - koeling veilig begrensd" },
    { value: "cooling_buffer_stop", label: "Zomer - water al koud genoeg" },
    { value: "cooling_stop_reasons", label: "Zomer - koelstops vergeleken" },
    { value: "cooling_limiter_log", label: "Zomer - limiter herhaalt" },
    { value: "defrost", label: "Winter - ontdooien" },
  ];

  window.__OQ_MOCK_SCENARIOS__ = Object.freeze(scenarios);
})();
