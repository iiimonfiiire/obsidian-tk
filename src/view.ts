import {
  ItemView,
  Keymap,
  MarkdownView,
  Notice,
  Platform,
  SearchComponent,
  TFile,
  setIcon,
  type ViewStateResult,
  type WorkspaceLeaf,
} from "obsidian";
import {
  STATUS_FILTERS,
  countsByFilter,
  emptyState,
  filterByStatus,
  filterFiles,
  headerLabel,
  isGroupCollapsed,
  isStatusFilter,
  normalizeQuery,
  noteName,
  type StatusFilter,
} from "./panel-model";
import { displayText, findTKs, type TK } from "./parser";
import {
  revealState,
  selectionRange,
  toTarget,
  type RevealTarget,
} from "./reveal";
import {
  applyEdit,
  planStatusEdit,
  refOf,
  type PlannedEdit,
  type TargetStatus,
  type TKRef,
} from "./status";
import { locateTK, type FileTKs, type TKIndex } from "./tk-index";

export const TK_VIEW_TYPE = "tk-comments-panel";
export const TK_ICON = "tk-comments";

type PanelScope = "note" | "vault";

interface PanelState {
  scope?: PanelScope;
  collapsed?: string[];
  statusFilter?: StatusFilter;
}

const SCOPES: { id: PanelScope; label: string }[] = [
  { id: "note", label: "This note" },
  { id: "vault", label: "Vault" },
];

export class TKView extends ItemView {
  private panelScope: PanelScope = "note";
  private collapsed = new Set<string>();
  private query = "";
  private statusFilter: StatusFilter = "queue";
  private lastSignature = "";

