import {
  App,
  PluginSettingTab,
  Setting,
  debounce,
  type Plugin,
} from "obsidian";
import {
  DEFAULT_COLORS,
  FONT_WEIGHTS,
  emptyAppearance,
  isValidFontFamily,
  isValidFontSize,
  isValidLength,
  type Appearance,
  type ChipColors,
  type TKSettings,
} from "./settings-model";
import { normalizeFolders } from "./tk-index";

export interface TKSettingsHost extends Plugin {
  settings: TKSettings;
  applySettings(): Promise<void>;
  applyAppearance(): void;
}

const COLOR_ROWS: { key: keyof ChipColors; name: string }[] = [
  { key: "commentFill", name: "Comment fill" },
  { key: "commentText", name: "Comment text" },
  { key: "responseFill", name: "Response fill" },
  { key: "responseText", name: "Response text" },
];

const SHIFT_HINT =
  "Text can shift slightly when the cursor enters a TK if you change this.";

export class TKSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private host: TKSettingsHost,
  ) {
    super(app, host);
  }

  private get appearance(): Appearance {
    return this.host.settings.appearance;
  }

  override display(): void {
    const { containerEl } = this;
    const scrollTop = containerEl.scrollTop;
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

    this.colorSection("dark", "Chip colors: dark theme");
    this.colorSection("light", "Chip colors: light theme");
    this.paddingSection();
    this.fontSection();

    containerEl.scrollTop = scrollTop;
  }

  private heading(name: string, reset: () => void): void {
    new Setting(this.containerEl)
      .setName(name)
      .setHeading()
      .addExtraButton((button) => {
        button
          .setIcon("reset")
          .setTooltip("Reset to defaults")
          .onClick(() => {
            reset();
            this.host.applyAppearance();
            this.display();
          });
      });
  }

  private colorSection(theme: "dark" | "light", title: string): void {
    this.heading(title, () => {
      this.appearance[theme] = emptyAppearance()[theme];
    });
    const defaults = DEFAULT_COLORS[theme];
    for (const { key, name } of COLOR_ROWS) {
      new Setting(this.containerEl).setName(name).addColorPicker((picker) => {
        picker
          .setValue(this.appearance[theme][key] || defaults[key])
          .onChange((value) => {
            const color = value.toLowerCase();
            this.appearance[theme][key] = color === defaults[key] ? "" : color;
            this.host.applyAppearance();
          });
      });
    }
  }

  private textRow(
    name: string,
    description: string,
    placeholder: string,
    read: () => string,
    write: (value: string) => void,
    isValid: (value: string) => boolean,
  ): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(description)
      .addText((text) => {
        text
          .setPlaceholder(placeholder)
          .setValue(read())
          .onChange((raw) => {
            const value = raw.trim();
            const valid = value === "" || isValid(value);
            text.inputEl.toggleClass("tk-setting-invalid", !valid);
            if (!valid) return;
            write(value);
            this.host.applyAppearance();
          });
      });
  }

  private paddingSection(): void {
    const a = this.appearance;
    this.heading("Chip padding", () => {
      a.paddingY = "";
      a.paddingX = "";
    });
    this.textRow(
      "Vertical",
      "A length such as 0.2em or 3px. This never moves text.",
      "Theme default",
      () => a.paddingY,
      (value) => (a.paddingY = value),
      isValidLength,
    );
    this.textRow(
      "Horizontal",
      `Extra side padding past the hidden brackets, such as 0.14em or 3px. ${SHIFT_HINT}`,
      "0.14em",
      () => a.paddingX,
      (value) => (a.paddingX = value),
      isValidLength,
    );
  }

  private fontSection(): void {
    const a = this.appearance;
    this.heading("Chip font", () => {
      a.fontFamily = "";
      a.fontSize = "";
      a.fontWeight = "";
    });
    this.textRow(
      "Family",
      `A font name, or several separated by commas. ${SHIFT_HINT}`,
      "Same as the text",
      () => a.fontFamily,
      (value) => (a.fontFamily = value),
      isValidFontFamily,
    );
    this.textRow(
      "Size",
      `A size such as 0.9em, 13px or 90%. ${SHIFT_HINT}`,
      "Same as the text",
      () => a.fontSize,
      (value) => (a.fontSize = value),
      isValidFontSize,
    );
    new Setting(this.containerEl)
      .setName("Weight")
      .setDesc(SHIFT_HINT)
      .addDropdown((dropdown) => {
        dropdown.addOption("", "Same as the text");
        for (const weight of FONT_WEIGHTS) dropdown.addOption(weight, weight);
        dropdown.setValue(a.fontWeight).onChange((value) => {
          a.fontWeight = value;
          this.host.applyAppearance();
        });
      });
  }
}
