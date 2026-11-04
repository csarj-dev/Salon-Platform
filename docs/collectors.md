# Cobradores: quién cobra los depósitos

Un **cobrador** es quien recibe el dinero del depósito de una cita y la forma en que se le paga.

- En un salón pequeño hay **uno**: el propio salón.
- En un salón donde trabajan varias titulares, cada una con su NIF y su TPV (como The Room: el salón, Amanda y Luz), hay **uno por titular**.

El cobrador decide cómo paga la clienta al reservar y en su página de confirmación: con instrucciones (Bizum, transferencia…) o pidiendo por WhatsApp el enlace de cobro del TPV, y a qué número escribe. **A quién se paga no se le dice a la clienta**: es información interna del salón. Solo la ve el equipo, en el panel de depósitos y en las notas de la cita en Koibox, y solo si cobra más de una persona.

El importe del depósito no es cosa del cobrador: va en cada servicio (`npx tsx db/service-deposit.ts`).

## Dónde se configura

En el config del salón (`salons/<id>/config.ts`), en `payments`:

```ts
payments: {
  // El que cobra cuando no se indica otro. Si solo hay uno, no hace falta.
  defaultCollector: "salon",
  collectors: {
    salon: {
      label: "The Room Studio", // lo que ve la clienta y recepción
      deposit: {
        mode: "whatsapp", // pide el enlace de pago por WhatsApp
        // whatsapp: "34600000000", // su número; sin esto, el del salón (contact.whatsapp)
      },
    },
    amanda: {
      label: "Amanda",
      deposit: {
        mode: "instructions", // paga siguiendo estas instrucciones y manda el comprobante
        instructions: {
          es: "Haz un Bizum al 611 111 111 indicando tu nombre y la fecha de la cita.",
          en: "Send a Bizum payment to 611 111 111 with your name and the appointment date.",
        },
      },
    },
  },
},
```

| Campo | Qué es |
|---|---|
| `label` | Nombre del cobrador. Solo lo ve el equipo (panel de depósitos, notas de Koibox), y solo si cobra más de una persona. La clienta nunca lo ve. |
| `deposit.mode` | `"whatsapp"`: la clienta pide el enlace de pago por WhatsApp al reservar. `"instructions"`: ve las instrucciones y manda el comprobante por WhatsApp. Por defecto, `"instructions"`. |
| `deposit.whatsapp` | Número al que escribe la clienta para pagar a este cobrador. Sin esto, el del salón (`contact.whatsapp`), que es lo normal: **recepción** atiende ese WhatsApp, ve en el panel quién cobra y manda el enlace del TPV que toca. Solo hace falta si una titular gestiona sus cobros ella misma (por ejemplo, autónomas sin recepción). Con `mode: "whatsapp"` tiene que haber uno de los dos. |
| `deposit.instructions` | Cómo pagarle, en todos los idiomas del salón. Sin esto, la clienta ve "El salón te escribirá con las instrucciones de pago". |

Lo que es común a todo el salón sigue en `booking.deposit`: el plazo para pagar (`holdHours`) y la política de cancelación y devolución (`policy`).

**Salón sin `payments`:** tiene un único cobrador, el salón, con instrucciones (sin texto) y el WhatsApp del salón. Para cobrar por WhatsApp hay que definir el cobrador:

```ts
payments: { collectors: { salon: { label: "Mi salón", deposit: { mode: "whatsapp" } } } },
```

> Antes, el modo y las instrucciones iban en `booking.deposit.mode` y `booking.deposit.instructions`. Si un config los trae, la web no arranca y el error dice que se movieron aquí.

## Qué cobrador toca en cada cita

Se mira la profesional de la cita, de lo más concreto a lo más general:

1. **El de la profesional**, si se le ha puesto uno (`npx tsx db/collectors.ts set …`).
2. **El de su cuenta de Koibox**, si la cuenta lo indica (`koibox.accounts.<cuenta>.collector`).
3. **El cobrador por defecto** (`payments.defaultCollector`, o el único que haya).

Si una profesional o una cuenta apuntan a un cobrador que ya no está en el config, se salta y se usa el siguiente: la cita no se rompe. `db/collectors.ts list` avisa de esos casos.

Con "cualquiera", el cobrador es el de la profesional que acaba atendiendo la cita.

La regla está en `lib/collectors.ts` (`resolveCollector`); en la base se lee con `lib/collectors-db.ts`.

## Ejemplos según el salón

**Un salón que cobra todo** (con o sin Koibox): un solo cobrador, sin más.

```ts
payments: { collectors: { salon: { label: "Mi salón", deposit: { mode: "whatsapp" } } } },
```

**Varias titulares con Koibox** (The Room): un cobrador por titular y cada cuenta de Koibox apunta al suyo.

```ts
payments: {
  defaultCollector: "salon",
  collectors: {
    salon: { label: "The Room Studio", deposit: { mode: "whatsapp" } },
    amanda: { label: "Amanda", deposit: { mode: "whatsapp" } },
  },
},
koibox: {
  accounts: {
    salon: { label: "Cuenta del salón", keyEnv: "KOIBOX_KEY_SALON", collector: "salon" },
    amanda: { label: "Cuenta de Amanda", keyEnv: "KOIBOX_KEY_AMANDA", collector: "amanda" },
  },
},
```

**Varias titulares sin Koibox** (por ejemplo, autónomas que alquilan sillón): un cobrador por titular en el config y se asigna a cada profesional en la base:

```
npx tsx db/collectors.ts set 12 marta
npx tsx db/collectors.ts set 15 rocio
```

Las que no tengan uno propio cobran con el de por defecto.

**Excepción en un salón con Koibox:** una profesional de la cuenta del salón que cobra lo suyo se asigna igual, con `set`. Manda sobre el de su cuenta.

## `db/collectors.ts`

```
npx tsx db/collectors.ts list                     cobradores del config y el de cada profesional (y de dónde sale)
npx tsx db/collectors.ts set <staffId> <cobrador> esa profesional cobra con ese cobrador
npx tsx db/collectors.ts clear <staffId>          vuelve al de su cuenta o al de por defecto
```

Solo admite cobradores que existen en el config. Lo que guarda es la columna `staff.collector` (migración `0018_staff_collector`).

## Más adelante

- **Pago online (entrega 7):** cada cobrador tendrá su TPV (BBVA/Redsys) para cobrar el depósito en la web. Irá dentro de su entrada en `payments.collectors`.
- **Panel (entrega 6):** ver y asignar el cobrador de cada profesional desde la pantalla de enlaces, además de con el script.