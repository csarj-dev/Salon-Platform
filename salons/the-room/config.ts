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
        es: "El depósito se descuenta del precio del servicio. Si cancelas con al menos 24 horas de antelación, lo guardamos para tu próxima cita. Si cancelas con menos de 24 horas o no vienes, se pierde. Los depósitos no se reembolsan.",
        en: "The deposit is deducted from the service price. If you cancel at least 24 hours in advance, we keep it for your next appointment. If you cancel with less than 24 hours' notice or don't show up, it is lost. Deposits are non-refundable.",
      },
    },
  },
  // Una cuenta de Koibox por titular: cada cita se guarda en la de quien hace el servicio.
  // Las claves van en Vercel (Settings → Environment Variables), nunca en este archivo.
  koibox: {
    accounts: {
      salon: { label: "Cuenta del salón (TR Studio)", keyEnv: "KOIBOX_KEY_SALON" },
      amanda: { label: "Cuenta de Amanda", keyEnv: "KOIBOX_KEY_AMANDA" },
      luz: { label: "Cuenta de Luz (TR Micros)", keyEnv: "KOIBOX_KEY_LUZ" },
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