import type { SVGProps } from "react";

const base = (d: string) =>
  function Icon(props: SVGProps<SVGSVGElement>) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" width={20} height={20} aria-hidden {...props}>
        <path d={d} />
      </svg>
    );
  };

export const IconHome = base("M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z");
export const IconGrid = base("M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z");
export const IconTrophy = base("M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3");
export const IconUser = base("M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0");
export const IconSettings = base("M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4");
export const IconPlay = base("M7 4v16l13-8z");
export const IconSwords = base("M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M9.5 6.5 14 2h3v3l-4.5 4.5M5 14l-2 2 3 3 2-2");
export const IconInfinity = base("M18.2 8.2a4.2 4.2 0 1 1 0 7.6c-2.4-1-4-3.8-6.2-3.8s-3.8 2.8-6.2 3.8a4.2 4.2 0 1 1 0-7.6c2.4 1 4 3.8 6.2 3.8s3.8-2.8 6.2-3.8z");
export const IconArrowLeft = base("M19 12H5M12 19l-7-7 7-7");
export const IconCopy = base("M9 9h11v11H9zM5 15H4V4h11v1");
export const IconPalette = base("M12 22a10 10 0 1 1 10-10c0 2.8-2.2 4-4 4h-2a2 2 0 0 0-1.5 3.3A1.6 1.6 0 0 1 12 22zM7.5 11.5h.01M10.5 7.5h.01M15.5 7.5h.01M17.5 11.5h.01");
export const IconBolt = base("M13 2 4 14h7l-1 8 9-12h-7z");
export const IconAlert = base("M12 3 2 20h20zM12 10v4M12 17.5v.01");
export const IconRotateCW = base("M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5");
export const IconRotateCCW = base("M4 12a8 8 0 1 0 2.3-5.7M4 4v5h5");
export const IconChevronLeft = base("M15 5l-7 7 7 7");
export const IconChevronRight = base("M9 5l7 7-7 7");
export const IconChevronDown = base("M5 9l7 7 7-7");
export const IconDropDown = base("M12 3v13M6 11l6 6 6-6M5 21h14");
