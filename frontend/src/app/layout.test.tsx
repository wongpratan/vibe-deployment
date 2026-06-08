import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import RootLayout, { metadata } from "./layout";

function getBody(tree: ReactElement): ReactElement {
  const html = tree as ReactElement<{ children: ReactElement }>;
  return html.props.children;
}

describe("RootLayout", () => {
  it("renders children inside the body", () => {
    const tree = RootLayout({ children: <span data-testid="child">hi</span> });
    const body = getBody(tree);
    expect(body.props.children).toEqual(
      <span data-testid="child">hi</span>,
    );
  });

  it('sets lang="en" on the html element', () => {
    const tree = RootLayout({ children: null });
    expect((tree.props as { lang: string }).lang).toBe("en");
  });

  it('exports metadata.title = "Vibe Deployment"', () => {
    expect(metadata.title).toBe("Vibe Deployment");
  });
});
