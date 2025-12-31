let captchaQueue = [];
let currentFingerprint = null;

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

// 招待リンクからID取得
document.getElementById('inviteInput').addEventListener('change', async (e) => {
    const code = e.target.value.split('/').pop();
    if (!code) return;
    try {
        const res = await fetch(`https://discord-api.soyaaaaana.com/invite/${code}`);
        const data = await res.json();
        if (data.guild) {
            document.getElementById('guildIdInput').value = data.guild.id;
            addLog(`Server ID detected: ${data.guild.id}`, 'info');
        }
    } catch (e) { addLog('Invite fetch failed', 'error'); }
});

// 表示切り替え
document.getElementById('toggleTokens').addEventListener('click', function() {
    const area = document.getElementById('tokens');
    const isMasked = area.classList.contains('masked');
    area.classList.toggle('masked', !isMasked);
    area.classList.toggle('unmasked', isMasked);
    this.innerText = isMasked ? '🔒' : '👁️';
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
            addLog('CAPTCHA: Required', 'info', num);
            captchaQueue.push({ token, inviteCode, num, sitekey: data.captcha_sitekey, rqtoken: data.captcha_rqtoken, rqdata: data.captcha_rqdata });
            if (captchaQueue.length === 1) renderCaptcha();
        }
    } catch (e) { addLog('Join Failed', 'error', num); }
}

function renderCaptcha() {
    if (!captchaQueue.length) return;
    const item = captchaQueue[0];
    const widgetId = window.hcaptcha.render("captcha-box", {
        sitekey: item.sitekey,
        callback: (key) => {
            window.hcaptcha.reset();
            joinServer(item.token, item.inviteCode, item.num, { key, rqtoken: item.rqtoken });
            captchaQueue.shift();
        }
    });
    if (item.rqdata) window.hcaptcha.setData(widgetId, { rqdata: item.rqdata });
}

function processNextCaptcha() { document.getElementById('captcha-box').innerHTML = ""; if (captchaQueue.length > 0) renderCaptcha(); }

// --- Bypass Engine ---
async function startBypass(token, num) {
    const gId = document.getElementById('guildIdInput').value;
    const msgUrl = document.getElementById('msgUrl').value;
    const headers = { "authorization": token.trim(), "content-type": "application/json", "x-super-properties": getSuperProperties() };
    if (gId) {
        await fetch(`https://discord.com/api/v9/guilds/${gId}/onboarding-responses`, { method: 'POST', headers, body: JSON.stringify({ onboarding_responses: [], onboarding_prompts_seen: {}, onboarding_responses_seen: {}, onboarding_completed: true }) }).catch(()=>{});
        await fetch(`https://discord.com/api/v9/guilds/${gId}/requests/@me`, { method: 'PUT', headers, body: JSON.stringify({ termsofservice: true }) }).catch(()=>{});
    }
    if (msgUrl) {
        const parts = msgUrl.split('/');
        const cId = parts[parts.length-2], mId = parts[parts.length-1];
        try {
            const msgRes = await fetch(`https://discord.com/api/v9/channels/${cId}/messages/${mId}`, { headers });
            const msgData = await msgRes.json();
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
        } catch(e) {}
    }
    addLog('BYPASS: Finished', 'success', num);
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
        } catch (e) {}
    }
    if (Object.keys(payload).length > 0) {
        const res = await fetch(`https://discord.com/api/v9/users/@me`, { method: 'PATCH', headers, body: JSON.stringify(payload) });
        if (res.ok) addLog('PROFILE: Changed', 'success', num);
    }
}

// ボタン実行
document.getElementById('joinBtn').addEventListener('click', async () => {
    const tokens = document.getElementById('tokens').value.split('\n').filter(t => t.trim());
    const invite = document.getElementById('inviteInput').value.split('/').pop();
    if (!tokens.length || !invite) return;
    document.getElementById('countTotal').innerText = tokens.length;
    for (let i = 0; i < tokens.length; i++) {
        await joinServer(tokens[i], invite, i + 1);
        await new Promise(r => setTimeout(r, 1500));
    }
});

document.getElementById('bypassBtn').addEventListener('click', async () => {
    const tokens = document.getElementById('tokens').value.split('\n').filter(t => t.trim());
    for (let i = 0; i < tokens.length; i++) {
        await startBypass(tokens[i], i + 1);
        await new Promise(r => setTimeout(r, 800));
    }
});

document.getElementById('profileBtn').addEventListener('click', async () => {
    const tokens = document.getElementById('tokens').value.split('\n').filter(t => t.trim());
    for (let i = 0; i < tokens.length; i++) {
        await updateProfile(tokens[i], i + 1);
        await new Promise(r => setTimeout(r, 2000));
    }
});
