export function KiteLogo({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path d="M24 3 41 20 24 37 7 20Z" fill="var(--brand, #F97316)" />
      <path d="M24 3v34M7 20h34" stroke="#fff" strokeWidth="2" strokeOpacity=".7" />
      <path d="M24 37c-2 3 2 4 0 7" stroke="var(--brand, #F97316)" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M22.5 40.5 19 39M25.5 43.5 29 42.5" stroke="#1E1B4B" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
