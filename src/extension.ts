import * as vscode from 'vscode';

// ── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_COLORS = ['#c0392b','#2980b9','#27ae60','#8e44ad','#d35400','#16a085','#f39c12','#2c3e50'];
const KEYBINDINGS: Record<number,string> = {1:'Ctrl+Alt+1',2:'Ctrl+Alt+2',3:'Ctrl+Alt+3',4:'Ctrl+Alt+4',5:'Ctrl+Alt+5'};
const TERM_KEYS = ['terminal.background','terminal.foreground','terminalCursor.background',
  'terminalCursor.foreground','terminal.border','terminal.tab.activeBorder',
  'terminal.tab.activeBorderTop','terminalCommandDecoration.defaultBackground'];
const W = vscode.ConfigurationTarget.Workspace;

// ── State ────────────────────────────────────────────────────────────────────
const cache: Record<string,string> = {};                    // in-memory color cache
const tmap  = new Map<vscode.Terminal|number, string>();    // terminal → folder name
let sbMain: vscode.StatusBarItem;
let sbFolder: vscode.StatusBarItem | undefined;
let edFolder: string | undefined;
let termFolder: string | undefined;

// ── Config shortcuts ─────────────────────────────────────────────────────────
const whCfg   = () => vscode.workspace.getConfiguration('workspaceHue');
const wbCfg   = () => vscode.workspace.getConfiguration('workbench');
const wsFolders = (): readonly vscode.WorkspaceFolder[] => vscode.workspace.workspaceFolders || [];
const getColor  = (name?: string) => name ? (cache[name] ?? whCfg().get<Record<string,string>>('folderColors',{})[name]) : undefined;
const wss       = (key: string) => (ctx: vscode.ExtensionContext) => ctx.workspaceState.get<Record<string,unknown>>(key, {});

// ── Color math ───────────────────────────────────────────────────────────────
const darken = (hex: string, p: number) => {
  const n = parseInt(hex.slice(1), 16), d = (c: number) => Math.max(0, c - Math.round(2.55*p));
  return '#' + ((1<<24)+(d(n>>16)<<16)+(d((n>>8)&0xff)<<8)+d(n&0xff)).toString(16).slice(1);
};
const contrast = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return (0.299*(n>>16)+0.587*((n>>8)&0xff)+0.114*(n&0xff))/255 > 0.5 ? '#000000' : '#ffffff';
};

// ── Color application ────────────────────────────────────────────────────────
function applyColors(ec: string, tc: string) {
  const [ed,et,tb,tt] = [darken(ec,20),contrast(ec),darken(tc,15),contrast(darken(tc,15))];
  wbCfg().update('colorCustomizations', {
    'titleBar.activeBackground':ec,   'titleBar.activeForeground':et,  'titleBar.inactiveBackground':ed,
    'activityBar.background':ec,      'activityBar.foreground':et,     'activityBar.inactiveForeground':et+'99',
    'statusBar.background':ed,        'statusBar.foreground':et,
    'terminal.background':tb,         'terminal.foreground':tt,
    'terminalCursor.background':tb,   'terminalCursor.foreground':tc,
    'terminal.border':darken(tc,5),   'terminal.tab.activeBorder':tc,
    'terminal.tab.activeBorderTop':tc,'terminalCommandDecoration.defaultBackground':tc,
  }, W);
}

const applyEditor   = (name: string) => { const c = getColor(name); if (c) applyColors(c, getColor(termFolder) ?? c); };
const applyTerminal = (name: string) => { const c = getColor(name); if (c) applyColors(getColor(edFolder) ?? c, c); };

function clearTerminal() {
  const cc = {...wbCfg().get<Record<string,string>>('colorCustomizations',{})};
  TERM_KEYS.forEach(k => delete cc[k]);
  wbCfg().update('colorCustomizations', cc, W);
}

// ── Status bar ───────────────────────────────────────────────────────────────
const sbText = (name: string) => `${getColor(name) ? '$(circle-filled)' : '$(folder)'} ${name} $(chevron-down)`;

function buildStatusBar(ctx: vscode.ExtensionContext) {
  sbFolder?.dispose();
  sbFolder = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  sbFolder.text    = sbText(edFolder ?? (wsFolders()[0]?.name ?? ''));
  sbFolder.tooltip = 'WorkspaceHue: Click to switch folder';
  sbFolder.command = 'workspaceHue.showFolderPicker';
  sbFolder.show();
  ctx.subscriptions.push(sbFolder);
}

function updateStatusBar(name: string) {
  sbMain.text = `${getColor(name) ? '●' : '○'} ${name}`;
  sbMain.show();
  if (sbFolder) sbFolder.text = sbText(name);
}

