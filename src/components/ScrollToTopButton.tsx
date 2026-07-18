import { ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Universal "back to top" floating button.
 * Appears after the user scrolls > 400px and stays out of the way
 * of mobile bottom nav / safe area.
 */
export function ScrollToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      type="button"
      aria-label="Scroll to top"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className="fixed right-4 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-sky-500 text-white shadow-lg shadow-sky-500/30 transition-transform hover:scale-105 hover:bg-sky-500/90 sm:right-6 sm:h-14 sm:w-14"
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)" }}
    >
      <ArrowUp className="h-5 w-5 sm:h-6 sm:w-6" />
    </button>
  );
}