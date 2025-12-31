let captchaQueue = [];
let currentFingerprint = null;
let successCount = 0;

// --- 招待リンクからGuild IDを自動抽出 ---
document.getElementById('inviteInput').addEventListener('input', async (e) => {
    const val = e.target.value.trim();
    const code = val.split('/').pop();
    if (!code || code.length < 2) return;

    try {
        const res = await fetch(`https://discord-api.soyaaaaana.com/invites/${code}`);
        if (res.ok) {
            const data = await res.json();
            if (data.guild && data.guild.id) {
                document.getElementById('guildIdInput').value = data.guild.id;
                addLog(`Guild ID detected: ${data.guild.id}`, 'info');
            }
        }
    } catch (err) { /* silent catch */ }
});

function addLog(msg, type = '', num = null) {
    const div = document.createElement('div');
    div.className = 'log-entry';
    const time = new Date().toLocaleTimeString([], { hour12: false });
    div.innerHTML = `<span style="color:#444">[${time}]</span> <span class="log-${type}">${num ? `[${num}] ` : ''}${msg}</span>`;
    const logArea = document.getElementById('logArea');
    logArea.prepend(div);
}

function getSuperProperties() {
    return btoa(JSON.stringify({
        "os": "Windows", "browser": "Chrome", "device": "", "system_locale": "ja",
        "browser_user_agent": navigator.userAgent, "browser_version": "120.0.0.0",
        "os_version": "10", "referrer": "", "referring_domain": "", "release_channel": "stable",
        "client_build_number": 250000, "client_event_source": null
    }));
}

// --- バイパス処理: オンボーディング、ルール同意、リアクション、ボタンクリック ---
async function bypassSequence(token, num, gId, msgUrl) {
    const headers = { 
        "authorization": token, 
        "content-type": "application/json", 
        "x-super-properties": getSuperProperties() 
    };

    // 1. オンボーディング & ルール同意の突破
    if (gId) {
        try {
            await fetch(`https://discord.com/api/v9/guilds/${gId}/onboarding-responses`, {
                method: 'POST', headers,
                body: JSON.stringify({ onboarding_responses: [], onboarding_prompts_seen: {}, onboarding_responses_seen: {}, onboarding_completed: true })
            });
            await fetch(`https://discord.com/api/v9/guilds/${gId}/requests/@me`, {
                method: 'PUT', headers, body: JSON.stringify({ termsofservice: true })
            });
            addLog('Bypass: Onboarding/Rules processed', 'success', num);
        } catch (e) { console.error(e); }
    }

    // 2. メッセージ解析 & コンポーネント自動実行
    if (msgUrl && msgUrl.includes('channels/')) {
        try {
            const parts = msgUrl.split('/');
            const channelId = parts[parts.length - 2];
            const messageId = parts[parts.length - 1];

            // メッセージ内容を取得
            const msgRes = await fetch(`https://discord.com/api/v9/channels/${channelId}/messages/${messageId}`, { headers });
            const msgData = await msgRes.json();

            // リアクションをすべて踏む
            if (msgData.reactions) {
                for (const r of msgData.reactions) {
                    const emoji = r.emoji.id ? `${r.emoji.name}:${r.emoji.id}` : r.emoji.name;
                    await fetch(`https://discord.com/api/v9/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`, { method: 'PUT', headers });
                    addLog(`Reaction: ${r.emoji.name} sent`, 'success', num);
                }
            }

            // ボタンをクリック
            if (msgData.components) {
                for (const row of msgData.components) {
                    for (const comp of row.components) {
                        if (comp.type === 2) { // Button type
                            await fetch(`https://discord.com/api/v9/interactions`, {
                                method: 'POST', headers,
                                body: JSON.stringify({
                                    type: 3,
                                    guild_id: gId,
                                    channel_id: channelId,
                                    message_id: messageId,
                                    application_id: msgData.author.id,
                                    data: { component_type: 2, custom_id: comp.custom_id }
                                })
                            });
                            addLog(`Button Clicked: ${comp.label || comp.custom_id}`, 'success', num);
                        }
                    }
                }
            }
        } catch (e) { addLog('Interaction error', 'error', num); }
    }
}

