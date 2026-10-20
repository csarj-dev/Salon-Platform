const config = {
  name: "The Broom",
  timezone: "Atlantic/Canary",
  locales: ["es", "en"],
  defaultLocale: "es",
  branding: {
    logoText: "The Broom",
    logo: "/salons/the-room/logo.ico", // cuando tengas el archivo en public/salons/the-room/
    logoWidth: 1254,
    logoHeight: 1254,
  },
  initialLocations: [
    { name: "The Room Centro", address: "Dirección de ejemplo 1" },
    { name: "The Room Sur", address: "Dirección de ejemplo 2" },
  ],
  booking: {
    slotStepMin: 30,
    bufferMin: 0,
    minNoticeHours: 2,
    maxDaysAhead: 60,
    cancellationNoticeHours: 24,
  },
  theme: {
    background: "#f7f1ea",
    foreground: "#231f20",
    surface: "#fcfaf7",
    primary: "#231f20",
    primaryForeground: "#f7f1ea",
    secondary: "#e6d8c8",
    secondaryForeground: "#231f20",
    muted: "#efe6dc",
    mutedForeground: "#6b5a4e",
    border: "#dacab7",
    radius: "0.25rem",
  },
};

export default config;