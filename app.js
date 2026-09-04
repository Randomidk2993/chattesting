/* ══════════════════════════════════════════
   NEXUS CHAT — APP LOGIC
   Firebase: auth, Firestore (messages, users, chats, restrictions)
   Supabase Storage: audio clips (≤3 min) and video clips (≤5 min)
   ══════════════════════════════════════════ */

'use strict';

// ─── STATE ────────────────────────────────────────────────────────────────────
let db, auth;
let currentUser     = null;
let currentUserData = null;
let currentChatId   = null;
let msgUnsub        = null;
let chatsUnsub      = null;
let lastDateStr     = null;
let banUnsub        = null;
let restrictUnsub   = null;
let adminUserUnsub  = null;
let adminRestrictUnsub = null;

// ─── ADMIN CONFIG ─────────────────────────────────────────────────────────────
const ADMIN_EMAILS = [
    '30copallock@pulaskischools.org',
    '30chpallock@pulaskischools.org',
    'chilten44pallock@gmail.com',
    'coltenboop@gmail.com',
    'ohioshared@gmail.com'
];

function isAdmin() {
    return currentUser && ADMIN_EMAILS.includes((currentUser.email || '').toLowerCase());
}

// ─── AVATAR COLORS ────────────────────────────────────────────────────────────
const PALETTE = [
    '#4a6cf7','#7209b7','#f72585','#4cc9f0',
    '#06d6a0','#ff6b35','#e63946','#3a0ca3',
    '#fb8500','#2dc653','#0096c7','#d62828'
];

function pickColor(seed) {
    if (!seed) return PALETTE[0];
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = seed.charCodeAt(i) + ((h << 5) - h);
    return PALETTE[Math.abs(h) % PALETTE.length];
}

function initial(name) { return (name || '?').charAt(0).toUpperCase(); }

function esc(str) {
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(String(str)));
    return d.innerHTML;
}

function setMsg(id, text, ok = false) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.style.color = ok ? '#22c55e' : '#ef4444';
    if (text) setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 5000);
}

// ─── CONTENT FILTER ──────────────────────────────────────────────────────────
const BLOCKLIST = [
    'fuck','fucks','fucker','fuckers','fucking','fucked','fuckhead',
    'f u c k','f*ck',
    'shit','shits','shitting','shitted','shithead','bullshit',
    's h i t','sh!t',
    'bitch','bitches','bitching','bitchy',
    'b!tch','b1tch',
    'cunt','cunts',
    'ass','asses','asshole','assholes','arsehole','arseholes',
    'a55','@ss',
    'bastard','bastards',
    'dick','dicks','dickhead','dickheads',
    'd!ck','d1ck',
    'pussy','pussies',
    'cock','cocks','cockhead',
    'motherfucker','motherfuckers','motherfucking',
    'nigger','niggers','nigga','niggas',
    'faggot','faggots','fag','fags',
    'retard','retards','retarded',
    'whore','whores',
    'slut','sluts',
    'piss','pissed','pissing',
    'crap','crappy',
    'wanker','wankers','wank',
    'twat','twats',
    'bollocks',
    'prick','pricks',
    'kike','spic','chink','gook','wetback','tranny',
].sort((a, b) => b.length - a.length);

const _filterRe = new RegExp(
    BLOCKLIST.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
    'gi'
);

function filterText(text) {
    if (!text || !text.trim()) return { clean: text, wasDirty: false };
    let wasDirty = false;
    const clean = text.replace(_filterRe, match => { wasDirty = true; return '*'.repeat(match.length); });
    return { clean, wasDirty };
}

function usernameIsDirty(name) { return filterText(name).wasDirty; }

// ─── SCREENS ──────────────────────────────────────────────────────────────────
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    const el = document.getElementById(id);
    if (el) {
        el.classList.remove('hidden');
        el.style.animation = 'none';
        el.offsetHeight;
        el.style.animation = '';
    }
}

// ─── MOBILE ───────────────────────────────────────────────────────────────────
function isMobile() { return window.innerWidth <= 640; }
function showChatOnMobile() {
    if (!isMobile()) return;
    document.querySelector('.conv-panel')?.classList.add('panel-hidden');
    document.querySelector('.chat-panel')?.classList.add('panel-visible');
}
function showConvOnMobile() {
    if (!isMobile()) return;
    document.querySelector('.conv-panel')?.classList.remove('panel-hidden');
    document.querySelector('.chat-panel')?.classList.remove('panel-visible');
}

// ─── AUTH TAB ─────────────────────────────────────────────────────────────────
function switchTab(tab) {
    const isLogin = tab === 'login';
    document.getElementById('tab-login').classList.toggle('active', isLogin);
    document.getElementById('tab-register').classList.toggle('active', !isLogin);
    document.getElementById('form-login').classList.toggle('hidden', !isLogin);
    document.getElementById('form-register').classList.toggle('hidden', isLogin);
    setMsg('auth-msg', '');
}

