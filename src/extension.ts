import * as vscode from 'vscode';

// ── Constants ─────────────────────────────────────────────────────
const DEFAULT_COLORS = ['#c0392b','#2980b9','#27ae60','#8e44ad','#d35400','#16a085','#f39c12','#2c3e50'];
const KEYBINDINGS: Record<number,string> = {1:'Ctrl+Alt+1',2:'Ctrl+Alt+2',3:'Ctrl+Alt+3',4:'Ctrl+Alt+4',5:'Ctrl+Alt+5'};
const TERM_KEYS = [
  'terminal.background','terminal.foreground','terminalCursor.background',
  'terminalCursor.foreground','terminal.border','terminal.tab.activeBorder',
  'terminal.tab.activeBorderTop','terminalCommandDecoration.defaultBackground',
];
const W = vscode.ConfigurationTarget.Workspace;

// ── State ─────────────────────────────────────────────────────────
const colorCache: Record<string,string>               = {};
const terminalFolderMap: Map<vscode.Terminal, string> = new Map();
let statusBarItem:  vscode.StatusBarItem;
let folderStatusItem: vscode.StatusBarItem | undefined;
let currentEditorFolder:   string | undefined;
let currentTerminalFolder: string | undefined;

// ── Helpers ───────────────────────────────────────────────────────
const cfg   = (id: string) => vscode.workspace.getConfiguration(id);
const whCfg = () => cfg('workspaceHue');
const wbCfg = () => cfg('workbench');
const folders = (): readonly vscode.WorkspaceFolder[] => vscode.workspace.workspaceFolders || [];
const getColor = (name: string | undefined): string | undefined =>
  name ? (colorCache[name] || whCfg().get<Record<string,string>>('folderColors', {})[name]) : undefined;

const darken = (hex: string, pct: number): string => {
  const n = parseInt(hex.replace('#',''), 16);
  const ch = (c: number) => Math.max(0, c - Math.round(2.55 * pct));
  return '#' + ((1<<24) + (ch(n>>16)<<16) + (ch((n>>8)&0xff)<<8) + ch(n&0xff)).toString(16).slice(1);
};

const contrast = (hex: string): string => {
  const n = parseInt(hex.replace('#',''), 16);
  return (0.299*(n>>16) + 0.587*((n>>8)&0xff) + 0.114*(n&0xff)) / 255 > 0.5 ? '#000000' : '#ffffff';
};

// ── Color writing ─────────────────────────────────────────────────
function writeAllColors(ec: string, tc: string): void {
  const ed = darken(ec, 20), et = contrast(ec);
  const tb = darken(tc, 15), tt = contrast(tb), tbr = darken(tc, 5);
  wbCfg().update('colorCustomizations', {
    'titleBar.activeBackground': ec,  'titleBar.activeForeground': et,  'titleBar.inactiveBackground': ed,
    'activityBar.background': ec,     'activityBar.foreground': et,     'activityBar.inactiveForeground': et+'99',
    'statusBar.background': ed,       'statusBar.foreground': et,
    'terminal.background': tb,        'terminal.foreground': tt,
    'terminalCursor.background': tb,  'terminalCursor.foreground': tc,
    'terminal.border': tbr,           'terminal.tab.activeBorder': tc,
    'terminal.tab.activeBorderTop': tc, 'terminalCommandDecoration.defaultBackground': tc,
  }, W);
}

function clearTerminalColor(): void {
  const cc = Object.assign({}, wbCfg().get<Record<string,string>>('colorCustomizations', {}));
  TERM_KEYS.forEach(k => delete cc[k]);
  wbCfg().update('colorCustomizations', cc, W);
}

// ── Apply colors ──────────────────────────────────────────────────
const applyEditorColor = (name: string): void => {
  const ec = getColor(name); if (!ec) return;
  writeAllColors(ec, getColor(currentTerminalFolder) || ec);
};

const applyTerminalColor = (name: string): void => {
  const tc = getColor(name); if (!tc) return;
  writeAllColors(getColor(currentEditorFolder) || tc, tc);
};

// ── Status bar ────────────────────────────────────────────────────
const sbText = (name: string) =>
  (getColor(name) ? '$(circle-filled)' : '$(folder)') + ' ' + name + ' $(chevron-down)';

function buildStatusBar(context: vscode.ExtensionContext): void {
  if (folderStatusItem) folderStatusItem.dispose();
  const f = folders();
  folderStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  folderStatusItem.text    = sbText(currentEditorFolder || (f[0] && f[0].name) || '');
  folderStatusItem.tooltip = 'WorkspaceHue: Click to switch folder';
  folderStatusItem.command = 'workspaceHue.showFolderPicker';
  folderStatusItem.show();
  context.subscriptions.push(folderStatusItem);
}

