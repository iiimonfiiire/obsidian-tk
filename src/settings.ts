import { App, PluginSettingTab, Setting, debounce, type Plugin } from "obsidian";
import { normalizeFolders } from "./tk-index";

export interface TKSettings {
  excludedFolders: string[];
}

export const DEFAULT_SETTINGS: TKSettings = {
  excludedFolders: ["Archive"],
};

export interface TKSettingsHost extends Plugin {
  settings: TKSettings;
  applySettings(): Promise<void>;
}

export class TKSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private host: TKSettingsHost,
  ) {
    super(app, host);
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const save = debounce(
      (value: string) => {
        this.host.settings.excludedFolders = normalizeFolders(value.split("\n"));
        void this.host.applySettings();
      },
      500,
      true,
    );

    new Setting(containerEl)
      .setName("Excluded folders")
      .setDesc(
        "One folder per line, relative to the vault root. TKs in these folders stay out of the panel. Chips still render there.",
      )
      .addTextArea((area) => {
        area
          .setPlaceholder("Archive")
          .setValue(this.host.settings.excludedFolders.join("\n"))
          .onChange(save);
        area.inputEl.rows = 5;
      });
  }
}
