// jsdom 回归：发送、流式、版本切换、编辑保留旧版本、主题、错误
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'www/index.html'), 'utf8');
const code = fs.readFileSync(path.join(ROOT, 'www/app.js'), 'utf8');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + e.message));
vc.on('error', (m) => errors.push('console.error: ' + m));

function sse(text, withTool) {
  const ev = [];
  const push = (o) => ev.push('event: ' + o.type + '\ndata: ' + JSON.stringify(o) + '\n\n');
  push({ type: 'message_start', message: { id: 'm1', usage: { input_tokens: 100, output_tokens: 1 } } });
  push({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } });
  push({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '想一下关键点。' } });
  push({ type: 'content_block_stop', index: 0 });
  let idx = 1;
  if (withTool) {
    push({ type: 'content_block_start', index: idx, content_block: { type: 'server_tool_use', id: 't1', name: 'deepseek_web_search', kind: 'search', input: { action: 'search', queries: ['查询一', '查询二'] } } });
    push({ type: 'content_block_stop', index: idx });
    push({ type: 'content_block_start', index: idx + 1, content_block: { type: 'web_search_tool_result', tool_use_id: 't1', kind: 'search', content: [{ type: 'web_search_result', title: '来源甲', url: 'https://example.com/a', snippet: 'x' }] } });
    push({ type: 'content_block_stop', index: idx + 1 });
    idx += 2;
  }
  push({ type: 'content_block_start', index: idx, content_block: { type: 'text', text: '' } });
  for (let i = 0; i < text.length; i += 5) {
    push({ type: 'content_block_delta', index: idx, delta: { type: 'text_delta', text: text.slice(i, i + 5) } });
  }
  if (withTool) push({ type: 'content_block_delta', index: idx, delta: { type: 'citations_delta', citation: { url: 'https://example.com/a', title: '来源甲' } } });
  push({ type: 'content_block_stop', index: idx });
  push({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 2000, output_tokens: 300, cache_read_input_tokens: 1000 } });
  push({ type: 'message_stop' });
  return ev.join('');
}