// ── Terminal detection ───────────────────────────────────────────────────────
function folderByCwd(cwd?: string | vscode.Uri): vscode.WorkspaceFolder | undefined {
  if (!cwd) return undefined;
  const s = (typeof cwd === 'string' ? cwd : cwd.fsPath).replace(/\/+$/, '');
  return [...wsFolders()].sort((a,b) => b.uri.fsPath.length - a.uri.fsPath.length)
    .find(f => s === f.uri.fsPath || s.startsWith(f.uri.fsPath+'/') || s.startsWith(f.uri.fsPath+'\\'));
}

const detectFolder = (t: vscode.Terminal) =>
  folderByCwd((t.creationOptions as vscode.TerminalOptions).cwd)
  ?? wsFolders().find(f => t.name.toLowerCase() === f.name.toLowerCase());

function storeTerminal(t: vscode.Terminal, name: string, pid?: number) {
  tmap.set(t, name);
  if (pid != null) tmap.set(pid, name);
}

// ── Editor change ────────────────────────────────────────────────────────────
function onEditorChange(e: vscode.TextEditor, ctx: vscode.ExtensionContext) {
  const folder = vscode.workspace.getWorkspaceFolder(e.document.uri);
  if (!folder || e.document.uri.scheme !== 'file') return;
  const lf = ctx.workspaceState.get<Record<string,string>>('lastFile', {});
  ctx.workspaceState.update('lastFile', {...lf, [folder.name]: e.document.uri.fsPath});
  if (folder.name === edFolder) return;
  edFolder = folder.name;
  applyEditor(folder.name);
  updateStatusBar(folder.name);
}

// ── Terminal change ──────────────────────────────────────────────────────────
function onTerminalChange(t: vscode.Terminal, ctx: vscode.ExtensionContext) {
  t.processId.then(pid => {
    let name = (tmap.get(t) ?? (pid != null ? tmap.get(pid) : undefined)) as string | undefined;

    if (!name) {
      const f = detectFolder(t);
      if (f) { name = f.name; storeTerminal(t, name, pid); }
    }

    if (!name && pid != null) {
      name = ctx.workspaceState.get<Record<number,string>>('terminalPidMap', {})[pid];
      if (name) storeTerminal(t, name, pid);
    }

    if (!name) {
      if (!wsFolders().some(f => getColor(f.name))) return;
      vscode.window.showQuickPick(wsFolders().map(f => ({ label: f.name })),
        { placeHolder: 'WorkspaceHue: Which folder does this terminal belong to?' }
      ).then(sel => {
        if (!sel) return;
        storeTerminal(t, sel.label, pid);
        if (pid != null) {
          const m = ctx.workspaceState.get<Record<number,string>>('terminalPidMap', {});
          ctx.workspaceState.update('terminalPidMap', {...m, [pid]: sel.label});
        }
        termFolder = sel.label;
        applyTerminal(sel.label);
        updateStatusBar(edFolder ?? sel.label);
      });
      return;
    }

    if (name === termFolder) return;
    termFolder = name;
    applyTerminal(name);
    updateStatusBar(edFolder ?? name);
  });
}

// ── Commands ─────────────────────────────────────────────────────────────────
function saveColor(folderName: string, color: string, ctx: vscode.ExtensionContext) {
  cache[folderName] = color;
  whCfg().update('folderColors', {...whCfg().get('folderColors',{}), [folderName]: color}, W);
  applyColors(getColor(edFolder) ?? color, getColor(termFolder) ?? color);
  updateStatusBar(folderName);
  buildStatusBar(ctx);
  vscode.window.showInformationMessage(`Color assigned to "${folderName}"!`);
}

