const create = <K extends keyof HTMLElementTagNameMap>(tag: K) => document.createElement(tag);

Object.assign(globalThis, {
  createEl: create,
  createSpan: () => create("span"),
});

if (typeof window === "undefined") Object.assign(globalThis, { window: globalThis });
