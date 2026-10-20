const config = {
  name: "The Room",
  timezone: "Atlantic/Canary",
  locales: ["es", "en"],
  defaultLocale: "es",
  branding: {
    logoText: "The Room",
    // logo: "/salons/the-room/logo.png", // cuando tengas el archivo en public/salons/the-room/
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
};

export default config;