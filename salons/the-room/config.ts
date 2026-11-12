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
    { name: "The Room Studio", address: "Luján Pérez, 27, Adeje" },
    { name: "The Room Micropigmentacion", address: "Plaza César Manrique, 10, Local 3, Adeje" },
  ],
  booking: {
    slotStepMin: 30,
    bufferMin: 0,
    minNoticeHours: 2,
    maxDaysAhead: 60,
    cancellationNoticeHours: 24,
    channels: ["online", "whatsapp"],
    // De dónde salen los huecos: "local" hasta tener las claves de Koibox; luego "koibox".
    // Para probar en local sin tocar esto: BOOKING_AVAILABILITY=koibox en el .env
    availability: "local",
    // Depósitos: el importe se pone en cada servicio (npx tsx db/service-deposit.ts).
    // Cómo se pagan va en payments (abajo). La política es de ejemplo hasta que el salón confirme la suya.
    deposit: {
      holdHours: 24,
      policy: {
        es: "…", // la que ya tienes, sin cambios
        en: "…",
      },
    },
  },
  // Quién cobra los depósitos: una titular por cuenta de Koibox (cada una con su NIF y su TPV).
  // Guía: docs/collectors.md. La clienta siempre pide el enlace a recepción (contact.whatsapp, sin
  // deposit.whatsapp propio): recepción ve en el panel quién cobra y lo genera desde ese TPV.
  payments: {
    defaultCollector: "salon",
    collectors: {
      salon: { label: "The Room Studio", color: "#8a9a7b", deposit: { mode: "whatsapp" } },
      amanda: { label: "Amanda", color: "#c9a27e", deposit: { mode: "whatsapp" } },
      luz: { label: "The Room Micropigmentación", color: "#7a5c46", deposit: { mode: "whatsapp" } },
    },
  },
  // Una cuenta de Koibox por titular: cada cita se guarda en la de quien hace el servicio.
  // Las claves van en Vercel (Settings → Environment Variables), nunca en este archivo.
  koibox: {
    accounts: {
      salon: { label: "Cuenta del salón (TR Studio)", keyEnv: "KOIBOX_KEY_SALON", locations: ["the-room-studio"], collector: "salon" },
      amanda: { label: "Cuenta de Amanda", keyEnv: "KOIBOX_KEY_AMANDA", locations: ["the-room-studio"], collector: "amanda" },
      luz: { label: "Cuenta de Luz (TR Micros)", keyEnv: "KOIBOX_KEY_LUZ", locations: ["the-room-micropigmentacion"], collector: "luz" },
    },
  },
  email: {
    // Recordatorio por correo antes de la cita. Si se confirma que Koibox ya los manda
    // en las tres cuentas, poner false para que la clienta no reciba dos.
    reminders: true,
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
    success: "#3f6b4a",
    warning: "#8a6230",
    danger: "#8a3b2e",
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
  gallery: [
    { src: "/salons/the-room/gallery/laminado-antes-despues.jpg", width: 1080, height: 1080, alt: { es: "Laminado de cejas, antes y después", en: "Brow lamination, before and after" } },
    { src: "/salons/the-room/gallery/lifting-antes-despues.webp", width: 1080, height: 1080, alt: { es: "Lifting de pestañas, antes y después", en: "Lash lift, before and after" } },
    { src: "/salons/the-room/gallery/microblading-antes-despues.jpg", width: 1080, height: 1080, alt: { es: "Microblading, antes y después", en: "Microblading, before and after" } },
    { src: "/salons/the-room/gallery/laminado-resultado.webp", width: 1080, height: 1080, alt: { es: "Cejas laminadas, resultado final", en: "Laminated brows, final result" } },
    { src: "/salons/the-room/gallery/lifting-detalle.webp", width: 1080, height: 1080, alt: { es: "Detalle de lifting de pestañas", en: "Close-up of a lash lift" } },
    { src: "/salons/the-room/gallery/microblading-proceso.webp", width: 1080, height: 1080, alt: { es: "Microblading en proceso", en: "Microblading in progress" } },
    { src: "/salons/the-room/gallery/estudio-recepcion.webp", width: 1080, height: 1080, alt: { es: "Recepción del estudio", en: "Studio reception" } },
    { src: "/salons/the-room/gallery/estudio-espejos.webp", width: 1080, height: 1080, alt: { es: "Zona de trabajo con espejos", en: "Work area with mirrors" } },
    { src: "/salons/the-room/gallery/estudio-sur.webp", width: 1080, height: 1080, alt: { es: "Estudio The Room Micropigmentación", en: "The Room Micropigmentación studio" } },
  ],
};

export default config;