function authError(code) {
    const map = {
        'auth/user-not-found':         'No account found with that email.',
        'auth/wrong-password':         'Incorrect password.',
        'auth/invalid-credential':     'Invalid email or password.',
        'auth/email-already-in-use':   'That email is already registered.',
        'auth/weak-password':          'Password must be at least 6 characters.',
        'auth/invalid-email':          'Invalid email address.',
        'auth/too-many-requests':      'Too many attempts — try again later.',
        'auth/popup-closed-by-user':   'Sign-in was cancelled.',
        'auth/network-request-failed': 'Network error. Check your connection.',
    };
    return map[code] || `Error: ${code}`;
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    db   = firebase.firestore();
    auth = firebase.auth();

    auth.onAuthStateChanged(async user => {
        if (!user) { showScreen('screen-auth'); return; }
        try {
            const snap = await db.collection('users').doc(user.uid).get();
            if (!snap.exists) {
                showScreen('screen-username');
            } else {
                const data = snap.data();
                if (data.banned) { showScreen('screen-banned'); return; }
                currentUser     = user;
                currentUserData = data;
                bootApp();
            }
        } catch (err) {
            console.error('Auth state error:', err);
            showScreen('screen-auth');
        }
    });

    document.getElementById('form-login').addEventListener('submit', async e => {
        e.preventDefault();
        const email = document.getElementById('login-email').value.trim();
        const pass  = document.getElementById('login-password').value;
        if (!email.toLowerCase().endsWith('@gmail.com')) {
            setMsg('auth-msg', 'Please use a Gmail address (@gmail.com).');
            return;
        }
        try {
            await auth.signInWithEmailAndPassword(email, pass);
        } catch (err) {
            setMsg('auth-msg', authError(err.code));
        }
    });

    document.getElementById('form-register').addEventListener('submit', async e => {
        e.preventDefault();
        const uname = document.getElementById('reg-username').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const pass  = document.getElementById('reg-password').value;

        if (uname.length < 2)  { setMsg('auth-msg', 'Username must be at least 2 characters.'); return; }
        if (uname.length > 24) { setMsg('auth-msg', 'Username can be at most 24 characters.'); return; }
        if (!/^[a-zA-Z0-9_. -]+$/.test(uname)) {
            setMsg('auth-msg', 'Username can only contain letters, numbers, spaces, underscores, dots, and hyphens.');
            return;
        }
        if (!email.toLowerCase().endsWith('@gmail.com')) {
            setMsg('auth-msg', 'Please use a Gmail address (@gmail.com).');
            return;
        }
        if (usernameIsDirty(uname)) {
            setMsg('auth-msg', 'That username contains inappropriate language. Please choose another.');
            return;
        }
        try {
            const cred = await auth.createUserWithEmailAndPassword(email, pass);
            await createUserDoc(cred.user, uname);
        } catch (err) {
            setMsg('auth-msg', authError(err.code));
        }
    });

    document.getElementById('form-username').addEventListener('submit', async e => {
        e.preventDefault();
        const uname = document.getElementById('setup-username').value.trim();
        if (uname.length < 2)  { setMsg('username-msg', 'At least 2 characters please.'); return; }
        if (uname.length > 24) { setMsg('username-msg', 'Max 24 characters.'); return; }
        if (usernameIsDirty(uname)) {
            setMsg('username-msg', 'That username contains inappropriate language. Please choose another.');
            return;
        }
        try {
            const user = auth.currentUser;
            await createUserDoc(user, uname);
            currentUser     = user;
            const snap      = await db.collection('users').doc(user.uid).get();
            currentUserData = snap.data();
            bootApp();
        } catch (err) {
            setMsg('username-msg', err.message);
        }
    });

    document.getElementById('compose-input').addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });

    document.getElementById('mobile-back-btn')?.addEventListener('click', showConvOnMobile);
});

// ─── GOOGLE SIGN-IN ───────────────────────────────────────────────────────────
function signInWithGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).catch(err => setMsg('auth-msg', authError(err.code)));
}

// ─── CREATE USER DOCUMENT ────────────────────────────────────────────────────
async function createUserDoc(user, username) {
    await db.collection('users').doc(user.uid).set({
        username,
        usernameLower: username.toLowerCase(),
        email:         user.email || '',
        color:         pickColor(user.uid),
        createdAt:     firebase.firestore.FieldValue.serverTimestamp()
    });
}

// ─── BOOT APP ─────────────────────────────────────────────────────────────────
function bootApp() {
    showScreen('screen-app');
    renderAvatar('sidebar-avatar', currentUserData.username, currentUserData.color);
    renderAvatar('footer-avatar',  currentUserData.username, currentUserData.color);
    document.getElementById('footer-username').textContent = currentUserData.username;

    if (isAdmin()) document.getElementById('nav-admin').classList.remove('hidden');

    loadConvList();
    pruneOldMessages();
    startBanListener();
    startRestrictionListener();
}

// ─── REALTIME BAN LISTENER ────────────────────────────────────────────────────
function startBanListener() {
    if (banUnsub) banUnsub();
    banUnsub = db.collection('users').doc(currentUser.uid)
        .onSnapshot(snap => {
            if (!snap.exists) return;
            if (snap.data().banned) {
                if (msgUnsub)      msgUnsub();
                if (chatsUnsub)    chatsUnsub();
                if (restrictUnsub) restrictUnsub();
                showScreen('screen-banned');
            }
        });
}

