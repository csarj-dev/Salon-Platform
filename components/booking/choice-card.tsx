import type { ComponentProps } from "react";
import { Link } from "@/i18n/navigation";
import { Card, CardContent } from "@/components/ui/card";

type Props = {
  href: ComponentProps<typeof Link>["href"];
  title: string;
  description?: string | null;
  meta?: string;
};

export function ChoiceCard({ href, title, description, meta }: Props) {
  return (
    <Link
      href={href}
      className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="transition-colors hover:bg-muted/50">
        <CardContent className="flex items-start justify-between gap-4">
          <div>
            <p className="font-medium">{title}</p>
            {description && (
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            )}
          </div>
          {meta && <span className="shrink-0 text-sm text-muted-foreground">{meta}</span>}
        </CardContent>
      </Card>
    </Link>
  );
}