// --- 強化版 Joiner (CORS回避・rqdata・session-id対応) ---
async function joinServer(token, inviteCode, num, captchaData = null) {
    if (!currentFingerprint) {
        try {
            const res = await fetch("https://discord-api.soyaaaaana.com/experiments", { 
                headers: { "x-super-properties": getSuperProperties() }, 
                method: "GET" 
            });
            const data = await res.json();
            currentFingerprint = data.fingerprint;
        } catch (e) { addLog('Fingerprint error', 'error'); }
    }

    const sessionId = crypto.randomUUID().replace(/-/g, '');
    const headers = {
        "authorization": token.trim(),
        "content-type": "application/json",
        "x-fingerprint": currentFingerprint,
        "x-super-properties": getSuperProperties(),
    };

    if (captchaData) {
        headers["x-captcha-key"] = captchaData.key;
        headers["x-captcha-rqtoken"] = captchaData.rqtoken;
        headers["x-captcha-session-id"] = sessionId;
    }

    try {
        const proxyUrl = `https://discord-api.soyaaaaana.com/invites/${inviteCode}`;
        const res = await fetch(proxyUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ session_id: sessionId }),
            credentials: "include"
        });

        const data = await res.json();
        
        if (res.ok && data.code) {
            addLog('JOIN: Success', 'success', num);
            successCount++;
            document.getElementById('countSuccess').innerText = successCount;
            
            // 参加後にバイパスシーケンスへ
            const gId = document.getElementById('guildIdInput').value;
            const msgUrl = document.getElementById('msgUrl').value;
            await bypassSequence(token.trim(), num, gId, msgUrl);

            processNextCaptcha();
        } else if (data.captcha_sitekey) {
            addLog('CAPTCHA: Required', 'warn', num);
            captchaQueue.push({ 
                token, 
                inviteCode, 
                num, 
                sitekey: data.captcha_sitekey, 
                rqtoken: data.captcha_rqtoken,
                rqdata: data.captcha_rqdata 
            });
            if (captchaQueue.length === 1) renderCaptcha();
        } else {
            addLog(`FAILED: ${data.message || 'Error'}`, 'error', num);
            processNextCaptcha();
        }
    } catch (e) { addLog('Network error', 'error', num); }
}

function renderCaptcha() {
    if (!captchaQueue.length) return;
    const item = captchaQueue[0];
    const box = document.getElementById('captcha-box');
    box.innerHTML = ""; 

    const widgetId = window.hcaptcha.render("captcha-box", {
        sitekey: item.sitekey,
        callback: (key) => {
            window.hcaptcha.reset();
            joinServer(item.token, item.inviteCode, item.num, { key, rqtoken: item.rqtoken });
            captchaQueue.shift();
        }
    });

    if (item.rqdata) {
        window.hcaptcha.setData(widgetId, { rqdata: item.rqdata });
    }
}

function processNextCaptcha() {
    document.getElementById('captcha-box').innerHTML = "";
    if (captchaQueue.length > 0) renderCaptcha();
}

document.getElementById('joinBtn').addEventListener('click', async () => {
    const tokens = document.getElementById('tokens').value.split('\n').filter(t => t.trim());
    const inviteRaw = document.getElementById('inviteInput').value.trim();
    const invite = inviteRaw.split('/').pop();
    
    if (!tokens.length || !invite) {
        addLog('Missing Token or Invite Code', 'error');
        return;
    }

    document.getElementById('countTotal').innerText = tokens.length;
    addLog('Initiating Nova engine...', 'info');

    for (let i = 0; i < tokens.length; i++) {
        await joinServer(tokens[i], invite, i + 1);
        // レート制限回避のためのインターバル
        await new Promise(r => setTimeout(r, 2000));
    }
});
