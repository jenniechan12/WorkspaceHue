"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");

// ── Constants ─────────────────────────────────────────────────────
const DEFAULT_COLORS = ['#c0392b','#2980b9','#27ae60','#8e44ad','#d35400','#16a085','#f39c12','#2c3e50'];
const KEYBINDINGS    = {1:'Ctrl+Alt+1',2:'Ctrl+Alt+2',3:'Ctrl+Alt+3',4:'Ctrl+Alt+4',5:'Ctrl+Alt+5'};
const TERM_KEYS      = ['terminal.background','terminal.foreground','terminalCursor.background',
                        'terminalCursor.foreground','terminal.border','terminal.tab.activeBorder',
                        'terminal.tab.activeBorderTop','terminalCommandDecoration.defaultBackground'];
const W              = vscode.ConfigurationTarget.Workspace;

// ── State ─────────────────────────────────────────────────────────
const colorCache       = {};
const terminalFolderMap = new Map();
let statusBarItem, folderStatusItem;
let currentEditorFolder, currentTerminalFolder;

// ── Helpers ───────────────────────────────────────────────────────
const cfg  = id => vscode.workspace.getConfiguration(id);
const whCfg = () => cfg('workspaceHue');
const wbCfg = () => cfg('workbench');
const folders = () => vscode.workspace.workspaceFolders || [];
const getColors = () => Object.assign({}, colorCache, whCfg().get('folderColors', {}));

const darken = (hex, pct) => {
  const n = parseInt(hex.replace('#',''), 16);
  const ch = c => Math.max(0, c - Math.round(2.55 * pct));
  return '#' + ((1<<24) + (ch(n>>16)<<16) + (ch((n>>8)&0xff)<<8) + ch(n&0xff)).toString(16).slice(1);
};

const contrast = hex => {
  const n = parseInt(hex.replace('#',''), 16);
  return (0.299*(n>>16) + 0.587*((n>>8)&0xff) + 0.114*(n&0xff)) / 255 > 0.5 ? '#000000' : '#ffffff';
};

const getColor = name => colorCache[name] || whCfg().get('folderColors', {})[name];

// ── Color writing ─────────────────────────────────────────────────
function writeAllColors(ec, tc) {
  const ed = darken(ec, 20), et = contrast(ec);
  const tb = darken(tc, 15), tt = contrast(tb), tbr = darken(tc, 5);
  wbCfg().update('colorCustomizations', {
    'titleBar.activeBackground': ec, 'titleBar.activeForeground': et, 'titleBar.inactiveBackground': ed,
    'activityBar.background': ec, 'activityBar.foreground': et, 'activityBar.inactiveForeground': et+'99',
    'statusBar.background': ed, 'statusBar.foreground': et,
    'terminal.background': tb, 'terminal.foreground': tt,
    'terminalCursor.background': tb, 'terminalCursor.foreground': tc,
    'terminal.border': tbr, 'terminal.tab.activeBorder': tc,
    'terminal.tab.activeBorderTop': tc, 'terminalCommandDecoration.defaultBackground': tc,
  }, W);
}

function clearTerminalColor() {
  const cc = Object.assign({}, wbCfg().get('colorCustomizations', {}));
  TERM_KEYS.forEach(k => delete cc[k]);
  wbCfg().update('colorCustomizations', cc, W);
}

// ── Apply colors ──────────────────────────────────────────────────
const applyEditorColor = name => {
  const ec = getColor(name); if (!ec) return;
  writeAllColors(ec, getColor(currentTerminalFolder) || ec);
};

const applyTerminalColor = name => {
  const tc = getColor(name); if (!tc) return;
  writeAllColors(getColor(currentEditorFolder) || tc, tc);
};

// ── Status bar ────────────────────────────────────────────────────
const sbText = name => (getColor(name) ? '$(circle-filled)' : '$(folder)') + ' ' + name + ' $(chevron-down)';

function buildStatusBar(context) {
  if (folderStatusItem) folderStatusItem.dispose();
  const f = folders();
  folderStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  folderStatusItem.text    = sbText(currentEditorFolder || (f[0] && f[0].name) || '');
  folderStatusItem.tooltip = 'WorkspaceHue: Click to switch folder';
  folderStatusItem.command = 'workspaceHue.showFolderPicker';
  folderStatusItem.show();
  context.subscriptions.push(folderStatusItem);
}

function updateStatusBar(name) {
  statusBarItem.text = (getColor(name) ? '●' : '○') + ' ' + name;
  statusBarItem.show();
  if (folderStatusItem) folderStatusItem.text = sbText(name);
}

// ── Event handlers ────────────────────────────────────────────────
function handleEditorChange(editor, context) {
  const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  if (!folder) return;
  if (editor.document.uri.scheme === 'file') {
    const lf = context.workspaceState.get('lastFile', {});
    lf[folder.name] = editor.document.uri.fsPath;
    context.workspaceState.update('lastFile', lf);
  }
  if (folder.name === currentEditorFolder) return;
  currentEditorFolder = folder.name;
  applyEditorColor(folder.name);
  updateStatusBar(folder.name);
}

