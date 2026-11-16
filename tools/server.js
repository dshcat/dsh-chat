// 本地联调服务：8081 静态站，8099 假 Anthropic 流式接口
const http = require('http');
const fs = require('fs');
const path = require('path');

const WWW = path.join(__dirname, '..', 'www');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8' };

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(WWW, p);
  if (!file.startsWith(WWW) || !fs.existsSync(file)) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(8081, '127.0.0.1', () => console.log('static http://127.0.0.1:8081'));

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, x-api-key, anthropic-version',
  'access-control-allow-methods': 'POST, OPTIONS'
};

function sse(res, obj) {
  res.write('event: ' + obj.type + '\n');
  res.write('data: ' + JSON.stringify(obj) + '\n\n');
}

const THINK = '先确认这个页面的目的：验证流式渲染、思考块、搜索工具条和引用角标。再构造一段带代码块的回复。';

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  if (!req.url.includes('/v1/messages')) { res.writeHead(404, cors); res.end('{}'); return; }

  res.writeHead(200, Object.assign({
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive'
  }, cors));

  const plan = [
    { type: 'message_start', message: { id: 'msg_mock', usage: { input_tokens: 120, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'server_tool_use', id: 'srvtoolu_1', name: 'deepseek_web_search', kind: 'search', input: { action: 'search', queries: ['测试查询一', '测试查询二'] } } },
    { type: 'content_block_stop', index: 1 },
    {
      type: 'content_block_start', index: 2, content_block: {
        type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', kind: 'search', content: [
          { type: 'web_search_result', title: '示例来源一：DeepSeek 文档', url: 'https://api-docs.deepseek.com/zh-cn/', snippet: '官方文档', site_name: 'DeepSeek' },
          { type: 'web_search_result', title: '示例来源二：GitHub chat-demo', url: 'https://github.com/deepseek-ai/chat-demo', snippet: '开源 Demo', site_name: 'GitHub' }
        ]
      }
    },
    { type: 'content_block_stop', index: 2 },
    { type: 'content_block_start', index: 3, content_block: { type: 'text', text: '' } }
  ];

  const text = '## 界面自检\n\n这是一条**假的流式回复**，用来检查排版。\n\n- 思考块、工具条、引用角标都在\n- 下面还有一个代码块：\n\n```js\nconst x = 1; // 代码块渲染\n```\n\n结论：布局工作正常[1]，其他来源见底部[2]。\n';

  let step = 0, ti = 0, thinkI = 0;
  const timer = setInterval(() => {
    if (step < plan.length) {
      const ev = plan[step++];
      sse(res, ev);
      if (ev.type === 'content_block_start' && ev.content_block.type === 'thinking') {
        // 紧接着吐思考内容
        setTimeout(() => {
          const chunk = THINK.slice(thinkI, thinkI + 10);
          thinkI += 10;
          sse(res, { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: chunk } });
        }, 10);
      }
      return;
    }
    if (ti < text.length) {
      const chunk = text.slice(ti, ti + 7);
      ti += 7;
      sse(res, { type: 'content_block_delta', index: 3, delta: { type: 'text_delta', text: chunk } });
      return;
    }
    sse(res, { type: 'content_block_delta', index: 3, delta: { type: 'citations_delta', citation: { type: 'web_search_result_location', url: 'https://api-docs.deepseek.com/zh-cn/', title: 'DeepSeek 文档' } } });
    sse(res, { type: 'content_block_delta', index: 3, delta: { type: 'citations_delta', citation: { type: 'web_search_result_location', url: 'https://github.com/deepseek-ai/chat-demo', title: 'GitHub chat-demo' } } });
    sse(res, { type: 'content_block_stop', index: 3 });
    sse(res, { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 2100, output_tokens: 380, cache_read_input_tokens: 1500 } });
    sse(res, { type: 'message_stop' });
    clearInterval(timer);
    res.end();
  }, 70);

  req.on('close', () => clearInterval(timer));
}).listen(8099, '127.0.0.1', () => console.log('mock api http://127.0.0.1:8099'));