function updateStatusBar(name: string): void {
  statusBarItem.text = (getColor(name) ? '●' : '○') + ' ' + name;
  statusBarItem.show();
  if (folderStatusItem) folderStatusItem.text = sbText(name);
}

// ── Event handlers ────────────────────────────────────────────────
function handleEditorChange(editor: vscode.TextEditor, context: vscode.ExtensionContext): void {
  const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  if (!folder) return;
  if (editor.document.uri.scheme === 'file') {
    const lf = context.workspaceState.get<Record<string,string>>('lastFile', {});
    lf[folder.name] = editor.document.uri.fsPath;
    context.workspaceState.update('lastFile', lf);
  }
  if (folder.name === currentEditorFolder) return;
  currentEditorFolder = folder.name;
  applyEditorColor(folder.name);
  updateStatusBar(folder.name);
}

function detectFolder(terminal: vscode.Terminal): vscode.WorkspaceFolder | undefined {
  const fs = folders(); if (!fs.length) return undefined;
  const byLength = <T>(arr: T[], key: (x: T) => number) => [...arr].sort((a,b) => key(b) - key(a));

  // 1. CWD — longest matching path wins
  const cwd = (terminal.creationOptions as vscode.TerminalOptions).cwd;
  if (cwd) {
    const s = (typeof cwd === 'string' ? cwd : cwd.fsPath).replace(/\/+$/, '');
    const match = byLength([...fs], f => f.uri.fsPath.length)
      .find(f => s === f.uri.fsPath || s.startsWith(f.uri.fsPath+'/') || s.startsWith(f.uri.fsPath+'\\'));
    if (match) return match;
  }

  // 2. Exact terminal name match
  const tn = terminal.name.toLowerCase();
  const exact = fs.find(f => tn === f.name.toLowerCase());
  if (exact) return exact;

  // 3. Word-boundary match — longer names first to avoid "Project" matching "ProjectA"
  const wb = /[\s\-_\/\\]/;
  return byLength([...fs], f => f.name.length).find(f => {
    const fn = f.name.toLowerCase(), i = tn.indexOf(fn);
    if (i === -1) return false;
    return (i === 0 || wb.test(tn[i-1])) && (i+fn.length >= tn.length || wb.test(tn[i+fn.length]));
  });
}

function handleTerminalChange(terminal: vscode.Terminal): void {
  let name = terminalFolderMap.get(terminal);
  if (!name) {
    const f = detectFolder(terminal);
    if (f) { name = f.name; terminalFolderMap.set(terminal, name); }
  }
  if (!name) { currentTerminalFolder = undefined; clearTerminalColor(); return; }
  if (name === currentTerminalFolder) return;
  currentTerminalFolder = name;
  applyTerminalColor(name);
  updateStatusBar(currentEditorFolder || name);
}

// ── Commands ──────────────────────────────────────────────────────
function saveColor(folderName: string, color: string, context: vscode.ExtensionContext): void {
  colorCache[folderName] = color;
  const fc = whCfg().get<Record<string,string>>('folderColors', {});
  fc[folderName] = color;
  whCfg().update('folderColors', fc, W);
  writeAllColors(getColor(currentEditorFolder) || color, getColor(currentTerminalFolder) || color);
  updateStatusBar(folderName);
  buildStatusBar(context);
  vscode.window.showInformationMessage('Color assigned to "' + folderName + '"!');
}

function assignColor(context: vscode.ExtensionContext): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { vscode.window.showWarningMessage('No active file open.'); return; }
  const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  if (!folder) { vscode.window.showWarningMessage('File is not inside a workspace folder.'); return; }
  const presets = [
    {label:'Red',color:'#c0392b'},{label:'Blue',color:'#2980b9'},{label:'Green',color:'#27ae60'},
    {label:'Purple',color:'#8e44ad'},{label:'Orange',color:'#d35400'},{label:'Teal',color:'#16a085'},
    {label:'Yellow',color:'#f39c12'},{label:'Dark Blue',color:'#2c3e50'},{label:'Pink',color:'#e91e8c'},
    {label:'Custom hex...', color:'custom'},
  ];
  vscode.window.showQuickPick(presets, {placeHolder:'Color for "'+folder.name+'"'}).then(sel => {
    if (!sel) return;
    if (sel.color === 'custom') {
      vscode.window.showInputBox({
        prompt: 'Hex color (e.g. #ff5733)',
        validateInput: v => /^#[0-9A-Fa-f]{6}$/.test(v) ? null : 'Invalid hex',
      }).then(v => { if (v) saveColor(folder.name, v, context); });
    } else {
      saveColor(folder.name, sel.color, context);
    }
  });
}

