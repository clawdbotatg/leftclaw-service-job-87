// Build a 1200x630 OG image for CLAWD Rain. Run once.
const sharp = require("sharp");
const path = require("path");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0b1220"/>
      <stop offset="100%" stop-color="#111827"/>
    </linearGradient>
    <linearGradient id="drop" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#60a5fa"/>
      <stop offset="100%" stop-color="#1d4ed8"/>
    </linearGradient>
    <radialGradient id="glow1" cx="0.2" cy="0.0" r="0.6">
      <stop offset="0%" stop-color="rgba(56,189,248,0.25)"/>
      <stop offset="100%" stop-color="rgba(56,189,248,0)"/>
    </radialGradient>
    <radialGradient id="glow2" cx="0.9" cy="1.0" r="0.5">
      <stop offset="0%" stop-color="rgba(96,165,250,0.25)"/>
      <stop offset="100%" stop-color="rgba(96,165,250,0)"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#glow1)"/>
  <rect width="1200" height="630" fill="url(#glow2)"/>

  <!-- raindrops scatter -->
  <g opacity="0.5">
    ${Array.from({ length: 18 }, (_, i) => {
      const cx = 60 + ((i * 71) % 1080);
      const cy = 80 + ((i * 137) % 470);
      return `<path d="M${cx} ${cy}c-3 6-12 14-12 22a12 12 0 0024 0c0-8-9-16-12-22z" fill="url(#drop)" opacity="0.35"/>`;
    }).join("")}
  </g>

  <!-- Big drop logo -->
  <g transform="translate(120, 200)">
    <path d="M80 0c-12 30-60 90-60 130a60 60 0 00120 0c0-40-48-100-60-130z" fill="url(#drop)"/>
    <ellipse cx="55" cy="100" rx="13" ry="22" fill="#dbeafe" opacity="0.55"/>
  </g>

  <!-- Title + tagline -->
  <g font-family="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Inter, sans-serif" fill="#e2e8f0">
    <text x="320" y="280" font-size="96" font-weight="700">CLAWD Rain</text>
    <text x="320" y="340" font-size="36" fill="#94a3b8">Pick up the umbrella or make it rain.</text>
    <text x="320" y="430" font-size="22" fill="#60a5fa">A community tipping tool — built with LeftClaw Services beta.</text>
  </g>
</svg>`;

const out = path.resolve(__dirname, "../public/thumbnail.jpg");
sharp(Buffer.from(svg))
  .jpeg({ quality: 88 })
  .toFile(out)
  .then(info => console.log("Wrote", out, info))
  .catch(err => {
    console.error("Failed to build OG:", err);
    process.exitCode = 1;
  });
