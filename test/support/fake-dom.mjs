export function createFakeDocument() {
  return { createElement: (tagName) => createFakeElement(tagName) };
}

const ownTexts = new WeakMap();

export function ownText(element) {
  return ownTexts.get(element) ?? "";
}

function createFakeElement(tagName) {
  const listeners = {};
  const element = {
    tagName: tagName.toUpperCase(),
    children: [],
    attributes: {},
    appendChild(child) {
      element.children.push(child);
      return child;
    },
    removeChild(child) {
      element.children.splice(element.children.indexOf(child), 1);
      return child;
    },
    setAttribute(name, value) {
      element.attributes[name] = String(value);
    },
    addEventListener(type, listener) {
      (listeners[type] ??= []).push(listener);
    },
    click() {
      (listeners.click ?? []).forEach((listener) => listener());
    },
  };
  Object.defineProperty(element, "textContent", {
    get() {
      return ownText(element) + element.children.map((child) => child.textContent).join("");
    },
    set(text) {
      ownTexts.set(element, text);
    },
  });
  Object.defineProperty(element, "innerHTML", {
    set() {
      throw new Error("unsafe API: innerHTML was used");
    },
  });
  return element;
}

export function allElements(root) {
  return [root, ...root.children.flatMap(allElements)];
}