function assignColor(ctx: vscode.ExtensionContext) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { vscode.window.showWarningMessage('No active file open.'); return; }
  const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  if (!folder) { vscode.window.showWarningMessage('File is not inside a workspace folder.'); return; }
  const presets = [
    {label:'Red',color:'#c0392b'},{label:'Blue',color:'#2980b9'},{label:'Green',color:'#27ae60'},
    {label:'Purple',color:'#8e44ad'},{label:'Orange',color:'#d35400'},{label:'Teal',color:'#16a085'},
    {label:'Yellow',color:'#f39c12'},{label:'Dark Blue',color:'#2c3e50'},{label:'Pink',color:'#e91e8c'},
    {label:'Custom hex…',color:'custom'},
  ];
  vscode.window.showQuickPick(presets, {placeHolder:`Color for "${folder.name}"`}).then(sel => {
    if (!sel) return;
    if (sel.color === 'custom') {
      vscode.window.showInputBox({prompt:'Hex color e.g. #ff5733', validateInput: v => /^#[0-9A-Fa-f]{6}$/.test(v) ? null : 'Invalid hex'})
        .then(v => { if (v) saveColor(folder.name, v, ctx); });
    } else {
      saveColor(folder.name, sel.color, ctx);
    }
  });
}

function showFolderPicker(ctx: vscode.ExtensionContext) {
  const fs = wsFolders();
  if (!fs.length) { vscode.window.showWarningMessage('No workspace folders found.'); return; }
  const slotMap = ctx.workspaceState.get<Record<number,string>>('slotMap', {});
  const items = fs.map((f, i) => {
    const slot  = Object.keys(slotMap).find(k => slotMap[+k] === f.name) ?? String(i+1);
    const color = getColor(f.name);
    const isEd  = f.name === edFolder, isTerm = f.name === termFolder;
    const badge = [isEd && '$(file-code) editor', isTerm && '$(terminal) terminal'].filter(Boolean).join('  ');
    return {
      label:       `${isEd ? '$(circle-filled)' : '$(circle-outline)'} ${f.name}`,
      description: color ? `${color}${badge ? `   ${badge}` : ''}` : '(no color)',
      detail:      `$(key-mod) Ctrl+Alt+${slot}   $(paintcan) Click to switch`,
      folderName:  f.name,
    };
  });
  vscode.window.showQuickPick([
    ...items,
    {label:'', kind:vscode.QuickPickItemKind.Separator, folderName:''},
    {label:'$(paintcan) Assign color to current folder', description:'', folderName:'__color__'},
    {label:'$(question) How to use WorkspaceHue',        description:'', folderName:'__help__'},
  ], {
    placeHolder: `WorkspaceHue — ${fs.length} folders  •  editor: ${edFolder??'none'}  •  terminal: ${termFolder??'none'}`,
    matchOnDescription: true,
  }).then(sel => {
    if (!sel) return;
    if (sel.folderName === '__color__') { assignColor(ctx); return; }
    if (sel.folderName === '__help__')  { showHelp(); return; }
    const i = fs.findIndex(f => f.name === sel.folderName);
    switchToFolder(+(Object.keys(slotMap).find(k => slotMap[+k] === sel.folderName) ?? i+1), ctx);
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
    '⚡ QUICK SWITCH  →  Ctrl+Alt+1 / 2 / 3',
  ].join('\n'), {modal:true}, 'Assign Color Now', 'Open Keyboard Shortcuts')
  .then(c => {
    if (c === 'Assign Color Now')        vscode.commands.executeCommand('workspaceHue.assignColor');
    if (c === 'Open Keyboard Shortcuts') vscode.commands.executeCommand('workbench.action.openGlobalKeybindings','workspaceHue');
  });
}

function switchToFolder(slot: number, ctx: vscode.ExtensionContext) {
  const fs = wsFolders();
  if (!fs.length) { vscode.window.showWarningMessage('No workspace folders found.'); return; }
  const slotMap = ctx.workspaceState.get<Record<number,string>>('slotMap', {});
  const name   = slotMap[slot] ?? fs[slot-1]?.name;
  if (!name) { vscode.window.showWarningMessage(`No folder assigned to slot ${slot}.`); return; }
  const target = fs.find(f => f.name === name);
  if (!target) { vscode.window.showWarningMessage(`Folder "${name}" not found.`); return; }
  const lastFile = ctx.workspaceState.get<Record<string,string>>('lastFile',{})[name];
  (lastFile
    ? vscode.workspace.openTextDocument(vscode.Uri.file(lastFile)).then(d => vscode.window.showTextDocument(d))
    : Promise.resolve(vscode.commands.executeCommand('revealInExplorer', target.uri))
  ).then(() => vscode.window.showInformationMessage(`Switched to ${name}`));
}

function autoAssignColors() {
  const fs = wsFolders(); if (!fs.length) return;
  const config = whCfg(), colors = config.get<Record<string,string>>('folderColors', {});
  let updated = false;
  fs.forEach((f,i) => { if (!colors[f.name]) { colors[f.name] = DEFAULT_COLORS[i%DEFAULT_COLORS.length]; updated = true; }});
  Object.assign(cache, colors);
  if (!updated) return;
  config.update('folderColors', colors, W);
  vscode.window.showInformationMessage(`WorkspaceHue: Colors auto-assigned to ${fs.length} folders!`, 'How to use', 'Switch Folder')
    .then(c => {
      if (c === 'How to use')    showHelp();
      if (c === 'Switch Folder') vscode.commands.executeCommand('workspaceHue.showFolderPicker');
    });
}

function resetColors() {
  vscode.window.showWarningMessage('Reset all folder colors?', {modal:true}, 'Yes, Reset').then(c => {
    if (c !== 'Yes, Reset') return;
    whCfg().update('folderColors', {}, W);
    wbCfg().update('colorCustomizations', {}, W);
    Object.keys(cache).forEach(k => delete cache[k]);
    edFolder = termFolder = undefined;
    sbMain.hide();
    vscode.window.showInformationMessage('All colors reset.');
  });
}

function showStatus() {
  const fs = wsFolders(), colors = whCfg().get<Record<string,string>>('folderColors',{});
  if (!fs.length) { vscode.window.showInformationMessage('No workspace folders.'); return; }
  vscode.window.showInformationMessage(fs.map(f => `${f.name}: ${colors[f.name]??'(none)'}`).join('\n'), {modal:true});
}

function assignShortcut(ctx: vscode.ExtensionContext) {
  const fs = wsFolders(); if (!fs.length) { vscode.window.showWarningMessage('No workspace folders.'); return; }
  const slotMap = ctx.workspaceState.get<Record<number,string>>('slotMap', {});
  vscode.window.showQuickPick(
    [1,2,3,4,5].map(n => ({label:`Slot ${n} — ${KEYBINDINGS[n]}`, description:`Currently: ${slotMap[n]??fs[n-1]?.name??'empty'}`, slot:n})),
    {placeHolder:'Which slot to reassign?'}
  ).then(s => {
    if (!s) return;
    vscode.window.showQuickPick(fs.map(f => ({label:f.name})), {placeHolder:'Assign to folder:'}).then(f => {
      if (!f) return;
      ctx.workspaceState.update('slotMap', {...slotMap, [s.slot]: f.label});
      vscode.window.showInformationMessage(`${KEYBINDINGS[s.slot]} assigned to "${f.label}"`);
      buildStatusBar(ctx);
    });
  });
}

function showShortcuts(ctx: vscode.ExtensionContext) {
  const fs = wsFolders(), slotMap = ctx.workspaceState.get<Record<number,string>>('slotMap',{});
  vscode.window.showInformationMessage(
    [1,2,3,4,5].map(i => `${KEYBINDINGS[i]}  ->  ${slotMap[i]??fs[i-1]?.name??'(not set)'}`).join('\n'),
    {modal:true}
  );
}

// ── Activate / Deactivate ─────────────────────────────────────────────────────
export function activate(ctx: vscode.ExtensionContext) {
  const reg = (cmd: string, fn: ()=>void) => ctx.subscriptions.push(vscode.commands.registerCommand(cmd, fn));

  sbMain = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101);
  sbMain.command = 'workspaceHue.assignColor';
  sbMain.tooltip = 'Click to assign a color to this folder';
  ctx.subscriptions.push(sbMain);

  ctx.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(e => { if (e) onEditorChange(e, ctx); }),
    vscode.window.onDidOpenTerminal(t => {
      const f = detectFolder(t); if (!f) return;
      tmap.set(t, f.name);
      t.processId.then(pid => { if (pid != null) tmap.set(pid, f.name); });
    }),
    vscode.window.onDidCloseTerminal(t => {
      tmap.delete(t);
      t.processId.then(pid => { if (pid != null) tmap.delete(pid); });
    }),
    vscode.window.onDidChangeActiveTerminal(t => { if (t) onTerminalChange(t, ctx); }),
  );

  reg('workspaceHue.showFolderPicker',      () => showFolderPicker(ctx));
  reg('workspaceHue.showHelp',              () => showHelp());
  reg('workspaceHue.assignColor',           () => assignColor(ctx));
  reg('workspaceHue.resetColors',           () => resetColors());
  reg('workspaceHue.showStatus',            () => showStatus());
  reg('workspaceHue.assignShortcut',        () => assignShortcut(ctx));
  reg('workspaceHue.showShortcuts',         () => showShortcuts(ctx));
  reg('workspaceHue.openKeyboardShortcuts', () => vscode.commands.executeCommand('workbench.action.openGlobalKeybindings','workspaceHue'));
  for (let i = 1; i <= 5; i++) reg(`workspaceHue.switchToFolder${i}`, (n => () => switchToFolder(n, ctx))(i));

  autoAssignColors();
  buildStatusBar(ctx);
  if (vscode.window.activeTextEditor) onEditorChange(vscode.window.activeTextEditor, ctx);
}

export function deactivate() {
  sbMain?.dispose();
  sbFolder?.dispose();
}
