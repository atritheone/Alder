export function WriteGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="butt"
      strokeLinejoin="miter"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" />
      <path d="M3 7.5H21 M3 12H21 M3 16.5H21" />
    </svg>
  );
}

export function ArrangementGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="butt"
      strokeLinejoin="miter"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" />
      <path d="M12 3V21 M3 12H21" />
    </svg>
  );
}
