/* Pi owns the agent loop. This file only presents API events and user actions. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const icons = {
    plus: '<path d="M8 3v10M3 8h10"/>',
    'chevron-left': '<path d="m10 4-4 4 4 4"/>', 'chevron-right': '<path d="m6 4 4 4-4 4"/>', 'chevron-up': '<path d="m4 10 4-4 4 4"/>',
    'panel-left': '<rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="M6 3v10"/>', 'panel-right': '<rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="M10 3v10"/>',
    edit: '<path d="m10 3 3 3-7.5 7.5H2.5v-3L10 3Z"/><path d="m8.5 4.5 3 3"/>',
    copy: '<rect x="5" y="5" width="8" height="9" rx="1.5"/><path d="M10 5V2.5H2.5V11H5"/>',
    terminal: '<rect x="1.5" y="2.5" width="13" height="11" rx="2"/><path d="m4 6 2 2-2 2m4 0h3"/>',
    chart: '<rect x="2" y="2" width="12" height="12" rx="2"/><path d="M5 10V7m3 3V5m3 5V8"/>',
    code: '<path d="m5 4-4 4 4 4m6-8 4 4-4 4M9 2 7 14"/>',
    globe: '<circle cx="8" cy="8" r="6"/><ellipse cx="8" cy="8" rx="2.5" ry="6"/><path d="M2 8h12"/>',
    'arrow-up-right': '<path d="M4 12 12 4M4 4h8v8"/>',
    paperclip: '<path d="m6 8 4-4a2 2 0 0 1 3 3l-6 6a3 3 0 0 1-4-4l6-6M5 10l5-5"/>',
    send: '<path d="m2 2 12 6-12 6 2-6-2-6Zm2 6h10"/>', stop: '<rect x="3" y="3" width="10" height="10" rx="1"/>',
    close: '<path d="m4 4 8 8M4 12l8-8"/>', check: '<circle cx="8" cy="8" r="6"/><path d="m5 8 2 2 4-4"/>',
    clock: '<circle cx="8" cy="8" r="6"/><path d="M8 4v4l3 2"/>', file: '<path d="M9 1.5H3v13h10v-9L9 1.5Z"/><path d="M9 1.5v4h4M5 9h6m-6 3h4"/>',
    download: '<path d="M8 2v8m-3-3 3 3 3-3M2 11v3h12v-3"/>', error: '<circle cx="8" cy="8" r="6"/><path d="M8 4.5v4M8 11h.01"/>'
  };
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = icons[name] || icons.terminal; // Fixed local SVG paths, never model content.
    return svg;
  }
  document.querySelectorAll('[data-icon]').forEach((el) => el.append(icon(el.dataset.icon)));
  const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text !== undefined) el.textContent = text; return el; };
  const labels = { orchestrator: '运行状态', 'pi-model': 'Pi 模型', sandbox: 'E2B 沙箱', validator: '独立校验器', web: '联网检索' };
  const json = (value) => typeof value === 'string' ? value : JSON.stringify(value ?? {}, null, 2);
  const time = (value) => new Date(value).toLocaleTimeString('zh-CN', { hour12: false });
  const bytes = (size) => size < 1024 ? `${size} 字节` : `${(size / 1024).toFixed(1)} KB`;
  const views = [];
  let active, toastTimer;

  // Safe Markdown: model text is always inserted with text nodes; URLs are restricted.
  function safeUrl(value) {
    if (/^\/api\/artifacts\//.test(value)) return value;
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; }
  }
  function inline(parent, text) {
    const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^\s)]+\)|https?:\/\/[^\s<>]+)/g;
    let offset = 0;
    for (const match of text.matchAll(pattern)) {
      parent.append(document.createTextNode(text.slice(offset, match.index)));
      const token = match[0];
      if (token.startsWith('`')) parent.append(node('code', '', token.slice(1, -1)));
      else if (token.startsWith('**')) parent.append(node('strong', '', token.slice(2, -2)));
      else {
        const parts = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        const href = safeUrl(parts ? parts[2] : token);
        if (href) { const a = node('a', '', parts ? parts[1] : token); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; parent.append(a); }
        else parent.append(document.createTextNode(token));
      }
      offset = match.index + token.length;
    }
    parent.append(document.createTextNode(text.slice(offset)));
  }
  function markdown(target, text) {
    target.replaceChildren();
    const lines = text.split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      if (/^\s*```/.test(line)) {
        const language = line.trim().slice(3), content = []; i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) content.push(lines[i++]);
        i++;
        const pre = node('pre'); if (language) pre.append(node('span', 'code-label', language));
        pre.append(node('code', '', content.join('\n'))); target.append(pre); continue;
      }
      const heading = line.match(/^(#{1,4})\s+(.+)$/);
      if (heading) { const h = node(`h${Math.min(heading[1].length + 1, 4)}`); inline(h, heading[2]); target.append(h); i++; continue; }
      const list = line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)$/);
      if (list) {
        const ordered = /^\s*\d+\./.test(line), ul = node(ordered ? 'ol' : 'ul');
        if (ordered) ul.start = Number(line.trim().match(/^\d+/)[0]);
        while (i < lines.length) {
          const item = lines[i].match(ordered ? /^\s*\d+\.\s+(.+)$/ : /^\s*[-*]\s+(.+)$/);
          if (!item) break;
          const li = node('li'); inline(li, item[1]); ul.append(li); i++;
        }
        target.append(ul); continue;
      }
      const p = node('p'); inline(p, line); target.append(p); i++;
    }
  }

  function newView() {
    const v = { key: crypto.randomUUID(), title: '新对话', renamed: false, createdAt: new Date(), draft: '', sessionId: undefined, creating: undefined, uploading: false, uploadPromise: undefined, selectedFile: undefined, running: false, submitting: false, stopping: false, status: '等待开始', lastEventId: 0, tab: 'progress', selection: -1, followLatest: true, messages: new Map(), toolMap: new Map(), tools: [], inputs: [], artifacts: [], fileStatus: '', chat: node('div'), toolRoot: node('div'), audit: node('div'), files: node('div'), attachments: node('div') };
    views.unshift(v); renderFiles(v); return v;
  }
  function selectView(v) {
    if (active) active.draft = $('prompt').value;
    active = v;
    $('messages').replaceChildren(v.chat); $('tools').replaceChildren(v.toolRoot); $('audit').replaceChildren(v.audit); $('files').replaceChildren(v.files); $('attachment-chips').replaceChildren(v.attachments);
    $('prompt').value = v.draft; $('file').value = ''; $('chat').scrollTop = $('chat').scrollHeight;
    document.body.classList.remove('nav-open'); updateOverlay(); update(v); resizePrompt();
  }
  function renderHistory() {
    $('history').replaceChildren(...views.map((v) => {
      const button = node('button', `history-item${v === active ? ' active' : ''}${v.running ? ' running' : ''}`);
      button.append(node('strong', '', v.title), node('small', '', `${v.createdAt.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })} ${v.createdAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`));
      if (v === active) button.setAttribute('aria-current', 'page'); button.title = v.title; button.onclick = () => selectView(v); return button;
    }));
  }
  function update(v) {
    if (v !== active) { renderHistory(); return; }
    const busy = v.running || v.submitting;
    $('chat-title').textContent = v.title; $('welcome').hidden = v.chat.childElementCount > 0;
    $('status').textContent = v.status;
    $('status-indicator').parentElement.dataset.state = busy ? 'running' : /失败/.test(v.status) ? 'error' : v.status === '已完成' ? 'done' : 'idle';
    $('session-short').textContent = v.sessionId ? `…${v.sessionId.slice(-8)}` : '尚未创建会话'; $('session-short').title = v.sessionId || '发送任务后创建沙箱会话';
    $('send').disabled = busy || v.uploading; $('file').disabled = busy || v.uploading;
    $('choose-file').disabled = busy || v.uploading;
    $('abort').hidden = !v.running; $('abort').disabled = !v.running || v.stopping;
    $('upload').hidden = !v.selectedFile || v.uploading; $('upload').disabled = busy || v.uploading;
    $('file-status').textContent = v.fileStatus || '文件选择后自动上传 · 单个文件最大 10 MB';
    $('tool-count').textContent = v.tools.length || ''; $('file-count').textContent = v.inputs.length + v.artifacts.length || '';
    $('tool-empty').hidden = v.tools.length > 0;
    $('run-summary').hidden = !v.tools.length;
    const done = v.tools.filter((tool) => tool.status !== 'running').length, errors = v.tools.filter((tool) => tool.status === 'error').length;
    $('summary-title').textContent = busy ? `正在执行 · ${done} / ${v.tools.length} 个工具已结束` : `${done} / ${v.tools.length} 个工具已结束`;
    $('summary-caption').textContent = errors ? `${errors} 次调用失败 · 可在执行面板查看详情` : busy ? '实时记录 Pi 的工具调用' : '点击展开执行记录';
    $('summary-list').replaceChildren(...v.tools.map((tool, index) => {
      const button = node('button', '', `${tool.status === 'running' ? '◌' : tool.status === 'error' ? '!' : '✓'}  ${tool.name} · ${tool.executor}`); button.onclick = () => showTool(v, index, true); return button;
    }));
    updateNavigation(v); setTab(v.tab); renderHistory();
  }
  function updateNavigation(v) {
    const total = v.tools.length;
    v.tools.forEach((tool, i) => { tool.el.hidden = i !== v.selection; });
    $('tool-position').max = String(Math.max(0, total - 1)); $('tool-position').value = String(Math.max(0, v.selection)); $('tool-position').disabled = total < 2;
    $('previous-tool').disabled = v.selection <= 0; $('next-tool').disabled = v.selection >= total - 1;
    $('tool-page').textContent = `${total ? v.selection + 1 : 0} / ${total}`;
    $('tool-position').setAttribute('aria-valuetext', total ? `第 ${v.selection + 1} 个，共 ${total} 个工具调用` : '暂无工具调用');
  }
  function showTool(v, index, open) {
    v.selection = Math.max(0, Math.min(index, v.tools.length - 1)); v.followLatest = v.selection === v.tools.length - 1; v.tab = 'progress';
    if (v === active) { setTab('progress'); updateNavigation(v); if (open && innerWidth <= 760) { document.body.classList.add('tools-open'); updateOverlay(); $('close-tools').focus(); } }
  }
  function setTab(name) {
    active.tab = name;
    document.querySelectorAll('[data-tab]').forEach((button) => { const selected = button.dataset.tab === name; button.classList.toggle('active', selected); button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1; });
    for (const tab of ['progress', 'audit', 'files']) $(`${tab}-panel`).hidden = tab !== name;
    document.querySelector('.tool-navigation').hidden = name !== 'progress';
    if (name === 'audit' && !active.audit.childElementCount) active.audit.append(node('div', 'panel-placeholder', '暂无事件日志。任务开始后将记录真实执行事件。'));
  }
  const atBottom = () => $('chat').scrollHeight - $('chat').scrollTop - $('chat').clientHeight < 110;
  function scrollAfter(v, follow) { if (v === active && follow) requestAnimationFrame(() => { if (v === active) $('chat').scrollTop = $('chat').scrollHeight; }); }
  function message(v, text, cls = 'notice', source) {
    const follow = v === active && atBottom(), el = node('div', `message ${cls}`);
    if (source) el.append(node('div', 'source', `来源：${labels[source] || source}`));
    el.append(node('div', 'body', text)); v.chat.append(el); if (v === active) $('welcome').hidden = true; scrollAfter(v, follow); return el;
  }
  async function request(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || `请求失败 (${response.status})`); return data;
  }
  async function ensureSession(v) {
    if (v.sessionId) return;
    if (!v.creating) v.creating = (async () => {
      v.status = '正在连接沙箱'; update(v);
      const data = await request('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      v.sessionId = data.sessionId; v.status = v.running || v.submitting ? 'Pi 执行中' : '已连接';
      const stream = new EventSource(`/api/sessions/${v.sessionId}/events`); v.stream = stream;
      stream.onmessage = (event) => { try { render(v, JSON.parse(event.data)); } catch (error) { console.error('Event rendering failed', error); toast('执行记录显示异常，请刷新后重试'); } };
      stream.onopen = () => { if (v.status === '连接中断，正在重连') { v.status = v.priorStatus || '已连接'; update(v); } };
      stream.onerror = () => { if (v.status !== '连接中断，正在重连') v.priorStatus = v.status; v.status = '连接中断，正在重连'; update(v); };
      update(v);
    })().finally(() => { v.creating = undefined; });
    return v.creating;
  }
  async function upload(v, file) {
    if (!file || v.running || v.uploading) return false;
    v.selectedFile = file; v.uploading = true; v.fileStatus = `正在上传：${file.name}…`; update(v);
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('单个文件不能超过 10 MB');
      await ensureSession(v);
      const form = new FormData(); form.append('file', file);
      const data = await request(`/api/sessions/${v.sessionId}/files`, { method: 'POST', body: form });
      for (let i = 0; i < data.uploaded.length; i++) {
        const input = { filename: data.uploaded[i], path: data.paths[i], size: file.size };
        const existing = v.inputs.findIndex((f) => f.path === input.path); if (existing >= 0) v.inputs[existing] = input; else v.inputs.push(input);
      }
      v.fileStatus = `已自动上传：${data.uploaded[0]}（沙箱路径：${data.paths[0]}）`; v.selectedFile = undefined;
      message(v, `文件已上传：${data.uploaded[0]}\n沙箱路径：${data.paths[0]}`, 'notice', 'sandbox');
      renderFiles(v); return true;
    } catch (error) { v.fileStatus = `上传失败：${error.message} · 点击重试上传`; message(v, v.fileStatus, 'notice error', 'orchestrator'); return false; }
    finally { v.uploading = false; if (v === active) $('file').value = ''; update(v); }
  }
  $('choose-file').onclick = () => $('file').click();
  $('file').onchange = () => { const v = active, file = $('file').files[0]; if (file) v.uploadPromise = upload(v, file); };
  $('upload').onclick = () => { const v = active; v.uploadPromise = upload(v, v.selectedFile); };
  $('send').onclick = async () => {
    const v = active;
    if (v.running || v.submitting || v.uploading) return;
    const text = $('prompt').value.trim(); if (!text) { $('prompt').focus(); toast('先描述一下需要完成的任务'); return; }
    v.submitting = true; update(v);
    try {
      if (v.uploadPromise && !(await v.uploadPromise)) { toast('请先重试上传，或重新选择文件'); return; }
      await ensureSession(v);
      message(v, text, 'user'); v.draft = ''; if (active === v) { $('prompt').value = ''; resizePrompt(); }
      if (!v.renamed && v.title === '新对话') v.title = text.length > 22 ? `${text.slice(0, 22)}…` : text;
      v.status = 'Pi 执行中'; update(v);
      await request(`/api/sessions/${v.sessionId}/prompts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: text }) });
    } catch (error) { message(v, error.message, 'notice error', 'orchestrator'); v.status = '提交失败'; v.running = false; v.draft = text; if (v === active) { $('prompt').value = text; resizePrompt(); } }
    finally { v.submitting = false; update(v); }
  };
  $('abort').onclick = async () => {
    const v = active; if (!v.sessionId || v.stopping) return; v.stopping = true; update(v);
    try { await request(`/api/sessions/${v.sessionId}/abort`, { method: 'POST' }); }
    catch (error) { message(v, error.message, 'notice error', 'orchestrator'); }
    finally { v.stopping = false; update(v); }
  };
  function resizePrompt() { $('prompt').style.height = 'auto'; $('prompt').style.height = `${Math.min(160, Math.max(70, $('prompt').scrollHeight))}px`; }
  $('prompt').oninput = () => { active.draft = $('prompt').value; resizePrompt(); };
  $('prompt').onkeydown = (event) => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('send').click(); } };

  function commandText(args) {
    if (args && typeof args === 'object') {
      if (typeof args.command === 'string') return `$ ${args.command}`;
      if (typeof args.code === 'string') return args.code;
      if (typeof args.path === 'string' && typeof args.content === 'string') return `${args.path}\n\n${args.content}`;
    }
    return json(args);
  }
  function resultText(result) {
    const readable = (text) => { try { return json(JSON.parse(text)); } catch { return text; } };
    if (result && typeof result === 'object' && Array.isArray(result.content)) return result.content.map((part) => typeof part.text === 'string' ? readable(part.text) : part.type === 'image' ? '[图片输出，请查看文件面板]' : json(part)).join('\n');
    if (result && typeof result === 'object' && ('stdout' in result || 'stderr' in result)) return [result.stdout, result.stderr && `STDERR\n${result.stderr}`, result.exitCode !== undefined && `\nExit code: ${result.exitCode}`].filter((part) => part !== undefined && part !== false && part !== '').join('\n');
    return json(result);
  }
  function createTool(v, event) {
    const tool = { id: event.toolCallId, name: event.name, executor: event.executor, args: event.args, at: event.at, status: event.type === 'tool_finished' ? event.status : 'running', raw: false, el: node('article', 'tool') };
    const header = node('div', 'tool-header'), heading = node('div', 'tool-heading');
    heading.append(node('strong', '', tool.name), node('time', '', `${new Date(tool.at).toLocaleDateString('zh-CN')} ${time(tool.at)}`)); tool.badge = node('span', 'tool-badge');
    const switcher = node('div', 'view-switch'); switcher.setAttribute('role', 'group'); switcher.setAttribute('aria-label', '工具输出视图');
    tool.uiButton = node('button', 'active', 'UI'); tool.rawButton = node('button', '', 'RAW');
    tool.uiButton.onclick = () => { tool.raw = false; updateTool(tool); }; tool.rawButton.onclick = () => { tool.raw = true; updateTool(tool); };
    switcher.append(tool.uiButton, tool.rawButton); header.append(heading, tool.badge, switcher);
    const content = node('div', 'tool-content'), executor = node('div', 'tool-executor'); executor.append(icon('terminal'), node('span', '', tool.executor));
    tool.ui = node('div'); const commandLabel = node('div', 'code-heading'); commandLabel.append(icon('terminal'), node('span', '', 'COMMAND / INPUT'));
    tool.command = node('pre', 'command', commandText(tool.args)); const outputLabel = node('div', 'code-heading'); outputLabel.append(icon('clock'), node('span', '', 'OUTPUT'));
    tool.output = node('pre', 'output'); tool.ui.append(commandLabel, tool.command, outputLabel, tool.output);
    tool.rawOutput = node('pre', 'raw-output'); tool.rawOutput.hidden = true;
    content.append(executor, tool.ui, tool.rawOutput, node('div', 'tool-note', '展示 Pi 返回的真实工具记录；模型回答见左侧对话。'));
    tool.el.append(header, content); v.toolRoot.append(tool.el);
    const activity = node('div', 'tool-activity'); tool.chip = node('button', 'tool-chip running');
    tool.chip.onclick = () => showTool(v, v.tools.indexOf(tool), true); activity.append(tool.chip, node('span', 'activity-caption', tool.executor)); v.chat.append(activity);
    v.tools.push(tool); v.toolMap.set(tool.id, tool); if (v.followLatest) v.selection = v.tools.length - 1;
    return tool;
  }
  function updateTool(tool) {
    const waiting = tool.status === 'running', failed = tool.status === 'error';
    tool.badge.className = `tool-badge ${waiting ? 'running' : failed ? 'error' : ''}`;
    tool.badge.replaceChildren(icon(waiting ? 'clock' : failed ? 'error' : 'check'), node('span', '', waiting ? 'Running' : failed ? 'Failed' : 'Completed'));
    tool.chip.className = `tool-chip ${waiting ? 'running' : failed ? 'error' : ''}`; tool.chip.replaceChildren(icon(waiting ? 'clock' : failed ? 'error' : 'check'), node('span', '', tool.name));
    tool.ui.hidden = tool.raw; tool.rawOutput.hidden = !tool.raw;
    tool.uiButton.classList.toggle('active', !tool.raw); tool.rawButton.classList.toggle('active', tool.raw); tool.uiButton.setAttribute('aria-pressed', String(!tool.raw)); tool.rawButton.setAttribute('aria-pressed', String(tool.raw));
    const output = tool.result === undefined ? '等待工具输出…' : resultText(tool.result);
    tool.output.textContent = output.length > 24000 ? `${output.slice(0, 24000)}\n\n…输出较长，UI 已截断；RAW 中保留完整事件。` : output;
    tool.rawOutput.textContent = json({ toolCallId: tool.id, name: tool.name, executor: tool.executor, at: tool.at, status: tool.status, args: tool.args, result: tool.result });
  }
  function artifactCard(v, artifact) {
    const el = node('article', 'artifact'), heading = node('div', 'artifact-title'); heading.append(icon('file'), node('span', '', artifact.filename));
    el.append(heading, node('div', 'file-path', `沙箱路径：${artifact.path}`), node('div', 'file-meta', `${bytes(artifact.size)} · 来源：E2B 沙箱`));
    const actions = node('div', 'artifact-actions'), link = node('a', '', '下载结果文件'); link.prepend(icon('download'));
    link.href = `/api/artifacts/${encodeURIComponent(artifact.artifactId)}?sessionId=${encodeURIComponent(v.sessionId)}`; link.download = artifact.filename; actions.append(link);
    if (artifact.contentType.startsWith('image/') || /text\/|application\/json/.test(artifact.contentType)) {
      const button = node('button', '', '预览'); let preview;
      button.onclick = async () => {
        if (preview) { preview.hidden = !preview.hidden; button.textContent = preview.hidden ? '预览' : '收起预览'; return; }
        button.disabled = true;
        try {
          const url = `${link.href}&preview=1`;
          if (artifact.contentType.startsWith('image/')) { preview = node('img'); preview.src = url; preview.alt = artifact.filename; }
          else { const response = await fetch(url); if (!response.ok) throw new Error('预览失败'); const text = await response.text(); preview = node('pre', '', text.slice(0, 20000) + (text.length > 20000 ? '\n…预览已截断，下载可查看完整文件。' : '')); }
          el.append(preview); button.textContent = '收起预览';
        } catch (error) { toast(error.message); } finally { button.disabled = false; }
      }; actions.append(button);
    }
    const hash = node('details'); hash.append(node('summary', '', 'SHA-256 文件指纹'), node('div', 'file-path', artifact.sha256)); el.append(actions, hash); return el;
  }
  function renderFiles(v) {
    v.files.replaceChildren(); v.attachments.replaceChildren();
    if (!v.inputs.length && !v.artifacts.length) { v.files.append(node('div', 'panel-placeholder', '还没有文件。\n上传的附件和生成的成果会显示在这里。')); return; }
    if (v.inputs.length) {
      v.files.append(node('div', 'file-section-label', `输入文件 · ${v.inputs.length}`));
      for (const file of v.inputs) {
        const el = node('div', 'input-file'); el.append(node('strong', '', file.filename), node('div', 'file-path', file.path), node('div', 'file-meta', `${bytes(file.size)} · 已上传到 E2B 沙箱`)); v.files.append(el);
        const chip = node('button', 'attachment-chip'); chip.append(icon('file'), node('span', '', file.filename), icon('check')); chip.title = file.path; chip.onclick = () => { if (v === active) { setTab('files'); if (innerWidth <= 760) { document.body.classList.add('tools-open'); updateOverlay(); } } }; v.attachments.append(chip);
      }
    }
    if (v.artifacts.length) { v.files.append(node('div', 'file-section-label', `生成成果 · ${v.artifacts.length}`)); for (const artifact of v.artifacts) v.files.append(artifactCard(v, artifact)); }
  }
  function render(v, event) {
    if (event.eventId && event.eventId <= v.lastEventId) return;
    v.lastEventId = event.eventId || v.lastEventId;
    const follow = v === active && atBottom();
    if (v.audit.querySelector('.panel-placeholder')) v.audit.replaceChildren();
    const audit = node('div', 'audit-entry'); audit.append(node('strong', '', event.type), node('time', '', time(event.at)));
    const details = node('details'); details.append(node('summary', '', `${labels[event.source] || event.source} · 查看原始事件`), node('pre', '', json(event))); audit.append(details); v.audit.append(audit);
    if (event.type === 'run_started') { v.running = true; v.status = 'Pi 执行中'; }
    if (event.type === 'run_settled') {
      v.running = false; v.status = event.aborted ? '已停止' : event.ok ? '已完成' : '执行失败';
      // An interrupted call may have no tool_finished event; don't invent success.
      for (const tool of v.tools) if (tool.status === 'running') { tool.status = 'error'; tool.result ??= { message: event.aborted ? '任务已停止，未收到完整工具结果' : '任务已结束，未收到完整工具结果' }; updateTool(tool); }
    }
    if (['assistant_start', 'assistant_delta', 'assistant_message'].includes(event.type)) {
      let entry = v.messages.get(event.messageId);
      if (!entry) { const el = message(v, '', 'assistant', 'pi-model'); el.hidden = true; entry = { el, text: '' }; v.messages.set(event.messageId, entry); }
      if (event.type === 'assistant_delta') entry.text += event.delta;
      if (event.type === 'assistant_message') entry.text = event.text;
      entry.el.hidden = !entry.text; markdown(entry.el.querySelector('.body'), entry.text);
    }
    if (['tool_started', 'tool_update', 'tool_finished'].includes(event.type)) {
      const tool = v.toolMap.get(event.toolCallId) || createTool(v, event);
      if (event.type === 'tool_finished') tool.status = event.status;
      if ('result' in event) tool.result = event.result;
      updateTool(tool);
    }
    if (event.type === 'artifact_ready' && !v.artifacts.some((a) => a.artifactId === event.artifact.artifactId)) { v.artifacts.push(event.artifact); v.chat.append(artifactCard(v, event.artifact)); renderFiles(v); }
    if (event.type === 'web_source') {
      const el = node('article', 'web-source'); el.append(node('div', 'source', '来源：联网检索'));
      const url = safeUrl(event.page.url);
      if (url) { const link = node('a', '', `${event.page.title}\n${event.page.url}`); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; el.append(link); }
      el.append(node('div', 'body', `网页正文已获取（${event.page.characters} 字符）\n来源域名：${event.page.domain}\n本次访问：${event.page.accessedAt}\n${event.page.cached ? '内容来自抓取缓存，发布时间需另核实' : '本次实际抓取'}`)); v.chat.append(el);
    }
    if (event.type === 'validation_finished') {
      const el = message(v, `校验${event.report.ok ? '通过' : '失败'} · ${event.report.kind}`, event.report.ok ? 'notice' : 'notice error', 'validator');
      const report = node('details'); report.append(node('summary', '', '查看校验明细'), node('pre', '', json(event.report))); el.append(report);
    }
    if (event.type === 'run_failed') message(v, event.message, 'notice error', 'orchestrator');
    update(v); scrollAfter(v, follow);
  }

  function toast(text) { clearTimeout(toastTimer); $('toast').textContent = text; $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3200); }
  function updateOverlay() {
    const navOpen = document.body.classList.contains('nav-open'), toolsOpen = document.body.classList.contains('tools-open');
    $('overlay').hidden = !navOpen && !(innerWidth <= 760 && toolsOpen);
    $('inspector').inert = innerWidth <= 760 && !toolsOpen;
    document.querySelector('.sidebar').inert = innerWidth <= 760 && !navOpen;
  }
  function closePanels() { document.body.classList.remove('nav-open', 'tools-open'); updateOverlay(); }
  $('new-chat').onclick = () => { const draft = views.find((v) => !v.sessionId && !v.creating && !v.chat.childElementCount && !v.draft); selectView(draft || newView()); $('prompt').focus(); };
  $('rename-chat').onclick = () => { const title = window.prompt('为这段对话起个名字', active.title); if (title?.trim()) { active.title = title.trim().slice(0, 80); active.renamed = true; update(active); } };
  $('copy-chat').onclick = async () => { try { await navigator.clipboard.writeText(active.chat.innerText); toast('对话已复制'); } catch { toast('复制失败，请手动选择对话内容复制'); } };
  $('collapse-nav').onclick = () => { if (innerWidth <= 950) closePanels(); else document.body.classList.add('nav-collapsed'); };
  $('toggle-nav').onclick = () => { if (innerWidth <= 950) { document.body.classList.toggle('nav-open'); updateOverlay(); } else document.body.classList.remove('nav-collapsed'); };
  $('toggle-tools').onclick = () => { document.body.classList.add('tools-open'); updateOverlay(); $('close-tools').focus(); };
  $('close-tools').onclick = () => { closePanels(); $('toggle-tools').focus(); }; $('overlay').onclick = closePanels;
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closePanels(); }); window.addEventListener('resize', updateOverlay);
  document.querySelectorAll('[data-prompt]').forEach((button) => { button.onclick = () => { $('prompt').value = button.dataset.prompt; active.draft = $('prompt').value; resizePrompt(); $('prompt').focus(); }; });
  document.querySelectorAll('[data-tab]').forEach((button, index, tabs) => {
    button.onclick = () => setTab(button.dataset.tab);
    button.onkeydown = (event) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length; tabs[next].click(); tabs[next].focus(); } };
  });
  $('previous-tool').onclick = () => showTool(active, active.selection - 1); $('next-tool').onclick = () => showTool(active, active.selection + 1); $('tool-position').oninput = () => showTool(active, Number($('tool-position').value));
  window.addEventListener('pagehide', () => { for (const view of views) view.stream?.close(); });
  selectView(newView());
})();
