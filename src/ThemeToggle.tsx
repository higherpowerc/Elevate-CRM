import { useTheme } from "./theme";

interface Props {
  className?: string;
  showLabel?: boolean;
}

export default function ThemeToggle({ className = "", showLabel = false }: Props) {
  const [theme, , toggleTheme] = useTheme();

  const isLight = theme === "light";
  const label = isLight ? "Switch to Dark mode" : "Switch to Light mode";

  return (
    <button
      type="button"
      className={`eye-btn theme-toggle-btn ${className}`}
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "6px",
        cursor: "pointer",
        padding: showLabel ? "6px 12px" : "6px",
        borderRadius: "8px",
        background: "transparent",
        border: "1px solid var(--line-strong)",
        color: "var(--ink)",
        transition: "all 0.15s ease",
      }}
    >
      {isLight ? (
        <MoonIcon />
      ) : (
        <SunIcon />
      )}
      {showLabel && (
        <span style={{ fontSize: "12px", fontWeight: 600 }}>
          {isLight ? "Dark Mode" : "Light Mode"}
        </span>
      )}
    </button>
  );
}

function SunIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