function showFolderPicker(context: vscode.ExtensionContext): void {
  const fs = folders();
  if (!fs.length) { vscode.window.showWarningMessage('No workspace folders found.'); return; }
  const slotMap = context.workspaceState.get<Record<number,string>>('slotMap', {});
  const items = fs.map((f, i) => {
    const slot      = Object.keys(slotMap).find(k => slotMap[+k] === f.name) || String(i+1);
    const color     = getColor(f.name);
    const active    = f.name === currentEditorFolder;
    const activeTerm = f.name === currentTerminalFolder;
    const badges    = [active && '$(file-code) editor', activeTerm && '$(terminal) terminal'].filter(Boolean).join('  ');
    return {
      label:       (active ? '$(circle-filled) ' : '$(circle-outline) ') + f.name,
      description: color ? color + (badges ? '   '+badges : '') : '(no color assigned)',
      detail:      '$(key-mod) Ctrl+Alt+'+slot+'   $(paintcan) Click to switch',
      folderName:  f.name,
    };
  });
  vscode.window.showQuickPick([
    ...items,
    { label: '', kind: vscode.QuickPickItemKind.Separator, folderName: '' },
    { label:'$(paintcan) Assign color to current folder', description:'Color picker for the active folder', folderName:'__assignColor__' },
    { label:'$(question) How to use WorkspaceHue',        description:'',                                   folderName:'__help__' },
  ], {
    placeHolder: 'WorkspaceHue — '+fs.length+' folders  •  editor: '+(currentEditorFolder||'none')+'  •  terminal: '+(currentTerminalFolder||'none'),
    matchOnDescription: true,
  }).then(sel => {
    if (!sel) return;
    if (sel.folderName === '__assignColor__') { assignColor(context); return; }
    if (sel.folderName === '__help__') { showHelp(); return; }
    const i = fs.findIndex(f => f.name === sel.folderName);
    switchToFolder(+(Object.keys(slotMap).find(k => slotMap[+k] === sel.folderName) || i+1), context);
  });
}

function showHelp(): void {
  vscode.window.showInformationMessage([
    'WorkspaceHue — How it works', '',
    '📄 EDITOR COLOR  →  title bar, activity bar, status bar',
    '   Changes when you open a file in a different folder.', '',
    '⌨  TERMINAL COLOR  →  terminal panel background',
    '   Changes when you click a different terminal tab.', '',
    '🎨 ASSIGN A COLOR',
    '   Open a file in the target folder, then run:',
    '   WorkspaceHue: Assign Color to Current Folder', '',
    '⚡ QUICK SWITCH',
    '   Ctrl+Alt+1 / 2 / 3 to jump between folders.',
  ].join('\n'), {modal:true}, 'Assign Color Now', 'Open Keyboard Shortcuts')
  .then(c => {
    if (c === 'Assign Color Now')       vscode.commands.executeCommand('workspaceHue.assignColor');
    if (c === 'Open Keyboard Shortcuts') vscode.commands.executeCommand('workbench.action.openGlobalKeybindings', 'workspaceHue');
  });
}

function switchToFolder(slotIndex: number, context: vscode.ExtensionContext): void {
  const fs = folders();
  if (!fs.length) { vscode.window.showWarningMessage('No workspace folders found.'); return; }
  const slotMap = context.workspaceState.get<Record<number,string>>('slotMap', {});
  const name = slotMap[slotIndex] || (fs[slotIndex-1] && fs[slotIndex-1].name);
  if (!name) { vscode.window.showWarningMessage('No folder assigned to slot '+slotIndex+'.'); return; }
  const target = fs.find(f => f.name === name);
  if (!target) { vscode.window.showWarningMessage('Folder "'+name+'" not found.'); return; }
  const lastFile = context.workspaceState.get<Record<string,string>>('lastFile', {})[name];
  if (lastFile) {
    vscode.workspace.openTextDocument(vscode.Uri.file(lastFile))
      .then(doc => vscode.window.showTextDocument(doc))
      .then(() => vscode.window.showInformationMessage('Switched to '+name));
  } else {
    vscode.commands.executeCommand('revealInExplorer', target.uri);
    vscode.window.showInformationMessage('Switched to '+name);
  }
}

function autoAssignColors(context: vscode.ExtensionContext): void {
  const fs = folders(); if (!fs.length) return;
  const config = whCfg(), colors = config.get<Record<string,string>>('folderColors', {});
  let updated = false;
  fs.forEach((f, i) => { if (!colors[f.name]) { colors[f.name] = DEFAULT_COLORS[i % DEFAULT_COLORS.length]; updated = true; } });
  Object.assign(colorCache, colors);
  if (updated) {
    config.update('folderColors', colors, W);
    vscode.window.showInformationMessage('WorkspaceHue: Colors auto-assigned to '+fs.length+' folders!', 'How to use', 'Switch Folder')
      .then(c => {
        if (c === 'How to use')    showHelp();
        if (c === 'Switch Folder') vscode.commands.executeCommand('workspaceHue.showFolderPicker');
      });
  }
}

