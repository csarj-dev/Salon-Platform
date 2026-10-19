const config = {
  name: "The Room",
  timezone: "Atlantic/Canary",
  locales: ["es", "en"],
  defaultLocale: "es",
  initialLocations: [
    { name: "The Room", address: "Dirección de ejemplo 1" },
    { name: "The Room Micro & Tattos", address: "Dirección de ejemplo 2" },
  ],
  booking: {
    slotStepMin: 30,
    bufferMin: 0,
    minNoticeHours: 2,
    maxDaysAhead: 60,
  },
};

export default config;