let captchaQueue = [];
let currentFingerprint = null;

// 汎用ログ出力関数
function addLog(msg, type = '', num = null) {
    const div = document.createElement('div');
    div.className = 'log-entry';
    const time = new Date().toLocaleTimeString();
    div.innerHTML = `<span style="color:#555">[${time}]</span> <span class="log-${type}">${num ? `[${num}] ` : ''}${msg}</span>`;
    document.getElementById('logArea').prepend(div);
}

function getSuperProperties() {
    return btoa(JSON.stringify({
        "os": "Windows", "browser": "Chrome", "device": "", "system_locale": "ja",
        "browser_user_agent": navigator.userAgent, "browser_version": "120.0.0.0",
        "os_version": "10", "release_channel": "stable", "client_build_number": 250000
    }));
}

// 招待リンクから情報取得 (プロキシ経由)
document.getElementById('inviteInput').addEventListener('change', async (e) => {
    const code = e.target.value.split('/').pop();
    if (!code) return;
    try {
        const res = await fetch(`https://discord-api.soyaaaaana.com/invite/${code}`);
        const data = await res.json();
        if (data.guild) {
            document.getElementById('guildIdInput').value = data.guild.id;
            addLog(`Detected Guild: ${data.guild.name} (${data.guild.id})`, 'info');
        } else {
            addLog(`Invite Error: ${data.message || 'Invalid link'}`, 'error');
        }
    } catch (e) { addLog('Invite fetch failed (Network error)', 'error'); }
});

// 表示切り替えボタン
document.getElementById('toggleTokens').addEventListener('click', function() {
    const area = document.getElementById('tokens');
    const isMasked = area.classList.contains('masked');
    area.classList.toggle('masked', !isMasked);
    area.classList.toggle('unmasked', isMasked);
    this.innerText = isMasked ? '🔒' : '👁️';
    
    // 表示切替をブラウザに反映させるための再代入
    const val = area.value;
    area.value = '';
    area.value = val;
});

// --- Join Engine ---
async function joinServer(token, inviteCode, num, captchaData = null) {
    if (!currentFingerprint) {
        const res = await fetch("https://discord-api.soyaaaaana.com/experiments", { headers: { "x-super-properties": getSuperProperties() }, method: "GET" });
        const data = await res.json();
        currentFingerprint = data.fingerprint;
    }
    const sessionId = crypto.randomUUID().replace(/-/g, '');
    const headers = { 
        "authorization": token.trim(), 
        "content-type": "application/json", 
        "x-fingerprint": currentFingerprint, 
        "x-super-properties": getSuperProperties(),
        "x-captcha-session-id": sessionId 
    };
    if (captchaData) { 
        headers["x-captcha-key"] = captchaData.key; 
        headers["x-captcha-rqtoken"] = captchaData.rqtoken; 
    }
    try {
        const proxyUrl = `https://discord-api.soyaaaaana.com/invite/${inviteCode}`;
        const res = await fetch(proxyUrl, { method: 'POST', headers, body: JSON.stringify({ session_id: sessionId }), credentials: "include" });
        const data = await res.json();

        if (res.ok && data.code) {
            addLog('JOIN: Success', 'success', num);
            document.getElementById('countSuccess').innerText = parseInt(document.getElementById('countSuccess').innerText) + 1;
            processNextCaptcha();
        } else if (data.captcha_sitekey) {
            addLog('JOIN: Captcha Required (rqdata applied)', 'warn', num);
            captchaQueue.push({ token, inviteCode, num, sitekey: data.captcha_sitekey, rqtoken: data.captcha_rqtoken, rqdata: data.captcha_rqdata });
            if (captchaQueue.length === 1) renderCaptcha();
        } else {
            // エラー理由を具体的に出力
            addLog(`JOIN ERROR: ${res.status} - ${data.message || JSON.stringify(data)}`, 'error', num);
            processNextCaptcha();
        }
    } catch (e) { addLog(`JOIN FAILED: Network error`, 'error', num); }
}

function renderCaptcha() {
    if (!captchaQueue.length) return;
    const item = captchaQueue[0];
    const captchaBox = document.getElementById('captcha-box');
    captchaBox.innerHTML = ""; 

    const widgetId = window.hcaptcha.render("captcha-box", {
        sitekey: item.sitekey,
        callback: (key) => {
            window.hcaptcha.reset();
            joinServer(item.token, item.inviteCode, item.num, { key, rqtoken: item.rqtoken });
            captchaQueue.shift();
        }
    });
    // rqdataをセット
    if (item.rqdata) window.hcaptcha.setData(widgetId, { rqdata: item.rqdata });
}

function processNextCaptcha() { document.getElementById('captcha-box').innerHTML = ""; if (captchaQueue.length > 0) renderCaptcha(); }

