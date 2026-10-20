import Image from "next/image";
import Link from "next/link";

type BrandSize = "header" | "sidebar" | "drawer" | "login";

export function Brand({
  size = "header",
  className = "",
}: {
  size?: BrandSize;
  className?: string;
}) {
  return (
    <Link
      href="/dashboard"
      className={`brand brand-${size} ${className}`.trim()}
      aria-label="Permora dashboard"
    >
      <Image
        src="/assets/Logo.png"
        alt="Permora logo"
        width={size === "login" ? 88 : size === "sidebar" ? 48 : 40}
        height={size === "login" ? 88 : size === "sidebar" ? 48 : 40}
        priority={size === "login" || size === "header"}
      />
      <span className="brand-name">Permora</span>
    </Link>
  );
}
