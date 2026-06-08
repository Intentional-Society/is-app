import type { CSSProperties } from "react";

// A graceful, blocking "your browser is too old" notice for engines that can't
// run the app. Next 16 / React 19 emit ~2020-era syntax (optional chaining,
// nullish coalescing); older engines across the board — Safari ≤10, IE 11,
// legacy Edge, dated Android/Chrome — fail to parse the bundle, so React never
// hydrates and interactive controls silently fall back to native behavior. None
// of React runs there, so this is deliberately plain server-rendered HTML plus an
// ES5 script (public/legacy-check.js) that reveals the overlay without the
// framework.
//
// Styling targets old browsers broadly: inline values only,
// no oklch tokens / CSS variables / flex `gap`; rgba and box-shadow are fine
// (IE9+). The hide/show toggle is `display:block`/`none` (universally honored);
// flexbox only centers the card and falls back to `margin:0 auto` (horizontal) +
// top padding where it's absent or buggy (IE10, old Android). See GitHub issue
// #365.
const overlayBase: CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 2147483647,
  backgroundColor: "rgba(0, 0, 0, 0.8)",
  // Scroll the overlay itself (not the page behind) if the card is taller than a
  // short/old viewport, so the message can't get clipped out of reach.
  overflowY: "auto",
};

const centerer: CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  height: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "24px",
};

const cardStyle: CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  maxWidth: "460px",
  // `margin: 0 auto` centers horizontally even when the flex container above is
  // ignored (engines without working flexbox fall back to block layout).
  margin: "0 auto",
  backgroundColor: "#ffffff",
  color: "#1c1917",
  borderRadius: "12px",
  padding: "28px 32px",
  textAlign: "center",
  // Cross-platform system stack — not WebKit-only `-apple-system`, which leaves
  // non-Apple engines fontless. Falls through to Arial/sans-serif everywhere.
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  boxShadow: "0 10px 40px rgba(0, 0, 0, 0.35)",
};

const headingStyle: CSSProperties = {
  margin: "0 0 12px",
  fontSize: "20px",
  fontWeight: 700,
  color: "#7f1d1d",
};

const messageStyle: CSSProperties = {
  margin: 0,
  fontSize: "15px",
  lineHeight: 1.5,
};

const HEADING = "Please update your browser";
const MESSAGE =
  "The IS Web App requires a modern web browser — less than 6 years old, approximately. Please open this page in the latest Chrome, Firefox, Safari, or Edge to continue.";

function NoticeCard() {
  return (
    <div style={centerer}>
      <div style={cardStyle} role="alert">
        <p style={headingStyle}>{HEADING}</p>
        <p style={messageStyle}>{MESSAGE}</p>
      </div>
    </div>
  );
}

export function LegacyBrowserNotice() {
  return (
    <>
      <div id="legacy-browser-warning" style={{ ...overlayBase, display: "none" }}>
        <NoticeCard />
      </div>
      {/* Same notice for browsers with JavaScript disabled, where the app also can't run. */}
      <noscript>
        <div style={{ ...overlayBase, display: "block" }}>
          <NoticeCard />
        </div>
      </noscript>
      <script defer src="/legacy-check.js" />
    </>
  );
}