// --- Bypass Engine ---
async function startBypass(token, num) {
    const gId = document.getElementById('guildIdInput').value;
    const msgUrl = document.getElementById('msgUrl').value;
    const headers = { "authorization": token.trim(), "content-type": "application/json", "x-super-properties": getSuperProperties() };
    
    if (gId) {
        const resOnb = await fetch(`https://discord.com/api/v9/guilds/${gId}/onboarding-responses`, { method: 'POST', headers, body: JSON.stringify({ onboarding_responses: [], onboarding_prompts_seen: {}, onboarding_responses_seen: {}, onboarding_completed: true }) });
        const resRule = await fetch(`https://discord.com/api/v9/guilds/${gId}/requests/@me`, { method: 'PUT', headers, body: JSON.stringify({ termsofservice: true }) });
        if (!resOnb.ok || !resRule.ok) addLog(`BYPASS: Onboarding/Rules Error (${resOnb.status})`, 'warn', num);
    }

    if (msgUrl && msgUrl.includes('channels/')) {
        try {
            const parts = msgUrl.split('/');
            const cId = parts[parts.length-2], mId = parts[parts.length-1];
            const msgRes = await fetch(`https://discord.com/api/v9/channels/${cId}/messages/${mId}`, { headers });
            const msgData = await msgRes.json();
            
            if (msgRes.ok) {
                if (msgData.reactions) {
                    for (const r of msgData.reactions) {
                        const emo = r.emoji.id ? `${r.emoji.name}:${r.emoji.id}` : r.emoji.name;
                        await fetch(`https://discord.com/api/v9/channels/${cId}/messages/${mId}/reactions/${encodeURIComponent(emo)}/@me`, { method: 'PUT', headers });
                    }
                }
                if (msgData.components) {
                    for (const row of msgData.components) {
                        for (const comp of row.components) {
                            if (comp.type === 2) {
                                await fetch(`https://discord.com/api/v9/interactions`, { method: 'POST', headers, body: JSON.stringify({ type: 3, guild_id: gId, channel_id: cId, message_id: mId, application_id: msgData.author.id, data: { component_type: 2, custom_id: comp.custom_id } }) });
                            }
                        }
                    }
                }
                addLog('BYPASS: Interaction Done', 'success', num);
            } else {
                addLog(`BYPASS: Msg Fetch Error (${msgRes.status})`, 'error', num);
            }
        } catch(e) { addLog('BYPASS: Exception during interaction', 'error', num); }
    }
}

// --- Profile Engine ---
async function updateProfile(token, num) {
    const name = document.getElementById('newName').value;
    const avatarUrl = document.getElementById('avatarUrl').value;
    const headers = { "authorization": token.trim(), "content-type": "application/json" };
    let payload = {};
    if (name) payload.username = name;
    if (avatarUrl) {
        try {
            const imgRes = await fetch(avatarUrl);
            const blob = await imgRes.blob();
            const base64 = await new Promise(r => { const rd = new FileReader(); rd.onload = () => r(rd.result); rd.readAsDataURL(blob); });
            payload.avatar = base64;
        } catch (e) { addLog('PROFILE: Avatar Fetch Error', 'error', num); }
    }
    if (Object.keys(payload).length > 0) {
        const res = await fetch(`https://discord.com/api/v9/users/@me`, { method: 'PATCH', headers, body: JSON.stringify(payload) });
        if (res.ok) addLog('PROFILE: Changed Success', 'success', num);
        else {
            const err = await res.json();
            addLog(`PROFILE: Error ${res.status} - ${JSON.stringify(err)}`, 'error', num);
        }
    }
}

// 実行イベント
document.getElementById('joinBtn').addEventListener('click', async () => {
    const tokens = document.getElementById('tokens').value.split('\n').filter(t => t.trim());
    const inviteRaw = document.getElementById('inviteInput').value.trim();
    const invite = inviteRaw.split('/').pop();
    if (!tokens.length || !invite) {
        addLog('Missing tokens or invite link!', 'error');
        return;
    }
    document.getElementById('countTotal').innerText = tokens.length;
    addLog(`Initiating JOIN for ${tokens.length} tokens...`, 'info');
    for (let i = 0; i < tokens.length; i++) {
        await joinServer(tokens[i], invite, i + 1);
        await new Promise(r => setTimeout(r, 1500));
    }
});

document.getElementById('bypassBtn').addEventListener('click', async () => {
    const tokens = document.getElementById('tokens').value.split('\n').filter(t => t.trim());
    if (!tokens.length) return;
    addLog('Initiating BYPASS sequence...', 'info');
    for (let i = 0; i < tokens.length; i++) {
        await startBypass(tokens[i], i + 1);
        await new Promise(r => setTimeout(r, 800));
    }
});

document.getElementById('profileBtn').addEventListener('click', async () => {
    const tokens = document.getElementById('tokens').value.split('\n').filter(t => t.trim());
    if (!tokens.length) return;
    addLog('Initiating PROFILE updates...', 'info');
    for (let i = 0; i < tokens.length; i++) {
        await updateProfile(tokens[i], i + 1);
        await new Promise(r => setTimeout(r, 2000));
    }
});