function detectFolder(terminal) {
  const fs = folders(); if (!fs.length) return;
  const byLength = arr => [...arr].sort((a, b) => b.length - a.length);

  // 1. CWD — most specific match wins (longest path first)
  const cwd = terminal.creationOptions && terminal.creationOptions.cwd;
  if (cwd) {
    const s = (typeof cwd === 'string' ? cwd : cwd.fsPath).replace(/\/+$/, '');
    const match = byLength(fs.map(f => f.uri.fsPath))
      .map(p => fs.find(f => f.uri.fsPath === p))
      .find(f => s === f.uri.fsPath || s.startsWith(f.uri.fsPath+'/') || s.startsWith(f.uri.fsPath+'\\'));
    if (match) return match;
  }

  // 2. Exact terminal name match
  const tn = terminal.name.toLowerCase();
  const exact = fs.find(f => tn === f.name.toLowerCase());
  if (exact) return exact;

  // 3. Word-boundary match (longer names first to avoid "Project" matching "ProjectA")
  return byLength(fs.map(f => f.name))
    .map(n => fs.find(f => f.name === n))
    .find(f => {
      const fn = f.name.toLowerCase(), i = tn.indexOf(fn);
      if (i === -1) return false;
      const wb = /[\s\-_\/\\]/;
      return (i === 0 || wb.test(tn[i-1])) && (i+fn.length >= tn.length || wb.test(tn[i+fn.length]));
    });
}

function handleTerminalChange(terminal) {
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
function saveColor(folderName, color, context) {
  colorCache[folderName] = color;
  const fc = whCfg().get('folderColors', {});
  fc[folderName] = color;
  whCfg().update('folderColors', fc, W);
  writeAllColors(getColor(currentEditorFolder) || color, getColor(currentTerminalFolder) || color);
  updateStatusBar(folderName);
  buildStatusBar(context);
  vscode.window.showInformationMessage('Color assigned to "' + folderName + '"!');
}

function assignColor(context) {
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
      vscode.window.showInputBox({prompt:'Hex color (e.g. #ff5733)', validateInput: v => /^#[0-9A-Fa-f]{6}$/.test(v) ? null : 'Invalid hex'})
        .then(v => { if (v) saveColor(folder.name, v, context); });
    } else {
      saveColor(folder.name, sel.color, context);
    }
  });
}

function showFolderPicker(context) {
  const fs = folders();
  if (!fs.length) { vscode.window.showWarningMessage('No workspace folders found.'); return; }
  const slotMap = context.workspaceState.get('slotMap', {});
  const items = fs.map((f, i) => {
    const slot   = Object.keys(slotMap).find(k => slotMap[k] === f.name) || String(i+1);
    const color  = getColor(f.name);
    const active = f.name === currentEditorFolder, activeTerm = f.name === currentTerminalFolder;
    const badges = [active && '$(file-code) editor', activeTerm && '$(terminal) terminal'].filter(Boolean).join('  ');
    return {
      label: (active ? '$(circle-filled) ' : '$(circle-outline) ') + f.name,
      description: color ? color + (badges ? '   '+badges : '') : '(no color assigned)',
      detail: '$(key-mod) Ctrl+Alt+'+slot+'   $(paintcan) Click to switch',
      folderName: f.name,
    };
  });
  vscode.window.showQuickPick([
    ...items,
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    { label:'$(paintcan) Assign color to current folder', description:'Color picker for the active folder', folderName:'__assignColor__' },
    { label:'$(question) How to use WorkspaceHue', description:'', folderName:'__help__' },
  ], {
    placeHolder: 'WorkspaceHue — '+fs.length+' folders  •  editor: '+(currentEditorFolder||'none')+'  •  terminal: '+(currentTerminalFolder||'none'),
    matchOnDescription: true,
  }).then(sel => {
    if (!sel) return;
    if (sel.folderName === '__assignColor__') { assignColor(context); return; }
    if (sel.folderName === '__help__') { showHelp(); return; }
    const i = fs.findIndex(f => f.name === sel.folderName);
    switchToFolder(parseInt(Object.keys(slotMap).find(k => slotMap[k] === sel.folderName) || i+1), context);
  });
}

function showHelp() {
  vscode.window.showInformationMessage([
    'WorkspaceHue — How it works','',
    '📄 EDITOR COLOR  →  title bar, activity bar, status bar',
    '   Changes when you open a file in a different folder.','',
    '⌨  TERMINAL COLOR  →  terminal panel background',
    '   Changes when you click a different terminal tab.','',
    '🎨 ASSIGN A COLOR',
    '   Open a file in the target folder, then run:',
    '   WorkspaceHue: Assign Color to Current Folder','',
    '⚡ QUICK SWITCH',
    '   Ctrl+Alt+1 / 2 / 3 to jump between folders.',
  ].join('\n'), {modal:true}, 'Assign Color Now', 'Open Keyboard Shortcuts')
  .then(c => {
    if (c === 'Assign Color Now') vscode.commands.executeCommand('workspaceHue.assignColor');
    if (c === 'Open Keyboard Shortcuts') vscode.commands.executeCommand('workbench.action.openGlobalKeybindings', 'workspaceHue');
  });
}

