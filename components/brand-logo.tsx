import Image from "next/image";
import type { SalonConfig } from "@/lib/salon-config";

type Props = {
  branding: SalonConfig["branding"];
  name: string;
  className?: string;
};

export function BrandLogo({ branding, name, className }: Props) {
  const text = branding?.logoText ?? name;

  if (!branding?.logo) {
    return <span className="font-semibold tracking-tight">{text}</span>;
  }

  return (
    <Image
      src={branding.logo}
      alt={text}
      width={branding.logoWidth ?? 160}
      height={branding.logoHeight ?? 48}
      priority
      className={className ?? "h-14 w-auto"}
    />
  );
}