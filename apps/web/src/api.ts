export interface Person {
  _id: string;
  displayName: string;
  averageRating: number;
  ratingCount: number;
  fictional?: boolean;
  kerberosId?: string;
  email?: string;
  venmoUsername?: string;
  role?: string;
  accountStatus?: string;
  termsVersion?: string;
}
export interface Location {
  type: "Point";
  coordinates: [number, number];
  label: string;
}
export interface Quest {
  _id: string;
  title: string;
  description: string;
  instructions?: string;
  category: string;
  payCents: number;
  startLocation: Location;
  endLocation?: Location;
  deadline: string;
  status: string;
  requesterId: Person;
  performerId?: Person;
  fictional: boolean;
  distanceMeters?: number;
  workSubmittedAt?: string;
  overdue?: boolean;
  requesterVenmoUsername?: string;
}
export interface Auth {
  user: Person | null;
  csrfToken: string;
  termsVersion: string;
  developmentLogin: boolean;
}
let csrf = "";
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(csrf ? { "x-csrf-token": csrf } : {}),
      ...options.headers,
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  if (data.csrfToken) csrf = data.csrfToken;
  return data;
}
export const post = (path: string, data = {}) =>
  api(path, { method: "POST", body: JSON.stringify(data) });
export const money = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 ? 2 : 0,
  }).format(cents / 100);
export const categoryLabel: Record<string, string> = {
  FOOD: "Food run",
  DELIVERY: "Delivery",
  MOVING: "Moving help",
  BORROWING: "Borrowing",
  ERRAND: "Campus errand",
};
