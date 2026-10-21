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
  contact: {
    whatsapp: "34600000000", // provisional; tu número real va en SALON_WHATSAPP
    instagram: "theroom.estudio",
  },
  // Fotos de ejemplo en gris: sin `src` se pinta un bloque con esa proporción.
  // Cuando haya fotos reales, se añade `src: "/salons/the-room/gallery/foto-1.jpg"`.
  gallery: [
    { width: 1080, height: 1350, alt: { es: "Cejas laminadas, resultado final", en: "Laminated brows, final result" } },
    { width: 1080, height: 1080, alt: { es: "Detalle de lifting de pestañas", en: "Close-up of a lash lift" } },
    { width: 1080, height: 1350, alt: { es: "Diseño de cejas con henna", en: "Henna brow shaping" } },
    { width: 1080, height: 1080, alt: { es: "Microblading, antes y después", en: "Microblading, before and after" } },
    { width: 1080, height: 1350, alt: { es: "Interior del estudio", en: "Inside the studio" } },
    { width: 1080, height: 1080, alt: { es: "Zona de recepción", en: "Reception area" } },
  ],
  channels: ["whatsapp"],
};

export default config;