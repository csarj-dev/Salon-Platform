import type { SalonConfig } from "./salon-config";

// Traduce el tema del salón a las variables CSS que usa shadcn/ui (y las de estado del panel)
export function themeToCssVars(t: SalonConfig["theme"]): Record<string, string> {
  return {
    "--background": t.background,
    "--foreground": t.foreground,
    "--card": t.surface,
    "--card-foreground": t.foreground,
    "--popover": t.surface,
    "--popover-foreground": t.foreground,
    "--primary": t.primary,
    "--primary-foreground": t.primaryForeground,
    "--secondary": t.secondary,
    "--secondary-foreground": t.secondaryForeground,
    "--accent": t.secondary,
    "--accent-foreground": t.secondaryForeground,
    "--muted": t.muted,
    "--muted-foreground": t.mutedForeground,
    "--border": t.border,
    "--input": t.border,
    "--ring": t.primary,
    "--radius": t.radius,
    "--success": t.success,
    "--warning": t.warning,
    "--danger": t.danger,
    "--destructive": t.danger,
  };
}