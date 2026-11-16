// 用 jsdom 跑一遍前端逻辑：初始化、发送、流式渲染、错误处理
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

function sseBody(text) {
  const ev = [];
  const push = (o) => ev.push('event: ' + o.type + '\ndata: ' + JSON.stringify(o) + '\n\n');
  push({ type: 'message_start', message: { id: 'm1', usage: { input_tokens: 100, output_tokens: 1 } } });
  push({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } });
  push({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '先想一想这个问题的关键。' } });
  push({ type: 'content_block_stop', index: 0 });
  push({
    type: 'content_block_start', index: 1,
    content_block: { type: 'server_tool_use', id: 'tool_1', name: 'deepseek_web_search', kind: 'search', input: { action: 'search', queries: ['查询一', '查询二'] } }
  });
  push({ type: 'content_block_stop', index: 1 });
  push({
    type: 'content_block_start', index: 2,
    content_block: {
      type: 'web_search_tool_result', tool_use_id: 'tool_1', kind: 'search',
      content: [{ type: 'web_search_result', title: '来源甲', url: 'https://example.com/a', snippet: 'x' }]
    }
  });
  push({ type: 'content_block_stop', index: 2 });
  push({ type: 'content_block_start', index: 3, content_block: { type: 'text', text: '' } });
  for (let i = 0; i < text.length; i += 5) {
    push({ type: 'content_block_delta', index: 3, delta: { type: 'text_delta', text: text.slice(i, i + 5) } });
  }
  push({ type: 'content_block_delta', index: 3, delta: { type: 'citations_delta', citation: { url: 'https://example.com/a', title: '来源甲' } } });
  push({ type: 'content_block_stop', index: 3 });
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
  window.Request = Request;
  window.AbortController = AbortController;

  let mode = 'ok';
  window.fetch = async (url, opts) => {
    if (mode === '401') {
      return { ok: false, status: 401, text: async () => '{"error":{"message":"Authentication Fails"}}' };
    }
    const body = sseBody('## 自检\n\n**加粗** 与 `行内代码`。\n\n```js\nconst x = 1;\n```\n\n结论正常[1]。\n');
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
  input.value = '你好，测试一下';
  doc.getElementById('btnSend').click();

  await new Promise((r) => setTimeout(r, 2500));

  const msgs = doc.getElementById('messages');
  const out = msgs.innerHTML;
  const checks = {
    'AI 气泡': !!msgs.querySelector('.msg.ai'),
    '用户气泡': !!msgs.querySelector('.msg.user'),
    '标题': doc.getElementById('chatTitle').textContent,
    '思考块': !!msgs.querySelector('details.think'),
    '工具条': (msgs.querySelectorAll('.tool') || []).length,
    '工具文案': (msgs.querySelector('.tool .t') || {}).textContent,
    '来源数': (msgs.querySelectorAll('.src') || []).length,
    '引用角标': !!msgs.querySelector('sup.cite'),
    'H2': !!msgs.querySelector('.md h2'),
    '加粗': !!msgs.querySelector('.md strong'),
    '代码块': !!msgs.querySelector('.md pre code'),
    '花费': (msgs.querySelector('.meta span') || {}).textContent,
    '停止按钮复位': !doc.getElementById('btnSend').classList.contains('busy'),
    '错误未出现': !msgs.querySelector('.err')
  };
  console.log('--- 正常流程 ---');
  console.log(JSON.stringify(checks, null, 2));
  console.log('存储会话数:', JSON.parse(window.localStorage.getItem('deepchat.v2') || '{}').conversations?.length);

  // 版本切换
  const regen = doc.querySelector('[data-act="regen"]');
  if (regen) {
    regen.click();
    await new Promise((r) => setTimeout(r, 1800));
  }
  const vers = doc.querySelector('.vers');
  console.log('--- 版本 ---');
  console.log('切换器:', vers ? vers.textContent.replace(/\s+/g, ' ').trim() : '无');
  const prev = vers && vers.querySelector('[data-act="vprev"]');
  if (prev && !prev.disabled) prev.click();
  await new Promise((r) => setTimeout(r, 100));
  console.log('切回后:', (doc.querySelector('.vers .vnum') || {}).textContent);

  // 主题
  doc.querySelector('#themeSeg [data-theme="light"]').click();
  await new Promise((r) => setTimeout(r, 50));
  console.log('--- 主题 ---');
  console.log('data-theme:', doc.documentElement.getAttribute('data-theme'));
  console.log('背景色样式:', doc.body.style.backgroundColor || '（主题默认）');

  // 错误路径
  mode = '401';
  const input2 = doc.getElementById('input');
  input2.value = '再问一次';
  doc.getElementById('btnSend').click();
  await new Promise((r) => setTimeout(r, 800));
  const errBox = doc.querySelector('.err');
  console.log('--- 错误流程 ---');
  console.log('错误提示:', errBox ? errBox.textContent.slice(0, 80) : '无');
  console.log('页面异常:', errors.length ? errors.slice(0, 3) : '无');
}

main().catch((e) => { console.error('TEST FAIL', e); process.exit(1); });
