import puppeteer from "puppeteer-core";
import fs from "fs";

const out = "/opt/cursor/artifacts/screenshots";
fs.mkdirSync(out, { recursive: true });

const chrome =
  process.env.CHROME_PATH ||
  "/opt/google/chrome/chrome" ||
  "/usr/bin/google-chrome";

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--hide-scrollbars",
  ],
  defaultViewport: { width: 1280, height: 900, deviceScaleFactor: 1 },
});

const page = await browser.newPage();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(name, fn) {
  await fn();
  await sleep(450);
  const path = `${out}/audit-${name}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log("saved", path);
}

await page.goto("http://127.0.0.1:4317/", { waitUntil: "networkidle2", timeout: 60000 });
await shot("envelope", async () => {});

// Skip intro and expand all collapsibles
await page.evaluate(() => {
  sessionStorage.setItem("invitation-opened", "1");
  const intro = document.getElementById("envelopeIntro");
  if (intro) intro.remove();
  document.body.classList.remove("intro-locked");
  document.body.classList.add("intro-open", "hero-play");
  const curtain = document.getElementById("pageCurtain");
  if (curtain) {
    curtain.classList.remove("is-entering", "is-leaving");
    curtain.classList.add("is-revealed");
  }
  document.querySelectorAll(".reveal").forEach((el) => el.classList.add("visible"));
  for (const id of ["storyExpandBtn", "attireExpandBtn", "entourageExpandBtn"]) {
    const btn = document.getElementById(id);
    if (btn && btn.getAttribute("aria-expanded") !== "true") btn.click();
  }
});
await sleep(700);

const targets = [
  ["hero", "#hero"],
  ["invite", "#invite"],
  ["countdown", "#countdown-section"],
  ["story", "#story"],
  ["venue", "#venue"],
  ["attire", "#attire"],
  ["entourage", "#entourage"],
  ["gallery", "#gallery"],
  ["rsvp", "#rsvp"],
];

for (const [name, sel] of targets) {
  await shot(name, async () => {
    await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (el) el.scrollIntoView({ block: "start" });
    }, sel);
    await sleep(400);
  });
}

// Mobile RSVP + story
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await shot("mobile-rsvp", async () => {
  await page.evaluate(() => {
    const el = document.querySelector("#rsvp");
    if (el) el.scrollIntoView({ block: "start" });
  });
});
await shot("mobile-story", async () => {
  await page.evaluate(() => {
    const el = document.querySelector("#story");
    if (el) el.scrollIntoView({ block: "start" });
  });
});

await browser.close();
console.log("done");
