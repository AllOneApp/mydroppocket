import logoAsset from "@/assets/droppocket-logo.png.asset.json";

export function Logo({ className = "h-9" }: { className?: string }) {
  return (
    <img src={logoAsset.url} alt="DropPocket" className={className} />
  );
}