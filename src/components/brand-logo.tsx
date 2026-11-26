import Image from "next/image";

import { cn } from "@/lib/utils";

const FULL_SRC = "/brand/supplier-portal-logo.png";
const MARK_SRC = "/brand/supplier-portal-mark.png";

/** Intrinsic pixels of optimized public assets (do not stretch). */
const FULL_SIZE = { width: 867, height: 191 } as const;
const MARK_SIZE = { width: 341, height: 341 } as const;

const HEIGHT = {
  sm: "h-7",
  md: "h-8",
  lg: "h-12",
} as const;

type BrandLogoProps = {
  /**
   * `full` — lockup (icon + wordmark). Desktop nav / login hero.
   * `mark` — S symbol only. Favicon-scale / compact / mobile.
   * `responsive` — mark below `sm`, full from `sm` up.
   */
  variant?: "full" | "mark" | "responsive";
  size?: keyof typeof HEIGHT;
  priority?: boolean;
  className?: string;
  /** Subtle entrance; respects prefers-reduced-motion via CSS. */
  animated?: boolean;
  /**
   * When true, images use empty alt (parent must expose the name,
   * e.g. link `aria-label` or a visually hidden heading).
   */
  decorative?: boolean;
};

function FullLogo({
  size,
  priority,
  className,
  alt,
}: {
  size: keyof typeof HEIGHT;
  priority?: boolean;
  className?: string;
  alt: string;
}) {
  return (
    <Image
      src={FULL_SRC}
      alt={alt}
      width={FULL_SIZE.width}
      height={FULL_SIZE.height}
      priority={priority}
      className={cn(
        HEIGHT[size],
        "w-auto max-w-full object-contain object-left",
        className,
      )}
    />
  );
}

function MarkLogo({
  size,
  priority,
  className,
  alt,
}: {
  size: keyof typeof HEIGHT;
  priority?: boolean;
  className?: string;
  alt: string;
}) {
  return (
    <Image
      src={MARK_SRC}
      alt={alt}
      width={MARK_SIZE.width}
      height={MARK_SIZE.height}
      priority={priority}
      className={cn(
        HEIGHT[size],
        "aspect-square w-auto object-contain",
        className,
      )}
    />
  );
}

/**
 * Approved Supplier Portal brand mark / lockup.
 * Colors are baked into the assets (#39FF14 / #FFFFFF on #050505).
 */
export function BrandLogo({
  variant = "full",
  size = "md",
  priority = false,
  className,
  animated = false,
  decorative = false,
}: BrandLogoProps) {
  const shell = cn(
    "inline-flex max-w-full items-center",
    animated && "brand-logo-enter",
    className,
  );
  const alt = decorative ? "" : "Supplier Portal";

  if (variant === "mark") {
    return (
      <span className={shell}>
        <MarkLogo size={size} priority={priority} alt={alt} />
      </span>
    );
  }

  if (variant === "full") {
    return (
      <span className={shell}>
        <FullLogo size={size} priority={priority} alt={alt} />
      </span>
    );
  }

  // Responsive swaps two images; keep both decorative so only the parent names the brand.
  return (
    <span className={shell}>
      <MarkLogo
        size={size}
        priority={priority}
        alt=""
        className="sm:hidden"
      />
      <FullLogo
        size={size}
        priority={priority}
        alt=""
        className="hidden sm:block"
      />
    </span>
  );
}
