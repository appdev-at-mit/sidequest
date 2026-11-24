import type L from "leaflet";
export type Request = {
  id: string | number;
  category: string;
  title: string;
  location: string;
  reward: string;
  distance: string;
  description: string;
  posted: string;
  lat: number | null;
  lng: number | null;
  poster: string;
  start?: string | null;
  end?: string | null;
  pickup?: string | null;
  dropoff?: string | null;
  createdAt?: string | null;
  expiresAt?: string | null;
  expired?: boolean;
  rating?: number | null;
  imageUrl?: string | null;
  status?: number;
  questStage?: number;
  helper?: string | null;
  requester?: string | null;
};

export const mapRequests: Request[] = [
  {
    id: 1,
    category: "Moving",
    title: "Help move a sofa upstairs",
    location: "450 Massachusetts Ave, Cambridge",
    reward: "85.00",
    distance: "0.4 mi",
    description:
      "I need one person to help carry a three-seat sofa from the lobby to my third-floor apartment. It should take about an hour, and I’ll be there to help.",
    posted: "18 min ago",
    lat: 42.35972,
    lng: -71.09416,
    poster: "Maya",
  },
  {
    id: 2,
    category: "Delivery",
    title: "Pick up a desk from IKEA",
    location: "Kendall Square, Cambridge",
    reward: "55.00",
    distance: "1.1 mi",
    description:
      "Pick up a flat-packed desk and deliver it to my apartment. It should fit in a standard SUV or larger vehicle.",
    posted: "32 min ago",
    lat: 42.36234,
    lng: -71.08618,
    poster: "Theo",
  },
  {
    id: 3,
    category: "Home Help",
    title: "Mount two living room shelves",
    location: "Cambridgeport, Cambridge",
    reward: "70.00",
    distance: "0.8 mi",
    description:
      "Looking for someone with tools and experience to securely mount two floating shelves on a drywall surface.",
    posted: "1 hr ago",
    lat: 42.35491,
    lng: -71.10432,
    poster: "Priya",
  },
  {
    id: 4,
    category: "Academic",
    title: "Review my calculus problem set",
    location: "77 Massachusetts Ave, Cambridge",
    reward: "32.00",
    distance: "0.2 mi",
    description:
      "I’d love a second set of eyes on my calculus problem set before tomorrow. Looking for help checking my work, not doing it for me.",
    posted: "12 min ago",
    lat: 42.36011,
    lng: -71.09212,
    poster: "Noah",
  },
  {
    id: 5,
    category: "Tech",
    title: "Set up a new Wi-Fi router",
    location: "Central Square, Cambridge",
    reward: "40.00",
    distance: "1.3 mi",
    description:
      "Help connect and configure a new Wi-Fi router in my apartment, including reconnecting three existing devices.",
    posted: "47 min ago",
    lat: 42.36502,
    lng: -71.10388,
    poster: "Lena",
  },
];

export const categories = ["All", "Delivery", "Moving", "Home Help", "Tech", "Academic"];
export const CAMBRIDGE_CENTER: L.LatLngTuple = [42.3604, -71.0942];

export const MAP_TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}";
export const MAP_TILE_OPTIONS = { attribution: "Tiles &copy; Esri", maxZoom: 19 };