// ─── REALTIME RESTRICTION LISTENER ───────────────────────────────────────────
function startRestrictionListener() {
    if (restrictUnsub) restrictUnsub();
    restrictUnsub = db.collection('restrictions').doc(currentUser.uid)
        .onSnapshot(snap => {
            if (snap.exists) {
                const data  = snap.data();
                const until = data.until ? data.until.toDate() : null;
                if (until && until > new Date()) {
                    setComposeRestricted(true, until);
                    setTimeout(() => setComposeRestricted(false), until - new Date());
                } else {
                    setComposeRestricted(false);
                    db.collection('restrictions').doc(currentUser.uid).delete().catch(() => {});
                }
            } else {
                setComposeRestricted(false);
            }
        });
}

function setComposeRestricted(restricted, until) {
    const overlay = document.getElementById('restricted-overlay');
    const input   = document.getElementById('compose-input');
    const sendBtn = document.getElementById('send-btn');
    const imgBtn  = document.getElementById('img-upload-btn');
    const audBtn  = document.getElementById('audio-upload-btn');
    const vidBtn  = document.getElementById('video-upload-btn');
    if (!overlay || !input) return;

    if (restricted && until) {
        const mins  = Math.ceil((until - new Date()) / 60000);
        const label = mins >= 1440 ? `${Math.ceil(mins/1440)} day(s)` : mins >= 60 ? `${Math.ceil(mins/60)} hour(s)` : `${mins} minute(s)`;
        document.getElementById('restricted-overlay-text').textContent = `You are restricted from chatting for ${label}`;
        overlay.classList.remove('hidden');
        input.disabled = true; input.value = '';
        if (sendBtn) sendBtn.disabled = true;
        if (imgBtn)  imgBtn.disabled  = true;
        if (audBtn)  audBtn.disabled  = true;
        if (vidBtn)  vidBtn.disabled  = true;
    } else {
        overlay.classList.add('hidden');
        input.disabled = false;
        if (sendBtn) sendBtn.disabled = false;
        if (imgBtn)  imgBtn.disabled  = false;
        if (audBtn)  audBtn.disabled  = false;
        if (vidBtn)  vidBtn.disabled  = false;
    }
}

// ─── AUTO-DELETE MESSAGES OLDER THAN 7 DAYS ──────────────────────────────────
async function pruneOldMessages() {
    try {
        const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const snap = await db.collection('messages')
            .where('timestamp', '<', firebase.firestore.Timestamp.fromDate(cutoff))
            .limit(400).get();
        if (snap.empty) return;
        const batch = db.batch();
        snap.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        console.log(`Pruned ${snap.size} old message(s).`);
    } catch (err) {
        console.warn('Message pruning skipped:', err.message);
    }
}

function renderAvatar(id, name, color) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent      = initial(name);
    el.style.background = color;
}

// ─── CONVERSATIONS ────────────────────────────────────────────────────────────
function loadConvList() {
    if (chatsUnsub) chatsUnsub();

    const list = document.getElementById('conv-list');
    list.innerHTML = '';

    list.appendChild(createLabel('<i class="fas fa-thumbtack"></i> Pinned'));
    list.appendChild(buildConvItem({
        chatId: 'global', name: 'Global Chat',
        sub: 'Everyone is here', color: '#4a6cf7', symbol: '🌐', isGlobal: true
    }));

    const dmLabel = createLabel('<i class="fas fa-comment-dots"></i> Direct Messages');
    dmLabel.id = 'dm-section-label';
    list.appendChild(dmLabel);

    chatsUnsub = db.collection('chats')
        .where('participants', 'array-contains', currentUser.uid)
        .orderBy('lastTimestamp', 'desc')
        .onSnapshot(snap => {
            list.querySelectorAll('.conv-item.dm-item').forEach(el => el.remove());
            const label = document.getElementById('dm-section-label');
            snap.forEach(doc => {
                const data    = doc.data();
                const otherId = data.participants.find(id => id !== currentUser.uid);
                if (!otherId) return;
                const otherName  = (data.participantNames  || {})[otherId] || 'Unknown';
                const otherColor = (data.participantColors || {})[otherId] || '#888';
                const ts         = data.lastTimestamp ? fmtTime(data.lastTimestamp.toDate()) : '';
                const sub        = data.lastMessage || 'No messages yet';
                list.insertBefore(buildConvItem({
                    chatId: doc.id, name: otherName, sub,
                    color: otherColor, symbol: null, timestamp: ts, isDM: true
                }), label.nextSibling);
            });
        }, err => console.error('Chats listener error:', err));
}

function createLabel(html) {
    const el = document.createElement('div');
    el.className = 'conv-section-label';
    el.innerHTML = html;
    return el;
}

