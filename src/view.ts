import {
  ItemView,
  Keymap,
  MarkdownView,
  Platform,
  TFile,
  type ViewStateResult,
  type WorkspaceLeaf,
} from "obsidian";
import { displayText, findTKs, type TK } from "./parser";
import { locateTK, type FileTKs, type TKIndex } from "./tk-index";

export const TK_VIEW_TYPE = "tk-comments-panel";
export const TK_ICON = "tk-comments";

type PanelScope = "note" | "vault";

const SCOPES: { id: PanelScope; label: string }[] = [
  { id: "note", label: "This note" },
  { id: "vault", label: "Vault" },
];

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export class TKView extends ItemView {
  private panelScope: PanelScope = "note";
  private lastSignature = "";

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
    return { scope: this.panelScope };
  }

  override async setState(
    state: { scope?: PanelScope },
    result: ViewStateResult,
  ): Promise<void> {
    if (state?.scope === "note" || state?.scope === "vault") {
      this.panelScope = state.scope;
      this.refresh();
    }
    await super.setState(state, result);
  }

  override async onOpen(): Promise<void> {
    this.contentEl.addClass("tk-panel");
    this.onFirstOpen();
    this.refresh();
  }

  refresh(): void {
    const file = this.app.workspace.getActiveFile();
    const path = file?.extension === "md" ? file.path : null;
    const signature = JSON.stringify([
      this.panelScope,
      path,
      this.index.ready,
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

    const scrollTop = this.contentEl.scrollTop;
    this.contentEl.empty();
    this.renderHeader(path);
    if (this.panelScope === "note") this.renderNote(path);
    else this.renderVault();
    this.contentEl.scrollTop = scrollTop;
  }

  private renderHeader(path: string | null): void {
    const header = this.contentEl.createDiv({ cls: "tk-panel-header" });
    const tabs = header.createDiv({
      cls: "tk-scope",
      attr: { role: "group", "aria-label": "Scope" },
    });
    for (const { id, label } of SCOPES) {
      const tab = tabs.createEl("button", {
        cls: "tk-scope-tab",
        text: label,
        attr: { "aria-pressed": String(this.panelScope === id) },
      });
      tab.addEventListener("click", () => {
        this.panelScope = id;
        this.refresh();
        this.app.workspace.requestSaveLayout();
      });
    }
    header.createDiv({
      cls: "tk-count",
      text: this.countLabel(path),
      attr: { "aria-live": "polite" },
    });
  }

  private countLabel(path: string | null): string {
    if (!this.index.ready) return "";
    if (this.panelScope === "note") {
      if (!path || this.index.isExcluded(path)) return "";
      return `${this.index.get(path).length} open`;
    }
    const files = this.index.all();
    const total = files.reduce((sum, file) => sum + file.tks.length, 0);
    if (total === 0) return "";
    return `${total} open in ${plural(files.length, "note")}`;
  }

  private renderNote(path: string | null): void {
    if (!this.index.ready) return this.renderEmpty("Scanning the vault.");
    if (!path) return this.renderEmpty("Open a note to see its TKs.");
    if (this.index.isExcluded(path)) {
      return this.renderEmpty("This note is in an excluded folder.");
    }
    const tks = this.index.get(path);
    if (tks.length === 0) return this.renderEmpty("No open TKs in this note.");
    this.renderRows(this.contentEl.createDiv({ cls: "tk-rows" }), path, tks);
  }

  private renderVault(): void {
    if (!this.index.ready) return this.renderEmpty("Scanning the vault.");
    const files = this.index.all();
    if (files.length === 0) return this.renderEmpty("No open TKs in the vault.");
    for (const file of files) this.renderGroup(file);
  }

  private renderGroup({ path, tks }: FileTKs): void {
    const group = this.contentEl.createDiv({ cls: "tk-group" });
    const name = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
    const heading = group.createDiv({
      cls: "tk-group-heading",
      attr: { title: path },
    });
    heading.createSpan({ cls: "tk-group-name", text: name });
    heading.createSpan({ cls: "tk-group-count", text: String(tks.length) });
    this.renderRows(group.createDiv({ cls: "tk-rows" }), path, tks);
  }

  private renderRows(parent: HTMLElement, path: string, tks: TK[]): void {
    for (const tk of tks) {
      const text = displayText(tk.body);
      const row = parent.createDiv({
        cls: text ? "tk-row" : "tk-row is-empty",
        text: text || "Empty TK",
        attr: { role: "button", tabindex: "0" },
      });
      row.addEventListener("click", (event) => {
        void this.reveal(path, tk, Keymap.isModEvent(event));
      });
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          void this.reveal(path, tk, Keymap.isModEvent(event));
        }
      });
    }
  }

  private renderEmpty(message: string): void {
    this.contentEl.createDiv({ cls: "tk-empty", text: message });
  }

  private async reveal(
    path: string,
    target: TK,
    newTab: ReturnType<typeof Keymap.isModEvent>,
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;

    const { workspace } = this.app;
    const open = newTab
      ? undefined
      : workspace
          .getLeavesOfType("markdown")
          .find(
            (leaf) =>
              leaf.view instanceof MarkdownView && leaf.view.file?.path === path,
          );
    const leaf = open ?? workspace.getLeaf(newTab);
    if (!open) await leaf.openFile(file);
    workspace.setActiveLeaf(leaf, { focus: !Platform.isMobile });

    if (Platform.isMobile) {
      workspace.leftSplit?.collapse();
      workspace.rightSplit?.collapse();
    }

    const view = leaf.view;
    if (!(view instanceof MarkdownView)) return;

    if (view.getMode() === "preview") {
      view.previewMode.applyScroll(target.line);
      return;
    }

    const editor = view.editor;
    const current = locateTK(findTKs(editor.getValue()), target);
    if (!current) {
      const line = Math.min(target.line, editor.lastLine());
      editor.setCursor({ line, ch: 0 });
      editor.scrollIntoView(
        { from: { line, ch: 0 }, to: { line, ch: 0 } },
        true,
      );
      return;
    }
    const range = {
      from: editor.offsetToPos(current.start),
      to: editor.offsetToPos(current.end),
    };
    editor.setSelection(range.from, range.to);
    editor.scrollIntoView(range, true);
    if (!Platform.isMobile) editor.focus();
  }
}
