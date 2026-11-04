import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LocalTime } from "@/components/local-time";

const ISO = "2026-11-01T23:30:00.000Z";

describe("LocalTime", () => {
  it("server-renders in a fixed locale and UTC, whatever the runtime's own settings are", () => {
    expect(renderToString(<LocalTime iso={ISO} />)).toContain("Nov 1, 2026");
    expect(renderToString(<LocalTime iso={ISO} withTime />)).toContain("Nov 1, 2026, 11:30 PM");
  });

  it("renders a <time> element carrying the ISO value", () => {
    render(<LocalTime iso={ISO} />);
    expect(screen.getByText(/2026/).closest("time")).toHaveAttribute("datetime", ISO);
  });

  it("does not throw on an unparseable value", () => {
    expect(renderToString(<LocalTime iso="not-a-date" />)).toContain("Invalid Date");
  });
});
