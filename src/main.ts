import {
  MarkdownView,
  Plugin,
  TFile,
  TFolder,
  addIcon,
  editorLivePreviewField,
  type Editor,
  type MarkdownFileInfo,
  type TAbstractFile,
  type WorkspaceLeaf,
} from "obsidian";
import { tkEditorExtension } from "./editor";
import { buildInsertion } from "./insert";
import { tkVisibility } from "./parser";
import { decorateTKs } from "./reading";
import {
  DEFAULT_SETTINGS,
  TKSettingTab,
  type TKSettings,
  type TKSettingsHost,
} from "./settings";
import { TKIndex } from "./tk-index";
import { TK_ICON, TK_VIEW_TYPE, TKView } from "./view";

const ICON_SVG =
  '<path fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" d="M32 14H18v72h14M68 14h14v72H68M36 50h28"/>';

function isMarkdown(file: TAbstractFile): file is TFile {
  return file instanceof TFile && file.extension === "md";
}

export default class TKCommentsPlugin extends Plugin implements TKSettingsHost {
  override settings: TKSettings = { ...DEFAULT_SETTINGS };
  private index!: TKIndex;
  private indexRequested = false;

  override async onload(): Promise<void> {
    await this.loadSettings();

    this.index = new TKIndex(
      {
        list: () =>
          this.app.vault
            .getMarkdownFiles()
            .map((file) => ({ path: file.path, mtime: file.stat.mtime })),
        read: (path) => {
          const file = this.app.vault.getAbstractFileByPath(path);
          if (!(file instanceof TFile)) {
            return Promise.reject(new Error("Not a file"));
          }
          return this.app.vault.cachedRead(file);
        },
        mtime: (path) => {
          const file = this.app.vault.getAbstractFileByPath(path);
          return file instanceof TFile ? file.stat.mtime : null;
        },
      },
      this.settings.excludedFolders,
      () => this.refreshViews(),
    );
    this.register(() => this.index.destroy());

    addIcon(TK_ICON, ICON_SVG);

    this.registerView(
      TK_VIEW_TYPE,
      (leaf) => new TKView(leaf, this.index, () => this.requestIndex()),
    );

    this.addRibbonIcon(TK_ICON, "Open TK comments", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-panel",
      name: "Open panel",
      callback: () => void this.activateView(),
    });

    this.addCommand({
      id: "insert-tk",
      name: "Insert TK",
      editorCallback: (editor) => this.insertTK(editor),
    });

    this.addSettingTab(new TKSettingTab(this.app, this));

    this.registerEditorExtension(
      tkEditorExtension(
        (state) => state.field(editorLivePreviewField, false) ?? false,
      ),
    );

    this.registerMarkdownPostProcessor((element, context) => {
      if (!element.textContent?.includes("TK")) return;
      const section = context.getSectionInfo(element);
      let visibility: boolean[] | undefined;
      let splitResponses = true;
      if (section) {
        const source = section.text
          .split("\n")
          .slice(section.lineStart, section.lineEnd + 1)
          .join("\n");
        if (source.includes("\\[TK")) visibility = tkVisibility(source);
        if (source.includes("\\>")) splitResponses = false;
      }
      decorateTKs(element, { visibility, splitResponses });
    });

    this.app.workspace.onLayoutReady(() => this.registerLiveUpdates());
  }

  async applySettings(): Promise<void> {
    await this.saveData(this.settings);
    this.index.setExcluded(this.settings.excludedFolders);
  }

  private async loadSettings(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
  }

  private requestIndex(): void {
    if (this.indexRequested) return;
    this.indexRequested = true;
    this.app.workspace.onLayoutReady(() => void this.index.sync());
  }

  private registerLiveUpdates(): void {
    const { vault, workspace } = this.app;

    this.registerEvent(
      vault.on("create", (file) => {
        if (isMarkdown(file)) this.index.schedule(file.path);
      }),
    );
    this.registerEvent(
      vault.on("modify", (file) => {
        if (isMarkdown(file)) this.index.schedule(file.path);
      }),
    );
    this.registerEvent(
      vault.on("delete", (file) => {
        if (isMarkdown(file)) this.index.remove(file.path);
        else if (file instanceof TFolder && this.indexRequested) {
          void this.index.sync();
        }
      }),
    );
    this.registerEvent(
      vault.on("rename", (file, oldPath) => {
        if (isMarkdown(file)) this.index.rename(oldPath, file.path);
        else if (file instanceof TFolder && this.indexRequested) {
          void this.index.sync();
        }
      }),
    );
    this.registerEvent(
      workspace.on(
        "editor-change",
        (editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
          const file = info.file;
          if (file) this.index.schedule(file.path, () => editor.getValue());
        },
      ),
    );
    this.registerEvent(
      workspace.on("active-leaf-change", () => this.refreshViews()),
    );
    this.registerEvent(workspace.on("file-open", () => this.refreshViews()));
  }

  private refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(TK_VIEW_TYPE)) {
      if (leaf.view instanceof TKView) leaf.view.refresh();
    }
  }

  private insertTK(editor: Editor): void {
    const from = editor.getCursor("from");
    const to = editor.getCursor("to");
    const { text, cursor } = buildInsertion(editor.getSelection());
    editor.replaceRange(text, from, to);
    editor.setCursor(editor.offsetToPos(editor.posToOffset(from) + cursor));
  }

  private async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null =
      workspace.getLeavesOfType(TK_VIEW_TYPE)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) return;
      await leaf.setViewState({ type: TK_VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
  }
}