function resetColors(): void {
  vscode.window.showWarningMessage('Reset all folder colors?', {modal:true}, 'Yes, Reset').then(c => {
    if (c !== 'Yes, Reset') return;
    whCfg().update('folderColors', {}, W);
    wbCfg().update('colorCustomizations', {}, W);
    Object.keys(colorCache).forEach(k => delete colorCache[k]);
    currentEditorFolder = currentTerminalFolder = undefined;
    statusBarItem.hide();
    vscode.window.showInformationMessage('All colors reset.');
  });
}

function showStatus(): void {
  const fs = folders(), colors = whCfg().get<Record<string,string>>('folderColors', {});
  if (!fs.length) { vscode.window.showInformationMessage('No workspace folders.'); return; }
  vscode.window.showInformationMessage(fs.map(f => f.name+': '+(colors[f.name]||'(none)')).join('\n'), {modal:true});
}

function assignShortcut(context: vscode.ExtensionContext): void {
  const fs = folders(); if (!fs.length) { vscode.window.showWarningMessage('No workspace folders.'); return; }
  const slotMap = context.workspaceState.get<Record<number,string>>('slotMap', {});
  vscode.window.showQuickPick(
    [1,2,3,4,5].map(n => ({
      label: 'Slot '+n+' — '+KEYBINDINGS[n],
      description: 'Currently: '+(slotMap[n]||(fs[n-1]&&fs[n-1].name)||'empty'),
      slot: n,
    })),
    {placeHolder:'Which slot to reassign?'}
  ).then(s => {
    if (!s) return;
    vscode.window.showQuickPick(fs.map(f => ({label:f.name})), {placeHolder:'Assign to folder:'}).then(f => {
      if (!f) return;
      slotMap[s.slot] = f.label;
      context.workspaceState.update('slotMap', slotMap);
      vscode.window.showInformationMessage(KEYBINDINGS[s.slot]+' assigned to "'+f.label+'"');
      buildStatusBar(context);
    });
  });
}

function showShortcuts(context: vscode.ExtensionContext): void {
  const fs = folders(), slotMap = context.workspaceState.get<Record<number,string>>('slotMap', {});
  vscode.window.showInformationMessage(
    [1,2,3,4,5].map(i => KEYBINDINGS[i]+'  ->  '+(slotMap[i]||(fs[i-1]&&fs[i-1].name)||'(not set)')).join('\n'),
    {modal:true}
  );
}

// ── Activate / Deactivate ─────────────────────────────────────────
export function activate(context: vscode.ExtensionContext): void {
  const reg = (cmd: string, fn: () => void) =>
    context.subscriptions.push(vscode.commands.registerCommand(cmd, fn));

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101);
  statusBarItem.command = 'workspaceHue.assignColor';
  statusBarItem.tooltip = 'Click to assign a color to this folder';
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(e => { if (e) handleEditorChange(e, context); }),
    vscode.window.onDidOpenTerminal(t => { const f = detectFolder(t); if (f) terminalFolderMap.set(t, f.name); }),
    vscode.window.onDidCloseTerminal(t => terminalFolderMap.delete(t)),
    vscode.window.onDidChangeActiveTerminal(t => { if (t) handleTerminalChange(t); }),
  );

  reg('workspaceHue.showFolderPicker',       () => showFolderPicker(context));
  reg('workspaceHue.showHelp',               () => showHelp());
  reg('workspaceHue.assignColor',            () => assignColor(context));
  reg('workspaceHue.resetColors',            () => resetColors());
  reg('workspaceHue.showStatus',             () => showStatus());
  reg('workspaceHue.assignShortcut',         () => assignShortcut(context));
  reg('workspaceHue.showShortcuts',          () => showShortcuts(context));
  reg('workspaceHue.openKeyboardShortcuts',  () => vscode.commands.executeCommand('workbench.action.openGlobalKeybindings', 'workspaceHue'));
  for (let i = 1; i <= 5; i++) reg('workspaceHue.switchToFolder'+i, (idx => () => switchToFolder(idx, context))(i));

  autoAssignColors(context);
  buildStatusBar(context);
  if (vscode.window.activeTextEditor) handleEditorChange(vscode.window.activeTextEditor, context);
}

export function deactivate(): void {
  statusBarItem   && statusBarItem.dispose();
  folderStatusItem && folderStatusItem.dispose();
}
