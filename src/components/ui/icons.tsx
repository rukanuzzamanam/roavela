import type { SVGProps } from "react";

/**
 * Inline icon set (stroke icons, 24×24). Decorative by default — pass `aria-label` and
 * `aria-hidden={false}` when an icon conveys meaning on its own.
 */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 20, ...props }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: false,
    ...props,
  };
}

const paths: Record<string, React.ReactNode> = {
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  car: <><path d="M5 17h14M6.5 17v2M17.5 17v2M4 13l1.6-4.3A2 2 0 0 1 7.5 7.4h9a2 2 0 0 1 1.9 1.3L20 13v4H4z" /><circle cx="7.5" cy="14" r=".6" /><circle cx="16.5" cy="14" r=".6" /></>,
  pin: <><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  users: <><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><path d="M16 5.2a3 3 0 0 1 0 5.6M18 14.8c1.8.6 3 2.2 3 5.2" /></>,
  heart: <path d="M12 20s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10z" />,
  star: <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />,
  bed: <><path d="M3 18v-8M21 18v-5a3 3 0 0 0-3-3h-8v8M3 14h18" /><circle cx="6.5" cy="11.5" r="1.5" /></>,
  bath: <><path d="M4 12h16v2a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM6 12V6a2 2 0 0 1 3.6-1.2M7 19l-1 2M17 19l1 2" /></>,
  wifi: <><path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0" /><circle cx="12" cy="19" r=".8" /></>,
  kitchen: <><path d="M7 3v8M5 3v4a2 2 0 0 0 4 0V3M7 11v10M16 3c-1.7 0-3 2-3 5s1.3 4 3 4v9" /></>,
  snow: <path d="M12 2v20M4 7l16 10M20 7 4 17M9 4l3 2 3-2M9 20l3-2 3 2" />,
  washer: <><rect x="4" y="3" width="16" height="18" rx="2" /><circle cx="12" cy="13" r="4.5" /><path d="M7.5 6.5h.01M10.5 6.5h.01" /></>,
  pool: <path d="M2 16c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5M2 20c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5M8 13V5a2 2 0 0 1 4 0M16 13V5a2 2 0 0 0-4 0M8 8h8" />,
  spa: <><path d="M12 20c-4 0-7-2.5-8-6 3 0 6 1.5 8 4 2-2.5 5-4 8-4-1 3.5-4 6-8 6z" /><path d="M12 18c-1.7-2-2.5-4.2-2.5-6.5S10.3 7 12 5c1.7 2 2.5 4.2 2.5 6.5S13.7 16 12 18z" /></>,
  flame: <path d="M12 21c3.9 0 6.5-2.6 6.5-6.2 0-4.3-3.5-6.3-4.3-10.8-2.7 1.6-4.2 4.1-4.2 6.7-1-.6-1.6-1.8-1.8-2.9C6.5 9.5 5.5 11.6 5.5 14.8 5.5 18.4 8.1 21 12 21z" />,
  plug: <path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4" />,
  grill: <><path d="M4 10h16a8 8 0 0 1-16 0zM8 17l-2 4M16 17l2 4M9 6c0-1 1-1.5 1-2.500M13 6c0-1 1-1.5 1-2.5" /></>,
  paw: <><circle cx="7" cy="10" r="1.8" /><circle cx="17" cy="10" r="1.8" /><circle cx="10" cy="6" r="1.8" /><circle cx="14" cy="6" r="1.8" /><path d="M8.5 17.5c0-2.5 1.6-4.5 3.5-4.500s3.5 2 3.5 4.500c0 1.5-1.1 2.5-2.3 2.5-.5 0-.8-.3-1.2-.300s-.7.3-1.2.300c-1.2 0-2.3-1-2.3-2.500z" /></>,
  family: <><circle cx="7" cy="6" r="2.2" /><circle cx="17" cy="6" r="2.2" /><circle cx="12" cy="12" r="1.8" /><path d="M3.5 20v-5a3.5 3.5 0 0 1 7 0M13.5 15a3.5 3.5 0 0 1 7 0v5M9.5 20v-1.500a2.5 2.5 0 0 1 5 0V20" /></>,
  accessible: <><circle cx="12" cy="4.5" r="1.8" /><path d="M6 8.500l6 1 6-1M12 9.500v5l-3.5 6.500M12 14.500l3.5 6.5" /></>,
  wave: <path d="M2 12c2.5 0 2.5-2.5 5-2.500S9.5 12 12 12s2.5-2.5 5-2.500S19.5 12 22 12M2 17c2.5 0 2.5-2.5 5-2.500S9.5 17 12 17s2.5-2.5 5-2.500S19.5 17 22 17M2 7c2.5 0 2.5-2.5 5-2.500S9.5 7 12 7s2.5-2.5 5-2.500S19.5 7 22 7" />,
  mountain: <path d="m2 20 7-12 4 6.5 2.5-3.500L22 20zM7.2 11.2 9 13l1.8-1.6" />,
  grape: <><circle cx="9" cy="11" r="2" /><circle cx="15" cy="11" r="2" /><circle cx="12" cy="15" r="2" /><circle cx="12" cy="7" r="2" /><path d="M12 5V2.500M12 3c1.5-1 3.5-1 4.5 0" /><circle cx="12" cy="19" r="2" /></>,
  tractor: <><circle cx="7" cy="16" r="4" /><circle cx="18" cy="17.5" r="2.5" /><path d="M5 12V6h6l2 6M11 12h6l2 3M15 12V8" /></>,
  list: <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />,
  map: <><path d="m9 4-6 2.500v13.500l6-2.5 6 2.5 6-2.500V4l-6 2.500z" /><path d="M9 4v13.500M15 6.500V20" /></>,
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  minus: <path d="M5 12h14" />,
  plus: <path d="M12 5v14M5 12h14" />,
  alert: <><path d="M12 3.5 2.5 20h19z" /><path d="M12 10v4M12 17h.01" /></>,
  check: <path d="m5 12.5 4.5 4.500L19 7" />,
  compass: <><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5z" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6.5 8-6.500s8 2.5 8 6.5" /></>,
  home: <path d="M3 11.5 12 4l9 7.500M5.5 9.500V20h13V9.5" />,
  shield: <path d="M12 3 4.5 6v6c0 4.5 3.2 7.8 7.5 9 4.3-1.2 7.5-4.5 7.5-9V6z" />,
  heater: <><rect x="4" y="6" width="16" height="12" rx="2" /><path d="M8 6v12M12 6v12M16 6v12M6 18v2M18 18v2" /></>,
  desk: <><path d="M3 10h18M5 10v10M19 10v10M13 10v5h6" /><rect x="7" y="4" width="8" height="6" rx="1" /></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  images: <><rect x="3" y="5" width="14" height="12" rx="2" /><path d="M7 21h12a2 2 0 0 0 2-2V9M3 14l4-4 4 4 2-2 4 4" /></>,
  clock:<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
};

export type IconName = keyof typeof paths;

export function Icon({ name, ...props }: IconProps & { name: IconName | string }) {
  const content = paths[name] ?? paths.compass;
  return <svg {...base(props)}>{content}</svg>;
}
