import { afterEach, expect, it, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { Discovery } from "./Discovery";
const quests = [
  {
    _id: "quest-a",
    title: "Deliver a notebook",
    description: "Delivery",
    category: "DELIVERY",
    payCents: 700,
    startLocation: {
      type: "Point",
      coordinates: [-71.0932, 42.3592],
      label: "Lobby 7",
    },
    deadline: new Date(Date.now() + 3600000).toISOString(),
    requesterId: { _id: "u1", displayName: "Alex Chen" },
    distanceMeters: 42,
  },
  {
    _id: "quest-b",
    title: "A food run",
    category: "FOOD",
    payCents: 500,
    startLocation: {
      type: "Point",
      coordinates: [-71.0957, 42.359],
      label: "Student Center",
    },
    deadline: new Date(Date.now() + 3600000).toISOString(),
    requesterId: { _id: "u2", displayName: "Maya Patel" },
  },
];
vi.mock("./MapView", () => ({
  CAMPUS: [42.3592, -71.0932],
  MapView: ({ selected, onSelect }: any) => (
    <div>
      <span data-testid="map-selection">{selected?._id || "none"}</span>
      <button onClick={() => onSelect("quest-b")}>Click food map pin</button>
    </div>
  ),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("uses one selection state for list, map pins, and detail preview", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: quests, total: 2, limit: 20 }),
    }),
  );
  render(
    <BrowserRouter>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <Discovery />
      </QueryClientProvider>
    </BrowserRouter>,
  );
  const card = await screen.findByRole("button", {
    name: /Deliver a notebook/,
  });
  fireEvent.click(card);
  expect(screen.getByTestId("map-selection").textContent).toBe("quest-a");
  expect(card.getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByText("See quest details").getAttribute("href")).toBe(
    "/quests/quest-a",
  );
  fireEvent.click(screen.getByText("Click food map pin"));
  await waitFor(() =>
    expect(screen.getByTestId("map-selection").textContent).toBe("quest-b"),
  );
  expect(card.getAttribute("aria-pressed")).toBe("false");
  expect(
    screen
      .getByRole("button", { name: /Food run.*A food run/ })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(screen.getByText("See quest details").getAttribute("href")).toBe(
    "/quests/quest-b",
  );
});
