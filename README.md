# WorkspaceHue

> Color your VS Code workspace by folder — **editor and terminal themed independently.**

---

## How It Works

WorkspaceHue tracks two things separately:

| What you focus | What changes color |
|---|---|
| A **file** in Folder A | Title bar · Activity bar · Status bar |
| A **terminal** in Folder A | Terminal panel background |

They are **fully independent** — you can have a blue title bar (Frontend file open) and a green terminal (Backend terminal active) at the same time.

---

## Getting Started

### 1. Open a multi-root workspace
`File → Add Folder to Workspace` for each project, then `File → Save Workspace As...`

### 2. Colors are auto-assigned on first launch
WorkspaceHue automatically assigns a distinct color to each folder when you first open the workspace. A notification will appear confirming this.

### 3. Switch folders
Click the **folder name in the status bar** (bottom left) to open the folder switcher:

```
● Frontend ⌄   ⎇ feature/navbar   App.tsx
```

Or use keyboard shortcuts:
- `Ctrl+Alt+1` — Switch to Folder 1
- `Ctrl+Alt+2` — Switch to Folder 2
- `Ctrl+Alt+3` — Switch to Folder 3

### 4. Change a folder's color
1. Open any file inside the folder you want to recolor
2. Run `WorkspaceHue: Assign Color to Current Folder` from the Command Palette (`Ctrl+Shift+P`)
3. Pick from 9 presets or enter a custom hex value (e.g. `#ff5733`)

---

## Folder Switcher

Click the folder pill in the status bar to open the switcher. It shows:

- `●` active folder (current file's folder)
- The assigned hex color for each folder
- Whether a folder has the active editor or active terminal
- Keyboard shortcut hint for each folder
- Quick access to color assignment and help

---

## Commands

| Command | Description |
|---|---|
| `WorkspaceHue: Switch Folder` | Open the folder switcher |
| `WorkspaceHue: Assign Color to Current Folder` | Pick a color for the active folder |
| `WorkspaceHue: Reset All Folder Colors` | Remove all color assignments |
| `WorkspaceHue: Show Current Folder Colors` | List all assigned colors |
| `WorkspaceHue: Assign Shortcut to Folder` | Map a keyboard slot to a folder |
| `WorkspaceHue: Show All Shortcuts` | View keyboard shortcut assignments |
| `WorkspaceHue: Show Help` | Show usage guide |

---

## Keyboard Shortcuts

| Windows / Linux | Mac | Action |
|---|---|---|
| `Ctrl+Alt+1` | `Cmd+Alt+1` | Switch to Folder 1 |
| `Ctrl+Alt+2` | `Cmd+Alt+2` | Switch to Folder 2 |
| `Ctrl+Alt+3` | `Cmd+Alt+3` | Switch to Folder 3 |
| `Ctrl+Alt+4` | `Cmd+Alt+4` | Switch to Folder 4 |
| `Ctrl+Alt+5` | `Cmd+Alt+5` | Switch to Folder 5 |

To reassign shortcuts: `Ctrl+Shift+P` → `WorkspaceHue: Assign Shortcut to Folder`

---

## Settings

| Setting | Default | Description |
|---|---|---|
| `workspaceHue.folderColors` | `{}` | Map of folder names to hex color values |
| `workspaceHue.affectTitleBar` | `true` | Color the title bar |
| `workspaceHue.affectActivityBar` | `true` | Color the activity bar |
| `workspaceHue.affectStatusBar` | `true` | Color the status bar |
| `workspaceHue.affectTerminal` | `true` | Color the terminal panel |

---

## Tips

- **Terminal colors** only change when you click a different terminal tab — not when you open files
- **Editor colors** only change when you open a file in a different folder — not when you switch terminals  
- If you have 5+ folders, the status bar shows only the active folder to avoid crowding — click it to see all folders
- Colors are saved per-workspace in `.code-workspace` settings

---

*Published by devnull · WorkspaceHue v1.0.0*
