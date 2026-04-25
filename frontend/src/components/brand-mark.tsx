/**
 * BrandMark — the circular Workforce0 mark used in nav, hero, auth pages, etc.
 *
 * The PNG is the canonical asset; it already includes its own dark
 * background and color treatment, so we don't wrap it in a gradient
 * tile the way the old inline SVG bolt was wrapped.
 */
import Image from "next/image";

interface BrandMarkProps {
  size?: number;
  className?: string;
  priority?: boolean;
}

export function BrandMark({ size = 36, className = "", priority = false }: BrandMarkProps) {
  return (
    <Image
      src="/logo-mark.png"
      alt="Workforce0"
      width={size}
      height={size}
      priority={priority}
      className={`rounded-xl ${className}`.trim()}
    />
  );
}
