import {
  ItemView,
  Keymap,
  MarkdownView,
  Platform,
  SearchComponent,
  TFile,
  setIcon,
  type ViewStateResult,
  type WorkspaceLeaf,
} from "obsidian";
import {
  countTKs,
  filterFiles,
  isGroupCollapsed,
  normalizeQuery,
  noteCountLabel,
  noteName,
  vaultCountLabel,
} from "./panel-model";
import { displayText, findTKs, type TK } from "./parser";
import {
  revealState,
  selectionRange,
  toTarget,
  type RevealTarget,
} from "./reveal";
import { locateTK, type FileTKs, type TKIndex } from "./tk-index";

export const TK_VIEW_TYPE = "tk-comments-panel";
export const TK_ICON = "tk-comments";

type PanelScope = "note" | "vault";

interface PanelState {
  scope?: PanelScope;
  collapsed?: string[];
}

const SCOPES: { id: PanelScope; label: string }[] = [
  { id: "note", label: "This note" },
  { id: "vault", label: "Vault" },
];

export class TKView extends ItemView {
  private panelScope: PanelScope = "note";
  private collapsed = new Set<string>();
  private query = "";
  private lastSignature = "";

  private headerEl: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;
  private countEl: HTMLElement | null = null;
  private toggleAllEl: HTMLElement | null = null;
  private tabs = new Map<PanelScope, HTMLElement>();

  constructor(
    leaf: WorkspaceLeaf,
    private index: TKIndex,
    private onFirstOpen: () => void,
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return TK_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return "TK comments";
  }

  override getIcon(): string {
    return TK_ICON;
  }

  override getState(): Record<string, unknown> {
    return { scope: this.panelScope, collapsed: Array.from(this.collapsed) };
  }

  override async setState(
    state: PanelState,
    result: ViewStateResult,
  ): Promise<void> {
    if (state?.scope === "note" || state?.scope === "vault") {
      this.panelScope = state.scope;
    }
    if (Array.isArray(state?.collapsed)) {
      this.collapsed = new Set(state.collapsed);
    }
    this.refresh();
    await super.setState(state, result);
  }

  override async onOpen(): Promise<void> {
    this.contentEl.addClass("tk-panel");
    this.buildChrome();
    this.onFirstOpen();
    this.refresh();
  }

  /**
   * The header is built once and only the list re-renders, so a vault event
   * arriving mid-search can't take focus or the cursor from the input.
   */
  private buildChrome(): void {
    if (this.headerEl) return;
    this.headerEl = this.contentEl.createDiv({ cls: "tk-panel-header" });

    const tabs = this.headerEl.createDiv({
      cls: "tk-scope",
      attr: { role: "group", "aria-label": "Scope" },
    });
    for (const { id, label } of SCOPES) {
      const tab = tabs.createEl("button", { cls: "tk-scope-tab", text: label });
      tab.addEventListener("click", () => {
        this.panelScope = id;
        this.refresh();
        this.app.workspace.requestSaveLayout();
      });
      this.tabs.set(id, tab);
    }

    new SearchComponent(this.headerEl)
      .setPlaceholder("Filter by TK text or note name")
      .onChange((value) => {
        this.query = value;
        this.refresh();
      });

    const status = this.headerEl.createDiv({ cls: "tk-status" });
    this.countEl = status.createDiv({
      cls: "tk-count",
      attr: { "aria-live": "polite" },
    });
    this.toggleAllEl = status.createDiv({
      cls: "clickable-icon tk-toggle-all",
      attr: { role: "button", tabindex: "0" },
    });
    this.onActivate(this.toggleAllEl, () => this.toggleAll());

    this.listEl = this.contentEl.createDiv({ cls: "tk-list" });
  }

