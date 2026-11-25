/** 共享样式：所有组件 Shadow DOM 内复用同一套设计变量与控件外观 */
export const sharedCss = `
:host {
  --bg-0: #0b101c;
  --bg-1: #111a2e;
  --bg-2: #18233d;
  --bg-3: #22304f;
  --line: #2b3a5c;
  --text-0: #e8eefc;
  --text-1: #a8b8d8;
  --text-2: #6b7ea3;
  --accent: #5b9dff;
  --accent-2: #8f7bff;
  --camera: #5b9dff;
  --crater: #ff9d5b;
  --ejecta: #7be0c0;
  --group: #c9a6ff;
  --danger: #ff6b81;
  --ok: #5bd68f;
  font-family: 'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif;
  font-size: 13px;
  color: var(--text-0);
  box-sizing: border-box;
}
* { box-sizing: border-box; }
button {
  font: inherit;
  color: var(--text-0);
  background: var(--bg-3);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 5px 10px;
  cursor: pointer;
  transition: background .15s, border-color .15s;
}
button:hover { background: #2c3d63; border-color: var(--accent); }
button.primary { background: var(--accent); border-color: var(--accent); color: #061020; font-weight: 600; }
button.primary:hover { background: #77adff; }
button.icon { padding: 4px 7px; line-height: 1; }
button.active { background: var(--accent); color: #061020; border-color: var(--accent); }
button:disabled { opacity: .4; cursor: not-allowed; }
select, input[type=text], input[type=number] {
  font: inherit;
  color: var(--text-0);
  background: var(--bg-1);
  border: 1px solid var(--line);
  border-radius: 5px;
  padding: 4px 7px;
  outline: none;
}
select:focus, input:focus { border-color: var(--accent); }
input[type=range] { accent-color: var(--accent); width: 100%; }
label { color: var(--text-1); }
.row { display: flex; align-items: center; gap: 8px; }
.col { display: flex; flex-direction: column; gap: 6px; }
.tag {
  display: inline-block; padding: 1px 7px; border-radius: 10px;
  font-size: 11px; font-weight: 600;
}
.tag.camera { background: rgba(91,157,255,.18); color: var(--camera); }
.tag.crater { background: rgba(255,157,91,.18); color: var(--crater); }
.tag.ejecta { background: rgba(123,224,192,.18); color: var(--ejecta); }
.tag.group { background: rgba(201,166,255,.18); color: var(--group); }
.muted-label { color: var(--text-2); font-style: italic; }
`;
