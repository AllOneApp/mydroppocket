import logoAsset from "@/assets/droppocket-logo.png.asset.json";

export function Logo({ className = "h-9 sm:h-[42px] md:h-12" }: { className?: string }) {
  return (
    <img
      src={logoAsset.url}
      alt="DropPocket"
      width="auto"
      height="auto"
      className={`w-auto object-contain ${className}`}
      style={{ maxHeight: 48 }}
    />
  );
}