import logoAsset from "@/assets/mydroppocket-logo.png.asset.json";

export function Logo({ className = "h-11 sm:h-12 md:h-14" }: { className?: string }) {
  return (
    <img
      src={logoAsset.url}
      alt="DropPocket"
      width="auto"
      height="auto"
      className={`w-auto object-contain ${className}`}
      style={{ maxHeight: 72 }}
    />
  );
}