function switchToFolder(slotIndex, context) {
  const fs = folders();
  if (!fs.length) { vscode.window.showWarningMessage('No workspace folders found.'); return; }
  const slotMap = context.workspaceState.get('slotMap', {});
  const name = slotMap[slotIndex] || (fs[slotIndex-1] && fs[slotIndex-1].name);
  if (!name) { vscode.window.showWarningMessage('No folder assigned to slot '+slotIndex+'.'); return; }
  const target = fs.find(f => f.name === name);
  if (!target) { vscode.window.showWarningMessage('Folder "'+name+'" not found.'); return; }
  const lastFile = context.workspaceState.get('lastFile', {})[name];
  if (lastFile) {
    vscode.workspace.openTextDocument(vscode.Uri.file(lastFile))
      .then(doc => vscode.window.showTextDocument(doc))
      .then(() => vscode.window.showInformationMessage('Switched to '+name));
  } else {
    vscode.commands.executeCommand('revealInExplorer', target.uri);
    vscode.window.showInformationMessage('Switched to '+name);
  }
}

function autoAssignColors(context) {
  const fs = folders(); if (!fs.length) return;
  const config = whCfg(), colors = config.get('folderColors', {});
  let updated = false;
  fs.forEach((f, i) => { if (!colors[f.name]) { colors[f.name] = DEFAULT_COLORS[i % DEFAULT_COLORS.length]; updated = true; } });
  Object.assign(colorCache, colors);
  if (updated) {
    config.update('folderColors', colors, W);
    vscode.window.showInformationMessage('WorkspaceHue: Colors auto-assigned to '+fs.length+' folders!', 'How to use', 'Switch Folder')
      .then(c => {
        if (c === 'How to use') showHelp();
        if (c === 'Switch Folder') vscode.commands.executeCommand('workspaceHue.showFolderPicker');
      });
  }
}

function resetColors() {
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

function showStatus() {
  const fs = folders(), colors = whCfg().get('folderColors', {});
  if (!fs.length) { vscode.window.showInformationMessage('No workspace folders.'); return; }
  vscode.window.showInformationMessage(fs.map(f => f.name+': '+(colors[f.name]||'(none)')).join('\n'), {modal:true});
}

function assignShortcut(context) {
  const fs = folders(); if (!fs.length) { vscode.window.showWarningMessage('No workspace folders.'); return; }
  const slotMap = context.workspaceState.get('slotMap', {});
  vscode.window.showQuickPick(
    [1,2,3,4,5].map(n => ({label:'Slot '+n+' — '+KEYBINDINGS[n], description:'Currently: '+(slotMap[n]||(fs[n-1]&&fs[n-1].name)||'empty'), slot:n})),
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

function showShortcuts(context) {
  const fs = folders(), slotMap = context.workspaceState.get('slotMap', {});
  vscode.window.showInformationMessage(
    [1,2,3,4,5].map(i => KEYBINDINGS[i]+'  ->  '+(slotMap[i]||(fs[i-1]&&fs[i-1].name)||'(not set)')).join('\n'),
    {modal:true}
  );
}

// ── Activate / Deactivate ─────────────────────────────────────────
function activate(context) {
  const reg = (cmd, fn) => context.subscriptions.push(vscode.commands.registerCommand(cmd, fn));

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

  reg('workspaceHue.showFolderPicker',      () => showFolderPicker(context));
  reg('workspaceHue.showHelp',              () => showHelp());
  reg('workspaceHue.assignColor',           () => assignColor(context));
  reg('workspaceHue.resetColors',           () => resetColors());
  reg('workspaceHue.showStatus',            () => showStatus());
  reg('workspaceHue.assignShortcut',        () => assignShortcut(context));
  reg('workspaceHue.showShortcuts',         () => showShortcuts(context));
  reg('workspaceHue.openKeyboardShortcuts', () => vscode.commands.executeCommand('workbench.action.openGlobalKeybindings', 'workspaceHue'));
  for (let i = 1; i <= 5; i++) reg('workspaceHue.switchToFolder'+i, (idx => () => switchToFolder(idx, context))(i));

  autoAssignColors(context);
  buildStatusBar(context);
  if (vscode.window.activeTextEditor) handleEditorChange(vscode.window.activeTextEditor, context);
}

function deactivate() {
  statusBarItem && statusBarItem.dispose();
  folderStatusItem && folderStatusItem.dispose();
}