  private onActivate(
    el: HTMLElement,
    action: (event: MouseEvent | KeyboardEvent) => void,
  ): void {
    el.addEventListener("click", action);
    el.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        action(event);
      }
    });
  }

  private toggleAll(): void {
    const files = this.index.all();
    const anyOpen = files.some((file) => !this.collapsed.has(file.path));
    this.collapsed = anyOpen
      ? new Set(files.map((file) => file.path))
      : new Set();
    this.refresh();
    this.app.workspace.requestSaveLayout();
  }

  refresh(): void {
    if (!this.listEl) return;
    const file = this.app.workspace.getActiveFile();
    const path = file?.extension === "md" ? file.path : null;

    this.updateHeader(path);

    const signature = JSON.stringify([
      this.panelScope,
      path,
      this.index.ready,
      normalizeQuery(this.query),
      this.panelScope === "vault" ? Array.from(this.collapsed).sort() : null,
      path ? this.index.isExcluded(path) : false,
      this.panelScope === "note"
        ? path && this.index.get(path).map((tk) => [tk.raw, tk.start])
        : this.index.all().map(({ path: p, tks }) => [
            p,
            tks.map((tk) => [tk.raw, tk.start]),
          ]),
    ]);
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;

    const list = this.listEl;
    const focusedGroup = (list.ownerDocument.activeElement as HTMLElement | null)
      ?.dataset?.tkGroup;
    const scrollTop = this.contentEl.scrollTop;
    list.empty();
    if (this.panelScope === "note") this.renderNote(list, path);
    else this.renderVault(list);
    this.contentEl.scrollTop = scrollTop;
    if (focusedGroup) {
      Array.from(list.querySelectorAll<HTMLElement>("[data-tk-group]"))
        .find((el) => el.dataset.tkGroup === focusedGroup)
        ?.focus();
    }
  }

  private updateHeader(path: string | null): void {
    this.tabs.forEach((tab, id) => {
      tab.setAttribute("aria-pressed", String(this.panelScope === id));
    });
    this.countEl?.setText(this.countLabel(path));

    const toggle = this.toggleAllEl;
    if (!toggle) return;
    const files = this.index.all();
    const searching = normalizeQuery(this.query) !== "";
    const available =
      this.index.ready &&
      this.panelScope === "vault" &&
      !searching &&
      files.length > 0;
    toggle.toggleClass("tk-hidden", !available);
    const anyOpen = files.some((file) => !this.collapsed.has(file.path));
    const icon = anyOpen ? "chevrons-down-up" : "chevrons-up-down";
    if (toggle.dataset.icon !== icon) {
      toggle.dataset.icon = icon;
      setIcon(toggle, icon);
    }
    toggle.setAttribute("aria-label", anyOpen ? "Collapse all" : "Expand all");
  }

  private countLabel(path: string | null): string {
    if (!this.index.ready) return "";
    if (this.panelScope === "note") {
      if (!path || this.index.isExcluded(path)) return "";
      const tks = this.index.get(path);
      const shown = countTKs(
        filterFiles([{ path, tks }], this.query),
      );
      return noteCountLabel(tks.length, shown, this.query);
    }
    const all = this.index.all();
    return vaultCountLabel(all, filterFiles(all, this.query), this.query);
  }

  private renderNote(list: HTMLElement, path: string | null): void {
    if (!this.index.ready) return this.renderEmpty(list, "Scanning the vault.");
    if (!path) return this.renderEmpty(list, "Open a note to see its TKs.");
    if (this.index.isExcluded(path)) {
      return this.renderEmpty(list, "This note is in an excluded folder.");
    }
    const tks = this.index.get(path);
    if (tks.length === 0) {
      return this.renderEmpty(list, "No open TKs in this note.");
    }
    const [match] = filterFiles([{ path, tks }], this.query);
    if (!match) return this.renderNoResults(list);
    this.renderRows(list.createDiv({ cls: "tk-rows" }), path, match.tks);
  }

  private renderVault(list: HTMLElement): void {
    if (!this.index.ready) return this.renderEmpty(list, "Scanning the vault.");
    const files = this.index.all();
    if (files.length === 0) {
      return this.renderEmpty(list, "No open TKs in the vault.");
    }
    const shown = filterFiles(files, this.query);
    if (shown.length === 0) return this.renderNoResults(list);
    for (const file of shown) this.renderGroup(list, file);
  }

  private renderGroup(list: HTMLElement, { path, tks }: FileTKs): void {
    const collapsed = isGroupCollapsed(path, this.collapsed, this.query);
    const group = list.createDiv({
      cls: collapsed ? "tree-item tk-group is-collapsed" : "tree-item tk-group",
    });
    const heading = group.createDiv({
      cls: "tree-item-self is-clickable tk-group-heading",
      attr: {
        role: "button",
        tabindex: "0",
        title: path,
        "aria-expanded": String(!collapsed),
        "data-tk-group": path,
      },
    });
    const chevron = heading.createDiv({
      cls: collapsed
        ? "tree-item-icon collapse-icon is-collapsed"
        : "tree-item-icon collapse-icon",
    });
    setIcon(chevron, "right-triangle");
    heading.createDiv({ cls: "tree-item-inner", text: noteName(path) });
    heading
      .createDiv({ cls: "tree-item-flair-outer" })
      .createSpan({ cls: "tree-item-flair", text: String(tks.length) });
    this.onActivate(heading, () => this.toggleGroup(path));

    if (!collapsed) {
      this.renderRows(
        group.createDiv({ cls: "tree-item-children tk-rows" }),
        path,
        tks,
      );
    }
  }

  private toggleGroup(path: string): void {
    if (normalizeQuery(this.query) !== "") return;
    if (!this.collapsed.delete(path)) this.collapsed.add(path);
    this.refresh();
    this.app.workspace.requestSaveLayout();
  }

  private renderRows(parent: HTMLElement, path: string, tks: TK[]): void {
    for (const tk of tks) {
      const text = displayText(tk.body);
      const row = parent.createDiv({
        cls: "tk-row",
        attr: { role: "button", tabindex: "0" },
      });
      row.createDiv({
        cls: text ? "tk-row-comment" : "tk-row-comment is-empty",
        text: text || "Empty TK",
      });
      if (tk.response !== null) {
        row.createDiv({
          cls: "tk-row-response",
          text: displayText(tk.response),
        });
      }
      this.onActivate(row, (event) => {
        void this.reveal(path, tk, Keymap.isModEvent(event));
      });
    }
  }

  private renderEmpty(list: HTMLElement, message: string): void {
    list.createDiv({ cls: "tk-empty", text: message });
  }

  private renderNoResults(list: HTMLElement): void {
    this.renderEmpty(list, `No TKs match "${this.query.trim()}".`);
  }

  private findOpenLeaf(path: string): WorkspaceLeaf | undefined {
    return this.app.workspace.getLeavesOfType("markdown").find((leaf) => {
      if (leaf.view instanceof MarkdownView) return leaf.view.file?.path === path;
      return leaf.getViewState().state?.file === path;
    });
  }

  private async reveal(
    path: string,
    tk: TK,
    newTab: ReturnType<typeof Keymap.isModEvent>,
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;

    const { workspace } = this.app;
    const existing = newTab ? undefined : this.findOpenLeaf(path);
    const leaf = existing ?? workspace.getLeaf(newTab);
    await leaf.loadIfDeferred?.();

    const focus = !Platform.isMobile;
    // Selecting the tab first: a hidden view can't lay out, so it can't scroll.
    workspace.setActiveLeaf(leaf, { focus });
    if (Platform.isMobile) {
      workspace.leftSplit?.collapse();
      workspace.rightSplit?.collapse();
    }

    const target = this.currentTarget(leaf, path, tk);
    await leaf.openFile(file, {
      active: false,
      eState: revealState(target, focus),
    });

    const view = leaf.view;
    if (view instanceof MarkdownView && view.getMode() === "source") {
      const { from, to } = selectionRange(target);
      view.editor.setSelection(from, to);
    }
  }

  /** An open editor may hold unsaved edits that have moved the TK. */
  private currentTarget(
    leaf: WorkspaceLeaf,
    path: string,
    tk: TK,
  ): RevealTarget {
    const view = leaf.view;
    if (
      view instanceof MarkdownView &&
      view.file?.path === path &&
      view.getMode() === "source"
    ) {
      const current = locateTK(findTKs(view.editor.getValue()), tk);
      if (current) return toTarget(current);
    }
    return toTarget(tk);
  }
}
