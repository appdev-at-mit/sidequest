import type { ReactNode } from "react";
export type IconName =
  | "arrow"
  | "bell"
  | "bookmark"
  | "bike"
  | "bolt"
  | "check"
  | "car"
  | "chevron"
  | "chat"
  | "edit"
  | "grid"
  | "home"
  | "location"
  | "menu"
  | "minus"
  | "plus"
  | "moon"
  | "search"
  | "settings"
  | "send"
  | "star"
  | "sun"
  | "user"
  | "wallet"
  | "walk"
  | "truck"
  | "wrench"
  | "book"
  | "x";

export default function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    arrow: <path d="m15 18-6-6 6-6" />,
    bell: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M10 21h4" />
      </>
    ),
    bookmark: <path d="M6 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18l-6-4-6 4Z" />,
    bike: <><circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="m6 17 4-8 4 8H6l3-5h5m-4-3h3"/></>,
    bolt: <path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z" />,
    check: <path d="m5 12 4 4L19 6" />,
    car: <><path d="m5 11 2-5h10l2 5 2 2v5h-2m-14 0H3v-5l2-2Z"/><path d="M5 11h14M7 18h10"/><circle cx="6" cy="16" r="1.5"/><circle cx="18" cy="16" r="1.5"/></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    chat: <path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20l1.2-4.6A8.5 8.5 0 1 1 21 11.5Z" />,
    edit: <><path d="m14 5 5 5M4 20l4.5-1 10-10a2.12 2.12 0 0 0-3-3l-10 10L4 20Z" /></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    home: <><path d="m3 10 9-7 9 7"/><path d="M5 9v12h14V9M9 21v-7h6v7"/></>,
    truck: <><path d="M3 6h12v12H3zM15 10h4l3 3v5h-7z"/><circle cx="7.5" cy="19" r="1.5"/><circle cx="18.5" cy="19" r="1.5"/></>,
    wrench: <><path d="M14.7 6.3a5 5 0 0 0-6.4 6.4L3 18l3 3 5.3-5.3a5 5 0 0 0 6.4-6.4L14 13l-3-3z"/></>,
    book: <><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22z"/><path d="M4 4.5v15A2.5 2.5 0 0 1 6.5 17H20"/></>,
    location: (
      <>
        <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
        <circle cx="12" cy="10" r="2.5" />
      </>
    ),
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    minus: <path d="M5 12h14" />,
    plus: <path d="M12 5v14M5 12h14" />,
    moon: <path d="M21 15.2A9 9 0 1 1 8.8 3 7 7 0 0 0 21 15.2Z" />,
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </>
    ),
    settings: <><path d="M4 6h8m4 0h4M4 18h4m4 0h8" /><circle cx="14" cy="6" r="2" /><circle cx="10" cy="18" r="2" /></>,
    send: <path d="m22 2-7 20-4-9-9-4Z M22 2 11 13" />,
    star: <path d="m12 2 3 6 6.5 1-4.75 4.6 1.1 6.4L12 17l-5.85 3 1.1-6.4L2.5 9 9 8Z" />,
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </>
    ),
    wallet: <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H21v3H5.5a1.5 1.5 0 0 0 0 3H21v10H5a2 2 0 0 1-2-2V6.5ZM16 13h5" />,
    user: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </>
    ),
    walk: (
      <>
        <circle cx="13" cy="4" r="2" />
        <path d="m10 22 2-7-3-3 2-5 5 3 3 1M12 15l4 3 1 4M9 12l-4 3" />
      </>
    ),
    x: <path d="M6 6l12 12M18 6 6 18" />,
  };

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}