function buildConvItem({ chatId, name, sub, color, symbol, timestamp, isGlobal, isDM }) {
    const div = document.createElement('div');
    div.className = 'conv-item' + (isDM ? ' dm-item' : '');
    div.dataset.chatId = chatId;
    div.innerHTML = `
        <div class="conv-av" style="background:${color}">${symbol || esc(initial(name))}</div>
        <div class="conv-info">
            <div class="conv-name-row">
                <span class="conv-name">${esc(name)}</span>
                ${timestamp ? `<span class="conv-time">${timestamp}</span>` : ''}
            </div>
            <span class="conv-sub">${esc(sub)}</span>
        </div>
    `;
    div.addEventListener('click', () => openChat(chatId, name, color, symbol || initial(name)));
    return div;
}

// ─── TIME FORMATTING ──────────────────────────────────────────────────────────
function fmtTime(date) {
    if (!date) return '';
    const now  = new Date();
    const diff = now - date;
    if (diff < 86400000 && date.toDateString() === now.toDateString())
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (new Date(now - 86400000).toDateString() === date.toDateString()) return 'Yesterday';
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function fmtDateLabel(date) {
    const now = new Date();
    if (date.toDateString() === now.toDateString()) return 'Today';
    if (new Date(now - 86400000).toDateString() === date.toDateString()) return 'Yesterday';
    return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

// ─── OPEN CHAT ────────────────────────────────────────────────────────────────
function openChat(chatId, name, color, avatarContent) {
    currentChatId = chatId;
    lastDateStr   = null;

    document.querySelectorAll('.conv-item').forEach(el => {
        el.classList.toggle('active', el.dataset.chatId === chatId);
    });

    const hdrAv = document.getElementById('chat-hdr-av');
    hdrAv.textContent      = avatarContent;
    hdrAv.style.background = color;
    document.getElementById('chat-hdr-name').textContent = name;
    document.getElementById('chat-hdr-sub').textContent  =
        chatId === 'global' ? '🌐 Global Chat • Everyone' : '💬 Direct Message';

    document.getElementById('chat-empty').classList.add('hidden');
    document.getElementById('chat-main').classList.remove('hidden');

    listenMessages(chatId);
    showChatOnMobile();
    document.getElementById('compose-input').focus();
}

// ─── MESSAGES LISTENER ────────────────────────────────────────────────────────
function listenMessages(chatId) {
    if (msgUnsub) msgUnsub();
    const area = document.getElementById('messages-area');
    area.innerHTML = '';
    lastDateStr = null;

    msgUnsub = db.collection('messages')
        .where('chatId', '==', chatId)
        .orderBy('timestamp', 'asc')
        .limitToLast(100)
        .onSnapshot(snap => {
            snap.docChanges().forEach(change => {
                if (change.type === 'added') {
                    const data = change.doc.data();
                    data.id = change.doc.id;
                    renderMsg(data);
                }
                if (change.type === 'removed') {
                    const el = document.querySelector(`[data-msg-id="${change.doc.id}"]`);
                    if (el) el.remove();
                }
            });
            scrollDown();
        }, err => console.error('Messages listener error:', err));
}

// ─── RENDER MESSAGE ───────────────────────────────────────────────────────────
function renderMsg(msg) {
    const area = document.getElementById('messages-area');
    if (!area) return;

    const isOwn   = msg.senderId === currentUser.uid;
    const ts      = msg.timestamp ? msg.timestamp.toDate() : new Date();
    const dateStr = ts.toDateString();

    if (dateStr !== lastDateStr) {
        lastDateStr = dateStr;
        const sep = document.createElement('div');
        sep.className   = 'date-sep';
        sep.textContent = fmtDateLabel(ts);
        area.appendChild(sep);
    }

    const group     = document.createElement('div');
    group.className = `msg-group ${isOwn ? 'own' : 'other'}`;
    if (msg.id) group.dataset.msgId = msg.id;

    const avColor   = isOwn ? currentUserData.color : (msg.senderColor || '#888');
    const avInitial = isOwn ? initial(currentUserData.username) : initial(msg.senderName);
    const sender    = isOwn ? 'You' : esc(msg.senderName || 'Unknown');
    const timeStr   = fmtTime(ts);

    let bubbleClass = 'msg-bubble';
    let bubbleInner = '';

    if (msg.imageBase64) {
        bubbleClass += ' img-bubble';
        bubbleInner  = `<img src="${msg.imageBase64}" class="msg-img" alt="Image" onclick="viewImage(this)">`;
    } else if (msg.audioUrl) {
        bubbleClass += ' media-bubble';
        bubbleInner  = `
            <div class="msg-audio-wrap">
                <i class="fas fa-microphone msg-media-icon"></i>
                <audio controls class="msg-audio" preload="metadata">
                    <source src="${esc(msg.audioUrl)}">
                    Your browser doesn't support audio.
                </audio>
            </div>`;
    } else if (msg.videoUrl) {
        bubbleClass += ' media-bubble';
        bubbleInner  = `
            <div class="msg-video-wrap">
                <video controls class="msg-video" preload="metadata">
                    <source src="${esc(msg.videoUrl)}">
                    Your browser doesn't support video.
                </video>
            </div>`;
    } else {
        bubbleInner = esc(msg.text || '');
        if (msg.wasFiltered) bubbleInner += `<span class="filter-badge" title="This message was filtered">🚫</span>`;
    }

    const deleteBtn = isOwn && msg.id
        ? `<button class="msg-delete-btn" title="Delete message" onclick="deleteOwnMessage('${msg.id}', this)"><i class="fas fa-trash"></i></button>`
        : '';

    const isAdminSender = ADMIN_EMAILS.includes((msg.senderEmail || '').toLowerCase());
    const adminBadge    = isAdminSender
        ? `<span class="admin-badge"><i class="fas fa-shield-alt"></i> Chat Moderator</span>` : '';

    const belowBubble = (adminBadge || deleteBtn)
        ? `<div class="msg-below">${adminBadge}${deleteBtn}</div>` : '';

    group.innerHTML = `
        <div class="msg-av" style="background:${avColor}">${avInitial}</div>
        <div class="msg-body">
            <div class="msg-meta">
                <span class="sender">${sender}</span>
                <span>${timeStr}</span>
            </div>
            <div class="${bubbleClass}">${bubbleInner}</div>
            ${belowBubble}
        </div>
    `;

    area.appendChild(group);
}

// ─── SCROLL ───────────────────────────────────────────────────────────────────
function scrollDown() {
    const area = document.getElementById('messages-area');
    if (!area) return;
    requestAnimationFrame(() => { area.scrollTop = area.scrollHeight; });
}

// ─── SEND TEXT MESSAGE ────────────────────────────────────────────────────────
async function sendMessage() {
    const input = document.getElementById('compose-input');
    const raw   = input.value.trim();
    if (!raw || !currentChatId) return;

    const overlay = document.getElementById('restricted-overlay');
    if (overlay && !overlay.classList.contains('hidden')) return;

    input.value = '';

    const { clean: text, wasDirty: wasFiltered } = filterText(raw);

    const msg = {
        chatId:      currentChatId,
        senderId:    currentUser.uid,
        senderName:  currentUserData.username,
        senderColor: currentUserData.color,
        senderEmail: currentUser.email || '',
        text,
        wasFiltered,
        timestamp:   firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
        await db.collection('messages').add(msg);
        if (currentChatId !== 'global') {
            await db.collection('chats').doc(currentChatId).update({
                lastMessage:   text,
                lastTimestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
    } catch (err) {
        console.error('Send message error:', err);
        alert('Failed to send message. Make sure your Firestore rules are set correctly.');
    }
}

// ─── SEND IMAGE (Firebase, base64) ────────────────────────────────────────────
function handleImage(input) {
    const file = input.files[0];
    if (!file || !currentChatId) return;

    const reader = new FileReader();
    reader.onload = e => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX    = 800;
            let [w, h]   = [img.width, img.height];
            if (w > MAX || h > MAX) {
                if (w >= h) { h = Math.round(h * MAX / w); w = MAX; }
                else        { w = Math.round(w * MAX / h); h = MAX; }
            }
            canvas.width  = w;
            canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            const base64 = canvas.toDataURL('image/jpeg', 0.65);
            if (base64.length > 900_000) {
                alert('Image is too large after compression. Please use a smaller image.');
                return;
            }
            postImage(base64);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
    input.value = '';
}

async function postImage(base64) {
    const msg = {
        chatId:      currentChatId,
        senderId:    currentUser.uid,
        senderName:  currentUserData.username,
        senderColor: currentUserData.color,
        senderEmail: currentUser.email || '',
        text: '', imageBase64: base64,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    };
    try {
        await db.collection('messages').add(msg);
        if (currentChatId !== 'global') {
            await db.collection('chats').doc(currentChatId).update({
                lastMessage:   '📷 Image',
                lastTimestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
    } catch (err) {
        console.error('Send image error:', err);
        alert('Failed to send image.');
    }
}

// ─── UPLOAD PROGRESS UI ───────────────────────────────────────────────────────
function showProgress(label) {
    document.getElementById('upload-progress-wrap').classList.remove('hidden');
    document.getElementById('upload-progress-label').textContent = label;
    setProgressPct(0);
}

function setProgressPct(pct) {
    document.getElementById('upload-progress-bar').style.width = `${pct}%`;
}

function hideProgress() {
    document.getElementById('upload-progress-wrap').classList.add('hidden');
    setProgressPct(0);
}

// ─── SUPABASE UPLOAD HELPER ───────────────────────────────────────────────────
// Uses XMLHttpRequest so we can track progress
async function supabaseUpload(bucket, filePath, file, onProgress) {
    return new Promise((resolve, reject) => {
        const url = `${SUPABASE_URL}/storage/v1/object/${bucket}/${filePath}`;
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        xhr.setRequestHeader('Authorization', `Bearer ${SUPABASE_ANON}`);
        xhr.setRequestHeader('x-upsert', 'true');
        // Don't set Content-Type — let browser set it with boundary for FormData,
        // or set it manually for raw binary
        xhr.setRequestHeader('Content-Type', file.type);

        xhr.upload.onprogress = e => {
            if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
        };

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                // Build public URL
                const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${filePath}`;
                resolve(publicUrl);
            } else {
                reject(new Error(`Upload failed: ${xhr.status} ${xhr.responseText}`));
            }
        };

        xhr.onerror = () => reject(new Error('Network error during upload'));
        xhr.send(file);
    });
}

// ─── HANDLE AUDIO (Supabase, max 3 min) ──────────────────────────────────────
async function handleAudio(input) {
    const file = input.files[0];
    input.value = '';
    if (!file || !currentChatId) return;

    // Check duration using an Audio element
    const url = URL.createObjectURL(file);
    const tmpAudio = document.createElement('audio');
    tmpAudio.preload = 'metadata';

    await new Promise((res) => {
        tmpAudio.onloadedmetadata = res;
        tmpAudio.onerror = res; // still proceed; duration may be NaN
        tmpAudio.src = url;
    });

    const duration = tmpAudio.duration;
    URL.revokeObjectURL(url);

    const MAX_AUDIO_SEC = 3 * 60; // 3 minutes
    if (!isNaN(duration) && duration > MAX_AUDIO_SEC) {
        alert(`Audio clips must be 3 minutes or shorter. Your clip is ${Math.ceil(duration / 60)} min.`);
        return;
    }

    // Check file size sanity (≈ 10MB max for 3 min audio)
    if (file.size > 10 * 1024 * 1024) {
        alert('Audio file is too large (max ~10 MB).');
        return;
    }

    const filePath = `${currentUser.uid}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    showProgress('Uploading audio…');
    try {
        const publicUrl = await supabaseUpload(SUPABASE_AUDIO_BUCKET, filePath, file, pct => {
            setProgressPct(pct);
            document.getElementById('upload-progress-label').textContent = `Uploading audio… ${pct}%`;
        });
        await postMedia('audio', publicUrl, '🎤 Audio clip');
    } catch (err) {
        console.error('Audio upload error:', err);
        alert('Failed to upload audio. Check your Supabase bucket settings.');
    } finally {
        hideProgress();
    }
}

// ─── HANDLE VIDEO (Supabase, max 5 min) ──────────────────────────────────────
async function handleVideo(input) {
    const file = input.files[0];
    input.value = '';
    if (!file || !currentChatId) return;

    // Check duration
    const url    = URL.createObjectURL(file);
    const tmpVid = document.createElement('video');
    tmpVid.preload = 'metadata';

    await new Promise((res) => {
        tmpVid.onloadedmetadata = res;
        tmpVid.onerror = res;
        tmpVid.src = url;
    });

    const duration = tmpVid.duration;
    URL.revokeObjectURL(url);

    const MAX_VIDEO_SEC = 5 * 60; // 5 minutes
    if (!isNaN(duration) && duration > MAX_VIDEO_SEC) {
        alert(`Video clips must be 5 minutes or shorter. Your clip is ${Math.ceil(duration / 60)} min.`);
        return;
    }

    // File size cap — 5 min at reasonable quality ≈ 150MB max
    if (file.size > 150 * 1024 * 1024) {
        alert('Video file is too large (max 150 MB for clips up to 5 min).');
        return;
    }

    const filePath = `${currentUser.uid}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    showProgress('Uploading video…');
    try {
        const publicUrl = await supabaseUpload(SUPABASE_VIDEO_BUCKET, filePath, file, pct => {
            setProgressPct(pct);
            document.getElementById('upload-progress-label').textContent = `Uploading video… ${pct}%`;
        });
        await postMedia('video', publicUrl, '🎬 Video clip');
    } catch (err) {
        console.error('Video upload error:', err);
        alert('Failed to upload video. Check your Supabase bucket settings.');
    } finally {
        hideProgress();
    }
}

// ─── POST MEDIA MESSAGE TO FIRESTORE ─────────────────────────────────────────
async function postMedia(type, url, lastMsgLabel) {
    const msgData = {
        chatId:      currentChatId,
        senderId:    currentUser.uid,
        senderName:  currentUserData.username,
        senderColor: currentUserData.color,
        senderEmail: currentUser.email || '',
        text:        '',
        timestamp:   firebase.firestore.FieldValue.serverTimestamp()
    };
    if (type === 'audio') msgData.audioUrl = url;
    if (type === 'video') msgData.videoUrl = url;

    await db.collection('messages').add(msgData);
    if (currentChatId !== 'global') {
        await db.collection('chats').doc(currentChatId).update({
            lastMessage:   lastMsgLabel,
            lastTimestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
    }
}

// ─── IMAGE LIGHTBOX ───────────────────────────────────────────────────────────
function viewImage(imgEl) {
    const lb  = document.createElement('div');
    lb.className = 'lightbox';
    const img = document.createElement('img');
    img.src   = imgEl.src;
    lb.appendChild(img);
    lb.addEventListener('click', () => lb.remove());
    document.body.appendChild(lb);
}

// ─── USER SEARCH / DM ─────────────────────────────────────────────────────────
function toggleSearch() {
    const box  = document.getElementById('search-box');
    const open = box.classList.contains('hidden');
    box.classList.toggle('hidden', !open);
    if (open) { document.getElementById('search-input').focus(); searchUsers(''); }
}

function closeSearch() {
    document.getElementById('search-box').classList.add('hidden');
}

async function searchUsers(query) {
    const results = document.getElementById('search-results');
    try {
        let snap;
        if (!query || query.length < 1) {
            snap = await db.collection('users').orderBy('usernameLower').limit(50).get();
        } else {
            const q = query.toLowerCase();
            snap = await db.collection('users')
                .orderBy('usernameLower').startAt(q).endAt(q + '\uf8ff').limit(20).get();
        }
        results.innerHTML = '';
        let any = false;
        snap.forEach(doc => {
            if (doc.id === currentUser.uid) return;
            any = true;
            const u   = doc.data();
            const row = document.createElement('div');
            row.className = 'search-result-item';
            row.innerHTML = `
                <div class="s-av" style="background:${u.color}">${esc(initial(u.username))}</div>
                <span>${esc(u.username)}</span>
            `;
            row.addEventListener('click', () => openOrCreateDM(doc.id, u));
            results.appendChild(row);
        });
        if (!any) results.innerHTML = '<div class="search-result-item empty">No users found</div>';
    } catch (err) {
        console.error('Search error:', err);
    }
}

async function openOrCreateDM(otherId, otherUser) {
    const chatId  = [currentUser.uid, otherId].sort().join('_');
    const chatRef = db.collection('chats').doc(chatId);
    try {
        const snap = await chatRef.get();
        if (!snap.exists) {
            await chatRef.set({
                participants: [currentUser.uid, otherId],
                participantNames:  { [currentUser.uid]: currentUserData.username, [otherId]: otherUser.username },
                participantColors: { [currentUser.uid]: currentUserData.color,    [otherId]: otherUser.color },
                lastMessage: '', lastTimestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
        closeSearch();
        openChat(chatId, otherUser.username, otherUser.color, initial(otherUser.username));
    } catch (err) {
        console.error('DM create error:', err);
        alert('Could not open DM. Check Firestore rules.');
    }
}

// ─── LOGOUT ───────────────────────────────────────────────────────────────────
function logout() {
    if (msgUnsub)          msgUnsub();
    if (chatsUnsub)        chatsUnsub();
    if (banUnsub)          banUnsub();
    if (restrictUnsub)     restrictUnsub();
    if (adminUserUnsub)    { adminUserUnsub();     adminUserUnsub = null; }
    if (adminRestrictUnsub){ adminRestrictUnsub(); adminRestrictUnsub = null; }
    currentUser = currentUserData = currentChatId = lastDateStr = null;
    auth.signOut();
}

// ─── DELETE OWN MESSAGE ───────────────────────────────────────────────────────
async function deleteOwnMessage(msgId, btn) {
    if (!msgId) return;
    btn.disabled = true;
    try {
        await db.collection('messages').doc(msgId).delete();
    } catch (err) {
        console.error('Delete message error:', err);
        btn.disabled = false;
        alert('Could not delete message.');
    }
}

// ─── MESSAGES VIEW ────────────────────────────────────────────────────────────
function openMessagesView() {
    document.getElementById('admin-panel').classList.add('hidden');
    document.getElementById('chat-panel').classList.remove('hidden');
    document.getElementById('nav-admin')?.classList.remove('active');
    document.getElementById('nav-messages')?.classList.add('active');
    if (adminUserUnsub)     { adminUserUnsub();     adminUserUnsub = null; }
    if (adminRestrictUnsub) { adminRestrictUnsub(); adminRestrictUnsub = null; }
}

// ─── ADMIN PANEL ──────────────────────────────────────────────────────────────
let adminSelectedUser = null;

function openAdminPanel() {
    if (!isAdmin()) return;
    document.getElementById('chat-panel').classList.add('hidden');
    document.getElementById('admin-panel').classList.remove('hidden');
    document.getElementById('nav-messages')?.classList.remove('active');
    document.getElementById('nav-admin')?.classList.add('active');
    if (adminUserUnsub)     { adminUserUnsub();     adminUserUnsub = null; }
    if (adminRestrictUnsub) { adminRestrictUnsub(); adminRestrictUnsub = null; }
    adminSelectedUser = null;
    document.getElementById('admin-user-search').value = '';
    document.getElementById('admin-selected-user').classList.add('hidden');
    adminSearchUsers('');
}

async function adminSearchUsers(query) {
    const results = document.getElementById('admin-search-results');
    try {
        let snap;
        if (!query || query.length < 1) {
            snap = await db.collection('users').orderBy('usernameLower').limit(50).get();
        } else {
            const q = query.toLowerCase();
            snap = await db.collection('users')
                .orderBy('usernameLower').startAt(q).endAt(q + '\uf8ff').limit(20).get();
        }
        results.innerHTML = '';
        let any = false;
        snap.forEach(doc => {
            if (doc.id === currentUser.uid) return;
            any = true;
            const u   = doc.data();
            const row = document.createElement('div');
            row.className = 'admin-result-item';
            row.innerHTML = `
                <div class="s-av" style="background:${u.color}">${esc(initial(u.username))}</div>
                <span>${esc(u.username)}</span>
                ${u.banned ? '<span class="admin-user-tag banned-tag">Banned</span>' : ''}
            `;
            row.addEventListener('click', () => selectAdminUser(doc.id, u));
            results.appendChild(row);
        });
        if (!any) results.innerHTML = '<div class="admin-result-item" style="cursor:default;opacity:0.6">No users found</div>';
    } catch (err) {
        console.error('Admin search error:', err);
    }
}

function selectAdminUser(uid, userData) {
    adminSelectedUser = { uid, ...userData };
    if (adminUserUnsub)     { adminUserUnsub();     adminUserUnsub = null; }
    if (adminRestrictUnsub) { adminRestrictUnsub(); adminRestrictUnsub = null; }

    const selAv = document.getElementById('admin-sel-av');
    selAv.textContent      = initial(userData.username);
    selAv.style.background = userData.color;
    document.getElementById('admin-sel-name').textContent  = userData.username;
    document.getElementById('admin-sel-email').textContent = userData.email || '(no email)';
    document.getElementById('admin-selected-user').classList.remove('hidden');
    document.getElementById('admin-search-results').innerHTML = '';
    document.getElementById('admin-user-search').value = '';

    setAdminStatus('restrict-status', '');
    setAdminStatus('ban-status', '');
    setAdminStatus('delete-msgs-status', '');

    adminUserUnsub = db.collection('users').doc(uid).onSnapshot(snap => {
        if (!snap.exists) return;
        const d = snap.data();
        adminSelectedUser = { ...adminSelectedUser, ...d, uid };
        const badge = document.getElementById('admin-ban-badge');
        if (badge) badge.textContent = d.banned ? '🔴 Currently Banned' : '🟢 Not Banned';
        setAdminStatus('ban-status', d.banned ? 'This user is currently banned.' : 'This user is not banned.', !d.banned);
    });

    adminRestrictUnsub = db.collection('restrictions').doc(uid).onSnapshot(snap => {
        const badge = document.getElementById('admin-restrict-badge');
        if (snap.exists) {
            const d     = snap.data();
            const until = d.until ? d.until.toDate() : null;
            if (until && until > new Date()) {
                const mins  = Math.ceil((until - new Date()) / 60000);
                const label = mins >= 1440 ? `${Math.ceil(mins/1440)}d` : mins >= 60 ? `${Math.ceil(mins/60)}h` : `${mins}m`;
                if (badge) badge.textContent = `🟠 Restricted (${label} left)`;
                setAdminStatus('restrict-status', `Restricted until ${until.toLocaleString()}`, false);
                return;
            }
        }
        if (badge) badge.textContent = '🟢 Not Restricted';
        setAdminStatus('restrict-status', 'This user is not restricted.', true);
    });
}

function setAdminStatus(id, msg, ok = false) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.style.color = ok ? '#22c55e' : '#ef4444';
}

async function restrictUser() {
    if (!adminSelectedUser) return;
    const duration = parseInt(document.getElementById('restrict-duration').value) || 60;
    const unit     = parseInt(document.getElementById('restrict-unit').value) || 1;
    const until    = new Date(Date.now() + duration * unit * 60 * 1000);
    try {
        await db.collection('restrictions').doc(adminSelectedUser.uid).set({
            uid: adminSelectedUser.uid, until: firebase.firestore.Timestamp.fromDate(until), by: currentUser.uid
        });
        setAdminStatus('restrict-status', `Restricted until ${until.toLocaleString()}`, true);
    } catch (err) {
        setAdminStatus('restrict-status', 'Failed to restrict user.');
    }
}

async function unrestrictUser() {
    if (!adminSelectedUser) return;
    try {
        await db.collection('restrictions').doc(adminSelectedUser.uid).delete();
        setAdminStatus('restrict-status', `${adminSelectedUser.username} has been unrestricted.`, true);
    } catch (err) {
        setAdminStatus('restrict-status', 'Failed to unrestrict user.');
    }
}

async function banUser() {
    if (!adminSelectedUser) return;
    if (!confirm(`Ban ${adminSelectedUser.username}? They will not be able to log in.`)) return;
    try {
        await db.collection('users').doc(adminSelectedUser.uid).update({ banned: true });
        setAdminStatus('ban-status', `${adminSelectedUser.username} has been banned.`, true);
    } catch (err) {
        setAdminStatus('ban-status', 'Failed to ban user.');
    }
}

async function unbanUser() {
    if (!adminSelectedUser) return;
    try {
        await db.collection('users').doc(adminSelectedUser.uid).update({ banned: false });
        setAdminStatus('ban-status', `${adminSelectedUser.username} has been unbanned.`, true);
    } catch (err) {
        setAdminStatus('ban-status', 'Failed to unban user.');
    }
}

async function deleteAllUserMessages() {
    if (!adminSelectedUser) return;
    if (!confirm(`Delete ALL messages from ${adminSelectedUser.username}? This cannot be undone.`)) return;
    setAdminStatus('delete-msgs-status', 'Deleting...', true);
    try {
        const snap  = await db.collection('messages').where('senderId', '==', adminSelectedUser.uid).get();
        const batch = db.batch();
        let count   = 0;
        snap.forEach(doc => { batch.delete(doc.ref); count++; });
        await batch.commit();
        setAdminStatus('delete-msgs-status', `Deleted ${count} message(s).`, true);
    } catch (err) {
        setAdminStatus('delete-msgs-status', 'Failed to delete messages.');
    }
}
