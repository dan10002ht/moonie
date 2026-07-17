/**
 * SVG icon dùng lại trong landing — port 1:1 path từ design/mooni-landing.html.
 * Server-safe (không state). Kích thước truyền qua prop `size`.
 */
type IconProps = {
  size?: number;
  className?: string;
};

export function PhoneIcon({ size = 18, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      className={className}
      style={{ display: "block" }}
    >
      <path
        fill="currentColor"
        d="M6.5 10.6a14.5 14.5 0 0 0 6.4 6.4l2.14-2.14a1 1 0 0 1 1.02-.24c1.1.37 2.3.57 3.54.57a1 1 0 0 1 1 1v3.4a1 1 0 0 1-1 1A16.5 16.5 0 0 1 3 4a1 1 0 0 1 1-1h3.4a1 1 0 0 1 1 1c0 1.24.2 2.44.57 3.54a1 1 0 0 1-.25 1.02L6.5 10.6Z"
      />
    </svg>
  );
}

export function ChatIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      style={{ display: "block" }}
    >
      <path d="M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 3v-3H5a1 1 0 0 1-1-1V5Z" />
    </svg>
  );
}

export function CheckIcon({ size = 18, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      style={{ display: "block" }}
    >
      <path d="m4 12 5 5L20 6" />
    </svg>
  );
}

export function ZaloIcon({ size = 22, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      className={className}
      style={{ display: "block" }}
    >
      <path
        fill="currentColor"
        d="M12 3.6c-4.98 0-9 3.18-9 7.1 0 2.27 1.32 4.3 3.37 5.62-.16.9-.6 2.02-1.28 2.98-.26.36.05.86.48.74 1.86-.5 3.2-1.1 3.96-1.55.78.2 1.62.31 2.47.31 4.98 0 9-3.18 9-7.1s-4.02-7.1-9-7.1Zm-4 8.5a1.35 1.35 0 1 1 0-2.7 1.35 1.35 0 0 1 0 2.7Zm4 0a1.35 1.35 0 1 1 0-2.7 1.35 1.35 0 0 1 0 2.7Zm4 0a1.35 1.35 0 1 1 0-2.7 1.35 1.35 0 0 1 0 2.7Z"
      />
    </svg>
  );
}

export function MessengerIcon({ size = 22, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      className={className}
      style={{ display: "block" }}
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M12 2.4C6.4 2.4 2.1 6.5 2.1 11.7c0 2.85 1.32 5.36 3.4 7.06v3.24l3.11-1.71c.99.27 2.04.42 3.13.42 5.6 0 9.9-4.1 9.9-9.31S17.6 2.4 12 2.4Zm.55 12.02-2.5-2.67-4.88 2.67 5.37-5.7 2.56 2.67 4.83-2.67-5.36 5.7Z"
      />
    </svg>
  );
}

export function MenuIcon({ size = 22, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
      className={className}
      style={{ display: "block" }}
    >
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}
