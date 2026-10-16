import { createRoot } from "react-dom/client";
import flowStyles from "@xyflow/react/dist/style.css?inline";
import panelStyles from "./panel.css?inline";
import { LatticeApp } from "./App";

export function mountLattice(getHref?: () => string) {
  if (document.getElementById("lattice-chatgpt-extension")) return;
  const host = document.createElement("div");
  host.id = "lattice-chatgpt-extension";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = flowStyles + panelStyles;
  const container = document.createElement("div");
  shadow.append(style, container);
  document.body.append(host);
  const root = createRoot(container);
  root.render(<LatticeApp getHref={getHref} />);
  return () => { root.unmount(); host.remove(); CSS.highlights?.delete("lattice-excerpt"); };
}
