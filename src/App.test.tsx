import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders the local exploration workspace", () => {
    render(<App />);
    expect(screen.getByText("Lattice")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Workspace actions" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Message" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Card tree" })).toBeInTheDocument();
  });
});
