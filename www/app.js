/* DeepChat 2.1 — 自用 / 可公开分发的移动端 DeepSeek 客户端
 * 每个提问保留全部回答版本，可无限次编辑与重生成，用 ‹ n / m › 来回切。 */
(function () {
  'use strict';

  var LS = 'deepchat.v3';
  var LS_OLD = ['deepchat.v2', 'deepchat.v1'];
  var APP_VERSION = '2.1.0';
  var API_PATH = '/anthropic/v1/messages';
  var MAX_TOKENS = 8192;

  var PRESETS = [
    { name: '日常助手', text: '你是我手机里的私人助手。说话直接、有判断：能一句话说清就不写三段；不确定就说不确定，不要编。默认中文回答。不要客套开场白，直接给答案。' },
    { name: '私人老师', text: '你是我的私人老师。先给结论，再用一个具体例子讲清原理，最后给我一道能立刻动手的小练习。我答错时直接指出错在哪，不要顺毛夸。' },
    { name: '工程师', text: '你是资深工程师，说话像同事。先给能跑的代码，再讲关键点和坑。不确定的 API 标注「待核实」，不要编造。代码注释简短、中文。' },
    { name: '中文编辑', text: '你是我的中文编辑。帮我把文字改得干净、有节奏，保留我的意思和语气，删掉空话套话。先给修改版，再用三行说明改了什么、为什么。' }
  ];

  var BG_PRESETS = ['#0f1115', '#1b2430', '#22303c', '#2a2440', '#3a2f2a', '#f5f6f9', '#eef2ff', '#fdf2f8'];

  var PRICE = {
    'deepseek-flash': { miss: 1, hit: 0.02, out: 4 },
    'deepseek-v4-pro': { miss: 4.5, hit: 0.15, out: 13.5 }
  };

  var ICON = {
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
    globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg>',
    link: '<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
    retry: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M14 6l4 4"/></svg>'
  };

  var state = { settings: null, conversations: [], activeId: null, abort: null, streaming: false, editing: null };

  /* ---------- 存取 ---------- */
  function defaults() {
    return {
      settings: {
        apiKey: '', model: 'deepseek-flash', base: 'https://api.deepseek.com',
        system: PRESETS[0].text, think: true, search: true,
        theme: 'auto', bg: { kind: 'none' }
      },
      conversations: [], activeId: null
    };
  }

  function newAi() {
    return {
      ts: Date.now(), text: '', thinking: '', blocks: [], sources: [], srcIndex: {},
      tools: [], usage: null, cost: 0, error: null, stopReason: null, streaming: false
    };
  }

  function makeVersion(q, a) {
    return { q: q || '', ts: Date.now(), a: a || newAi() };
  }

  function normalizeTurn(t) {
    if (Array.isArray(t.versions) && t.versions.length) {
      t.active = Math.min(t.active || 0, t.versions.length - 1);
      return t;
    }
    var versions = [];
    if (Array.isArray(t.variants)) {
      // v2 结构：user + variants[]
      var q = (t.user && t.user.content) || '';
      t.variants.forEach(function (v) {
        var a = Object.assign(newAi(), v);
        versions.push({ q: q, ts: v.ts || Date.now(), a: a });
      });
    } else if (t.user) {
      versions.push(makeVersion(t.user.content, newAi()));
    }
    if (!versions.length) versions.push(makeVersion('', newAi()));
    t.versions = versions;
    t.active = Math.min(t.active || 0, versions.length - 1);
    delete t.user; delete t.variants;
    return t;
  }

  function migrate(c) {
    if (!Array.isArray(c.turns)) {
      // v1：messages[] 平铺
      var turns = [], pending = null;
      (c.messages || []).forEach(function (m) {
        if (m.role === 'user') {
          pending = { id: uid(), active: 0, versions: [] };
          pending.versions.push(makeVersion(m.content, newAi()));
          turns.push(pending);
        } else if (m.role === 'assistant' && pending) {
          var a = Object.assign(newAi(), {
            ts: m.ts, text: m.text || '', thinking: m.thinking || '', blocks: m.blocks || [],
            sources: m.sources || [], srcIndex: m.srcIndex || {}, tools: m.tools || [],
            usage: m.usage || null, cost: m.cost || 0, error: m.error || null
          });
          pending.versions[pending.versions.length - 1].a = a;
          pending = null;
        }
      });
      c.turns = turns;
      delete c.messages;
      return c;
    }
    c.turns.forEach(normalizeTurn);
    return c;
  }

  function load() {
    var d = defaults(), raw = null;
    try { raw = localStorage.getItem(LS); } catch (e) {}
    if (!raw) {
      for (var i = 0; i < LS_OLD.length && !raw; i++) {
        try { raw = localStorage.getItem(LS_OLD[i]); } catch (e) {}
      }
    }
    state.settings = d.settings;
    if (!raw) return;
    try {
      var o = JSON.parse(raw);
      state.settings = Object.assign(d.settings, o.settings || {});
      state.conversations = (o.conversations || []).map(migrate);
      state.activeId = o.activeId || null;
    } catch (e) {}
    if (!state.settings.bg) state.settings.bg = { kind: 'none' };
    if (!state.conversations.length) state.activeId = null;
    if (state.activeId && !findConv(state.activeId)) state.activeId = null;
  }

  var saveTimer = null;
  function save(now) {
    function write() {
      try {
        localStorage.setItem(LS, JSON.stringify({
          settings: state.settings, conversations: state.conversations, activeId: state.activeId
        }));
      } catch (e) { toast('本地空间满了，背景图可能太大'); }
    }
    clearTimeout(saveTimer);
    if (now) { write(); return; }
    saveTimer = setTimeout(write, 250);
  }

  function findConv(id) {
    for (var i = 0; i < state.conversations.length; i++) if (state.conversations[i].id === id) return state.conversations[i];
    return null;
  }
  function activeConv() { return findConv(state.activeId); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function host(u) { try { return new URL(u).host.replace(/^www\./, ''); } catch (e) { return u || ''; } }
  function fmtNum(n) { n = n || 0; return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n); }

  function isPeak() {
    var d = new Date(Date.now() + 8 * 3600 * 1000);
    var wd = d.getUTCDay(), h = d.getUTCHours();
    if (wd === 0 || wd === 6) return false;
    return (h >= 9 && h < 12) || (h >= 14 && h < 18);
  }
  function costOf(usage, model) {
    if (!usage) return 0;
    var p = PRICE[model] || PRICE['deepseek-flash'];
    var sum = (usage.input_tokens || 0) * p.miss +
      (usage.cache_read_input_tokens || 0) * p.hit +
      (usage.output_tokens || 0) * p.out;
    return sum / 1e6 * (isPeak() ? 2 : 1);
  }
  function money(n) {
    if (!n) return '¥0';
    if (n < 0.0001) return '<¥0.0001';
    return '¥' + n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  }
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.classList.remove('show'); }, 1900);
  }
  function haptic() { if (navigator.vibrate) { try { navigator.vibrate(8); } catch (e) {} } }

  /* ---------- 主题 / 背景 ---------- */
  function resolveTheme() {
    var t = state.settings.theme || 'auto';
    if (t !== 'auto') return t;
    try { return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; } catch (e) { return 'dark'; }
  }

  function applyTheme() {
    var t = resolveTheme();
    document.documentElement.setAttribute('data-theme', t);
    document.documentElement.style.colorScheme = t;
    var m = $('metaTheme');
    if (m) m.setAttribute('content', t === 'light' ? '#f5f6f9' : '#0f1115');
    var seg = $('themeSeg');
    if (seg) {
      var bs = seg.querySelectorAll('button');
      for (var i = 0; i < bs.length; i++) {
        bs[i].classList.toggle('active', bs[i].getAttribute('data-theme') === (state.settings.theme || 'auto'));
      }
    }
    applyBg();
  }

  function applyBg() {
    var b = state.settings.bg || { kind: 'none' };
    var isImg = b.kind === 'image' && !!b.image;
    document.body.classList.toggle('has-img', isImg);
    document.body.style.backgroundImage = isImg ? 'url("' + b.image + '")' : '';
    document.body.style.backgroundColor = (b.kind === 'color' && b.color) ? b.color : '';
  }

  function renderSwatches() {
    var box = $('swatches');
    if (!box) return;
    box.innerHTML = '';
    var b = state.settings.bg || { kind: 'none' };

    var none = document.createElement('button');
    none.className = 'sw none' + (b.kind === 'none' ? ' active' : '');
    none.title = '无背景';
    none.onclick = function () { state.settings.bg = { kind: 'none' }; save(true); applyBg(); renderSwatches(); };
    box.appendChild(none);

    BG_PRESETS.forEach(function (cl) {
      var s = document.createElement('button');
      s.className = 'sw' + (b.kind === 'color' && b.color === cl ? ' active' : '');
      s.style.background = cl;
      s.onclick = function () { state.settings.bg = { kind: 'color', color: cl }; save(true); applyBg(); renderSwatches(); };
      box.appendChild(s);
    });

    var pick = document.createElement('label');
    var custom = b.kind === 'color' && BG_PRESETS.indexOf(b.color) < 0;
    pick.className = 'sw pick' + (custom ? ' active' : '');
    pick.style.background = custom ? b.color : 'var(--bg2)';
    pick.innerHTML = '<span>+</span><input type="color" id="bgColor" value="' + ((b.kind === 'color' && b.color) || '#22303c') + '">';
    pick.querySelector('input').oninput = function () {
      state.settings.bg = { kind: 'color', color: this.value };
      save(true); applyBg(); renderSwatches();
    };
    box.appendChild(pick);
  }

  function pickBackgroundImage(file) {
    if (!file) return;
    var fr = new FileReader();
    fr.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 1400;
        var scale = Math.min(1, max / Math.max(img.width, img.height));
        var w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        var cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        var data;
        try { data = cv.toDataURL('image/jpeg', 0.72); } catch (e) { toast('这张图读不了'); return; }
        state.settings.bg = { kind: 'image', image: data, color: '' };
        save(true); applyBg(); renderSwatches();
        toast('背景已替换');
      };
      img.onerror = function () { toast('图片格式不支持'); };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  }

  /* ---------- Markdown ---------- */
  function inlineMd(t) {
    t = esc(t);
    t = t.replace(/`([^`]+)`/g, function (m, c) { return '<code>' + c + '</code>'; });
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, function (m, txt, url) {
      return '<a href="' + url + '" target="_blank" rel="noreferrer">' + txt + '</a>';
    });
    t = t.replace(/(^|[\s(（])(https?:\/\/[^\s<)）]+)/g, function (m, pre, url) {
      return pre + '<a href="' + url + '" target="_blank" rel="noreferrer">' + url + '</a>';
    });
    t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    return t;
  }

  function blockMd(src) {
    var lines = String(src).split('\n');
    var out = '', para = [], i = 0;
    function flush() {
      if (!para.length) return;
      out += '<p>' + para.map(inlineMd).join('<br>') + '</p>';
      para = [];
    }
    while (i < lines.length) {
      var ln = lines[i];
      if (!ln.trim()) { flush(); i++; continue; }
      var h = ln.match(/^(#{1,3})\s+(.*)$/);
      if (h) { flush(); out += '<h' + h[1].length + '>' + inlineMd(h[2]) + '</h' + h[1].length + '>'; i++; continue; }
      if (/^\s*(---+|\*\*\*+)\s*$/.test(ln)) { flush(); out += '<hr>'; i++; continue; }
      if (/^>\s?/.test(ln)) {
        flush(); var q = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) { q.push(lines[i].replace(/^>\s?/, '')); i++; }
        out += '<blockquote>' + q.map(inlineMd).join('<br>') + '</blockquote>'; continue;
      }
      if (/^\s*[-*+]\s+/.test(ln)) {
        flush(); out += '<ul>';
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          out += '<li>' + inlineMd(lines[i].replace(/^\s*[-*+]\s+/, '')) + '</li>'; i++;
        }
        out += '</ul>'; continue;
      }
      if (/^\s*\d+[.)]\s+/.test(ln)) {
        flush(); out += '<ol>';
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
          out += '<li>' + inlineMd(lines[i].replace(/^\s*\d+[.)]\s+/, '')) + '</li>'; i++;
        }
        out += '</ol>'; continue;
      }
      para.push(ln); i++;
    }
    flush();
    return out;
  }

  function renderMd(src, citations, srcIndex) {
    var segs = String(src || '').split('```');
    var html = '';
    for (var i = 0; i < segs.length; i++) {
      if (i % 2 === 1) {
        var seg = segs[i], code = seg, nl = seg.indexOf('\n');
        if (nl >= 0 && /^[\w+#.\-]{0,20}$/.test(seg.slice(0, nl).trim())) code = seg.slice(nl + 1);
        html += '<pre><code>' + esc(code.replace(/\n$/, '')) + '</code></pre>';
      } else {
        html += blockMd(segs[i]);
      }
    }
    if (citations && citations.length && srcIndex) {
      var seen = {}, sups = '';
      citations.forEach(function (c) {
        if (!c || !c.url || seen[c.url]) return;
        seen[c.url] = 1;
        var n = srcIndex[c.url];
        if (n) sups += '<sup class="cite">[' + n + ']</sup>';
      });
      html += sups;
    }
    return html;
  }

  /* ---------- 消息模型 ---------- */
  function convTitleOf(text) {
    var t = String(text).replace(/\s+/g, ' ').trim();
    return t.length > 20 ? t.slice(0, 20) + '…' : (t || '新对话');
  }

  function curVersion(turn) {
    if (!turn.versions || !turn.versions.length) return null;
    var i = Math.min(Math.max(turn.active || 0, 0), turn.versions.length - 1);
    return turn.versions[i];
  }

  function withAi(turn, fn) {
    var v = curVersion(turn);
    if (v && v.a) fn(v.a, v);
  }

  function sourceAdd(ai, item) {
    if (!item || !item.url) return;
    if (!ai.srcIndex) ai.srcIndex = {};
    if (ai.srcIndex[item.url]) return;
    if (!ai.sources) ai.sources = [];
    var n = ai.sources.length + 1;
    ai.srcIndex[item.url] = n;
    ai.sources.push({ n: n, url: item.url, title: item.title || host(item.url) });
  }

  function toolLabel(t) {
    var a = t.action || {};
    var k = a.action || a.type || '';
    if (k === 'search') {
      var q = (a.queries || []).join(' · ');
      return { icon: 'search', text: (t.done ? '搜索：' : '正在搜索：') + q, title: q };
    }
    if (k === 'open_page') return { icon: 'globe', text: (t.done ? '看过 ' : '打开 ') + host(a.url), title: a.url };
    if (k === 'find_in_page') return { icon: 'search', text: '页内查找「' + (a.pattern || '') + '」', title: a.url };
    if (k === 'read_link') return { icon: 'link', text: (t.done ? '读过 ' : '阅读 ') + host(a.url), title: a.url };
    return { icon: 'search', text: '联网工具', title: '' };
  }

  function aiInner(turn) {
    var v = curVersion(turn);
    var ai = v ? v.a : null;
    if (!ai) return '<div class="ai-head"><div class="avatar"><div class="spinner"></div></div><span>等待生成</span></div>';

    var h = '';
    h += '<div class="ai-head"><div class="avatar">' +
      (ai.streaming && !ai.text ? '<div class="spinner"></div>' : 'D') + '</div><span>' +
      (ai.streaming ? '正在生成' : 'DeepChat') + '</span></div>';

    if (ai.thinking) {
      h += '<details class="think"' + (ai._thinkOpen ? ' open' : '') + ' data-act="think" data-turn="' + turn.id + '">' +
        '<summary><span class="chev">▶</span>' + (ai.streaming && !ai.text ? '深度思考中…' : '已深度思考') +
        '<span class="dim">· ' + ai.thinking.length + ' 字</span></summary>' +
        '<div class="thinkbody">' + esc(ai.thinking) + '</div></details>';
    }

    if (ai.tools && ai.tools.length) {
      h += '<div class="tools">';
      ai.tools.slice(-6).forEach(function (t) {
        var l = toolLabel(t);
        h += '<span class="tool' + (t.done ? ' done' : '') + '" title="' + esc(l.title) + '">' +
          ICON[l.icon] + '<span class="t">' + esc(l.text) + '</span></span>';
      });
      h += '</div>';
    }

    var textHtml = '';
    (ai.blocks || []).forEach(function (b) {
      if (b.type === 'text' && b.text) textHtml += renderMd(b.text, b.citations, ai.srcIndex);
    });
    if (!textHtml && ai.text) textHtml = renderMd(ai.text, null, ai.srcIndex);
    if (textHtml) h += '<div class="md">' + textHtml + (ai.streaming ? '<span class="caret"></span>' : '') + '</div>';

    if (ai.sources && ai.sources.length) {
      h += '<div class="sources"><div class="st">来源 ' + ai.sources.length + '</div>';
      ai.sources.slice(0, 8).forEach(function (s) {
        h += '<a class="src" href="' + esc(s.url) + '" target="_blank" rel="noreferrer">' +
          '<span class="n">[' + s.n + ']</span><span class="u">' + esc(s.title) + '</span>' +
          '<span class="d">' + esc(host(s.url)) + '</span></a>';
      });
      h += '</div>';
    }

    if (ai.error) {
      h += '<div class="err"><span>' + esc(ai.error) + '</span>' +
        '<button data-act="regen" data-turn="' + turn.id + '">重试</button></div>';
    }

    if (!ai.streaming) {
      var meta = [];
      if (ai.usage) meta.push(fmtNum((ai.usage.input_tokens || 0) + (ai.usage.cache_read_input_tokens || 0)) + ' in · ' + fmtNum(ai.usage.output_tokens || 0) + ' out');
      if (ai.cost) meta.push(money(ai.cost));

      var n = (turn.versions || []).length;
      var idx = (turn.active || 0) + 1;
      h += '<div class="foot">';
      h += '<span class="fmeta">' + (meta.join(' · ') || '') + '</span>';
      h += '<span class="fact">' +
        '<button data-act="copy" data-turn="' + turn.id + '">' + ICON.copy + '复制</button>' +
        '<button data-act="regen" data-turn="' + turn.id + '">' + ICON.retry + '重新生成</button>' +
        '</span>';
      h += '<span class="vers">' +
        '<button data-act="vprev" data-turn="' + turn.id + '"' + (idx <= 1 ? ' disabled' : '') + ' aria-label="上一版">‹</button>' +
        '<span class="vnum">' + idx + ' / ' + n + '</span>' +
        '<button data-act="vnext" data-turn="' + turn.id + '"' + (idx >= n ? ' disabled' : '') + ' aria-label="下一版">›</button>' +
        '</span>';
      h += '</div>';
    }
    return h;
  }

  function turnNode(turn) {
    var v = curVersion(turn);
    var wrap = document.createElement('div');
    wrap.className = 'turn';
    wrap.dataset.turn = turn.id;
    wrap.innerHTML =
      '<div class="msg user">' +
      '<div class="body">' + esc(v ? v.q : '') + '</div>' +
      '<div class="uact">' +
      '<button data-act="edit" data-turn="' + turn.id + '">' + ICON.edit + '编辑</button>' +
      '<button data-act="copyu" data-turn="' + turn.id + '">' + ICON.copy + '复制</button>' +
      '</div></div>' +
      '<div class="msg ai" data-ai="' + turn.id + '"><div class="body">' + aiInner(turn) + '</div></div>';
    return wrap;
  }

  function renderMessages() {
    var box = $('messages');
    var conv = activeConv();
    box.innerHTML = '';
    var empty = $('empty');
    if (!conv || !conv.turns.length) {
      empty.classList.remove('hide');
      renderSuggests();
    } else {
      empty.classList.add('hide');
      conv.turns.forEach(function (t) { box.appendChild(turnNode(t)); });
    }
    updateHeader();
  }

  function totalCost() {
    var t = 0;
    state.conversations.forEach(function (c) {
      (c.turns || []).forEach(function (turn) {
        (turn.versions || []).forEach(function (v) { if (v.a && v.a.cost) t += v.a.cost; });
      });
    });
    return t;
  }

  function updateHeader() {
    var conv = activeConv(), s = state.settings;
    $('chatTitle').textContent = conv ? conv.title : '新对话';
    $('chatSub').textContent = [s.model, s.think ? '思考' : '快答', s.search ? '联网' : '不联网'].join(' · ');
    $('chipThink').classList.toggle('on', !!s.think);
    $('chipSearch').classList.toggle('on', !!s.search);
    $('chipCost').textContent = '累计 ' + money(totalCost());
  }

  function scrollBottom(smooth) {
    var sc = $('scroller');
    requestAnimationFrame(function () {
      if (typeof sc.scrollTo === 'function') sc.scrollTo({ top: sc.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
      else sc.scrollTop = sc.scrollHeight;
    });
  }
  function nearBottom() {
    var sc = $('scroller');
    return sc.scrollHeight - sc.scrollTop - sc.clientHeight < 170;
  }

  /* ---------- 请求 ---------- */
  function apiMessages(conv, excludeTurn) {
    var out = [];
    (conv.turns || []).forEach(function (t) {
      var v = curVersion(t);
      if (!v) return;
      out.push({ role: 'user', content: v.q });
      if (t === excludeTurn) return;
      if (v.a.blocks && v.a.blocks.length) out.push({ role: 'assistant', content: v.a.blocks });
      else if (v.a.text) out.push({ role: 'assistant', content: [{ type: 'text', text: v.a.text }] });
    });
    return out;
  }

  function pushEvent(ai, ev) {
    var t = ev.type;
    if (t === 'content_block_start') {
      var b = ev.content_block || {}, blk = { type: b.type };
      if (b.type === 'text') { blk.text = ''; blk.citations = []; }
      else if (b.type === 'thinking') { blk.thinking = ''; }
      else if (b.type === 'server_tool_use') {
        blk.id = b.id; blk.name = b.name; blk.kind = b.kind; blk.input = b.input || {};
        ai.tools = ai.tools || [];
        ai.tools.push({ id: b.id, action: b.input || {}, kind: b.kind, done: false });
      } else if (b.type === 'web_search_tool_result') {
        blk.tool_use_id = b.tool_use_id; blk.kind = b.kind; blk.content = b.content || [];
        (b.content || []).forEach(function (r) { if (r && r.url) sourceAdd(ai, r); });
        markTool(ai, b.tool_use_id);
      } else if (b.type === 'web_fetch_tool_result') {
        blk.tool_use_id = b.tool_use_id; blk.kind = b.kind;
        blk.content = b.content; blk.signature = b.signature;
        var c = b.content || {};
        if (c.url) sourceAdd(ai, { url: c.url, title: (c.content && c.content.title) || host(c.url) });
        markTool(ai, b.tool_use_id);
      }
      ai.blocks[ev.index] = blk;
    } else if (t === 'content_block_delta') {
      var blk2 = ai.blocks[ev.index];
      if (!blk2) return;
      var d = ev.delta || {};
      if (d.type === 'text_delta') {
        blk2.text = (blk2.text || '') + d.text;
        ai.text = (ai.text || '') + d.text;
      } else if (d.type === 'thinking_delta') {
        blk2.thinking = (blk2.thinking || '') + d.thinking;
        ai.thinking = (ai.thinking || '') + d.thinking;
      } else if (d.type === 'signature_delta') {
        blk2.signature = (blk2.signature || '') + d.signature;
      } else if (d.type === 'citations_delta') {
        var cit = d.citation;
        if (cit && cit.url) {
          blk2.citations = blk2.citations || [];
          blk2.citations.push({ url: cit.url, title: cit.title || host(cit.url) });
          sourceAdd(ai, { url: cit.url, title: cit.title });
        }
      }
    } else if (t === 'message_delta') {
      if (ev.usage) ai.usage = ev.usage;
      if (ev.delta && ev.delta.stop_reason) ai.stopReason = ev.delta.stop_reason;
    } else if (t === 'error') {
      ai.error = (ev.error && ev.error.message) || '生成失败';
    }
  }

  function markTool(ai, id) {
    (ai.tools || []).forEach(function (x) { if (x.id === id) x.done = true; });
  }

  function cleanupBlocks(ai) {
    ai.blocks = (ai.blocks || []).filter(function (b) {
      if (!b) return false;
      if (b.type === 'text') return !!b.text;
      if (b.type === 'thinking') return !!b.thinking;
      return true;
    });
  }

  function runStream(conv, turn) {
    var s = state.settings;
    var v = curVersion(turn);
    var ai = v.a;
    ai.streaming = true;

    state.streaming = true;
    state.abort = new AbortController();
    setBusy(true);
    renderMessages();
    scrollBottom();

    var node = document.querySelector('[data-ai="' + turn.id + '"]');

    function paint() {
      if (!node) return;
      var stick = nearBottom();
      node.innerHTML = '<div class="body">' + aiInner(turn) + '</div>';
      if (stick) scrollBottom();
    }
    var raf = 0;
    function paintSoon() {
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = 0; paint(); });
    }

    var body = {
      model: s.model, stream: true, max_tokens: MAX_TOKENS,
      thinking: { type: s.think ? 'enabled' : 'disabled' },
      messages: apiMessages(conv, turn)
    };
    if (s.system && s.system.trim()) body.system = s.system.trim();
    if (s.search) body.tools = [
      { type: 'deepseek_web_search', name: 'deepseek_web_search' },
      { type: 'deepseek_read_url', name: 'deepseek_read_url' }
    ];

    function finish() {
      cleanupBlocks(ai);
      if (ai.usage) ai.cost = costOf(ai.usage, s.model);
      ai.streaming = false;
      conv.updatedAt = Date.now();
      save(true);
      paint();
      setBusy(false);
    }

    fetch(String(s.base || 'https://api.deepseek.com').replace(/\/+$/, '') + API_PATH, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': (s.apiKey || '').trim(),
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body),
      signal: state.abort.signal
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (txt) {
          var msg = txt;
          try { var j = JSON.parse(txt); msg = (j.error && (j.error.message || j.error.type)) || txt; } catch (e) {}
          throw new Error('HTTP ' + res.status + ' · ' + String(msg).slice(0, 200));
        });
      }
      var reader = res.body.getReader(), dec = new TextDecoder(), buf = '';
      function handleRaw(raw) {
        raw.split('\n').forEach(function (ln) {
          if (ln.indexOf('data:') !== 0) return;
          var payload = ln.slice(5).trim();
          if (!payload || payload === '[DONE]') return;
          try { pushEvent(ai, JSON.parse(payload)); } catch (e) {}
        });
        paintSoon();
      }
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return;
          buf += dec.decode(r.value, { stream: true });
          var idx;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            var raw = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            handleRaw(raw);
          }
          return pump();
        });
      }
      return pump();
    }).then(finish).catch(function (err) {
      if (err && err.name === 'AbortError') {
        if (!ai.text) ai.text = '（已停止）';
      } else {
        ai.error = (err && err.message) || '请求失败';
      }
      finish();
    });
  }

  function setBusy(b) {
    state.streaming = b;
    $('btnSend').classList.toggle('busy', b);
    if (!b) state.abort = null;
  }

  function ensureConv() {
    var conv = activeConv();
    if (conv) return conv;
    conv = { id: uid(), title: '新对话', createdAt: Date.now(), updatedAt: Date.now(), turns: [] };
    state.conversations.unshift(conv);
    state.activeId = conv.id;
    return conv;
  }

  function sendText(text) {
    text = (text || '').trim();
    if (!text) return;
    if (!state.settings.apiKey) { openSheet(); toast('先填 API Key'); return; }
    if (state.streaming) return;

    var conv = ensureConv();
    var turn = { id: uid(), active: 0, versions: [makeVersion(text, newAi())] };
    conv.turns.push(turn);
    if (conv.turns.length === 1) conv.title = convTitleOf(text);
    conv.updatedAt = Date.now();
    $('input').value = '';
    autoGrow();
    save(true);
    runStream(conv, turn);
  }

  function regenerate(turn) {
    if (state.streaming) { toast('等这条说完'); return; }
    if (!state.settings.apiKey) { openSheet(); return; }
    var conv = activeConv();
    if (!conv) return;
    var v = curVersion(turn);
    turn.versions.push(makeVersion(v ? v.q : '', newAi()));
    turn.active = turn.versions.length - 1;
    conv.updatedAt = Date.now();
    save(true);
    runStream(conv, turn);
  }

  function editAndRegenerate(turn, text) {
    var conv = activeConv();
    if (!conv) return;
    turn.versions.push(makeVersion(text, newAi()));
    turn.active = turn.versions.length - 1;
    conv.updatedAt = Date.now();
    save(true);
    runStream(conv, turn);
  }

  function switchVersion(turn, delta) {
    if (state.streaming) { toast('这条还在生成'); return; }
    var n = turn.versions.length;
    var i = (turn.active || 0) + delta;
    if (i < 0 || i >= n) return;
    turn.active = i;
    save(true);
    renderMessages();
    haptic();
  }

  /* ---------- 抽屉 / 面板 ---------- */
  function renderConvList() {
    var box = $('convlist');
    box.innerHTML = '';
    if (!state.conversations.length) { box.innerHTML = '<div class="none">还没有对话</div>'; return; }
    state.conversations.slice().sort(function (a, b) { return b.updatedAt - a.updatedAt; }).forEach(function (c) {
      var d = document.createElement('div');
      d.className = 'conv' + (c.id === state.activeId ? ' active' : '');
      d.dataset.cid = c.id;
      d.innerHTML = '<span class="tt">' + esc(c.title || '新对话') + '</span>' +
        '<button class="del" data-act="delconv" data-cid="' + c.id + '">✕</button>';
      box.appendChild(d);
    });
  }

  function openDrawer() { renderConvList(); $('drawer').classList.add('open'); $('scrim').classList.add('show'); }
  function closeDrawer() { $('drawer').classList.remove('open'); $('scrim').classList.remove('show'); }
  function openSheet() { fillSheet(); $('sheet').classList.add('open'); $('scrim').classList.add('show'); }
  function closeSheet() { $('sheet').classList.remove('open'); $('scrim').classList.remove('show'); }
  function openEdit(turn) {
    state.editing = turn;
    $('editText').value = curVersion(turn).q;
    $('editSheet').classList.add('open');
    $('scrim').classList.add('show');
    setTimeout(function () { $('editText').focus(); }, 150);
  }
  function closeEdit() { $('editSheet').classList.remove('open'); $('scrim').classList.remove('show'); state.editing = null; }

  function renderModelCards() {
    var box = $('modelCards');
    if (!box) return;
    var cards = box.querySelectorAll('.modelcard');
    for (var i = 0; i < cards.length; i++) {
      cards[i].classList.toggle('active', cards[i].getAttribute('data-model') === state.settings.model);
    }
  }

  function fillSheet() {
    var s = state.settings;
    $('setKey').value = s.apiKey || '';
    $('setSystem').value = s.system || '';
    $('setThink').checked = !!s.think;
    $('setSearch').checked = !!s.search;
    $('aboutVer').textContent = APP_VERSION;
    applyTheme();
    renderPresets();
    renderSwatches();
    renderModelCards();

    var msgs = 0, cost = 0, tok = 0;
    state.conversations.forEach(function (c) {
      (c.turns || []).forEach(function (t) {
        msgs += 1;
        (t.versions || []).forEach(function (v) {
          if (v.a && v.a.usage) tok += (v.a.usage.input_tokens || 0) + (v.a.usage.cache_read_input_tokens || 0) + (v.a.usage.output_tokens || 0);
        });
      });
    });
    cost = totalCost();
    $('usageNote').textContent = state.conversations.length + ' 个对话 · ' + msgs + ' 条提问 · ' + fmtNum(tok) + ' tokens · 累计 ' + money(cost);
  }

  function renderPresets() {
    var row = $('presetRow');
    row.innerHTML = '';
    PRESETS.forEach(function (p) {
      var b = document.createElement('button');
      b.className = 'preset' + (state.settings.system === p.text ? ' on' : '');
      b.textContent = p.name;
      b.onclick = function () {
        state.settings.system = p.text;
        $('setSystem').value = p.text;
        renderPresets();
        save();
        toast('提示词：' + p.name);
      };
      row.appendChild(b);
    });
  }

  function renderSuggests() {
    var box = $('suggests');
    if (box.childNodes.length) return;
    ['解释一下 SSE 流式输出是怎么工作的', '帮我把这段话改得像人说的：尊敬的领导…', '搜一下最近 AI 圈值得看的事'].forEach(function (t) {
      var b = document.createElement('button');
      b.className = 'sug';
      b.innerHTML = '<span style="flex:1">' + esc(t) + '</span><span>→</span>';
      b.onclick = function () { $('input').value = t; autoGrow(); $('input').focus(); };
      box.appendChild(b);
    });
  }

  function autoGrow() {
    var el = $('input');
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 132) + 'px';
  }

  function newChat() {
    if (state.streaming && state.abort) state.abort.abort();
    var c = { id: uid(), title: '新对话', createdAt: Date.now(), updatedAt: Date.now(), turns: [] };
    state.conversations.unshift(c);
    state.activeId = c.id;
    save(true);
    renderMessages();
    $('input').value = '';
    autoGrow();
    setTimeout(function () { $('input').focus(); }, 60);
  }

  function copyText(txt) {
    if (!txt) { toast('没有可复制的内容'); return; }
    if (window.App && window.App.copy) { window.App.copy(txt); toast('已复制'); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () { toast('已复制'); }, function () { fallbackCopy(txt); });
    } else fallbackCopy(txt);
  }
  function fallbackCopy(txt) {
    var ta = document.createElement('textarea');
    ta.value = txt;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('已复制'); } catch (e) { toast('复制失败'); }
    document.body.removeChild(ta);
  }

  function findTurn(id) {
    var conv = activeConv();
    if (!conv) return null;
    for (var i = 0; i < conv.turns.length; i++) if (conv.turns[i].id === id) return conv.turns[i];
    return null;
  }

  /* ---------- 事件 ---------- */
  function bind() {
    $('btnMenu').onclick = openDrawer;
    $('btnCloseDrawer').onclick = closeDrawer;
    $('scrim').onclick = function () { closeDrawer(); closeSheet(); closeEdit(); };
    $('btnSettings').onclick = function () { closeDrawer(); openSheet(); };
    $('btnCloseSheet').onclick = closeSheet;
    $('btnEditClose').onclick = closeEdit;
    $('btnEditCancel').onclick = closeEdit;
    $('btnNew').onclick = newChat;
    $('btnNew2').onclick = function () { newChat(); closeDrawer(); };
    $('emptyHint').onclick = openSheet;

    $('chipThink').onclick = function () { state.settings.think = !state.settings.think; save(); updateHeader(); haptic(); };
    $('chipSearch').onclick = function () { state.settings.search = !state.settings.search; save(); updateHeader(); haptic(); };
    $('chipCost').onclick = openSheet;

    $('btnSend').onclick = function () {
      if (state.streaming) { if (state.abort) state.abort.abort(); return; }
      sendText($('input').value);
    };

    var input = $('input');
    input.addEventListener('input', autoGrow);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendText(input.value); }
    });

    $('messages').addEventListener('click', function (e) {
      var t = e.target.closest('[data-act]');
      if (!t) return;
      var act = t.getAttribute('data-act');
      var turn = findTurn(t.getAttribute('data-turn'));
      if (act === 'think') {
        if (turn) withAi(turn, function (ai) { ai._thinkOpen = !ai._thinkOpen; });
        return;
      }
      if (!turn) return;
      if (act === 'copy') { withAi(turn, function (ai) { copyText(ai.text); }); return; }
      if (act === 'copyu') { copyText(curVersion(turn).q); return; }
      if (act === 'edit') { openEdit(turn); return; }
      if (act === 'regen') { regenerate(turn); return; }
      if (act === 'vprev') { switchVersion(turn, -1); return; }
      if (act === 'vnext') { switchVersion(turn, 1); return; }
    });

    $('btnEditSave').onclick = function () {
      var turn = state.editing;
      if (!turn) { closeEdit(); return; }
      var txt = $('editText').value.trim();
      if (!txt) { toast('内容不能为空'); return; }
      closeEdit();
      editAndRegenerate(turn, txt);
    };

    $('convlist').addEventListener('click', function (e) {
      var del = e.target.closest('[data-act="delconv"]');
      if (del) {
        e.stopPropagation();
        var cid = del.getAttribute('data-cid');
        var c = findConv(cid);
        if (c && confirm('删除「' + (c.title || '新对话') + '」？')) {
          state.conversations = state.conversations.filter(function (x) { return x.id !== cid; });
          if (state.activeId === cid) state.activeId = state.conversations[0] ? state.conversations[0].id : null;
          save(true); renderMessages(); renderConvList();
        }
        return;
      }
      var row = e.target.closest('.conv');
      if (row) {
        state.activeId = row.dataset.cid;
        save(true);
        renderMessages();
        closeDrawer();
        scrollBottom();
      }
    });

    $('themeSeg').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      state.settings.theme = b.getAttribute('data-theme');
      save(true);
      applyTheme();
    });

    $('modelCards').addEventListener('click', function (e) {
      var card = e.target.closest('.modelcard');
      if (!card) return;
      state.settings.model = card.getAttribute('data-model');
      save(true);
      renderModelCards();
      updateHeader();
      haptic();
    });

    $('bgFile').onchange = function () {
      pickBackgroundImage(this.files && this.files[0]);
      this.value = '';
    };
    $('btnBgClear').onclick = function () {
      state.settings.bg = { kind: 'none' };
      save(true); applyBg(); renderSwatches(); toast('背景已清除');
    };

    $('setKey').oninput = function () { state.settings.apiKey = this.value.trim(); save(); };
    $('setSystem').oninput = function () { state.settings.system = this.value; save(); renderPresets(); };
    $('setThink').onchange = function () { state.settings.think = this.checked; save(); updateHeader(); };
    $('setSearch').onchange = function () { state.settings.search = this.checked; save(); updateHeader(); };
    $('btnEye').onclick = function () {
      var k = $('setKey'), pwd = k.type === 'password';
      k.type = pwd ? 'text' : 'password';
      this.textContent = pwd ? '隐藏' : '显示';
    };
    $('btnClear').onclick = function () {
      if (!confirm('清空所有对话？Key、提示词和背景会保留。')) return;
      state.conversations = [];
      state.activeId = null;
      save(true);
      renderMessages();
      toast('已清空');
    };

    $('scroller').addEventListener('scroll', function () {
      var on = $('scroller').scrollTop > 4;
      document.querySelector('.topbar').classList.toggle('scrolled', on);
    });

    window.__onBack = function () {
      if ($('editSheet').classList.contains('open')) { closeEdit(); return true; }
      if ($('sheet').classList.contains('open')) { closeSheet(); return true; }
      if ($('drawer').classList.contains('open')) { closeDrawer(); return true; }
      if (state.streaming && state.abort) { state.abort.abort(); return true; }
      return false;
    };

    window.addEventListener('beforeunload', function () { save(true); });

    try {
      window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () {
        if ((state.settings.theme || 'auto') === 'auto') applyTheme();
      });
    } catch (e) {}
  }

  function init() {
    load();
    try {
      var q = new URLSearchParams(location.search).get('api');
      if (q) state.settings.base = q;
    } catch (e) {}
    bind();
    applyTheme();
    renderMessages();
    updateHeader();
    $('drawerVer').textContent = 'v' + APP_VERSION;
    var h = new Date().getHours();
    document.querySelector('.empty h1').textContent =
      h < 6 ? '夜深了' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 19 ? '下午好' : '晚上好';
    $('emptyHint').textContent = state.settings.apiKey ? '说点什么，或者直接问我。' : '先到设置里填上 DeepSeek API Key，然后随便聊。';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