  private chromeEl: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;
  private countEl: HTMLElement | null = null;
  private toggleAllEl: HTMLElement | null = null;
  private filterEl: HTMLSelectElement | null = null;
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
    return {
      scope: this.panelScope,
      collapsed: Array.from(this.collapsed),
      statusFilter: this.statusFilter,
    };
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
    if (isStatusFilter(state?.statusFilter)) {
      this.statusFilter = state.statusFilter;
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
    if (this.chromeEl) return;
    this.chromeEl = this.contentEl.createDiv({ cls: "tk-panel-header" });

    const tabs = this.chromeEl.createDiv({
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

    new SearchComponent(this.chromeEl)
      .setPlaceholder("Filter by TK text or note name")
      .onChange((value) => {
        this.query = value;
        this.refresh();
      });

    const status = this.chromeEl.createDiv({ cls: "tk-status" });
    this.filterEl = status.createEl("select", {
      cls: "dropdown tk-filter",
      attr: { "aria-label": "Status filter" },
    });
    for (const { id, label } of STATUS_FILTERS) {
      this.filterEl.createEl("option", { value: id, text: label });
    }
    this.filterEl.addEventListener("change", () => {
      const value = this.filterEl?.value;
      if (isStatusFilter(value)) this.statusFilter = value;
      this.refresh();
      this.app.workspace.requestSaveLayout();
    });
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

  private scopeFiles(path: string | null): FileTKs[] {
    if (this.panelScope === "vault") return this.index.all();
    if (!path || this.index.isExcluded(path)) return [];
    const tks = this.index.get(path);
    return tks.length > 0 ? [{ path, tks }] : [];
  }

  private shownFiles(path: string | null): FileTKs[] {
    return filterByStatus(
      filterFiles(this.scopeFiles(path), this.query),
      this.statusFilter,
    );
  }

  private toggleAll(): void {
    const files = this.shownFiles(null);
    const anyOpen = files.some((file) => !this.collapsed.has(file.path));
    for (const file of files) {
      if (anyOpen) this.collapsed.add(file.path);
      else this.collapsed.delete(file.path);
    }
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
      this.statusFilter,
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
    this.updateFilter(path);

    const toggle = this.toggleAllEl;
    if (!toggle) return;
    const files = this.shownFiles(path);
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

  /** Relabels options in place, so an open dropdown or focus isn't disturbed. */
  private updateFilter(path: string | null): void {
    const select = this.filterEl;
    if (!select) return;
    const counts = countsByFilter(filterFiles(this.scopeFiles(path), this.query));
    Array.from(select.options).forEach((option) => {
      const entry = STATUS_FILTERS.find(({ id }) => id === option.value);
      if (!entry) return;
      const text = this.index.ready
        ? `${entry.label} (${counts[entry.id]})`
        : entry.label;
      if (option.text !== text) option.text = text;
    });
    if (select.value !== this.statusFilter) select.value = this.statusFilter;
  }

  private countLabel(path: string | null): string {
    if (!this.index.ready) return "";
    if (this.panelScope === "note" && (!path || this.index.isExcluded(path))) {
      return "";
    }
    return headerLabel(
      this.scopeFiles(path),
      this.shownFiles(path),
      this.statusFilter,
      this.query,
    );
  }

  private renderNote(list: HTMLElement, path: string | null): void {
    if (!this.index.ready) return this.renderEmpty(list, "Scanning the vault.");
    if (!path) return this.renderEmpty(list, "Open a note to see its TKs.");
    if (this.index.isExcluded(path)) {
      return this.renderEmpty(list, "This note is in an excluded folder.");
    }
    const [match] = this.shownFiles(path);
    if (!match) return this.renderFilteredEmpty(list);
    this.renderRows(list.createDiv({ cls: "tk-rows" }), path, match.tks);
  }

  private renderVault(list: HTMLElement): void {
    if (!this.index.ready) return this.renderEmpty(list, "Scanning the vault.");
    const shown = this.shownFiles(null);
    if (shown.length === 0) return this.renderFilteredEmpty(list);
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
    const all = this.index.get(path);
    for (const tk of tks) {
      const text = displayText(tk.body);
      const row = parent.createDiv({ cls: `tk-row tk-row-${tk.status}` });
      const main = row.createDiv({
        cls: "tk-row-main",
        attr: { role: "button", tabindex: "0" },
      });
      main.createSpan({
        cls: "tk-row-dot",
        attr: { "aria-label": tk.status, title: tk.status },
      });
      const body = main.createDiv({ cls: "tk-row-text" });
      body.createDiv({
        cls: text ? "tk-row-comment" : "tk-row-comment is-empty",
        text: text || "Empty TK",
      });
      if (tk.response !== null) {
        body.createDiv({
          cls: "tk-row-response",
          text: displayText(tk.response),
        });
      }
      this.onActivate(main, (event) => {
        void this.reveal(path, tk, Keymap.isModEvent(event));
      });
      this.renderActions(row, path, tk, refOf(all, tk));
    }
  }

  private renderActions(
    row: HTMLElement,
    path: string,
    tk: TK,
    ref: TKRef,
  ): void {
    const actions = row.createDiv({ cls: "tk-row-actions" });
    const closed = tk.status === "accepted" || tk.status === "rejected";
    const buttons: { label: string; icon: string; status: TargetStatus }[] =
      closed
        ? [{ label: "Reopen", icon: "rotate-ccw", status: "open" }]
        : [
            { label: "Accept", icon: "check", status: "accepted" },
            { label: "Reject", icon: "x", status: "rejected" },
          ];
    for (const { label, icon, status } of buttons) {
      const button = actions.createEl("button", {
        cls: `clickable-icon tk-row-action tk-action-${status}`,
        attr: { "aria-label": label },
      });
      setIcon(button, icon);
      button.addEventListener("click", () => {
        // Stays disabled until the row re-renders, so a double tap can't act twice.
        actions.querySelectorAll("button").forEach((b) => (b.disabled = true));
        void this.setStatus(path, ref, status);
      });
    }
  }

  private async setStatus(
    path: string,
    ref: TKRef,
    status: TargetStatus,
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    let plan: PlannedEdit = { ok: false, reason: "gone" };
    try {
      if (file instanceof TFile) {
        const editor = this.openEditor(path);
        if (editor) {
          // A transaction, so unsaved edits, the cursor and undo all survive.
          plan = planStatusEdit(editor.getValue(), ref, status);
          if (plan.ok) {
            const { from, to, insert } = plan.edit;
            editor.replaceRange(
              insert,
              editor.offsetToPos(from),
              editor.offsetToPos(to),
            );
          }
        } else {
          await this.app.vault.process(file, (text) => {
            plan = planStatusEdit(text, ref, status);
            return plan.ok ? applyEdit(text, plan.edit) : text;
          });
        }
      }
    } catch (error) {
      console.error("TK Comments: could not change status", error);
    }
    if (!plan.ok) {
      new Notice(
        plan.reason === "ambiguous"
          ? "TK not changed. Identical TKs in this note were added or removed. Try again."
          : "TK not changed. It's no longer in the note.",
      );
      this.lastSignature = "";
      this.refresh();
    }
  }

  private openEditor(path: string): MarkdownView["editor"] | null {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (
        view instanceof MarkdownView &&
        view.file?.path === path &&
        view.getMode() === "source"
      ) {
        return view.editor;
      }
    }
    return null;
  }

  private renderEmpty(list: HTMLElement, message: string): void {
    list.createDiv({ cls: "tk-empty", text: message });
  }

  private renderFilteredEmpty(list: HTMLElement): void {
    const { title, detail } = emptyState(
      this.statusFilter,
      this.panelScope,
      this.query,
    );
    const empty = list.createDiv({ cls: "tk-empty" });
    empty.createDiv({ cls: "tk-empty-title", text: title });
    if (detail) empty.createDiv({ text: detail });
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
