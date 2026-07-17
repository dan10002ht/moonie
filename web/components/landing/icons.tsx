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
