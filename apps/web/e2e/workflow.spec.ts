import { test, expect } from "@playwright/test";
test("discovery, two-person task, live chat, review, and support", async ({
  page,
  browser,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: /Show quests/ }).click();
  await expect(
    page.getByRole("button", { name: /Grab dinner from the Student Center/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Grab dinner from the Student Center/ })
    .click();
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "Show map" }).click();
  await expect(
    page.getByRole("link", { name: "See quest details" }),
  ).toBeVisible();
  await page.screenshot({
    path: `/tmp/sidequest-${info.project.name}.png`,
    fullPage: true,
  });
  await page.goto("/login");
  await page
    .getByRole("button", {
      name:
        info.project.name === "mobile"
          ? "Continue as Jordan Brooks"
          : "Continue as Alex Chen",
    })
    .click();
  await expect(page).toHaveURL("http://localhost:5174/");
  await page.goto("/quests/new");
  await expect(page.getByLabel("Quest title")).toBeVisible();
  const terms = page.getByRole("button", {
    name: "I have read and accept these terms",
  });
  if (await terms.isVisible()) await terms.click();
  await page
    .getByLabel("Quest title")
    .fill(`Browser delivery ${info.project.name}`);
  await page
    .getByLabel("What do you need?")
    .fill("Bring a notebook to the Lobby 7 entrance.");
  await page.getByLabel("Payment (USD)").fill("8.50");
  await page.getByLabel("Pickup location name").fill("Lobby 7 entrance");
  const deadline = new Date(Date.now() + 3600000);
  const localDate = new Date(
    deadline.getTime() - deadline.getTimezoneOffset() * 60000,
  )
    .toISOString()
    .slice(0, 16);
  await page.getByLabel("Deadline (within 24 hours)").fill(localDate);
  await page.getByRole("button", { name: "Post quest", exact: true }).click();
  await expect(page).toHaveURL(/\/quests\/[a-f\d]{24}$/);
  const questPath = new URL(page.url()).pathname;
  const partnerContext = await browser.newContext({
    baseURL: "http://localhost:5174",
  });
  const partner = await partnerContext.newPage();
  await partner.goto("/login");
  await partner.getByRole("button", { name: "Continue as Maya Patel" }).click();
  await expect(partner).toHaveURL("http://localhost:5174/");
  await partner.goto(questPath);
  await expect(
    partner.getByRole("button", { name: "Accept this quest" }),
  ).toBeVisible();
  const partnerTerms = partner.getByRole("button", {
    name: "I have read and accept these terms",
  });
  if (await partnerTerms.isVisible()) await partnerTerms.click();
  await partner.getByRole("button", { name: "Accept this quest" }).click();
  await expect(partner.getByText("ACCEPTED", { exact: true })).toBeVisible();
  await partner.getByRole("link", { name: "Open conversation" }).click();
  await page.goto(questPath);
  await page.getByRole("link", { name: "Open conversation" }).click();
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Hello! Meet me outside Lobby 7.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    partner.getByText("Hello! Meet me outside Lobby 7."),
  ).toBeVisible({ timeout: 5000 });
  await partner.goto(questPath);
  await partner.getByRole("button", { name: "Mark work as done" }).click();
  await page.goto(questPath);
  await page.getByRole("button", { name: "Confirm task completion" }).click();
  await expect(page.getByText("COMPLETED", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Submit review" }).click();
  await expect(
    page.getByRole("button", { name: "Submit review" }),
  ).toBeDisabled();
  await page.getByRole("link", { name: "Report this quest" }).click();
  await page
    .getByLabel("What happened?")
    .fill("Fictional test report to exercise the support workflow.");
  await page.getByRole("button", { name: "Submit report" }).click();
  await expect(page.getByText("Inappropriate behavior · OPEN")).toBeVisible();
  expect(errors).toEqual([]);
  await partnerContext.close();
});
