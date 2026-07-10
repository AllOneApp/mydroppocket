import logoLight from "@/assets/mydroppocket-logo.png.asset.json";
import logoDark from "@/assets/droppocket-logo-dark.png.asset.json";

export function Logo({ className = "h-[60px]" }: { className?: string }) {
  return (
    <picture>
      <source srcSet={logoDark.url} media="(prefers-color-scheme: dark)" />
      <img
        src={logoLight.url}
        alt="DropPocket"
        className={`block w-auto max-w-full object-contain ${className}`}
        style={{ maxHeight: 72 }}
        decoding="async"
      />
    </picture>
  );
}