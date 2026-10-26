const config = {
  name: "The Room",
  timezone: "Atlantic/Canary",
  locales: ["es", "en"],
  defaultLocale: "es",
  branding: {
    logoText: "The Room",
    logo: "/salons/the-room/the-room-wordmark-dark.svg",
    logoWidth: 987,
    logoHeight: 155,
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
    channels: ["online", "whatsapp"],
    // Depósitos: el importe se pone en cada servicio (npx tsx db/service-deposit.ts)
    // Los textos de abajo son de ejemplo hasta que el salón confirme los suyos.
    deposit: {
      // "whatsapp": la clienta pide por chat el enlace de cobro del TPV; "instructions": Bizum/transferencia
      mode: "whatsapp",
      holdHours: 24,
      instructions: {
        es: "Haz un Bizum al 600 000 000 indicando tu nombre y la fecha de la cita. Cuando lo recibamos, tu cita queda confirmada.",
        en: "Send a Bizum payment to 600 000 000 with your name and the appointment date. Once we receive it, your appointment is confirmed.",
      },
      policy: {
        es: "El depósito se descuenta del precio del servicio. Si cancelas con 24 horas o más de antelación, te lo devolvemos.",
        en: "The deposit is deducted from the service price. If you cancel at least 24 hours in advance, we refund it.",
      },
    },
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
  // Portada. Sin `src` se pinta gris; con foto: src: "/salons/the-room/hero.webp"
  hero: {
    src: "/salons/the-room/hero.webp",
    width: 1536,
    height: 1024,
    focus: "center 15%",
    mobile: { src: "/salons/the-room/hero-mobile.webp", width: 900, height: 1350 },
    alt: {
      es: "El equipo de The Room en el estudio",
      en: "The Room team at the studio",
    },
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
};

export default config;