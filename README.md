# TK Comments

An Obsidian plugin for "TK" placeholders, the writer's mark for a gap to fill later.

Write `[TK]` or `[TK: what goes here]` anywhere in a note. The plugin shows each one as a chip and lists every open TK in a side panel. To resolve a TK, edit or delete the text. It then leaves the panel.

Works on desktop and mobile.

## Features

- **Insert TK** command. Adds `[TK: ]` with the cursor inside. With text selected, that text becomes the body and the cursor lands after the `]`. There is no default hotkey; assign one in Settings > Hotkeys.
- **Live Preview chips.** The text stays in place, with dimmed brackets. Put the cursor on a TK and it shows raw for editing, without shifting the line. Source mode gets a light highlight.
- **Reading view chips**, including TKs that contain links.
- **Side panel** with "This note" and "Vault" scopes. Vault scope groups by file. Click a row to open the note and select the TK. Open it from the ribbon or the **Open panel** command.
- **Excluded folders** setting, defaulting to `Archive`. Exclusions affect the panel only. Paths are relative to the vault root.

## Syntax

| Text | TK? |
| --- | --- |
| `[TK]`, `[TK: body]`, `[TK:body]`, `[TK: ]` | Yes |
| `[TK: see [[Some Note]] first]` | Yes, brackets are balanced |
| `[TK: link text]()` | Yes, a link with no destination yet |
| In YAML frontmatter | Yes in the panel, not decorated |
| `[TKO]`, `[TK-1]`, `[TKs: x]`, `[tk]` | No |
| `\[TK]`, `` `[TK]` ``, fenced code | No |
| `[[TK]]`, `[TK](https://example.com)` | No, these are links |
| `[TK: opened` and closed on a later line | No, TKs are single-line |

Limits of the parser:

- Code spans are matched within one line.
- Indented code blocks are not detected, since four spaces is also how list content nests.

## Theming

Override these on `body`:

| Variable | Purpose |
| --- | --- |
| `--tk-chip-rgb` | Chip base color as `r, g, b` |
| `--tk-chip-accent` | "TK:" label color |
| `--tk-chip-background` | Chip fill |
| `--tk-chip-bracket` | Bracket color |
| `--tk-chip-radius` | Corner radius |
| `--tk-source-background` | Source mode highlight |

## Development

Needs Node 24.

```sh
npm install
npm test
npm run build
npm run dev
```

`npm run build` typechecks and writes `main.js`.

To install into a vault, copy `.env.example` to `.env`, set `OBSIDIAN_PLUGIN_DIR`, and run `npm run install-plugin`. It copies `main.js`, `manifest.json` and `styles.css` as real files, so a synced vault carries them to other devices.

## Layout

| Path | Contents |
| --- | --- |
| `src/parser.ts` | TK parser, with no Obsidian imports |
| `src/insert.ts` | Text and cursor offset for the insert command |
| `src/tk-index.ts` | Per-file cache with debounced updates |
| `src/editor.ts` | CodeMirror 6 chips |
| `src/reading.ts` | Reading view chips |
| `src/view.ts` | Side panel |
| `src/settings.ts` | Settings tab |
| `src/main.ts` | Plugin wiring |

## License

MIT
