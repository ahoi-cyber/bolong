(function () {
    'use strict';

    if (window.top !== window.self || window.__ABULU_STUDY_LOADED__) return;
    window.__ABULU_STUDY_LOADED__ = true;

    const STORAGE_KEY = 'abulu_study_config_v2';

    const DEFAULT_MODELS = [
        'deepseek-v4.1-flash:high',
        'deepseek-v4.1-flash:medium',
        'deepseek-v4.1-flash:low',
        'claude-sonnet-4-5',
        'claude-opus-4-1',
        'gpt-4o',
        'gemini-2.5-pro'
    ];

    const DEFAULT_CONFIG = {
        apiFormat: 'anthropic', // 'anthropic' (/v1/messages) | 'openai' (/v1/chat/completions)
        baseUrl: 'https://api.abulu.net',
        authToken: '',
        model: 'deepseek-v4.1-flash:high',
        customModels: DEFAULT_MODELS.join(', '),
        maxTokens: 4096,
        features: {
            selectionFab: true,
            quickBar: true,
            unlockCopy: false,
            showThinking: true,
            hotkey: true
        }
    };

    const SYSTEM_PROMPT = [
        'Bạn là trợ lý học tập thông minh, trả lời bằng tiếng Việt rõ ràng, chính xác và dễ hiểu.',
        '- Nếu là trắc nghiệm: nêu rõ đáp án đúng trước, sau đó giải thích ngắn gọn lý do.',
        '- Nếu là tự luận / tính toán: trình bày từng bước, công thức áp dụng và kết luận cuối cùng.',
        '- Nếu người dùng gửi bài làm: chỉ ra chỗ đúng, chỗ sai (nếu có) và cách sửa.'
    ].join('\n');

    const QUICK_MODES = {
        solve: 'Hãy giải chi tiết từng bước bài tập sau và chốt đáp án cuối cùng:\n\n',
        mcq: 'Đây là câu hỏi trắc nghiệm. Hãy chọn đáp án đúng nhất và giải thích ngắn gọn:\n\n',
        explain: 'Hãy giải thích kiến thức và cách làm của nội dung sau theo cách dễ hiểu nhất:\n\n',
        check: 'Hãy kiểm tra giúp tôi phần bài làm/câu hỏi sau xem đúng hay sai và sửa lại nếu cần:\n\n'
    };

    function getConfig() {
        try {
            const raw = GM_getValue(STORAGE_KEY, null);
            const parsed = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {};
            return {
                ...DEFAULT_CONFIG,
                ...parsed,
                baseUrl: (parsed.baseUrl || DEFAULT_CONFIG.baseUrl).replace(/\/+$/, ''),
                features: { ...DEFAULT_CONFIG.features, ...(parsed.features || {}) }
            };
        } catch {
            return { ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features } };
        }
    }

    function saveConfig(cfg) {
        GM_setValue(STORAGE_KEY, JSON.stringify(cfg));
    }

    function getModelList(cfg) {
        const list = (cfg.customModels || '')
            .split(/[\n,]+/)
            .map((s) => s.trim())
            .filter(Boolean);
        if (cfg.model && !list.includes(cfg.model)) list.unshift(cfg.model);
        return list.length ? list : DEFAULT_MODELS;
    }

    const state = {
        expanded: false,
        settingsOpen: false,
        loading: false,
        messages: [],
        lastSelection: ''
    };

    // --- Mở khóa bôi đen / copy ---
    let unlockStyleEl = null;
    ['copy', 'cut', 'contextmenu', 'selectstart', 'dragstart'].forEach((evt) => {
        document.addEventListener(evt, (e) => {
            if (getConfig().features.unlockCopy) e.stopPropagation();
        }, true);
    });

    function applyUnlockCopy(enabled) {
        if (enabled) {
            if (!unlockStyleEl) {
                unlockStyleEl = document.createElement('style');
                unlockStyleEl.textContent = '*,*::before,*::after{-webkit-user-select:text!important;user-select:text!important;}';
                document.head.appendChild(unlockStyleEl);
            }
        } else if (unlockStyleEl) {
            unlockStyleEl.remove();
            unlockStyleEl = null;
        }
    }

    // --- Shadow DOM ---
    const host = document.createElement('div');
    host.id = 'abulu-homework-host';
    host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;';
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
        :host{all:initial;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,sans-serif;color:#f5f5f7}
        *{box-sizing:border-box}
        .wrap{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;display:flex;flex-direction:column;align-items:center;pointer-events:none}
        .pill{pointer-events:auto;background:rgba(18,18,22,.92);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:6px 14px;display:flex;align-items:center;gap:10px;box-shadow:0 10px 30px rgba(0,0,0,.45);cursor:pointer;user-select:none;transition:transform .2s,border-color .2s}
        .pill:hover{border-color:rgba(120,170,255,.45);transform:translateY(-1px)}
        .dot{width:8px;height:8px;border-radius:50%;background:#34d399;box-shadow:0 0 8px rgba(52,211,153,.8)}
        .dot.loading{background:#60a5fa;animation:pulse 1s infinite ease-in-out}
        .dot.no-key{background:#fbbf24}
        @keyframes pulse{0%,100%{transform:scale(.9);opacity:.7}50%{transform:scale(1.25);opacity:1}}
        .pill-title{font-size:13px;font-weight:600;white-space:nowrap}
        .pill-badge{font-size:11px;color:#a1a1aa;background:rgba(255,255,255,.08);padding:2px 8px;border-radius:999px;white-space:nowrap}
        .panel{pointer-events:auto;margin-top:8px;width:min(570px,calc(100vw - 24px));max-height:min(80vh,740px);background:rgba(18,18,22,.96);backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,.14);border-radius:22px;box-shadow:0 22px 60px rgba(0,0,0,.65);display:none;flex-direction:column;overflow:hidden}
        .panel.open{display:flex}
        .header{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.08);gap:8px}
        .header-left{display:flex;align-items:center;gap:8px;min-width:0;flex:1}
        .header-title{font-size:13.5px;font-weight:600;white-space:nowrap}
        .model-select{background:rgba(59,130,246,.15);border:1px solid rgba(59,130,246,.32);color:#93c5fd;border-radius:999px;padding:3px 10px;font-size:11.5px;max-width:210px;outline:none;cursor:pointer}
        .model-select option{background:#18181b;color:#f4f4f5}
        .actions{display:flex;gap:5px}
        .btn{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);color:#e4e4e7;border-radius:8px;padding:5px 9px;font-size:12px;cursor:pointer}
        .btn:hover{background:rgba(255,255,255,.15)}
        .btn.active{background:rgba(59,130,246,.25);border-color:rgba(59,130,246,.5);color:#93c5fd}
        .settings{display:none;padding:12px 14px;background:rgba(255,255,255,.03);border-bottom:1px solid rgba(255,255,255,.08);flex-direction:column;gap:8px;max-height:310px;overflow-y:auto}
        .settings.open{display:flex}
        .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
        .field{display:flex;flex-direction:column;gap:4px}
        .field label{font-size:11px;color:#a1a1aa;font-weight:500}
        .field input,.field select,.field textarea{width:100%;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.14);color:#f5f5f7;border-radius:9px;padding:7px 9px;font-size:12px;outline:none;font-family:inherit}
        .toggles{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:2px}
        .chk{display:flex;align-items:center;gap:6px;font-size:11.5px;color:#d4d4d8;cursor:pointer}
        .primary{background:#2563eb;color:#fff;border:none;border-radius:9px;padding:7px 14px;font-size:12.5px;font-weight:600;cursor:pointer}
        .primary:hover{background:#1d4ed8}
        .primary:disabled{opacity:.55;cursor:not-allowed}
        .quick-bar{display:flex;gap:6px;padding:9px 14px 4px;flex-wrap:wrap}
        .quick-bar.hidden{display:none}
        .chip{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:#e4e4e7;border-radius:999px;padding:4px 10px;font-size:11.5px;cursor:pointer}
        .chip:hover{background:rgba(59,130,246,.22);border-color:rgba(96,165,250,.45)}
        .chat{flex:1;min-height:170px;max-height:360px;overflow-y:auto;padding:10px 14px;display:flex;flex-direction:column;gap:10px}
        .empty{text-align:center;color:#a1a1aa;font-size:12.5px;line-height:1.5;padding:22px 10px}
        .msg{display:flex;flex-direction:column;gap:4px;max-width:92%}
        .msg.user{align-self:flex-end}
        .msg.assistant{align-self:flex-start}
        .bubble{padding:9px 12px;border-radius:14px;font-size:13px;line-height:1.5;word-break:break-word}
        .msg.user .bubble{background:#2563eb;color:#fff;border-bottom-right-radius:4px;white-space:pre-wrap}
        .msg.assistant .bubble{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.08);border-bottom-left-radius:4px}
        .bubble pre{background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.1);padding:8px;border-radius:8px;overflow-x:auto;font-size:12px;margin:6px 0}
        .bubble code{background:rgba(255,255,255,.1);padding:1px 5px;border-radius:4px;font-size:12px}
        .bubble pre code{background:transparent;padding:0}
        .bubble p{margin:4px 0}
        .bubble ul{margin:4px 0 4px 18px;padding:0}
        .thinking{margin-bottom:6px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:5px 8px;font-size:11.5px;color:#a1a1aa}
        .thinking summary{cursor:pointer;color:#93c5fd;font-weight:500}
        .thinking-body{margin-top:5px;white-space:pre-wrap}
        .copy-btn{background:transparent;border:none;color:#93c5fd;font-size:11px;cursor:pointer;padding:0;align-self:flex-start}
        .composer{padding:9px 14px 13px;border-top:1px solid rgba(255,255,255,.08);display:flex;flex-direction:column;gap:7px}
        .composer textarea{width:100%;min-height:58px;max-height:140px;resize:vertical;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.14);border-radius:11px;padding:8px 10px;color:#f5f5f7;font-family:inherit;font-size:13px;outline:none}
        .composer-foot{display:flex;align-items:center;justify-content:space-between}
        .status{font-size:11.5px;color:#a1a1aa}
        .fab{position:fixed;z-index:2147483647;display:none;align-items:center;background:rgba(18,18,22,.95);border:1px solid rgba(96,165,250,.55);color:#f5f5f7;padding:6px 12px;border-radius:999px;font-size:12px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,.5);cursor:pointer;pointer-events:auto}
        .fab:hover{background:#2563eb}
    `;
    shadow.appendChild(style);

    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.innerHTML = `
        <div class="pill" id="pill" title="Mở/đóng trợ lý">
            <span class="dot" id="dot"></span>
            <span class="pill-title">Abulu Study</span>
            <span class="pill-badge" id="badge">Alt+H</span>
        </div>
        <div class="panel" id="panel">
            <div class="header">
                <div class="header-left">
                    <span class="header-title">Bài tập</span>
                    <select class="model-select" id="quickModel" title="Đổi model AI nhanh"></select>
                </div>
                <div class="actions">
                    <button class="btn" id="clearBtn">Xóa</button>
                    <button class="btn" id="settingsBtn">Cài đặt</button>
                    <button class="btn" id="closeBtn">Đóng</button>
                </div>
            </div>
            <div class="settings" id="settingsBox">
                <div class="grid-2">
                    <div class="field">
                        <label>Định dạng API</label>
                        <select id="inFormat">
                            <option value="anthropic">Anthropic (/v1/messages)</option>
                            <option value="openai">OpenAI (/v1/chat/completions)</option>
                        </select>
                    </div>
                    <div class="field">
                        <label>Base URL</label>
                        <input type="text" id="inBaseUrl" placeholder="https://api.abulu.net" />
                    </div>
                </div>
                <div class="grid-2">
                    <div class="field">
                        <label>API Token / Key</label>
                        <input type="password" id="inToken" placeholder="abl-... hoặc sk-..." />
                    </div>
                    <div class="field">
                        <label>Model đang dùng</label>
                        <input type="text" id="inModel" placeholder="deepseek-v4.1-flash:high" />
                    </div>
                </div>
                <div class="field">
                    <label>Danh sách model đổi nhanh (cách nhau bởi dấu phẩy)</label>
                    <input type="text" id="inModelList" />
                </div>
                <div class="toggles">
                    <label class="chk"><input type="checkbox" id="chkFab" /> Nút nổi khi bôi đen</label>
                    <label class="chk"><input type="checkbox" id="chkQuick" /> Thanh chế độ nhanh</label>
                    <label class="chk"><input type="checkbox" id="chkCopy" /> Mở khóa bôi đen / copy</label>
                    <label class="chk"><input type="checkbox" id="chkThink" /> Hiện suy luận (thinking)</label>
                    <label class="chk"><input type="checkbox" id="chkHotkey" /> Phím tắt Alt + H</label>
                </div>
                <div style="display:flex;justify-content:flex-end;margin-top:4px;">
                    <button class="primary" id="saveBtn">Lưu cấu hình</button>
                </div>
            </div>
            <div class="quick-bar" id="quickBar">
                <button class="chip" data-mode="solve">Giải chi tiết</button>
                <button class="chip" data-mode="mcq">Trắc nghiệm</button>
                <button class="chip" data-mode="explain">Giải thích</button>
                <button class="chip" data-mode="check">Kiểm tra bài</button>
                <button class="chip" id="grabBtn">Lấy chữ bôi đen</button>
            </div>
            <div class="chat" id="chat"></div>
            <div class="composer">
                <textarea id="input" placeholder="Dán đề bài hoặc hỏi tiếp... (Enter để gửi)"></textarea>
                <div class="composer-foot">
                    <span class="status" id="status">Sẵn sàng</span>
                    <button class="primary" id="sendBtn">Gửi</button>
                </div>
            </div>
        </div>
    `;
    shadow.appendChild(wrap);

    const fab = document.createElement('button');
    fab.className = 'fab';
    fab.textContent = '✨ Giải ngay';
    shadow.appendChild(fab);

    const $ = (id) => shadow.getElementById(id);
    const el = {
        pill: $('pill'), dot: $('dot'), badge: $('badge'), panel: $('panel'),
        quickModel: $('quickModel'), clearBtn: $('clearBtn'), settingsBtn: $('settingsBtn'), closeBtn: $('closeBtn'),
        settingsBox: $('settingsBox'), inFormat: $('inFormat'), inBaseUrl: $('inBaseUrl'), inToken: $('inToken'),
        inModel: $('inModel'), inModelList: $('inModelList'), chkFab: $('chkFab'), chkQuick: $('chkQuick'),
        chkCopy: $('chkCopy'), chkThink: $('chkThink'), chkHotkey: $('chkHotkey'), saveBtn: $('saveBtn'),
        quickBar: $('quickBar'), grabBtn: $('grabBtn'), chat: $('chat'), input: $('input'), status: $('status'),
        sendBtn: $('sendBtn'), fab
    };

    function escapeHtml(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function renderMd(text) {
        const blocks = [];
        let safe = escapeHtml(text).replace(/```[\w-]*\n([\s\S]*?)```/g, (_, code) => {
            blocks.push(`<pre><code>${code.trimEnd()}</code></pre>`);
            return `__BLK_${blocks.length - 1}__`;
        });
        safe = safe.replace(/`([^`\n]+)`/g, '<code>$1</code>')
            .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
            .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
        let html = '', inUl = false;
        for (const raw of safe.split('\n')) {
            const line = raw.trim();
            if (/^[-*]\s+/.test(line)) {
                if (!inUl) { html += '<ul>'; inUl = true; }
                html += `<li>${line.replace(/^[-*]\s+/, '')}</li>`;
            } else {
                if (inUl) { html += '</ul>'; inUl = false; }
                html += line ? `<p>${line}</p>` : '<br/>';
            }
        }
        if (inUl) html += '</ul>';
        blocks.forEach((b, i) => { html = html.replace(`__BLK_${i}__`, b); });
        return html;
    }

    function syncUI() {
        const cfg = getConfig();
        applyUnlockCopy(cfg.features.unlockCopy);
        el.quickBar.classList.toggle('hidden', !cfg.features.quickBar);

        el.quickModel.innerHTML = '';
        getModelList(cfg).forEach((m) => {
            const opt = document.createElement('option');
            opt.value = m;
            opt.textContent = m;
            if (m === cfg.model) opt.selected = true;
            el.quickModel.appendChild(opt);
        });

        el.dot.classList.remove('loading', 'no-key');
        if (state.loading) {
            el.dot.classList.add('loading');
            el.badge.textContent = 'Đang giải...';
            el.status.textContent = `Đang gọi ${cfg.model}...`;
        } else if (!cfg.authToken) {
            el.dot.classList.add('no-key');
            el.badge.textContent = 'Chưa có key';
            el.status.textContent = 'Mở Cài đặt để nhập API Token';
        } else {
            el.badge.textContent = cfg.features.hotkey ? 'Alt+H' : 'Mở';
            el.status.textContent = 'Sẵn sàng';
        }
        el.sendBtn.disabled = state.loading;
    }

    function renderChat() {
        const cfg = getConfig();
        if (!state.messages.length) {
            el.chat.innerHTML = '<div class="empty">Bôi đen đề bài hoặc dán vào ô dưới.<br/>Bạn có thể đổi model AI trực tiếp ở thanh trên cùng.</div>';
            return;
        }
        el.chat.innerHTML = '';
        state.messages.forEach((m) => {
            const box = document.createElement('div');
            box.className = `msg ${m.role}`;
            const bubble = document.createElement('div');
            bubble.className = 'bubble';

            if (m.role === 'assistant') {
                if (m.thinking && cfg.features.showThinking) {
                    const det = document.createElement('details');
                    det.className = 'thinking';
                    det.innerHTML = `<summary>Quá trình suy luận</summary><div class="thinking-body">${escapeHtml(m.thinking)}</div>`;
                    bubble.appendChild(det);
                }
                const body = document.createElement('div');
                body.innerHTML = renderMd(m.content);
                bubble.appendChild(body);
            } else {
                bubble.textContent = m.content;
            }
            box.appendChild(bubble);

            if (m.role === 'assistant') {
                const cp = document.createElement('button');
                cp.className = 'copy-btn';
                cp.textContent = 'Sao chép';
                cp.onclick = () => {
                    navigator.clipboard?.writeText(m.content);
                    cp.textContent = 'Đã chép!';
                    setTimeout(() => { cp.textContent = 'Sao chép'; }, 1400);
                };
                box.appendChild(cp);
            }
            el.chat.appendChild(box);
        });
        el.chat.scrollTop = el.chat.scrollHeight;
    }

    function togglePanel(force) {
        state.expanded = typeof force === 'boolean' ? force : !state.expanded;
        el.panel.classList.toggle('open', state.expanded);
        if (state.expanded) {
            if (!getConfig().authToken && !state.settingsOpen) toggleSettings(true);
            setTimeout(() => el.input.focus(), 40);
        }
    }

    function toggleSettings(force) {
        state.settingsOpen = typeof force === 'boolean' ? force : !state.settingsOpen;
        el.settingsBox.classList.toggle('open', state.settingsOpen);
        el.settingsBtn.classList.toggle('active', state.settingsOpen);
        if (state.settingsOpen) {
            const cfg = getConfig();
            el.inFormat.value = cfg.apiFormat;
            el.inBaseUrl.value = cfg.baseUrl;
            el.inToken.value = cfg.authToken;
            el.inModel.value = cfg.model;
            el.inModelList.value = cfg.customModels;
            el.chkFab.checked = cfg.features.selectionFab;
            el.chkQuick.checked = cfg.features.quickBar;
            el.chkCopy.checked = cfg.features.unlockCopy;
            el.chkThink.checked = cfg.features.showThinking;
            el.chkHotkey.checked = cfg.features.hotkey;
        }
    }

    function sendMessage(text) {
        const clean = text.trim();
        if (!clean || state.loading) return;
        const cfg = getConfig();
        if (!cfg.authToken) {
            togglePanel(true);
            toggleSettings(true);
            return;
        }

        state.messages.push({ role: 'user', content: clean });
        renderChat();
        state.loading = true;
        syncUI();

        const isOpenAI = cfg.apiFormat === 'openai';
        const url = isOpenAI ? `${cfg.baseUrl}/v1/chat/completions` : `${cfg.baseUrl}/v1/messages`;
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cfg.authToken}`
        };
        if (!isOpenAI) {
            headers['x-api-key'] = cfg.authToken;
            headers['anthropic-version'] = '2023-06-01';
        }

        const history = state.messages.map((m) => ({ role: m.role, content: m.content }));
        const payload = isOpenAI
            ? { model: cfg.model, max_tokens: cfg.maxTokens, messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...history] }
            : { model: cfg.model, max_tokens: cfg.maxTokens, system: SYSTEM_PROMPT, messages: history };

        GM_xmlhttpRequest({
            method: 'POST',
            url,
            headers,
            data: JSON.stringify(payload),
            timeout: 120000,
            onload: (res) => {
                state.loading = false;
                try {
                    const data = JSON.parse(res.responseText || '{}');
                    if (res.status < 200 || res.status >= 300) {
                        state.messages.push({ role: 'assistant', content: `Lỗi (${res.status}): ${data?.error?.message || data?.message || 'Yêu cầu thất bại'}` });
                    } else if (Array.isArray(data.content)) {
                        const thinking = data.content.filter((b) => b.type === 'thinking' && b.thinking).map((b) => b.thinking).join('\n\n');
                        const content = data.content.filter((b) => b.type === 'text' && b.text).map((b) => b.text).join('\n\n') || '(Trống)';
                        state.messages.push({ role: 'assistant', content, thinking });
                    } else if (data.choices?.[0]?.message?.content) {
                        const msg = data.choices[0].message;
                        state.messages.push({ role: 'assistant', content: msg.content, thinking: msg.reasoning_content || '' });
                    } else {
                        state.messages.push({ role: 'assistant', content: `Phản hồi lạ: ${res.responseText.slice(0, 250)}` });
                    }
                } catch (e) {
                    state.messages.push({ role: 'assistant', content: `Lỗi JSON: ${e.message}` });
                }
                renderChat();
                syncUI();
            },
            onerror: () => {
                state.loading = false;
                state.messages.push({ role: 'assistant', content: `Không thể kết nối tới ${url}` });
                renderChat();
                syncUI();
            },
            ontimeout: () => {
                state.loading = false;
                state.messages.push({ role: 'assistant', content: 'Hết thời gian chờ (120s).' });
                renderChat();
                syncUI();
            }
        });
    }

    // --- Events ---
    el.pill.onclick = () => togglePanel();
    el.closeBtn.onclick = () => togglePanel(false);
    el.settingsBtn.onclick = () => toggleSettings();
    el.clearBtn.onclick = () => { state.messages = []; renderChat(); };

    el.quickModel.onchange = () => {
        const cfg = getConfig();
        cfg.model = el.quickModel.value;
        saveConfig(cfg);
        el.inModel.value = cfg.model;
        syncUI();
    };

    el.saveBtn.onclick = () => {
        const cfg = getConfig();
        cfg.apiFormat = el.inFormat.value;
        cfg.baseUrl = (el.inBaseUrl.value || DEFAULT_CONFIG.baseUrl).trim().replace(/\/+$/, '');
        cfg.authToken = el.inToken.value.trim();
        cfg.model = (el.inModel.value || DEFAULT_CONFIG.model).trim();
        cfg.customModels = el.inModelList.value.trim() || DEFAULT_MODELS.join(', ');
        cfg.features = {
            selectionFab: el.chkFab.checked,
            quickBar: el.chkQuick.checked,
            unlockCopy: el.chkCopy.checked,
            showThinking: el.chkThink.checked,
            hotkey: el.chkHotkey.checked
        };
        saveConfig(cfg);
        toggleSettings(false);
        syncUI();
        renderChat();
        el.status.textContent = 'Đã lưu cấu hình!';
    };

    el.sendBtn.onclick = () => {
        const val = el.input.value;
        if (!val.trim()) return;
        el.input.value = '';
        sendMessage(val);
    };

    el.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            el.sendBtn.click();
        }
    });

    shadow.querySelectorAll('.chip[data-mode]').forEach((btn) => {
        btn.onclick = () => {
            const prefix = QUICK_MODES[btn.dataset.mode];
            const txt = el.input.value.trim() || window.getSelection()?.toString().trim() || state.lastSelection;
            if (!txt) {
                el.status.textContent = 'Hãy bôi đen hoặc nhập đề bài trước.';
                return;
            }
            el.input.value = '';
            sendMessage(prefix + txt);
        };
    });

    el.grabBtn.onclick = () => {
        const sel = window.getSelection()?.toString().trim() || state.lastSelection;
        if (!sel) { el.status.textContent = 'Chưa có chữ được bôi đen.'; return; }
        el.input.value = sel;
        el.input.focus();
    };

    document.addEventListener('mouseup', (e) => {
        if (e.composedPath().includes(host) || !getConfig().features.selectionFab) return;
        setTimeout(() => {
            const sel = window.getSelection()?.toString().trim() || '';
            if (sel.length >= 4) {
                state.lastSelection = sel;
                el.fab.style.left = `${Math.min(window.innerWidth - 130, Math.max(12, e.clientX + 10))}px`;
                el.fab.style.top = `${Math.min(window.innerHeight - 44, Math.max(12, e.clientY + 12))}px`;
                el.fab.style.display = 'flex';
            } else {
                el.fab.style.display = 'none';
            }
        }, 20);
    });

    document.addEventListener('mousedown', (e) => {
        if (!e.composedPath().includes(host)) el.fab.style.display = 'none';
    });

    el.fab.onclick = () => {
        const sel = state.lastSelection || window.getSelection()?.toString().trim() || '';
        el.fab.style.display = 'none';
        if (!sel) return;
        togglePanel(true);
        sendMessage(QUICK_MODES.solve + sel);
    };

    document.addEventListener('keydown', (e) => {
        const cfg = getConfig();
        if (cfg.features.hotkey && e.altKey && (e.key === 'h' || e.key === 'H')) {
            e.preventDefault();
            togglePanel();
        } else if (e.key === 'Escape' && state.expanded) {
            togglePanel(false);
        }
    });

    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('Mở / Đóng Abulu Study', () => togglePanel());
        GM_registerMenuCommand('Cài đặt & Chọn chức năng', () => { togglePanel(true); toggleSettings(true); });
    }

    syncUI();
    renderChat();
})();