/* DSChat — 自用 / 可公开分发的移动端 DeepSeek 客户端
 * 问题版本与回答版本分开管理；对话可置顶、收藏；编辑不丢历史。 */
(function () {
  'use strict';

  var LS = 'deepchat.v5';
  var LS_OLD = ['deepchat.v4', 'deepchat.v3', 'deepchat.v2', 'deepchat.v1'];
  var APP_VERSION = '3.4.2';
  var API_PATH = '/anthropic/v1/messages';
  var MAX_TOKENS = 65536;

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
    edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M14 6l4 4"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M9 4h6l-1 6 4 4H6l4-4-1-6z"/><path d="M12 14v6"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="M12 4l2.4 5.2 5.6.6-4.2 3.8 1.2 5.4L12 16.2 6.9 19l1.2-5.4L4 9.8l5.6-.6z"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13"/></svg>'
  };

  var AV_LOGO = '<svg viewBox="0 0 48 48"><path d="M10 12h28a4 4 0 0 1 4 4v14a4 4 0 0 1-4 4H24l-8 7v-7h-6a4 4 0 0 1-4-4V16a4 4 0 0 1 4-4z"/></svg>';
  var AV_USER = '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.6"/><path d="M4.4 20c0-3.7 3.4-6 7.6-6s7.6 2.3 7.6 6z"/></svg>';

  var state = { settings: null, conversations: [], activeId: null, abort: null, streaming: false, editing: null, menuCid: null };

  /* ---------- 存取 ---------- */
  function defaults() {
    return {
      settings: {
        apiKey: '', model: 'deepseek-flash', base: 'https://api.deepseek.com',
        system: PRESETS[0].text, think: true, search: true, effort: 'high', temperature: 1,
        theme: 'auto', bg: { kind: 'none', veil: 0.8 }, usageByDay: {},
        avatar: { user: '', ai: '' }, agreed: false, lang: 'zh-Hans'
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

  function makeQuestion(q, answers) {
    return { id: uid(), q: q || '', ts: Date.now(), activeA: 0, answers: answers && answers.length ? answers : [newAi()] };
  }

  function normalizeTurn(t) {
    if (Array.isArray(t.questions) && t.questions.length) {
      t.questions.forEach(function (q) {
        q.id = q.id || uid();
        if (!Array.isArray(q.answers) || !q.answers.length) q.answers = [newAi()];
        q.activeA = Math.min(Math.max(q.activeA || 0, 0), q.answers.length - 1);
      });
      t.activeQ = Math.min(Math.max(t.activeQ || 0, 0), t.questions.length - 1);
      return t;
    }
    var questions = [];
    if (Array.isArray(t.versions) && t.versions.length) {
      t.versions.forEach(function (v) {
        questions.push({ id: uid(), q: v.q || '', activeA: 0, answers: [v.a || newAi()] });
      });
      t.activeQ = t.active || 0;
    } else if (Array.isArray(t.variants) && t.variants.length) {
      questions.push({ id: uid(), q: (t.user && t.user.content) || '', activeA: t.active || 0, answers: t.variants });
      t.activeQ = 0;
    } else if (t.user) {
      questions.push(makeQuestion(t.user.content));
      t.activeQ = 0;
    }
    t.questions = questions.length ? questions : [makeQuestion('')];
    t.activeQ = Math.min(t.activeQ || 0, t.questions.length - 1);
    delete t.versions; delete t.variants; delete t.user; delete t.active;
    return t;
  }

  function migrate(c) {
    if (!Array.isArray(c.turns)) {
      var turns = [], pending = null;
      (c.messages || []).forEach(function (m) {
        if (m.role === 'user') {
          pending = { id: uid(), activeQ: 0, questions: [makeQuestion(m.content)] };
          turns.push(pending);
        } else if (m.role === 'assistant' && pending) {
          pending.questions[0].answers[0] = Object.assign(newAi(), {
            ts: m.ts, text: m.text || '', thinking: m.thinking || '', blocks: m.blocks || [],
            sources: m.sources || [], srcIndex: m.srcIndex || {}, tools: m.tools || [],
            usage: m.usage || null, cost: m.cost || 0, error: m.error || null
          });
          pending = null;
        }
      });
      c.turns = turns;
      delete c.messages;
    }
    c.turns.forEach(normalizeTurn);
    if (!c.pinned) c.pinned = false;
    if (!c.fav) c.fav = false;
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
    if (typeof state.settings.bg.veil !== 'number') state.settings.bg.veil = 0.8;
    if (!state.settings.effort) state.settings.effort = state.settings.think ? 'high' : 'none';
    if (typeof state.settings.temperature !== 'number') state.settings.temperature = 1;
    if (!state.settings.usageByDay) state.settings.usageByDay = {};
    if (!state.settings.avatar) state.settings.avatar = { user: '', ai: '' };
    try { if (!localStorage.getItem(LS)) save(true); } catch (e) {}
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
  function hhmm(ts) {
    var d = new Date(ts || Date.now());
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  function dayKey(ts) {
    var d = new Date(ts || Date.now());
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }
  function dayLabel(ts) {
    var d = new Date(ts || Date.now());
    var now = new Date();
    var k = dayKey(ts), nk = dayKey(now.getTime());
    var y = new Date(now.getTime() - 86400000);
    if (k === nk) return '今天';
    if (k === dayKey(y.getTime())) return '昨天';
    if (d.getFullYear() === now.getFullYear()) return (d.getMonth() + 1) + '月' + d.getDate() + '日';
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }
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

  /* ---------- 确认框 ---------- */
  var dlgCb = null;
  function ask(title, msg, okText, danger, cb) {
    $('dlgTitle').textContent = title;
    $('dlgMsg').textContent = msg || '';
    var ok = $('dlgOk');
    ok.textContent = okText || '确定';
    ok.classList.toggle('danger', !!danger);
    dlgCb = cb;
    $('dlgScrim').classList.add('show');
  }
  function closeAsk() { $('dlgScrim').classList.remove('show'); dlgCb = null; }

  /* ---------- 主题 / 背景 ---------- */
  function resolveTheme() {
    var t = state.settings.theme || 'auto';
    if (t !== 'auto') return t;
    try { return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; } catch (e) { return 'dark'; }
  }

  /* ---------- 多语言（界面文案） ---------- */
  var HANT = { '设':'設','置':'置','语':'語','言':'言','主':'主','题':'題','背':'背','景':'景','头':'頭','像':'像',
    '模':'模','型':'型','提':'提','示':'示','词':'詞','数':'數','据':'據','关':'關','于':'於','用':'用','量':'量',
    '通':'通','外':'外','观':'觀','跟':'跟','随':'隨','系':'系','统':'統','浅':'淺','色':'色','深':'深','自':'自',
    '定':'定','义':'義','清':'清','除':'除','恢':'恢','复':'復','默':'默','认':'認','开':'開','边':'邊','想':'想',
    '边':'邊','答':'答','快':'快','省':'省','按':'按','次':'次','额':'額','外':'外','计':'計','费':'費','温':'溫',
    '度':'度','最':'最','散':'散','模':'模','式':'式','该':'該','参':'參','不':'不','生':'生','效':'效','本':'本',
    '对':'對','话':'話','空':'空','则':'則','全':'全','局':'局','的':'的','名':'名','称':'稱','给':'給','起':'起',
    '个':'個','名':'名','字':'字','上':'上','下':'下','文':'文','已':'已','剩':'剩','余':'餘','限':'限','轮':'輪',
    '费':'費','仅':'僅','供':'供','参':'參','考':'考','高':'高','峰':'峰','期':'期','为':'為','两':'兩','倍':'倍',
    '复':'復','制':'製','重':'重','新':'新','编':'編','辑':'輯','保':'保','存':'存','并':'並','删':'刪','确':'確',
    '取':'取','消':'消','发':'發','送':'送','消':'消','息':'息','搜':'搜','索':'索','联':'聯','网':'網','深':'深',
    '推':'推','理':'理','退':'退','出':'出','同':'同','意':'意','继':'繼','续':'續','文':'文','件':'件','图':'圖',
    '片':'片','选':'選','择':'擇','张':'張','压':'壓','缩':'縮','后':'後','只':'只','存':'存','在':'在','本':'本',
    '机':'機','换':'換','成':'成','纯':'純','色':'色','心':'心','数':'數','量':'量','柱':'柱','子':'子','看':'看',
    '当':'當','天':'天','点':'點','一':'一','下':'下','近':'近','合':'合','计':'計','今':'今','版':'版','释':'釋' };

  function toHant(str) {
    var out = '';
    for (var i = 0; i < str.length; i++) {
      var c = str[i];
      out += (HANT[c] || c);
    }
    return out;
  }

  var EN = {
    '通用': 'General', '语言': 'Language', '外观': 'Appearance', '模型': 'Model', '提示词': 'Prompt',
    'API': 'API', '数据': 'Data', '关于': 'About', '用量': 'Usage', '头像': 'Avatars',
    '主题': 'Theme', '背景': 'Background', '跟随系统': 'System', '浅色': 'Light', '深色': 'Dark',
    '自定义背景': 'Custom background', '清除背景': 'Clear background', '透明度': 'Opacity',
    '用户': 'User', 'AI': 'AI', '恢复默认': 'Reset', '默认深度思考': 'Thinking by default',
    '默认联网': 'Web search by default', '默认温度': 'Default temperature',
    '按次额外计费': 'Charged per search', '本对话的系统提示词': "This chat's system prompt",
    '对话名称': 'Chat title', '温度': 'Temperature', '上下文': 'Context',
    'API Key': 'API Key', '显示': 'Show', '隐藏': 'Hide', '清空所有对话': 'Clear all chats',
    '导出备份': 'Export backup', '恢复备份': 'Restore backup', '版本': 'Version', '性质': 'Type',
    '协议': 'License', '密钥': 'API key', '流量': 'Traffic', '第三方客户端': 'Third-party client',
    '申请 API Key': 'Get API Key', 'API 文档': 'API docs', '价格': 'Pricing',
    '设置': 'Settings', '新对话': 'New chat',
    '联网': 'Web search', '推理': 'Reasoning',
    '发消息…': 'Message…', '搜索对话、提问或回答': 'Search chats…',
    '设置 · 外观 · 提示词': 'Settings · Appearance · Prompt',
    '点一下柱子，看当天用量': 'Tap a bar for that day',
    '近 15 天 —': 'Last 15 days —',
    '费用按官方价格估算，仅供参考；高峰期为两倍。': 'Costs are estimates; peak hours are 2x.',
    '对话设置': 'Chat settings', '上下文用量': 'Context usage',
    '使用前请读一下': 'Before you start'
  };

  var LANG_NODES = null;
  function langRoots() {
    return ['.topbar', '.composer', '.drawer', '#sheet', '#editSheet', '#ctxSheet', '#convSetSheet', '.empty'];
  }
  function captureLangNodes() {
    if (LANG_NODES) return;
    LANG_NODES = [];
    langRoots().forEach(function (sel) {
      var root = document.querySelector(sel);
      if (!root) return;
      (function walk(n) {
        if (n.nodeType === 3) { LANG_NODES.push({ n: n, o: n.nodeValue }); return; }
        if (n.nodeType !== 1) return;
        if (n.tagName === 'SCRIPT' || n.tagName === 'STYLE') return;
        for (var i = 0; i < n.childNodes.length; i++) walk(n.childNodes[i]);
      })(root);
    });
    var ph = document.querySelectorAll('[placeholder]');
    for (var i = 0; i < ph.length; i++) {
      if (!ph[i]._ph) ph[i]._ph = ph[i].getAttribute('placeholder');
    }
  }
  function applyLang() {
    captureLangNodes();
    var lang = state.settings.lang || 'zh-Hans';
    document.documentElement.setAttribute('lang', lang === 'en' ? 'en' : lang === 'zh-Hant' ? 'zh-Hant' : 'zh-CN');
    LANG_NODES.forEach(function (it) { it.n.nodeValue = it.o; });
    if (lang !== 'zh-Hans') {
      LANG_NODES.forEach(function (it) {
        var key = it.o.trim();
        if (!key) return;
        var val = null;
        if (lang === 'en') val = EN[key];
        else val = toHant(key);
        if (!val || val === key) return;
        it.n.nodeValue = it.o.replace(key, val);
      });
      var inputs = document.querySelectorAll('[placeholder]');
      for (var i = 0; i < inputs.length; i++) {
        var p0 = inputs[i]._ph || '';
        if (!p0) continue;
        var pv = lang === 'en' ? EN[p0.trim()] : toHant(p0);
        if (pv) inputs[i].setAttribute('placeholder', pv);
      }
    } else {
      var ph2 = document.querySelectorAll('[placeholder]');
      for (var j = 0; j < ph2.length; j++) {
        if (ph2[j]._ph) ph2[j].setAttribute('placeholder', ph2[j]._ph);
      }
    }
    var seg = $('langSeg');
    if (seg) {
      var bs = seg.querySelectorAll('button');
      for (var k = 0; k < bs.length; k++) {
        bs[k].classList.toggle('active', bs[k].getAttribute('data-lang') === (state.settings.lang || 'zh-Hans'));
      }
    }
    syncEffortUI();
  }

  function convOv(conv) { return (conv && conv.overrides) || {}; }
  function effSystem(conv) {
    var o = convOv(conv);
    return (typeof o.system === 'string' && o.system.trim()) ? o.system : (state.settings.system || '');
  }
  function effTemperature(conv) {
    var o = convOv(conv);
    if (typeof o.temperature === 'number') return o.temperature;
    return typeof state.settings.temperature === 'number' ? state.settings.temperature : 1;
  }
  function effAvatar(conv) {
    var g = state.settings.avatar || { user: '', ai: '' };
    var o = convOv(conv).avatar || {};
    return { user: o.user || g.user || '', ai: o.ai || g.ai || '' };
  }
  function effBg(conv) {
    var o = convOv(conv);
    return o.bg || state.settings.bg || { kind: 'none', veil: 0.8 };
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
    var b = effBg(activeConv());
    var isImg = b.kind === 'image' && !!b.image;
    document.body.classList.toggle('has-img', isImg);
    document.body.style.backgroundImage = isImg ? 'url("' + b.image + '")' : '';
    document.body.style.backgroundColor = (b.kind === 'color' && b.color) ? b.color : '';
    var v = typeof b.veil === 'number' ? b.veil : 0.8;
    document.documentElement.style.setProperty('--veil', String(Math.min(1, Math.max(0.2, v))));
    var sl = $('bgVeil');
    if (sl) { sl.value = String(Math.round(v * 100)); }
    var lab = $('bgVeilVal');
    if (lab) lab.textContent = Math.round(v * 100) + '%';
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

  function curQ(turn) {
    if (!turn.questions || !turn.questions.length) return null;
    var i = Math.min(Math.max(turn.activeQ || 0, 0), turn.questions.length - 1);
    return turn.questions[i];
  }
  function curA(turn) {
    var q = curQ(turn);
    if (!q) return null;
    return q.answers[Math.min(Math.max(q.activeA || 0, 0), q.answers.length - 1)];
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

  function answerVersHtml(turn) {
    var q = curQ(turn);
    if (!q || q.answers.length <= 1) return '';
    var idx = (q.activeA || 0) + 1;
    return '<span class="vers">' +
      '<button data-act="aprev" data-turn="' + turn.id + '"' + (idx <= 1 ? ' disabled' : '') + '>‹</button>' +
      '<span class="vnum">' + idx + ' / ' + q.answers.length + '</span>' +
      '<button data-act="anext" data-turn="' + turn.id + '"' + (idx >= q.answers.length ? ' disabled' : '') + '>›</button>' +
      '</span>';
  }

  function questionVersHtml(turn) {
    if (turn.questions.length <= 1) return '';
    var idx = (turn.activeQ || 0) + 1;
    return '<span class="qvers">' +
      '<button data-act="qprev" data-turn="' + turn.id + '"' + (idx <= 1 ? ' disabled' : '') + '>‹</button>' +
      '<span class="qnum">' + idx + ' / ' + turn.questions.length + '</span>' +
      '<button data-act="qnext" data-turn="' + turn.id + '"' + (idx >= turn.questions.length ? ' disabled' : '') + '>›</button>' +
      '</span>';
  }

  function aiInner(turn) {
    var ai = curA(turn);
    if (!ai) return '<div class="ai-head"><div class="avatar"><div class="spinner"></div></div><span>等待生成</span></div>';

    var av = effAvatar(activeConv());
    var avHtml;
    if (av.ai) avHtml = '<div class="avatar" style="background-image:url(' + av.ai + ')"></div>';
    else avHtml = '<div class="avatar def">' + (ai.streaming && !ai.text ? '<div class="spinner"></div>' : '<img src="whale.png" alt="">') + '</div>';

    var h = '';
    h += '<div class="ai-head">' + avHtml + '<span>' +
      (ai.streaming ? '正在生成' : 'DSChat') + '</span></div>';

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
      var u = ai.usage || {};
      var think = (u.output_tokens_details && u.output_tokens_details.thinking_tokens) || 0;
      var usageHtml = '';
      if (ai.usage) {
        usageHtml =
          '<span class="usg"><i class="ud hit"></i>命中 ' + fmtNum(u.cache_read_input_tokens || 0) + '</span>' +
          '<span class="usg"><i class="ud miss"></i>未命中 ' + fmtNum(u.input_tokens || 0) + '</span>' +
          '<span class="usg"><i class="ud out"></i>输出 ' + fmtNum(u.output_tokens || 0) + '</span>' +
          (think ? '<span class="usg"><i class="ud think"></i>思考 ' + fmtNum(think) + '</span>' : '') +
          (ai.cost ? '<span class="usg cost">' + money(ai.cost) + '</span>' : '');
      }

      h += '<div class="foot">';
      h += '<div class="usage">' + usageHtml + '</div>';
      h += '<div class="footbar">';
      h += '<span class="fact">' +
        '<button data-act="copy" data-turn="' + turn.id + '">' + ICON.copy + '复制</button>' +
        (turn.id === lastTurnId
          ? '<button data-act="regen" data-turn="' + turn.id + '">' + ICON.retry + '重新生成</button>'
          : '') +
        '</span>';
      h += answerVersHtml(turn);
      h += '</div></div>';
    }
    return h;
  }

  function turnNode(turn) {
    var q = curQ(turn);
    var wrap = document.createElement('div');
    wrap.className = 'turn';
    wrap.dataset.turn = turn.id;
    var uav = effAvatar(activeConv()).user;
    wrap.innerHTML =
      '<div class="msg user">' +
      '<div class="ubox">' +
      (q && q.files && q.files.some(function (f) { return f.kind === 'image'; })
        ? '<div class="uatt">' + q.files.filter(function (f) { return f.kind === 'image'; }).map(function (f) {
          return '<img src="data:image/jpeg;base64,' + f.data + '" data-full="data:image/jpeg;base64,' + f.data + '" alt="">';
        }).join('') + '</div>' : '') +
      (q && q.files && q.files.some(function (f) { return f.kind !== 'image'; })
        ? '<div class="ufiles">' + q.files.filter(function (f) { return f.kind !== 'image'; }).map(function (f) {
          return '<span class="ufile">' + ICON.link + esc(f.name) + '</span>';
        }).join('') + '</div>' : '') +
      (q && q.q ? '<div class="body">' + esc(q.q) + '</div>' : '') +
      '<div class="uact">' +
      '<span class="utime">' + hhmm(q ? q.ts : Date.now()) + '</span>' +
      questionVersHtml(turn) +
      '<button data-act="edit" data-turn="' + turn.id + '">' + ICON.edit + '编辑</button>' +
      '<button data-act="copyu" data-turn="' + turn.id + '">' + ICON.copy + '复制</button>' +
      '</div></div>' +
      '<div class="uavatar"' + (uav ? ' style="background-image:url(' + uav + ')"' : '') + '>' +
      (uav ? '' : AV_USER) + '</div>' +
      '</div>' +
      '<div class="msg ai" data-ai="' + turn.id + '"><div class="body">' + aiInner(turn) + '</div></div>';
    return wrap;
  }

  /* ---------- 问题跳转条 ---------- */
  var qpanelOpen = false, activeTurnIdx = 0, lastTurnId = null;

  function railTurns() {
    var c = activeConv();
    return c && c.turns ? c.turns : [];
  }

  function turnLabel(t) {
    var q = curQ(t);
    var s = q && q.q ? String(q.q).replace(/\s+/g, ' ').trim() : '';
    if (!s) return (q && q.files && q.files.length) ? '图片/文件' : '空提问';
    return s.slice(0, 5) + (s.length > 5 ? '…' : '');
  }

  function updateRail() {
    var rail = $('qrail');
    if (!rail) return;
    rail.classList.toggle('show', railTurns().length >= 3);
  }

  function renderQPanel() {
    var list = $('qpanelList');
    if (!list) return;
    var turns = railTurns();
    list.innerHTML = '';
    turns.forEach(function (t, i) {
      var b = document.createElement('button');
      b.className = 'qitem' + (i === activeTurnIdx ? ' active' : '');
      b.dataset.turn = t.id;
      b.innerHTML = '<span class="qi-n">' + (i + 1) + '</span>' +
        '<span class="qi-t">' + esc(turnLabel(t)) + '</span>' +
        (t.questions.length > 1 ? '<span class="qi-c">' + t.questions.length + ' 版</span>' : '');
      list.appendChild(b);
    });
    var act = list.querySelector('.qitem.active');
    if (act && act.scrollIntoView) { try { act.scrollIntoView({ block: 'nearest' }); } catch (e) {} }
  }

  function computeActiveTurn() {
    var turns = document.querySelectorAll('#messages .turn');
    if (!turns.length) return 0;
    var sc = $('scroller');
    var line = sc.getBoundingClientRect().top + 90;
    var idx = 0;
    for (var i = 0; i < turns.length; i++) {
      if (turns[i].getBoundingClientRect().top <= line) idx = i;
    }
    return idx;
  }

  function jumpToTurn(id) {
    var el = document.querySelector('#messages .turn[data-turn="' + id + '"]');
    if (!el) return;
    var sc = $('scroller');
    var y = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 58;
    y = Math.max(0, y);
    if (typeof sc.scrollTo === 'function') sc.scrollTo({ top: y, behavior: 'smooth' });
    else sc.scrollTop = y;
  }

  function openQPanel() {
    qpanelOpen = true;
    activeTurnIdx = computeActiveTurn();
    renderQPanel();
    $('qpanel').classList.add('open');
    $('qrail').classList.add('open');
  }
  function closeQPanel() {
    qpanelOpen = false;
    $('qpanel').classList.remove('open');
    $('qrail').classList.remove('open');
  }

  function renderMessages() {
    var box = $('messages');
    var conv = activeConv();
    lastTurnId = conv && conv.turns && conv.turns.length ? conv.turns[conv.turns.length - 1].id : null;
    box.innerHTML = '';
    var empty = $('empty');
    if (!conv || !conv.turns.length) {
      empty.classList.remove('hide');
      renderSuggests();
    } else {
      empty.classList.add('hide');
      var lastDay = '';
      conv.turns.forEach(function (t) {
        var q = curQ(t);
        var ts = (q && q.ts) || (t.questions[0] && t.questions[0].ts) || Date.now();
        var dk = dayKey(ts);
        if (dk !== lastDay) {
          var sep = document.createElement('div');
          sep.className = 'daysep';
          sep.innerHTML = '<span>' + dayLabel(ts) + '</span>';
          box.appendChild(sep);
          lastDay = dk;
        }
        box.appendChild(turnNode(t));
      });
    }
    closeQPanel();
    updateRail();
    applyBg();
    updateHeader();
  }

  function allTurns(conv) {
    var out = [], seen = {};
    function walk(list) {
      (list || []).forEach(function (t) {
        if (!t || seen[t.id]) return;
        seen[t.id] = 1;
        out.push(t);
        (t.questions || []).forEach(function (q) { walk(q.tail); });
      });
    }
    walk(conv && conv.turns ? conv.turns : []);
    return out;
  }

  function totalCost() {
    var t = 0;
    state.conversations.forEach(function (c) {
      allTurns(c).forEach(function (turn) {
        (turn.questions || []).forEach(function (q) {
          (q.answers || []).forEach(function (a) { if (a.cost) t += a.cost; });
        });
      });
    });
    return t;
  }

  function updateHeader() {
    var conv = activeConv(), s = state.settings;
    $('chatTitle').textContent = conv ? conv.title : '新对话';
    $('chatSub').textContent = [s.model, s.think ? '思考' : '快答', s.search ? '联网' : '不联网'].join(' · ');
    $('chipSearch').classList.toggle('on', !!s.search);
    syncEffortUI();
    updateCtxRing();
  }

  function estimateTokens(conv) {
    var chars = 0, imgs = 0, docs = 0;
    (conv.turns || []).forEach(function (t) {
      var q = curQ(t);
      if (!q) return;
      chars += (q.q || '').length;
      (q.files || []).forEach(function (f) {
        if (f.kind === 'image') imgs++;
        else if (f.kind === 'text') chars += (f.text || '').length;
        else docs++;
      });
      var a = curA(t);
      if (a && a.text) chars += a.text.length;
    });
    return Math.round(chars / 1.6) + imgs * 800 + docs * 4000;
  }

  function ctxInfo(conv) {
    if (!conv) return { used: 0, limit: 1000000, pct: 0 };
    var used = 0, have = false;
    for (var i = conv.turns.length - 1; i >= 0; i--) {
      var a = curA(conv.turns[i]);
      if (a && a.usage) {
        used = (a.usage.input_tokens || 0) + (a.usage.cache_read_input_tokens || 0);
        have = true;
        break;
      }
    }
    if (!have) used = estimateTokens(conv);
    var limit = conv.ctxLimit || 1000000;
    return { used: used, limit: limit, pct: Math.min(100, used / limit * 100), exact: have };
  }

  function updateCtxRing() {
    var conv = activeConv();
    var ring = $('ctxRing');
    if (!ring) return;
    var i = ctxInfo(conv);
    var C = 2 * Math.PI * 11;
    var fg = $('ringFg');
    if (fg) fg.style.strokeDashoffset = String(C * (1 - i.pct / 100));
    $('ctxPct').textContent = i.pct > 0 && i.pct < 1 ? '<1%' : Math.round(i.pct) + '%';
    ring.classList.toggle('warn', i.pct >= 70 && i.pct < 90);
    ring.classList.toggle('full', i.pct >= 90);
  }

  function fillCtx() {
    var conv = activeConv();
    var i = ctxInfo(conv);
    var body = $('ctxBody');
    var left = Math.max(0, i.limit - i.used);
    var turns = conv ? conv.turns.length : 0;
    body.innerHTML =
      '<div class="ctxbig">' + i.pct.toFixed(i.pct < 10 ? 1 : 0) + '%</div>' +
      '<div class="ctxsub">' + (i.exact ? '按最近一次请求的实际用量' : '按字数估算（还没成功请求过）') + '</div>' +
      '<div class="ctxbar"><i style="width:' + Math.min(100, i.pct) + '%"></i></div>' +
      '<div class="ctxrows">' +
      '<div class="ctxrow"><span>已用</span><span>' + i.used.toLocaleString() + ' tokens</span></div>' +
      '<div class="ctxrow"><span>剩余</span><span>' + left.toLocaleString() + ' tokens</span></div>' +
      '<div class="ctxrow"><span>上限</span><span>' + i.limit.toLocaleString() + ' tokens</span></div>' +
      '<div class="row ctxrow"><span>对话轮数</span><span>' + turns + ' 轮</span></div>' +
      '</div>' +
      '<p class="note">上限按模型文档的 1M 计算；如果服务端返回更小的限制，这里会自动改成实际值。' +
      '费用仅为估算，高峰期为两倍。</p>';
  }

  function fillConvSet() {
    var conv = ensureConv();
    var o = convOv(conv);
    $('csTitle').value = conv.title || '';
    var t = effTemperature(conv);
    $('csTemp').value = String(Math.round(t * 10));
    $('csTempVal').textContent = t.toFixed(1);
    $('csSystem').value = typeof o.system === 'string' ? o.system : '';
    var av = effAvatar(conv);
    var u = $('csAvUser'), i = $('csAvAi');
    u.style.backgroundImage = av.user ? 'url(' + av.user + ')' : '';
    u.innerHTML = av.user ? '' : AV_USER.replace('<svg', '<svg class="def-user"');
    i.style.backgroundImage = av.ai ? 'url(' + av.ai + ')' : '';
    i.innerHTML = av.ai ? '' : '<img src="whale.png" alt="" style="width:70%;height:70%;object-fit:contain">';
    var ci = ctxInfo(conv);
    $('csCtxLine').textContent = '已用 ' + ci.used.toLocaleString() + ' / ' + ci.limit.toLocaleString() +
      ' tokens（' + Math.round(ci.pct) + '%）';
  }

  function openConvSet() {
    ensureConv();
    fillConvSet();
    $('convSetSheet').classList.add('open');
    $('scrim').classList.add('show');
  }
  function closeConvSet() {
    $('convSetSheet').classList.remove('open');
    $('scrim').classList.remove('show');
  }

  function openCtx() { fillCtx(); $('ctxSheet').classList.add('open'); $('scrim').classList.add('show'); }
  function closeCtx() { $('ctxSheet').classList.remove('open'); $('scrim').classList.remove('show'); }

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
      var q = curQ(t);
      if (!q) return;
      out.push({ role: 'user', content: userContent(q) });
      if (t === excludeTurn) return;
      var a = q.answers[Math.min(Math.max(q.activeA || 0, 0), q.answers.length - 1)];
      if (!a) return;
      var hasContent = (a.blocks && a.blocks.length) || a.text;
      if (!hasContent) { out.pop(); return; }   // 这一轮没有回答，整轮丢掉，避免 user,user
      if (a.blocks && a.blocks.length) out.push({ role: 'assistant', content: a.blocks });
      else if (a.text) out.push({ role: 'assistant', content: [{ type: 'text', text: a.text }] });
    });
    return out;
  }

  function userContent(q) {
    if (!q.files || !q.files.length) return q.q;
    var blocks = [];
    q.files.forEach(function (f) {
      if (!f) return;
      if (f.kind === 'image') blocks.push({ type: 'image', source: { type: 'base64', media_type: f.media, data: f.data } });
      else if (f.kind === 'doc') blocks.push({ type: 'document', source: { type: 'file', file_id: f.fileId } });
      else if (f.kind === 'text') blocks.push({ type: 'document', source: { type: 'text', media_type: 'text/plain', data: f.text } });
    });
    if (q.q) blocks.push({ type: 'text', text: q.q });
    return blocks;
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

  function trimMessages(msgs, limit) {
    function est(list) {
      var c = 0;
      for (var i = 0; i < list.length; i++) c += JSON.stringify(list[i]).length;
      return c / 2.2;
    }
    var guard = 0;
    while (msgs.length > 2 && est(msgs) > limit * 0.85 && guard++ < 300) {
      msgs.shift();
      if (msgs.length && msgs[0].role !== 'user') msgs.shift();
    }
    return msgs;
  }

  function runStream(conv, turn) {
    var s = state.settings;
    var ai = curA(turn);
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

    var ef = s.effort || 'high';
    var body = {
      model: s.model, stream: true, max_tokens: MAX_TOKENS,
      thinking: { type: ef === 'none' ? 'disabled' : 'enabled' },
      messages: apiMessages(conv, turn)
    };
    if (ef !== 'none') body.output_config = { effort: ef };
    var sysText = effSystem(conv);
    if (sysText && sysText.trim()) body.system = sysText.trim();
    body.temperature = effTemperature(conv);
    if (s.search) body.tools = [
      { type: 'deepseek_web_search', name: 'deepseek_web_search' },
      { type: 'deepseek_read_url', name: 'deepseek_read_url' }
    ];

    function finish() {
      cleanupBlocks(ai);
      if (ai.usage) ai.cost = costOf(ai.usage, s.model);
      if (!ai.text && !ai.error && !(ai.blocks || []).some(function (b) { return b.type === 'text' && b.text; })) {
        ai.error = '模型没有返回内容，点重新生成再试一次';
      }
      if (ai.cost || ai.usage) {
        var dk = dayKey(Date.now());
        state.settings.usageByDay = state.settings.usageByDay || {};
        var rec = state.settings.usageByDay[dk];
        if (typeof rec === 'number') rec = { c: rec, t: 0, n: 0 };
        if (!rec) rec = { c: 0, t: 0, n: 0 };
        rec.c += ai.cost || 0;
        if (ai.usage) {
          rec.t += (ai.usage.input_tokens || 0) + (ai.usage.cache_read_input_tokens || 0) + (ai.usage.output_tokens || 0);
        }
        rec.n += 1;
        state.settings.usageByDay[dk] = rec;
      }
      ai.streaming = false;
      conv.updatedAt = Date.now();
      save(true);
      paint();
      setBusy(false);
    }

    var apiUrl = String(s.base || 'https://api.deepseek.com').replace(/\/+$/, '') + API_PATH;
    var headers = {
      'content-type': 'application/json',
      'x-api-key': (s.apiKey || '').trim(),
      'anthropic-version': '2023-06-01'
    };
    var hasDoc = JSON.stringify(body.messages).indexOf('"document"') >= 0;
    var betas = [];
    if (hasDoc) betas.push('files-api-2025-04-14');
    if (estimateTokens(conv) > 28000) betas.push('context-1m-2025-08-07');
    if (betas.length) headers['anthropic-beta'] = betas.join(',');

    function sendOnce(b, allowRetry) {
      return fetch(apiUrl, {
        method: 'POST', headers: headers, body: JSON.stringify(b), signal: state.abort.signal
      }).then(function (res) {
        if (res.ok) return res;
        return res.text().then(function (txt) {
          var msg = txt;
          try { var j = JSON.parse(txt); msg = (j.error && (j.error.message || j.error.type)) || txt; } catch (e) {}
          if (allowRetry && b.output_config && String(txt).indexOf('output_config') >= 0) {
            delete b.output_config;
            return sendOnce(b, false);
          }
          // 图片被拒时退回纯文本重发一次，至少别让整条消息丢掉
          if (allowRetry && (res.status === 400 || res.status === 413) &&
              JSON.stringify(b.messages).indexOf('"image"') >= 0) {
            b.messages = b.messages.map(function (m) {
              if (!Array.isArray(m.content)) return m;
              var kept = m.content.filter(function (c) { return c && c.type !== 'image'; });
              if (!kept.length) kept = [{ type: 'text', text: '（图片未能发送）' }];
              return { role: m.role, content: kept };
            });
            toast('图片没被接受，已按纯文本重发');
            return sendOnce(b, false);
          }
          var m = String(txt).match(/exceeds max (\d+) tokens/i);
          if (allowRetry && m && b.messages && b.messages.length > 2) {
            var lim = parseInt(m[1], 10);
            if (lim > 1000) {
              conv.ctxLimit = lim;
              b.messages = trimMessages(b.messages, lim);
              save(true);
              toast('上下文超过 ' + lim.toLocaleString() + '，已省略最早的对话重试');
              return sendOnce(b, false);
            }
          }
          throw new Error('HTTP ' + res.status + ' · ' + String(msg).slice(0, 200));
        });
      });
    }

    sendOnce(body, true).then(function (res) {
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
        var msg = (err && err.message) || '请求失败';
        if (/image|media|content/i.test(msg) && JSON.stringify(body.messages).indexOf('"image"') >= 0) {
          msg += '　（图片可能不被当前模型接受，试试切成 deepseek-flash、或减少图片）';
        }
        ai.error = msg;
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
    conv = { id: uid(), title: '新对话', createdAt: Date.now(), updatedAt: Date.now(), pinned: false, fav: false, turns: [] };
    state.conversations.unshift(conv);
    state.activeId = conv.id;
    return conv;
  }

  /* ---------- 附件 ---------- */
  var pending = [];

  function isTextLike(file) {
    if (file.type && file.type.indexOf('text/') === 0) return true;
    return /\.(txt|md|markdown|csv|json|js|ts|jsx|tsx|py|java|c|h|cpp|go|rs|rb|php|html|css|xml|yml|yaml|log|sh|ini|conf)$/i.test(file.name || '');
  }

  function renderAttach() {
    var row = $('attachRow');
    if (!row) return;
    row.innerHTML = '';
    pending.forEach(function (f, i) {
      var d = document.createElement('div');
      d.className = 'att' + (f.uploading ? ' uploading' : '');
      var head = f.kind === 'image' && f.data
        ? '<img class="thumb" src="data:image/jpeg;base64,' + f.data + '" alt="">'
        : '<span class="ficon">' + (f.uploading ? '<span class="spin2"></span>' : ICON.link) + '</span>';
      d.innerHTML = head + '<span class="nm">' + esc(f.name) + '</span>' +
        '<button class="rm" data-rm="' + i + '">✕</button>';
      row.appendChild(d);
    });
    var btns = row.querySelectorAll('[data-rm]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].onclick = function () {
        pending.splice(parseInt(this.getAttribute('data-rm'), 10), 1);
        renderAttach();
      };
    }
  }

  function resizeImage(file, cb) {
    var fr = new FileReader();
    fr.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 1400;
        var sc = Math.min(1, max / Math.max(img.width, img.height));
        var cv = document.createElement('canvas');
        cv.width = Math.round(img.width * sc);
        cv.height = Math.round(img.height * sc);
        var ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        var data;
        try { data = cv.toDataURL('image/jpeg', 0.8); } catch (e) { cb(null); return; }
        cb(data.indexOf('base64,') === 0 ? data.slice(7) : data.split(',')[1]);
      };
      img.onerror = function () { cb(null); };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  }

  function uploadDoc(file, item) {
    var fd = new FormData();
    fd.append('purpose', 'text_recognition');
    fd.append('file', file, file.name);
    var base = String(state.settings.base || 'https://api.deepseek.com').replace(/\/+$/, '');
    fetch(base + '/files', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + (state.settings.apiKey || '').trim() },
      body: fd
    }).then(function (res) {
      return res.text().then(function (txt) {
        if (!res.ok) throw new Error('HTTP ' + res.status + ' · ' + txt.slice(0, 120));
        return JSON.parse(txt);
      });
    }).then(function (j) {
      item.fileId = j.id;
      item.uploading = false;
      renderAttach();
    }).catch(function (err) {
      item.uploading = false;
      item.error = (err && err.message) || '上传失败';
      renderAttach();
      toast('文件上传失败');
    });
  }

  function addFiles(list) {
    var arr = [];
    for (var i = 0; i < list.length; i++) arr.push(list[i]);
    arr.slice(0, 6).forEach(function (file) {
      if (pending.length >= 6) return;
      if (/^image\//.test(file.type || '')) {
        var item = { kind: 'image', name: file.name || '图片', media: 'image/jpeg', uploading: true };
        pending.push(item);
        renderAttach();
        resizeImage(file, function (b64) {
          if (!b64) { pending = pending.filter(function (x) { return x !== item; }); renderAttach(); toast('图片读取失败'); return; }
          item.data = b64;
          item.uploading = false;
          renderAttach();
        });
        return;
      }
      if (isTextLike(file)) {
        if (file.size > 512 * 1024) { toast('文本文件太大（限 512KB）'); return; }
        var t = { kind: 'text', name: file.name, text: '', uploading: true };
        pending.push(t);
        renderAttach();
        var fr = new FileReader();
        fr.onload = function () { t.text = String(fr.result || '').slice(0, 400000); t.uploading = false; renderAttach(); };
        fr.onerror = function () { pending = pending.filter(function (x) { return x !== t; }); renderAttach(); };
        fr.readAsText(file);
        return;
      }
      if (/\.(pdf|doc|docx|ppt|pptx)$/i.test(file.name || '')) {
        if (!state.settings.apiKey) { openSheet(); toast('先填 API Key'); return; }
        var d = { kind: 'doc', name: file.name, fileId: null, uploading: true };
        pending.push(d);
        renderAttach();
        uploadDoc(file, d);
        return;
      }
      toast('暂不支持这种文件');
    });
  }

  function sendText(text) {
    text = (text || '').trim();
    var ready = pending.filter(function (f) {
      return f.kind === 'image' ? !!f.data : f.kind === 'text' ? !!f.text : !!f.fileId;
    });
    if (!text && !ready.length) { toast('说点什么，或者加张图片'); return; }
    if (!state.settings.apiKey) { openSheet(); toast('先填 API Key'); return; }
    if (state.streaming) return;

    if (pending.some(function (f) { return f.uploading; })) { toast('文件还在处理，稍等'); return; }
    if (pending.some(function (f) { return f.kind === 'image' && !f.data; })) { toast('图片还没读好，重选一次'); return; }
    if (pending.some(function (f) { return f.kind === 'doc' && !f.fileId; })) { toast('文件还没上传完'); return; }
    if (pending.some(function (f) { return f.kind === 'image'; }) && state.settings.model !== 'deepseek-flash') {
      toast('看图要先切到 deepseek-flash');
      return;
    }
    var conv = ensureConv();
    var q0 = makeQuestion(text);
    q0.files = pending.filter(function (f) { return f.kind === 'image' ? !!f.data : f.kind === 'text' ? !!f.text : !!f.fileId; });
    if (!text && q0.files.length) q0.title = '图片 · ' + q0.files[0].name;
    pending = [];
    renderAttach();
    var turn = { id: uid(), activeQ: 0, questions: [q0] };
    conv.turns.push(turn);
    if (conv.turns.length === 1) conv.title = text ? convTitleOf(text) : (q0.title || '新对话');
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
    var q = curQ(turn);
    q.answers.push(newAi());
    q.activeA = q.answers.length - 1;
    conv.updatedAt = Date.now();
    save(true);
    runStream(conv, turn);
  }

  function editAndRegenerate(turn, text) {
    var conv = activeConv();
    if (!conv) return;
    var idx = conv.turns.indexOf(turn);
    var old = curQ(turn);
    var oldFiles = old && old.files ? old.files.slice() : null;
    // 旧版本收下它之后的所有轮次，形成独立分支
    if (idx >= 0) {
      if (old) old.tail = conv.turns.slice(idx + 1);
      conv.turns = conv.turns.slice(0, idx + 1);
    }
    var nq = makeQuestion(text);
    if (oldFiles && oldFiles.length) nq.files = oldFiles;
    nq.tail = [];
    turn.questions.push(nq);
    turn.activeQ = turn.questions.length - 1;
    conv.updatedAt = Date.now();
    save(true);
    runStream(conv, turn);
  }

  function switchQ(turn, delta) {
    if (state.streaming) { toast('这条还在生成'); return; }
    var i = (turn.activeQ || 0) + delta;
    if (i < 0 || i >= turn.questions.length) return;
    var conv = activeConv();
    var idx = conv ? conv.turns.indexOf(turn) : -1;
    if (conv && idx >= 0) {
      var cur = curQ(turn);
      if (cur) cur.tail = conv.turns.slice(idx + 1);   // 存下当前分支后续
      turn.activeQ = i;
      var nq = curQ(turn);
      conv.turns = conv.turns.slice(0, idx + 1).concat(nq && nq.tail ? nq.tail : []);
    } else {
      turn.activeQ = i;
    }
    save(true);
    renderMessages();
    haptic();
  }

  function switchA(turn, delta) {
    if (state.streaming) { toast('这条还在生成'); return; }
    var q = curQ(turn);
    var i = (q.activeA || 0) + delta;
    if (i < 0 || i >= q.answers.length) return;
    q.activeA = i;
    save(true);
    renderMessages();
    haptic();
  }

  /* ---------- 抽屉 / 菜单 ---------- */
  function sortedConvs() {
    return state.conversations.slice().sort(function (a, b) {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }

  var convQuery = '';

  function escRe(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function snippetHtml(text, q) {
    var i = text.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return esc(text.slice(0, 60));
    var start = Math.max(0, i - 22);
    var end = Math.min(text.length, i + q.length + 46);
    var part = (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
    var safe = esc(part);
    try {
      return safe.replace(new RegExp('(' + escRe(esc(q)) + ')', 'ig'), '<mark>$1</mark>');
    } catch (e) { return safe; }
  }

  function convHits(c, q) {
    var hits = [];
    var lower = q.toLowerCase();
    function scan(text, who) {
      if (!text || hits.length >= 3) return;
      if (String(text).toLowerCase().indexOf(lower) < 0) return;
      hits.push({ who: who, html: snippetHtml(String(text), q) });
    }
    scan(c.title, '标题');
    allTurns(c).forEach(function (t) {
      (t.questions || []).forEach(function (qu) {
        scan(qu.q, '提问');
        (qu.answers || []).forEach(function (a) { scan(a.text, '回答'); });
      });
    });
    return hits;
  }

  function dayGroup(ts) {
    var d = new Date(ts || 0), now = new Date();
    var k = dayKey(d.getTime());
    if (k === dayKey(now.getTime())) return '今天';
    if (k === dayKey(now.getTime() - 86400000)) return '昨天';
    if (now.getTime() - d.getTime() < 7 * 86400000) return '近 7 天';
    if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) return '本月';
    return '更早';
  }

  function convRow(c, hits) {
    var d = document.createElement('div');
    d.className = 'conv' + (c.id === state.activeId ? ' active' : '') + (hits ? ' hit' : '');
    d.dataset.cid = c.id;
    var badges = '';
    if (c.pinned) badges += '<span class="fav">' + ICON.pin + '置顶</span>';
    if (c.fav) badges += '<span class="fav">' + ICON.star + '收藏</span>';

    var sub;
    if (hits && hits.length) {
      sub = hits.map(function (h) {
        return '<div class="conv-snip"><span class="who">' + h.who + '</span>' + h.html + '</div>';
      }).join('');
    } else {
      sub = '<div class="conv-sub">' + (c.turns ? c.turns.length : 0) + ' 条提问' + (badges ? ' · ' + badges : '') + '</div>';
    }
    d.innerHTML = '<div class="conv-main"><div class="conv-title">' + esc(c.title || '新对话') + '</div>' + sub + '</div>' +
      '<button class="more" data-act="more" data-cid="' + c.id + '" aria-label="更多">⋯</button>';
    return d;
  }

  function renderConvList() {
    var box = $('convlist');
    box.innerHTML = '';
    var q = convQuery.trim();

    if (q) {
      var matched = [];
      sortedConvs().forEach(function (c) {
        var hits = convHits(c, q);
        if (hits.length) matched.push({ c: c, hits: hits });
      });
      if (!matched.length) {
        box.innerHTML = '<div class="search-none">没有找到「' + esc(q) + '」<br>试试更短的词</div>';
        return;
      }
      matched.forEach(function (m) { box.appendChild(convRow(m.c, m.hits)); });
      return;
    }

    if (!state.conversations.length) { box.innerHTML = '<div class="none">还没有对话</div>'; return; }

    var pinned = [], groups = {}, order = ['今天', '昨天', '近 7 天', '本月', '更早'];
    sortedConvs().forEach(function (c) {
      if (c.pinned) { pinned.push(c); return; }
      var g = dayGroup(c.updatedAt);
      (groups[g] = groups[g] || []).push(c);
    });

    if (pinned.length) {
      var pg = document.createElement('div');
      pg.className = 'convg';
      pg.textContent = '置顶';
      box.appendChild(pg);
      pinned.forEach(function (c) { box.appendChild(convRow(c, null)); });
    }
    order.forEach(function (g) {
      if (!groups[g] || !groups[g].length) return;
      var gh = document.createElement('div');
      gh.className = 'convg';
      gh.textContent = g;
      box.appendChild(gh);
      groups[g].forEach(function (c) { box.appendChild(convRow(c, null)); });
    });
  }

  function showAgree() {
    $('agreeSheet').classList.add('open');
    $('scrim').classList.add('show');
  }
  function closeAgree() {
    $('agreeSheet').classList.remove('open');
    $('scrim').classList.remove('show');
  }

  function openDrawer() {
    convQuery = '';
    var si = $('convSearch');
    if (si) { si.value = ''; document.querySelector('.drawer-search').classList.remove('has'); }
    renderConvList(); $('drawer').classList.add('open'); $('scrim').classList.add('show'); }
  function closeDrawer() { $('drawer').classList.remove('open'); $('scrim').classList.remove('show'); }
  function openSheet() {
    fillSheet();
    $('sheet').classList.add('open');
    $('scrim').classList.add('show');
    var body = $('sheet').querySelector('.sheet-body');
    if (body) body.scrollTop = 0;
  }
  function closeSheet() { $('sheet').classList.remove('open'); $('scrim').classList.remove('show'); }
  function openEdit(turn) {
    state.editing = turn;
    $('editText').value = curQ(turn).q;
    $('editSheet').classList.add('open');
    $('scrim').classList.add('show');
    setTimeout(function () { $('editText').focus(); }, 150);
  }
  function closeEdit() { $('editSheet').classList.remove('open'); $('scrim').classList.remove('show'); state.editing = null; }

  function openConvMenu(cid) {
    var c = findConv(cid);
    if (!c) return;
    state.menuCid = cid;
    var body = $('convMenuBody');
    body.innerHTML = '';

    function item(icon, label, cls, disabled, fn) {
      var b = document.createElement('button');
      b.className = 'menu-item' + (cls ? ' ' + cls : '');
      b.disabled = !!disabled;
      b.innerHTML = icon + '<span>' + label + '</span>';
      b.onclick = fn;
      body.appendChild(b);
    }

    item(ICON.pin, c.pinned ? '取消置顶' : '置顶对话', '', false, function () {
      c.pinned = !c.pinned; save(true); renderConvList(); closeMenu(); toast(c.pinned ? '已置顶' : '已取消置顶');
    });
    item(ICON.star, c.fav ? '取消收藏' : '收藏对话', '', false, function () {
      c.fav = !c.fav; save(true); renderConvList(); closeMenu(); toast(c.fav ? '已收藏，需先取消收藏才能删除' : '已取消收藏');
    });

    var sep = document.createElement('div'); sep.className = 'menu-sep'; body.appendChild(sep);

    item(ICON.trash, '删除对话', 'danger', !!c.fav, function () {
      if (c.fav) return;
      closeMenu();
      ask('删除对话', '「' + (c.title || '新对话') + '」将被永久删除，无法恢复。', '删除', true, function () {
        state.conversations = state.conversations.filter(function (x) { return x.id !== cid; });
        if (state.activeId === cid) state.activeId = state.conversations[0] ? state.conversations[0].id : null;
        save(true); renderMessages(); renderConvList();
        toast('已删除');
      });
    });

    if (c.fav) {
      var hint = document.createElement('div');
      hint.className = 'menu-hint';
      hint.textContent = '已收藏的对话不能删除，先取消收藏。';
      body.appendChild(hint);
    }

    $('convMenu').classList.add('open');
    $('scrim').classList.add('show');
  }
  function closeMenu() { $('convMenu').classList.remove('open'); if (!$('sheet').classList.contains('open')) $('scrim').classList.remove('show'); }

  function renderModelCards() {
    var box = $('modelCards');
    if (!box) return;
    var cards = box.querySelectorAll('.modelcard');
    for (var i = 0; i < cards.length; i++) {
      cards[i].classList.toggle('active', cards[i].getAttribute('data-model') === state.settings.model);
    }
  }

  var chartSel = -1, chartDays = [];

  function dayShort(ts) {
    var d = new Date(ts);
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  function paintChartSel() {
    var box = $('chart30');
    if (!box) return;
    var bars = box.querySelectorAll('.bar');
    for (var i = 0; i < bars.length; i++) bars[i].classList.toggle('sel', i === chartSel);
    var el = $('chartSel');
    if (!el) return;
    var d = chartDays[chartSel];
    if (!d) { el.textContent = '点一下柱子，看当天用量'; return; }
    var bits = [dayLabel(d.ts), money(d.c)];
    if (d.t) bits.push(fmtNum(d.t) + ' tokens');
    if (d.n) bits.push(d.n + ' 条回答');
    el.textContent = bits.join(' · ');
  }

  /* ---------- 裁剪 ---------- */
  var crop = { img: null, aspect: 1, cb: null, zoom: 1, ox: 0, oy: 0, w: 0, h: 0, base: 1, iw: 0, ih: 0 };
  var cropTarget = 'user';

  function cropApply() {
    var el = $('cropImg');
    el.style.width = crop.iw + 'px';
    el.style.height = crop.ih + 'px';
    el.style.transform = 'translate(' + crop.ox + 'px,' + crop.oy + 'px)';
  }

  function cropClamp() {
    crop.iw = crop.img.width * crop.base * crop.zoom;
    crop.ih = crop.img.height * crop.base * crop.zoom;
    crop.ox = Math.min(0, Math.max(crop.w - crop.iw, crop.ox));
    crop.oy = Math.min(0, Math.max(crop.h - crop.ih, crop.oy));
    cropApply();
  }

  function openCrop(src, aspect, cb) {
    var img = new Image();
    img.onload = function () {
      var box = $('cropBox');
      var maxH = Math.min(window.innerHeight * 0.42, 360);
      var maxW = window.innerWidth - 96;
      var h = maxH, w = h * aspect;
      if (w > maxW) { w = maxW; h = w / aspect; }
      crop = { img: img, aspect: aspect, cb: cb, zoom: 1, w: w, h: h, base: Math.max(w / img.width, h / img.height) };
      crop.iw = img.width * crop.base;
      crop.ih = img.height * crop.base;
      crop.ox = (w - crop.iw) / 2;
      crop.oy = (h - crop.ih) / 2;
      box.style.width = w + 'px';
      box.style.height = h + 'px';
      var el = $('cropImg');
      el.src = src;
      cropApply();
      $('cropZoom').value = 100;
      $('cropSheet').classList.add('open');
      $('scrim').classList.add('show');
    };
    img.onerror = function () { toast('这张图打不开'); };
    img.src = src;
  }

  function closeCrop() {
    $('cropSheet').classList.remove('open');
    $('scrim').classList.remove('show');
  }

  function cropConfirm() {
    if (!crop.img) { closeCrop(); return; }
    var outW = crop.aspect >= 0.9 ? 512 : 900;
    var outH = Math.round(outW / crop.aspect);
    var cv = document.createElement('canvas');
    cv.width = outW;
    cv.height = outH;
    var ctx = cv.getContext('2d');
    var k = outW / crop.w;
    try {
      ctx.drawImage(crop.img, crop.ox * k, crop.oy * k, crop.iw * k, crop.ih * k);
    } catch (e) { toast('裁剪失败'); return; }
    var data;
    try { data = cv.toDataURL('image/jpeg', crop.aspect >= 0.9 ? 0.86 : 0.76); } catch (e) { toast('裁剪失败'); return; }
    var cb = crop.cb;
    closeCrop();
    if (cb) cb(data);
  }

  function renderAvatarSettings() {
    var a = state.settings.avatar || { user: '', ai: '' };
    var u = $('avUser'), i = $('avAi');
    if (u) {
      u.style.backgroundImage = a.user ? 'url(' + a.user + ')' : '';
      u.innerHTML = a.user ? '' : AV_USER.replace('<svg', '<svg class="def-user"');
    }
    if (i) {
      i.style.backgroundImage = a.ai ? 'url(' + a.ai + ')' : '';
      i.innerHTML = a.ai ? '' : '<img src="whale.png" alt="" style="width:70%;height:70%;object-fit:contain">';
    }
  }

  function renderChart() {
    var box = $('chart30');
    if (!box) return;
    chartDays = [];
    var total = 0;
    for (var i = 14; i >= 0; i--) {
      var ts = Date.now() - i * 86400000;
      var k = dayKey(ts);
      var rec = (state.settings.usageByDay || {})[k];
      if (typeof rec === 'number') rec = { c: rec, t: 0, n: 0 };
      rec = rec || { c: 0, t: 0, n: 0 };
      total += rec.c;
      chartDays.push({ ts: ts, c: rec.c, t: rec.t || 0, n: rec.n || 0 });
    }
    var max = 0;
    chartDays.forEach(function (x) { if (x.c > max) max = x.c; });
    box.innerHTML = chartDays.map(function (x) {
      var h = max ? Math.max(4, Math.round(x.c / max * 100)) : 4;
      return '<div class="bar' + (x.c ? ' has' : '') + '" style="height:' + h + '%" title="' + dayShort(x.ts) + '  ' + money(x.c) + '"></div>';
    }).join('');

    var from = $('axisFrom'), to = $('axisTo');
    if (from) from.textContent = dayShort(chartDays[0].ts);
    if (to) to.textContent = '今天';

    if (chartSel < 0) chartSel = 14;
    paintChartSel();

    var note = $('chartNote');
    if (note) note.textContent = '近 15 天合计 ' + money(total);

    function scrub(e) {
      var rect = box.getBoundingClientRect();
      if (!rect.width) return;
      var x = e.clientX - rect.left;
      var idx = Math.floor(x / rect.width * chartDays.length);
      idx = Math.max(0, Math.min(chartDays.length - 1, idx));
      if (idx !== chartSel) {
        chartSel = idx;
        paintChartSel();
        haptic();
      }
    }
    var down = false;
    box.onpointerdown = function (e) { down = true; scrub(e); try { box.setPointerCapture(e.pointerId); } catch (err) {} };
    box.onpointermove = function (e) { if (down) scrub(e); };
    box.onpointerup = function () { down = false; };
    box.onpointercancel = function () { down = false; };
    box.onpointerleave = function () { down = false; };
  }

  var EFFORTS = [
    { v: 'none', t: '不思考', d: '关闭思考，最快最省' },
    { v: 'low', t: '低', d: '简单问题，少量思考' },
    { v: 'high', t: '高', d: '默认，日常专用' },
    { v: 'max', t: '最高', d: '难题，复杂推理' }
  ];
  var EFFORT_COLORS = ['#6b7385', '#2fd3c0', '#4d6bfe', '#ff7a45'];

  function effortIndex(v) {
    for (var i = 0; i < EFFORTS.length; i++) if (EFFORTS[i].v === v) return i;
    return 2;
  }
  function syncEffortUI() {
    var i = effortIndex(state.settings.effort || 'high');
    var col = EFFORT_COLORS[i];
    var lab = $('effortLabel');
    if (lab) {
      var lang = state.settings.lang || 'zh-Hans';
      var name = EFFORTS[i].t;
      if (lang === 'en') name = ['Off', 'Low', 'High', 'Max'][i];
      else if (lang === 'zh-Hant') name = toHant(name);
      lab.textContent = (lang === 'en' ? 'Reasoning ' : '推理 ') + name;
    }
    var chip = $('chipEffort');
    if (chip) {
      chip.style.setProperty('--lv', col);
      chip.classList.toggle('on', i > 0);
    }
    var dot = $('effDot');
    if (dot) { dot.style.background = col; dot.style.color = col; }

    var gauge = $('gauge');
    if (gauge) {
      gauge.style.setProperty('--lv', col);
      gauge.style.setProperty('--lv2', EFFORT_COLORS[Math.min(3, i + 1)]);
      var d = gaugeSectorPath(i);
      var sector = $('gSector');
      if (sector) sector.setAttribute('d', d);
      var sheen = $('gSheen');
      if (sheen) sheen.setAttribute('d', d);
      var trail = $('gTrail');
      if (trail) trail.setAttribute('d', gaugeTrailPath(i));
      var ang = i * 60 * Math.PI / 180;
      var nx = (120 - 88 * Math.cos(ang)).toFixed(1);
      var ny = (120 - 88 * Math.sin(ang)).toFixed(1);
      var needle = $('gNeedle');
      if (needle) { needle.setAttribute('x2', nx); needle.setAttribute('y2', ny); }
      var tip = $('gTip');
      if (tip) { tip.setAttribute('cx', nx); tip.setAttribute('cy', ny); }
      var labels = $('gLabels').querySelectorAll('span');
      for (var k = 0; k < labels.length; k++) labels[k].classList.toggle('on', k === i);
      var nm = $('effName'), ds = $('effDesc');
      if (nm) { nm.textContent = EFFORTS[i].t; nm.style.color = col; }
      if (ds) ds.textContent = EFFORTS[i].d;
    }
  }

  function gaugeSectorPath(i) {
    if (i <= 0) return '';
    var sweep = i * 60 * Math.PI / 180;
    var x = 120 - 96 * Math.cos(sweep);
    var y = 120 - 96 * Math.sin(sweep);
    return 'M120 120 L24 120 A96 96 0 0 1 ' + x.toFixed(2) + ' ' + y.toFixed(2) + ' Z';
  }

  function gaugeTrailPath(i) {
    if (i <= 0) return '';
    var r = 90;
    var a1 = i * 60 * Math.PI / 180;
    var a2 = Math.max(0, i * 60 - 11) * Math.PI / 180;
    var x1 = 120 - r * Math.cos(a1), y1 = 120 - r * Math.sin(a1);
    var x2 = 120 - r * Math.cos(a2), y2 = 120 - r * Math.sin(a2);
    return 'M120 120 L' + x1.toFixed(1) + ' ' + y1.toFixed(1) +
      ' A' + r + ' ' + r + ' 0 0 1 ' + x2.toFixed(1) + ' ' + y2.toFixed(1) + ' Z';
  }

  function buildGauge() {
    var ticks = $('gTicks'), labels = $('gLabels');
    if (!ticks || ticks.childNodes.length) return;
    var NS = 'http://www.w3.org/2000/svg';
    var names = ['不思考', '低', '高', '最高'];
    for (var i = 0; i < 4; i++) {
      var ang = (i * 60) * Math.PI / 180;
      var cos = Math.cos(ang), sin = Math.sin(ang);
      var ln = document.createElementNS(NS, 'line');
      ln.setAttribute('x1', (120 - 97 * cos).toFixed(1));
      ln.setAttribute('y1', (120 - 97 * sin).toFixed(1));
      ln.setAttribute('x2', (120 - 85 * cos).toFixed(1));
      ln.setAttribute('y2', (120 - 85 * sin).toFixed(1));
      ticks.appendChild(ln);

      var sp = document.createElement('span');
      sp.textContent = names[i];
      var lx = 120 - 113 * cos;
      var ly = 120 - 113 * sin + (i === 0 || i === 3 ? 10 : 0);
      sp.style.left = (lx / 240 * 100) + '%';
      sp.style.top = (ly / 150 * 100) + '%';
      labels.appendChild(sp);
    }
  }

  function setEffortIndex(i) {
    i = Math.max(0, Math.min(3, i));
    if (EFFORTS[i].v === state.settings.effort) return;
    state.settings.effort = EFFORTS[i].v;
    state.settings.think = EFFORTS[i].v !== 'none';
    save();
    syncEffortUI();
    haptic();
  }

  function openEffort() {
    syncEffortUI();
    $('effortSheet').classList.add('open');
    $('scrim').classList.add('show');
  }
  function closeEffort() {
    $('effortSheet').classList.remove('open');
    if (!$('sheet').classList.contains('open') && !$('convMenu').classList.contains('open')) $('scrim').classList.remove('show');
  }

  function exportBackup() {
    var bak = {
      app: 'DSChat', version: APP_VERSION, exportedAt: new Date().toISOString(),
      settings: (function () {
        var o = JSON.parse(JSON.stringify(state.settings));
        delete o.apiKey;
        return o;
      })(),
      conversations: state.conversations
    };
    var text = JSON.stringify(bak);
    var name = 'deepchat-backup-' + dayKey(Date.now()) + '.json';
    if (window.App && window.App.saveText) {
      var r = '';
      try { r = window.App.saveText(name, text); } catch (e) { r = 'ERR:' + e.message; }
      toast(String(r).indexOf('ERR') === 0 ? '保存失败：' + r : '已保存到「下载」目录');
      return;
    }
    try {
      var blob = new Blob([text], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      toast('已导出 ' + name);
    } catch (e) { toast('导出失败'); }
  }

  function importBackup(text) {
    var o;
    try { o = JSON.parse(text); } catch (e) { toast('不是合法的备份文件'); return; }
    if (!o || !o.conversations) { toast('备份内容不对'); return; }
    ask('恢复备份', '将用备份里的 ' + o.conversations.length + ' 个对话覆盖当前全部对话，当前数据会丢失。', '覆盖恢复', true, function () {
      try {
        state.conversations = o.conversations.map(migrate);
        if (o.settings) {
          var key = state.settings.apiKey;
          state.settings = Object.assign(defaults().settings, o.settings);
          state.settings.apiKey = key;
        }
        state.activeId = state.conversations[0] ? state.conversations[0].id : null;
        save(true);
        applyTheme();
        renderMessages();
        fillSheet();
        toast('已恢复');
      } catch (e) { toast('恢复失败：' + e.message); }
    });
  }

  function fillSheet() {
    var s = state.settings;
    $('setKey').value = s.apiKey || '';
    $('setSystem').value = s.system || '';
    $('setThink').checked = !!s.think;
    $('setSearch').checked = !!s.search;
    var gt = typeof s.temperature === 'number' ? s.temperature : 1;
    $('setTemp').value = String(Math.round(gt * 10));
    $('setTempVal').textContent = gt.toFixed(1);
    $('aboutVer').textContent = APP_VERSION;
    applyTheme();
    renderPresets();
    renderSwatches();
    renderModelCards();
    renderAvatarSettings();
    renderChart();

    var turns = 0, cost = 0, tok = 0;
    state.conversations.forEach(function (c) {
      allTurns(c).forEach(function (t) {
        turns += 1;
        (t.questions || []).forEach(function (q) {
          (q.answers || []).forEach(function (a) {
            if (a.usage) tok += (a.usage.input_tokens || 0) + (a.usage.cache_read_input_tokens || 0) + (a.usage.output_tokens || 0);
          });
        });
      });
    });
    cost = totalCost();
    $('usageNote').textContent = state.conversations.length + ' 个对话 · ' + turns + ' 条提问 · ' + fmtNum(tok) + ' tokens · 累计 ' + money(cost);
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
    var c = { id: uid(), title: '新对话', createdAt: Date.now(), updatedAt: Date.now(), pinned: false, fav: false, turns: [] };
    state.conversations.unshift(c);
    state.activeId = c.id;
    save(true);
    renderMessages();
    $('input').value = '';
    autoGrow();
    setTimeout(function () { $('input').focus(); }, 60);
  }

  function openLightbox(src, list) {
    if (!src) return;
    var slides = (list && list.length) ? list : [src];
    var idx = Math.max(0, slides.indexOf(src));
    var track = $('lbTrack');
    track.innerHTML = slides.map(function (u) {
      return '<div class="lb-slide"><img src="' + u + '" alt=""></div>';
    }).join('');
    track.scrollLeft = 0;
    $('lbCount').textContent = (idx + 1) + ' / ' + slides.length;
    $('lightbox').classList.add('show');
    requestAnimationFrame(function () {
      track.scrollLeft = idx * track.clientWidth;
      $('lbCount').textContent = (idx + 1) + ' / ' + slides.length;
    });
    track.onscroll = function () {
      var i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
      i = Math.max(0, Math.min(slides.length - 1, i));
      $('lbCount').textContent = (i + 1) + ' / ' + slides.length;
    };
  }
  function closeLightbox() {
    $('lightbox').classList.remove('show');
    setTimeout(function () { $('lbTrack').innerHTML = ''; }, 200);
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
    $('btnAgree').onclick = function () {
      state.settings.agreed = true;
      save(true);
      closeAgree();
      toast('随时可在设置 → 关于 里查看这些说明');
    };
    $('btnDisagree').onclick = function () {
      if (window.App && window.App.exit) { try { window.App.exit(); return; } catch (e) {} }
      toast('需要同意后才能使用');
    };
    $('convSearch').oninput = function () {
      convQuery = this.value;
      document.querySelector('.drawer-search').classList.toggle('has', !!this.value);
      clearTimeout(window.__sq);
      window.__sq = setTimeout(renderConvList, 120);
    };
    $('btnSearchClear').onclick = function () {
      var el = $('convSearch');
      el.value = ''; convQuery = '';
      document.querySelector('.drawer-search').classList.remove('has');
      renderConvList();
    };
    $('btnMenu').onclick = openDrawer;
    $('btnCloseDrawer').onclick = closeDrawer;
    $('scrim').onclick = function () {
      if ($('agreeSheet').classList.contains('open')) return;
      closeDrawer(); closeSheet(); closeEdit(); closeMenu(); closeEffort(); closeCrop(); closeCtx(); closeConvSet();
    };
    $('btnSettings').onclick = function () { closeDrawer(); openSheet(); };
    $('btnCloseSheet').onclick = closeSheet;
    $('btnEditClose').onclick = closeEdit;
    $('btnEditCancel').onclick = closeEdit;
    $('btnNew').onclick = newChat;
    $('btnNew2').onclick = function () { newChat(); closeDrawer(); };
    $('emptyHint').onclick = openSheet;

    $('dlgOk').onclick = function () {
      var cb = dlgCb;
      closeAsk();
      if (cb) cb();
    };
    $('dlgCancel').onclick = closeAsk;

    $('chipSearch').onclick = function () { state.settings.search = !state.settings.search; save(); updateHeader(); haptic(); };
    $('chipEffort').onclick = openEffort;
    $('btnEffClose').onclick = closeEffort;
    (function () {
      var svg = $('gaugeSvg');
      if (!svg) return;
      var dragging = false;
      function idxAt(clientX, clientY) {
        var r = svg.getBoundingClientRect();
        if (!r.width) return effortIndex(state.settings.effort || 'high');
        var cx = r.left + r.width * 0.5;
        var cy = r.top + r.height * (120 / 150);
        var ang = Math.atan2(cy - clientY, clientX - cx) * 180 / Math.PI;
        if (ang < 0) ang = clientX >= cx ? 0 : 180;
        ang = Math.max(0, Math.min(180, ang));
        return Math.round((180 - ang) / 60);
      }
      svg.addEventListener('pointerdown', function (e) {
        dragging = true;
        setEffortIndex(idxAt(e.clientX, e.clientY));
        try { svg.setPointerCapture(e.pointerId); } catch (err) {}
      });
      svg.addEventListener('pointermove', function (e) {
        if (dragging) setEffortIndex(idxAt(e.clientX, e.clientY));
      });
      svg.addEventListener('pointerup', function () { dragging = false; });
      svg.addEventListener('pointercancel', function () { dragging = false; });
    })();
    $('btnConvSet2').onclick = openConvSet;
    $('ctxRing').onclick = openCtx;
    $('btnCtxClose').onclick = closeCtx;
    $('btnConvSet').onclick = openConvSet;
    $('btnConvSetClose').onclick = closeConvSet;

    $('setTemp').oninput = function () {
      state.settings.temperature = (+this.value) / 10;
      $('setTempVal').textContent = state.settings.temperature.toFixed(1);
      save();
    };

    $('csTitle').oninput = function () {
      var c = activeConv();
      if (!c) return;
      c.title = this.value;
      updateHeader();
    };
    $('csTemp').oninput = function () {
      var c = ensureConv();
      c.overrides = c.overrides || {};
      c.overrides.temperature = (+this.value) / 10;
      $('csTempVal').textContent = c.overrides.temperature.toFixed(1);
      save();
    };
    $('csSystem').oninput = function () {
      var c = ensureConv();
      c.overrides = c.overrides || {};
      c.overrides.system = this.value;
      save();
    };
    $('csPickUser').onclick = function () { cropTarget = 'csUser'; $('cropFile').click(); };
    $('csPickAi').onclick = function () { cropTarget = 'csAi'; $('cropFile').click(); };
    $('csAvatarReset').onclick = function () {
      var c = ensureConv();
      if (c.overrides) { delete c.overrides.avatar; }
      save(true); fillConvSet(); renderMessages(); toast('已跟随全局头像');
    };
    $('csBgFile').onchange = function () {
      var f = this.files && this.files[0];
      this.value = '';
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        openCrop(String(fr.result), window.innerWidth / window.innerHeight, function (data) {
          var c = ensureConv();
          c.overrides = c.overrides || {};
          c.overrides.bg = { kind: 'image', image: data, veil: (state.settings.bg && state.settings.bg.veil) || 0.8 };
          save(true); applyBg(); toast('这个对话的背景已换');
        });
      };
      fr.readAsDataURL(f);
    };
    $('csBgClear').onclick = function () {
      var c = ensureConv();
      if (c.overrides) { delete c.overrides.bg; }
      save(true); applyBg(); toast('已跟随全局背景');
    };

    $('btnAttach').onclick = function () { $('filePick').click(); };
    $('filePick').onchange = function () { addFiles(this.files || []); this.value = ''; };
    $('btnExport').onclick = exportBackup;
    $('btnImport').onclick = function () { $('importFile').click(); };
    $('importFile').onchange = function () {
      var f = this.files && this.files[0];
      if (f) {
        var fr = new FileReader();
        fr.onload = function () { importBackup(String(fr.result || '')); };
        fr.readAsText(f);
      }
      this.value = '';
    };
    $('bgVeil').oninput = function () {
      state.settings.bg.veil = (+this.value) / 100;
      applyBg();
      save();
    };
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
      var img = e.target.closest('img[data-full]');
      if (img) {
        var strip = img.closest('.uatt');
        var all = strip ? Array.prototype.slice.call(strip.querySelectorAll('img[data-full]'))
          .map(function (x) { return x.getAttribute('data-full'); }) : null;
        openLightbox(img.getAttribute('data-full'), all);
        return;
      }
      var t = e.target.closest('[data-act]');
      if (!t) return;
      var act = t.getAttribute('data-act');
      var turn = findTurn(t.getAttribute('data-turn'));
      if (act === 'think') {
        if (turn) { var ai = curA(turn); if (ai) ai._thinkOpen = !ai._thinkOpen; }
        return;
      }
      if (!turn) return;
      if (act === 'copy') { var a = curA(turn); copyText(a ? a.text : ''); return; }
      if (act === 'copyu') { copyText(curQ(turn).q); return; }
      if (act === 'edit') { openEdit(turn); return; }
      if (act === 'regen') {
        if (turn.id !== lastTurnId) { toast('只能重新生成最后一条回答，改前面的请用「编辑」'); return; }
        regenerate(turn);
        return;
      }
      if (act === 'qprev') { switchQ(turn, -1); return; }
      if (act === 'qnext') { switchQ(turn, 1); return; }
      if (act === 'aprev') { switchA(turn, -1); return; }
      if (act === 'anext') { switchA(turn, 1); return; }
    });

    $('btnEditSave').onclick = function () {
      var turn = state.editing;
      if (!turn) { closeEdit(); return; }
      var txt = $('editText').value.trim();
      var qq = curQ(turn);
      if (!txt && !(qq && qq.files && qq.files.length)) { toast('内容不能为空'); return; }
      closeEdit();
      editAndRegenerate(turn, txt);
    };

    $('convlist').addEventListener('click', function (e) {
      var more = e.target.closest('[data-act="more"]');
      if (more) {
        e.stopPropagation();
        openConvMenu(more.getAttribute('data-cid'));
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

    // 长按会话直接打开操作菜单（删除/置顶/收藏）
    (function () {
      var box = $('convlist');
      var timer = null, longPressed = false;
      function cancel() { clearTimeout(timer); timer = null; }
      box.addEventListener('pointerdown', function (e) {
        var row = e.target.closest('.conv');
        if (!row || e.target.closest('[data-act="more"]')) return;
        longPressed = false;
        var cid = row.dataset.cid;
        cancel();
        timer = setTimeout(function () {
          timer = null;
          longPressed = true;
          haptic();
          openConvMenu(cid);
        }, 460);
      });
      box.addEventListener('pointermove', cancel);
      box.addEventListener('pointerup', cancel);
      box.addEventListener('pointercancel', cancel);
      box.addEventListener('pointerleave', cancel);
      box.addEventListener('click', function (e) {
        if (!longPressed) return;
        e.preventDefault();
        e.stopPropagation();
        longPressed = false;
      }, true);
    })();

    $('langSeg').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      state.settings.lang = b.getAttribute('data-lang');
      save(true);
      applyLang();
      haptic();
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
      var f = this.files && this.files[0];
      this.value = '';
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        openCrop(String(fr.result), window.innerWidth / window.innerHeight, function (data) {
          state.settings.bg = { kind: 'image', image: data, veil: state.settings.bg.veil || 0.8 };
          save(true); applyBg(); renderSwatches(); toast('背景已替换');
        });
      };
      fr.readAsDataURL(f);
    };

    $('pickUserAvatar').onclick = function () { cropTarget = 'user'; $('cropFile').click(); };
    $('pickAiAvatar').onclick = function () { cropTarget = 'ai'; $('cropFile').click(); };
    $('cropFile').onchange = function () {
      var f = this.files && this.files[0];
      this.value = '';
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        openCrop(String(fr.result), 1, function (data) {
          if (cropTarget === 'user' || cropTarget === 'ai') {
            state.settings.avatar = state.settings.avatar || { user: '', ai: '' };
            state.settings.avatar[cropTarget] = data;
            renderAvatarSettings();
          } else {
            var conv = ensureConv();
            conv.overrides = conv.overrides || {};
            conv.overrides.avatar = conv.overrides.avatar || {};
            conv.overrides.avatar[cropTarget === 'csUser' ? 'user' : 'ai'] = data;
            if ($('convSetSheet').classList.contains('open')) fillConvSet();
          }
          save(true); renderMessages(); toast('头像已更新');
        });
      };
      fr.readAsDataURL(f);
    };
    $('btnAvatarReset').onclick = function () {
      state.settings.avatar = { user: '', ai: '' };
      save(true); renderAvatarSettings(); renderMessages(); toast('已恢复默认头像');
    };
    $('btnCropCancel').onclick = closeCrop;
    $('btnCropClose').onclick = closeCrop;
    $('btnCropOk').onclick = cropConfirm;
    $('cropZoom').oninput = function () {
      if (!crop.img) return;
      var nz = (+this.value) / 100;
      var cx = (crop.w / 2 - crop.ox) / crop.iw;
      var cy = (crop.h / 2 - crop.oy) / crop.ih;
      crop.zoom = nz;
      crop.iw = crop.img.width * crop.base * nz;
      crop.ih = crop.img.height * crop.base * nz;
      crop.ox = crop.w / 2 - cx * crop.iw;
      crop.oy = crop.h / 2 - cy * crop.ih;
      cropClamp();
    };
    (function () {
      var box = $('cropBox');
      var drag = null;
      box.addEventListener('pointerdown', function (e) {
        if (!crop.img) return;
        drag = { x: e.clientX, y: e.clientY, ox: crop.ox, oy: crop.oy };
        try { box.setPointerCapture(e.pointerId); } catch (err) {}
      });
      box.addEventListener('pointermove', function (e) {
        if (!drag) return;
        crop.ox = drag.ox + (e.clientX - drag.x);
        crop.oy = drag.oy + (e.clientY - drag.y);
        cropClamp();
      });
      box.addEventListener('pointerup', function () { drag = null; });
      box.addEventListener('pointercancel', function () { drag = null; });
    })();
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
      ask('清空所有对话', '所有对话、版本记录都会被删除，无法恢复。Key、提示词和背景会保留。', '清空', true, function () {
        state.conversations = [];
        state.activeId = null;
        save(true);
        renderMessages();
        toast('已清空');
      });
    };

    $('scroller').addEventListener('scroll', function () {
      var on = $('scroller').scrollTop > 4;
      document.querySelector('.topbar').classList.toggle('scrolled', on);
      if (qpanelOpen) {
        var idx = computeActiveTurn();
        if (idx !== activeTurnIdx) {
          activeTurnIdx = idx;
          var items = document.querySelectorAll('#qpanelList .qitem');
          for (var i = 0; i < items.length; i++) items[i].classList.toggle('active', i === idx);
        }
      }
    });

    (function () {
      var rail = $('qrail');
      var dragging = false, moved = false, startY = 0;
      function indexAt(clientY) {
        var r = rail.getBoundingClientRect();
        var n = railTurns().length;
        var ratio = (clientY - r.top) / Math.max(1, r.height);
        return Math.max(0, Math.min(n - 1, Math.round(ratio * (n - 1))));
      }
      rail.addEventListener('pointerdown', function (e) {
        dragging = true; moved = false; startY = e.clientY;
        rail.classList.add('active');
        try { rail.setPointerCapture(e.pointerId); } catch (err) {}
      });
      rail.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        if (Math.abs(e.clientY - startY) > 8) {
          moved = true;
          var turns = railTurns();
          var t = turns[indexAt(e.clientY)];
          if (t) {
            activeTurnIdx = indexAt(e.clientY);
            jumpToTurn(t.id);
          }
        }
      });
      rail.addEventListener('pointerup', function () {
        dragging = false;
        rail.classList.remove('active');
        if (!moved) { if (qpanelOpen) closeQPanel(); else openQPanel(); }
      });
      rail.addEventListener('pointercancel', function () { dragging = false; rail.classList.remove('active'); });
    })();

    $('lightbox').onclick = function (e) {
      if (e.target.closest('.lb-slide') || e.target.closest('#lbClose')) return;
      closeLightbox();
    };
    $('lbClose').onclick = closeLightbox;
    $('qpanelClose').onclick = closeQPanel;
    $('qpanelList').addEventListener('click', function (e) {
      var item = e.target.closest('.qitem');
      if (!item) return;
      jumpToTurn(item.dataset.turn);
      closeQPanel();
    });
    document.addEventListener('pointerdown', function (e) {
      if (!qpanelOpen) return;
      if (e.target.closest('#qpanel') || e.target.closest('#qrail')) return;
      closeQPanel();
    }, true);

    window.__onBack = function () {
      if ($('agreeSheet').classList.contains('open')) { return true; }
      if ($('lightbox').classList.contains('show')) { closeLightbox(); return true; }
      if ($('ctxSheet').classList.contains('open')) { closeCtx(); return true; }
      if ($('convSetSheet').classList.contains('open')) { closeConvSet(); return true; }
      if (qpanelOpen) { closeQPanel(); return true; }
      if ($('dlgScrim').classList.contains('show')) { closeAsk(); return true; }
      if ($('cropSheet').classList.contains('open')) { closeCrop(); return true; }
      if ($('effortSheet').classList.contains('open')) { closeEffort(); return true; }
      if ($('convMenu').classList.contains('open')) { closeMenu(); return true; }
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
    buildGauge();
    applyTheme();
    applyLang();
    renderMessages();
    updateHeader();
    if (!state.settings.agreed) showAgree();
    $('drawerVer').textContent = 'v' + APP_VERSION;
    var h = new Date().getHours();
    document.querySelector('.empty h1').textContent =
      h < 6 ? '夜深了' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 19 ? '下午好' : '晚上好';
    $('emptyHint').textContent = state.settings.apiKey ? '说点什么，或者直接问我。' : '先到设置里填上 DeepSeek API Key，然后随便聊。';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
