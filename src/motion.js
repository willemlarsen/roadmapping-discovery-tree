import { renderMotionToggle } from "./render.js";

export function applyMotion(root, state) {
  if (state === "off") {
    root.setAttribute("data-motion", "off");
  } else {
    root.removeAttribute("data-motion");
  }
}

export function mountMotionToggle(document, container) {
  const root = document.documentElement;
  const toggle = renderMotionToggle(document, (state) => applyMotion(root, state));
  if (toggle) {
    container.appendChild(toggle);
  } else {
    applyMotion(root, "off");
  }
}
