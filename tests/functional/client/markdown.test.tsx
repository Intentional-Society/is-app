import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Markdown, MarkdownInline } from "@/components/markdown";
import { markdownHasContent } from "@/lib/markdown";

describe("Markdown (full)", () => {
  it("renders the complete v1 formatting set to the expected HTML", () => {
    const src = [
      "### Heading three",
      "",
      "#### Heading four",
      "",
      "A paragraph with **bold**, *italic*, ~~struck~~ and a [link](https://example.org).",
      "",
      "First line", // single newline below → hard break
      "Second line",
      "",
      "- bullet one",
      "- bullet two",
      "",
      "1. number one",
      "2. number two",
      "",
      "> a block quote",
    ].join("\n");
    const { container } = render(<Markdown>{src}</Markdown>);
    const html = container.querySelector("div")?.innerHTML.replace(/\n/g, "");
    expect(html).toBe(
      "<h3>Heading three</h3><h4>Heading four</h4>" +
        "<p>A paragraph with <strong>bold</strong>, <em>italic</em>, <del>struck</del> and a " +
        '<a href="https://example.org">link</a>.</p>' +
        "<p>First line<br>Second line</p>" +
        "<ul><li>bullet one</li><li>bullet two</li></ul>" +
        "<ol><li>number one</li><li>number two</li></ol>" +
        "<blockquote><p>a block quote</p></blockquote>",
    );
  });

  it("renders the v1 formatting set", () => {
    const { container } = render(
      <Markdown>{"### Heading\n\n**bold** _italic_ ~~struck~~\n\n- one\n- two\n\n> quote"}</Markdown>,
    );
    expect(container.querySelector("h3")).toHaveTextContent("Heading");
    expect(container.querySelector("strong")).toHaveTextContent("bold");
    expect(container.querySelector("em")).toHaveTextContent("italic");
    // remark-gfm strikethrough → <del>.
    expect(container.querySelector("del")).toHaveTextContent("struck");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("blockquote")).toHaveTextContent("quote");
  });

  it("renders a bare single newline as a hard line break (remark-breaks)", () => {
    // MDXEditor serializes a Shift+Enter as a soft single "\n"; remark-breaks
    // makes it a visible <br> instead of CommonMark's collapse-to-space.
    const { container } = render(<Markdown>{"Line one\nLine two"}</Markdown>);
    expect(container.querySelector("br")).not.toBeNull();
    // Paragraph break stays a paragraph break.
    const { container: two } = render(<Markdown>{"Para one\n\nPara two"}</Markdown>);
    expect(two.querySelectorAll("p")).toHaveLength(2);
  });

  it("renders links with a safe href", () => {
    const { container } = render(<Markdown>{"[site](https://example.org)"}</Markdown>);
    const anchor = container.querySelector("a");
    expect(anchor).toHaveAttribute("href", "https://example.org");
  });

  it("autolinks a bare URL (remark-gfm)", () => {
    const { container } = render(<Markdown>{"Visit https://example.org today"}</Markdown>);
    const anchor = container.querySelector("a");
    expect(anchor).toHaveAttribute("href", "https://example.org");
    expect(anchor).toHaveTextContent("https://example.org");
  });

  it("never executes embedded raw HTML (no rehype-raw)", () => {
    const { container } = render(
      <Markdown>{"# Title\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>"}</Markdown>,
    );
    // The whole point of the no-raw-HTML render path: no live nodes get built.
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    // It surfaces as inert text instead.
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it("neutralizes javascript: link protocols", () => {
    const { container } = render(<Markdown>{"[x](javascript:alert(1))"}</Markdown>);
    const href = container.querySelector("a")?.getAttribute("href") ?? "";
    expect(href.startsWith("javascript:")).toBe(false);
  });
});

describe("MarkdownInline (constrained)", () => {
  it("renders the inline set (marks, link, hard break, paragraph break) to the expected HTML", () => {
    const { container } = render(
      <MarkdownInline>{"**b** _i_ ~~s~~ [l](https://x.org)\nbreak\n\npara two"}</MarkdownInline>,
    );
    const html = container.querySelector("div")?.innerHTML.replace(/\n/g, "");
    expect(html).toBe(
      '<span class="block"><strong>b</strong> <em>i</em> <del>s</del> <a href="https://x.org">l</a><br>break</span>' +
        '<span class="block">para two</span>',
    );
  });

  it("unwraps block nodes to their text but keeps inline marks", () => {
    const { container } = render(
      <MarkdownInline>
        {"### Heading\n\n- **bold** item with a [link](https://example.org) and ~~strike~~"}
      </MarkdownInline>,
    );
    // Block elements are stripped...
    expect(container.querySelector("h3")).toBeNull();
    expect(container.querySelector("ul")).toBeNull();
    expect(container.querySelector("li")).toBeNull();
    // ...inline marks survive.
    expect(container.querySelector("strong")).toHaveTextContent("bold");
    expect(container.querySelector("a")).toHaveAttribute("href", "https://example.org");
    expect(container.querySelector("del")).toHaveTextContent("strike");
    expect(container.textContent).toContain("Heading");
  });

  it("stays raw-HTML-free", () => {
    const { container } = render(<MarkdownInline>{"<img src=x onerror=alert(1)> hi"}</MarkdownInline>);
    expect(container.querySelector("img")).toBeNull();
  });

  it("keeps a soft newline as a <br> so cards preserve line breaks", () => {
    const { container } = render(<MarkdownInline>{"one\ntwo"}</MarkdownInline>);
    expect(container.querySelector("br")).not.toBeNull();
    expect(container.textContent).toContain("one");
    expect(container.textContent).toContain("two");
  });

  it("preserves paragraph breaks as separate lines (block spans)", () => {
    const { container } = render(<MarkdownInline>{"Para one\n\nPara two"}</MarkdownInline>);
    expect(container.querySelectorAll("span.block")).toHaveLength(2);
    expect(container.querySelector("p")).toBeNull();
    expect(container.textContent).toContain("Para one");
    expect(container.textContent).toContain("Para two");
  });
});

describe("markdownHasContent", () => {
  it("is true when the source renders visible text", () => {
    expect(markdownHasContent("hello")).toBe(true);
    expect(markdownHasContent("**bold**")).toBe(true);
    expect(markdownHasContent("- a list item")).toBe(true);
  });

  it("is false for whitespace or empty markup", () => {
    for (const empty of ["", "   ", "\n\n", "<br>", "**  **", "###", "> "]) {
      expect(markdownHasContent(empty)).toBe(false);
    }
  });
});
