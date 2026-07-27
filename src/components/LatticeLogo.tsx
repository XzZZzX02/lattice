export function LatticeLogo({ large = false }: { large?: boolean }) {
  return (
    <span className={large ? "brand-mark large" : "brand-mark"} aria-hidden="true">
      <svg viewBox="0 0 24 24" role="presentation">
        <path d="M6 6h12M6 12h12M6 18h12M6 6v12M12 6v12M18 6v12" />
        <circle cx="6" cy="6" r="1.3" />
        <circle cx="18" cy="6" r="1.3" />
        <circle cx="12" cy="12" r="1.3" />
        <circle cx="6" cy="18" r="1.3" />
        <circle cx="18" cy="18" r="1.3" />
      </svg>
    </span>
  );
}
