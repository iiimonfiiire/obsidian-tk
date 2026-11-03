// Stands in for the types-only obsidian package when tests import UI modules.

// Assigned by Obsidian's ItemView constructors, per 1.14 and 1.15. Other plugins
// reach for these: Hover Editor wraps ItemView.open and calls headerEl.createDiv.
export const INHERITED_VIEW_FIELDS = [
  "actionsEl",
  "app",
  "backButtonEl",
  "canDropAnywhere",
  "containerEl",
  "contentEl",
  "forwardButtonEl",
  "headerEl",
  "icon",
  "iconEl",
  "leaf",
  "leftSidebarToggleEl",
  "moreOptionsButtonEl",
  "navigation",
  "scope",
  "titleContainerEl",
  "titleEl",
  "titleParentEl",
] as const;

export class ItemView {
  constructor(leaf: unknown) {
    const self = this as unknown as Record<string, unknown>;
    for (const name of INHERITED_VIEW_FIELDS) self[name] = `inherited:${name}`;
    self.leaf = leaf;
  }
}

export const Keymap = {};
export class MarkdownView {}
export const Platform = {};
export class SearchComponent {}
export class TFile {}
export const setIcon = () => {};