async function main() {
  const dom = new JSDOM(html, {
    url: 'https://appassets.androidplatform.net/assets/index.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: vc
  });
  const { window } = dom;
  window.TextDecoder = TextDecoder;
  window.ReadableStream = ReadableStream;
  window.AbortController = AbortController;

  let mode = 'ok';
  let call = 0;
  let lastBody = null;
  window.fetch = async (url, opts) => {
    if (mode === '401') {
      return { ok: false, status: 401, text: async () => '{"error":{"message":"Authentication Fails"}}' };
    }
    call++;
    lastBody = JSON.parse(opts.body);
    const body = sse('第 ' + call + ' 版回答。**加粗** 与 `行内代码`。\n\n## 小标题\n\n```js\nconst x = 1;\n```\n\n结论正常[1]。\n', call === 1);
    const bytes = new TextEncoder().encode(body);
    let i = 0;
    const stream = new ReadableStream({
      pull(c) {
        if (i >= bytes.length) { c.close(); return; }
        c.enqueue(bytes.slice(i, i + 40));
        i += 40;
      }
    });
    return { ok: true, status: 200, body: stream };
  };

  window.eval(code);
  await new Promise((r) => setTimeout(r, 400));

  const doc = window.document;
  const key = doc.getElementById('setKey');
  key.value = 'sk-test';
  key.dispatchEvent(new window.Event('input'));

  const input = doc.getElementById('input');
  input.value = '原始提问';
  doc.getElementById('btnSend').click();
  await new Promise((r) => setTimeout(r, 1600));

  const msgs = doc.getElementById('messages');
  console.log('--- 第一轮 ---');
  console.log(JSON.stringify({
    'AI 气泡': !!msgs.querySelector('.msg.ai'),
    '标题': doc.getElementById('chatTitle').textContent,
    '思考块': !!msgs.querySelector('details.think'),
    '工具条': (msgs.querySelector('.tool .t') || {}).textContent,
    '来源数': msgs.querySelectorAll('.src').length,
    '引用角标': !!msgs.querySelector('sup.cite'),
    '代码块': !!msgs.querySelector('.md pre code'),
    '版本器': (msgs.querySelector('.vers .vnum') || {}).textContent,
    '花费': (msgs.querySelector('.fmeta') || {}).textContent
  }, null, 2));

  // 重新生成 → 回答 2 版（只有回答版本器）
  doc.querySelector('[data-act="regen"]').click();
  await new Promise((r) => setTimeout(r, 1500));
  console.log('--- 重新生成 ---');
  console.log('回答版本器:', (doc.querySelector('.vers .vnum') || {}).textContent,
    '| 问题版本器:', (doc.querySelector('.qvers .qnum') || {}).textContent || '无（正确）');

  // 编辑 → 问题 2 版，回答各 1 版
  doc.querySelector('[data-act="edit"]').click();
  await new Promise((r) => setTimeout(r, 120));
  doc.getElementById('editText').value = '改过的提问';
  doc.getElementById('btnEditSave').click();
  await new Promise((r) => setTimeout(r, 1500));
  const st = JSON.parse(window.localStorage.getItem('deepchat.v4'));
  const turn = st.conversations[0].turns[0];
  console.log('--- 编辑 ---');
  console.log('问题版本:', turn.questions.length, '| 当前问题:', turn.activeQ + 1,
    '| 问题列表:', turn.questions.map((q) => q.q).join(' / '));
  console.log('当前问题的回答数:', turn.questions[turn.activeQ].answers.length);
  console.log('界面: 问题', (doc.querySelector('.qvers .qnum') || {}).textContent,
    '| 回答器', (doc.querySelector('.vers .vnum') || {}).textContent || '无（正确）');

  // 切回第 1 个问题
  doc.querySelector('[data-act="qprev"]').click();
  await new Promise((r) => setTimeout(r, 150));
  console.log('切到问题 1:', doc.querySelector('.qvers .qnum').textContent,
    '| 气泡:', doc.querySelector('.msg.user .body').textContent,
    '| 回答版本器:', (doc.querySelector('.vers .vnum') || {}).textContent, '(应为 1/2)');

  // 会话菜单：收藏 → 删除被禁用
  doc.getElementById('btnMenu').click();
  await new Promise((r) => setTimeout(r, 100));
  doc.querySelector('[data-act="more"]').click();
  await new Promise((r) => setTimeout(r, 100));
  const items = [...doc.querySelectorAll('#convMenuBody .menu-item')];
  console.log('--- 会话菜单 ---');
  console.log('菜单项:', items.map((b) => b.textContent.trim()).join(' / '));
  items[1].click(); // 收藏
  await new Promise((r) => setTimeout(r, 100));
  doc.querySelector('[data-act="more"]').click();
  await new Promise((r) => setTimeout(r, 100));
  const items2 = [...doc.querySelectorAll('#convMenuBody .menu-item')];
  const del = items2[items2.length - 1];
  console.log('收藏后删除按钮禁用:', del.disabled, '| 提示:', (doc.querySelector('.menu-hint') || {}).textContent);

  // 主题
  doc.querySelector('#themeSeg [data-theme="light"]').click();
  await new Promise((r) => setTimeout(r, 60));
  console.log('--- 主题 ---');
  console.log('data-theme:', doc.documentElement.getAttribute('data-theme'));

  // 模型卡片
  doc.querySelector('.modelcard[data-model="deepseek-v4-pro"]').click();
  console.log('模型切换:', doc.querySelector('.modelcard.active .mc-name').textContent);

  // 错误路径
  mode = '401';
  input.value = '再问一次';
  doc.getElementById('btnSend').click();
  await new Promise((r) => setTimeout(r, 800));
  console.log('--- 错误 ---');
  const err = doc.querySelector('.err');
  console.log('提示:', err ? err.textContent.slice(0, 60) : '无');
  console.log('页面异常:', errors.length ? errors.slice(0, 3) : '无');
}

main().catch((e) => { console.error('TEST FAIL', e); process.exit(1); });
