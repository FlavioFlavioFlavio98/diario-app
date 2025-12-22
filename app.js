import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, collection, query, where, getDocs, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// --- VERSIONE APP ---
const APP_VERSION = "V15.0 Final";
const verEl = document.getElementById('app-version-display');
if(verEl) verEl.innerText = APP_VERSION;
const loginVerEl = document.getElementById('login-version');
if(loginVerEl) loginVerEl.innerText = APP_VERSION;

const firebaseConfig = {
    apiKey: "AIzaSyCYndAl9MKtZDTK5ivbtmaqDa-r6vEe6SM",
    authDomain: "diario-app-fc5fe.firebaseapp.com",
    projectId: "diario-app-fc5fe",
    storageBucket: "diario-app-fc5fe.firebasestorage.app",
    messagingSenderId: "314736217548",
    appId: "1:314736217548:web:010cc701630286c3f16169"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// DEFAULT PROMPTS (Lista Completa)
const defaultPromptsText = [
    "Qual è stata la cosa migliore che ti è successa oggi?",
    "Scrivi 3 cose, anche piccole, per cui sei grato in questo momento.",
    "C'è stato un momento oggi in cui ti sei sentito veramente in pace?",
    "Cosa ti ha fatto sorridere oggi?",
    "Qual è la lezione più importante che hai imparato oggi?",
    "Chi ha reso la tua giornata migliore e perché?",
    "Come ti sei preso cura di te stesso oggi?",
    "Qual è l'obiettivo principale che vuoi raggiungere domani?",
    "C'è qualcosa che stai rimandando? Perché?",
    "Se potessi rifare la giornata di oggi, cosa cambieresti?",
    "Quale piccola azione puoi fare ora per migliorare la tua settimana?",
    "Cosa ti ha fatto perdere tempo oggi?",
    "Hai fatto un passo avanti verso i tuoi sogni oggi? Quale?",
    "Come valuti la tua energia oggi da 1 a 10 e perché?",
    "Quale emozione ha prevalso oggi?",
    "C'è qualcosa che ti preoccupa? Scrivilo per toglierlo dalla testa.",
    "C'è una conversazione che avresti voluto affrontare diversamente?",
    "Cosa ti sta togliendo energia in questo periodo?",
    "Cosa faresti se non avessi paura di fallire?",
    "C'è un pensiero ricorrente che ti sta disturbando?",
    "Scrivi una lettera al te stesso di 5 anni fa.",
    "C'è qualcosa che devi 'lasciar andare' prima di dormire?",
    "Se la tua giornata fosse un film, che titolo avrebbe?",
    "Descrivi la giornata di oggi usando solo 3 parole.",
    "Se potessi essere ovunque nel mondo ora, dove saresti?",
    "Qual è l'idea più strana che ti è venuta in mente oggi?",
    "Scrivi la prima frase del libro della tua vita.",
    "Come ti immagini tra un anno esatto?",
    "Qual è la cosa che aspetti con più ansia nel prossimo futuro?",
    "Scrivi un messaggio di incoraggiamento per il te stesso di domani mattina."
];

function createPromptObj(text) {
    return { id: Date.now() + Math.random(), text: text, usage: 0 };
}

// VARIABILI GLOBALI
let currentUser = null;
let currentDateString = new Date().toISOString().slice(0, 7); 
let currentDayStats = {};
let currentTags = [];
let globalWordCount = 0; 
let currentPrompts = [];
let collectedTasks = [];
let isLocalChange = false; // FLAG CRITICO

// CHAT VARIABLES
let chatHistory = [];

// TRIP MODE VARIABLES
let tripInterval = null;
let tripStartTime = null;
let tripStartWordCount = 0;
let isTripRunning = false;
let tripSeconds = 0;

if ('serviceWorker' in navigator) { navigator.serviceWorker.register('sw.js'); }

window.login = () => signInWithPopup(auth, provider);

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app').style.display = 'flex';
        document.getElementById('user-pic').src = user.photoURL;
        document.getElementById('date-picker').value = currentDateString;
        
        loadSettings(); // Font e Grandezza
        
        const savedKey = localStorage.getItem('GEMINI_API_KEY');
        if(savedKey) { document.getElementById('gemini-api-key').value = savedKey; }

        loadGlobalStats(); 
        await loadDiaryForDate(currentDateString);
        loadCoachPrompts();
    }
});

// --- SETTINGS (FONT & SIZE) ---
function loadSettings() {
    const font = localStorage.getItem('editorFont') || 'system-ui';
    const size = localStorage.getItem('editorSize') || '1.1rem';
    
    document.documentElement.style.setProperty('--editor-font', font);
    document.documentElement.style.setProperty('--editor-size', size);
    
    const fontSel = document.getElementById('font-family-select');
    const sizeSel = document.getElementById('font-size-select');
    if(fontSel) fontSel.value = font;
    if(sizeSel) sizeSel.value = size;
}

window.changeEditorFont = (val) => {
    document.documentElement.style.setProperty('--editor-font', val);
    localStorage.setItem('editorFont', val);
};

window.changeEditorSize = (val) => {
    document.documentElement.style.setProperty('--editor-size', val);
    localStorage.setItem('editorSize', val);
};

window.forceAppRefresh = async () => {
    if (confirm("Sei sicuro? Questo cancellerà la cache locale e ricaricherà l'ultima versione dell'app.")) {
        if (navigator.serviceWorker) {
            const regs = await navigator.serviceWorker.getRegistrations();
            for (let reg of regs) await reg.unregister();
        }
        const keys = await caches.keys();
        for (const key of keys) await caches.delete(key);
        window.location.reload(true);
    }
};

// --- FIX CURSORE & CHECKBOX LISTENER ---
// Questo evita che il salvataggio ricarichi l'HTML e sposti il cursore
document.getElementById('editor').addEventListener('click', (e) => {
    if (e.target.classList.contains('smart-task')) {
        // Toggle manuale attributo DOM
        if (e.target.hasAttribute('checked')) {
            e.target.removeAttribute('checked');
            e.target.checked = false; 
        } else {
            e.target.setAttribute('checked', 'true');
            e.target.checked = true; 
        }
        
        isLocalChange = true;
        saveData();
        setTimeout(() => isLocalChange = false, 2000);
    }
});

document.getElementById('editor').addEventListener('input', (e) => {
    isLocalChange = true; 
    const sel = window.getSelection();
    if (sel.rangeCount > 0) {
        const node = sel.anchorNode;
        if (node.nodeType === 3) {
            const text = node.textContent;
            const caretPos = sel.anchorOffset;
            const textBeforeCaret = text.substring(0, caretPos);
            
            // @now logic
            if (textBeforeCaret.endsWith('@now')) {
                const range = document.createRange();
                range.setStart(node, caretPos - 4);
                range.setEnd(node, caretPos);
                sel.removeAllRanges();
                sel.addRange(range);
                const now = new Date();
                const htmlToInsert = `<span style="color: #ff5252; font-weight: bold;">📅 ${now.toLocaleDateString('it-IT')} - ${now.toLocaleTimeString('it-IT', {hour: '2-digit', minute:'2-digit'})}</span>&nbsp;`;
                document.execCommand('insertHTML', false, htmlToInsert);
            }

            // @task logic
            if (textBeforeCaret.endsWith('@task')) {
                const range = document.createRange();
                range.setStart(node, caretPos - 5);
                range.setEnd(node, caretPos);
                sel.removeAllRanges();
                sel.addRange(range);
                // ID UNIVOCO PER SYNC
                const taskId = 'task_' + Date.now();
                const htmlToInsert = `<input type="checkbox" id="${taskId}" class="smart-task">&nbsp;`;
                document.execCommand('insertHTML', false, htmlToInsert);
            }
        }
    }
    
    // Aggiorna Trip Word Count se attivo
    if(isTripRunning) updateTripUI();
    
    updateCounts(); 
    clearTimeout(timeout); 
    timeout = setTimeout(() => {
        saveData();
        isLocalChange = false; 
    }, 1500);
});

// --- TRIP MODE LOGIC (Manuale) ---
window.tripStart = () => {
    if (isTripRunning) return;
    isTripRunning = true;
    tripStartTime = Date.now() - (tripSeconds * 1000); // Riprendi da dove eri
    tripStartWordCount = parseInt(document.getElementById('count-today').innerText); // Base attuale
    if (tripInterval) clearInterval(tripInterval);
    tripInterval = setInterval(updateTripUI, 1000);
};

window.tripPause = () => {
    isTripRunning = false;
    clearInterval(tripInterval);
};

window.tripReset = () => {
    isTripRunning = false;
    clearInterval(tripInterval);
    tripSeconds = 0;
    tripStartTime = null;
    document.getElementById('trip-timer').innerText = "00:00";
    document.getElementById('trip-words').innerText = "0w";
};

function updateTripUI() {
    if (!isTripRunning) return;
    
    // Tempo
    const now = Date.now();
    tripSeconds = Math.floor((now - tripStartTime) / 1000);
    const m = Math.floor(tripSeconds / 60).toString().padStart(2, '0');
    const s = (tripSeconds % 60).toString().padStart(2, '0');
    document.getElementById('trip-timer').innerText = `${m}:${s}`;
    
    // Parole
    const currentWords = parseInt(document.getElementById('count-today').innerText);
    const sessionWords = currentWords - tripStartWordCount;
    document.getElementById('trip-words').innerText = `${sessionWords > 0 ? sessionWords : 0}w`;
}

// --- TASK HARVESTER & SYNC ---
function harvestTasks() {
    const editor = document.getElementById('editor');
    const checkboxes = editor.querySelectorAll('.smart-task');
    const tasks = [];
    
    checkboxes.forEach((cb) => {
        let taskText = "Task";
        let nextNode = cb.nextSibling;
        if (nextNode && nextNode.textContent) {
            taskText = nextNode.textContent.trim().split('\n')[0].substring(0, 50); 
        }
        tasks.push({
            id: cb.id,
            text: taskText,
            done: cb.checked
        });
    });
    return tasks;
}

window.toggleTaskFromModal = (taskId, isChecked) => {
    const editor = document.getElementById('editor');
    const checkbox = editor.querySelector(`#${taskId}`);
    
    if (checkbox) {
        if (isChecked) {
            checkbox.setAttribute('checked', 'true');
            checkbox.checked = true;
        } else {
            checkbox.removeAttribute('checked');
            checkbox.checked = false;
        }
        saveData();
        // Aggiorna la lista dopo poco
        setTimeout(window.openTodoList, 100); 
    }
};

window.openTodoList = () => {
    const modal = document.getElementById('todo-modal');
    const container = document.getElementById('todo-list-container');
    container.innerHTML = '';
    
    // FIX LISTA VUOTA: Harvest Immediato dal DOM, non dal DB
    collectedTasks = harvestTasks(); 
    
    if (collectedTasks.length === 0) {
        container.innerHTML = "<div style='text-align:center; padding:20px; color:#666;'>Nessun task trovato. Usa @task nel testo.</div>";
    } else {
        collectedTasks.forEach(task => {
            const row = document.createElement('div');
            row.style.cssText = "padding:10px; border-bottom:1px solid #333; display:flex; align-items:center; gap:10px;";
            
            const cb = document.createElement('input');
            cb.type = "checkbox";
            cb.checked = task.done;
            cb.onchange = (e) => toggleTaskFromModal(task.id, e.target.checked);
            
            const txt = document.createElement('span');
            txt.innerText = task.text || '...';
            if(task.done) txt.style.cssText = "text-decoration:line-through; color:#666;";
            
            row.appendChild(cb);
            row.appendChild(txt);
            container.appendChild(row);
        });
    }
    
    modal.classList.add('open');
};

// --- CHAT DI ANALISI PROFONDA ---
window.openAnalysisChat = () => {
    const editorText = document.getElementById('editor').innerText;
    if(editorText.length < 50) { alert("Scrivi di più prima di analizzare!"); return; }
    
    document.getElementById('chat-modal').classList.add('open');
    const container = document.getElementById('chat-history-container');
    container.innerHTML = '';
    
    // Reset e Init Storia
    chatHistory = [
        {
            role: "user",
            parts: [{ text: `Agisci come un coach empatico e psicologico. Analizza: "${editorText}". Fai domande brevi e profonde per aiutarmi a riflettere. Sii umano.` }]
        }
    ];

    sendChatRequest(); // Start automatico
};

window.closeAnalysisChat = () => { document.getElementById('chat-modal').classList.remove('open'); };

window.sendChatMessage = () => {
    const input = document.getElementById('chat-user-input');
    const text = input.value.trim();
    if(!text) return;
    
    renderChatMessage(text, 'user');
    input.value = '';

    chatHistory.push({ role: "user", parts: [{ text: text }] });
    sendChatRequest();
};

async function sendChatRequest() {
    const loading = document.getElementById('chat-loading');
    const apiKey = localStorage.getItem('GEMINI_API_KEY');
    if (!apiKey) { alert("Manca API Key"); return; }
    
    loading.style.display = 'block';

    try {
        // USO GEMINI 3.0 FLASH PREVIEW COME RICHIESTO
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: chatHistory })
        });
        
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || "Errore API");

        const aiResponseText = data.candidates[0].content.parts[0].text;
        
        chatHistory.push({ role: "model", parts: [{ text: aiResponseText }] });
        renderChatMessage(aiResponseText, 'model');

    } catch (e) {
        renderChatMessage("Errore: " + e.message, 'model');
    } finally {
        loading.style.display = 'none';
    }
}

function renderChatMessage(text, role) {
    const container = document.getElementById('chat-history-container');
    const div = document.createElement('div');
    div.className = `chat-message ${role === 'user' ? 'chat-user' : 'chat-ai'}`;
    div.innerHTML = marked.parse(text); 
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

window.saveChatToNote = () => {
    let htmlToAppend = "<br><hr><h3>🧠 Sessione di Analisi</h3>";
    for (let i = 1; i < chatHistory.length; i++) {
        const msg = chatHistory[i];
        const text = msg.parts[0].text;
        if(msg.role === 'model') {
            htmlToAppend += `<p style="color:#ff9100; margin-bottom:5px;"><b>Coach:</b> ${text}</p>`;
        } else {
            htmlToAppend += `<p style="margin-bottom:5px;"><b>Io:</b> ${text}</p>`;
        }
    }
    htmlToAppend += "<hr><br>";
    
    window.closeAnalysisChat();
    window.scrollToBottom();
    document.execCommand('insertHTML', false, htmlToAppend);
    saveData();
};

// --- COACH MANAGER ---
async function loadCoachPrompts() {
    if (!currentUser) return;
    try {
        const docRef = doc(db, "diario", currentUser.uid, "settings", "coach");
        const snap = await getDoc(docRef);
        if (snap.exists() && snap.data().prompts) {
            let loaded = snap.data().prompts;
            currentPrompts = (typeof loaded[0] === 'string') ? loaded.map(txt => createPromptObj(txt)) : loaded;
        } else {
            currentPrompts = defaultPromptsText.map(txt => createPromptObj(txt));
        }
    } catch (e) { currentPrompts = defaultPromptsText.map(txt => createPromptObj(txt)); }
}
async function savePromptsToDb() { if (!currentUser) return; try { await setDoc(doc(db, "diario", currentUser.uid, "settings", "coach"), { prompts: currentPrompts }, { merge: true }); renderCoachList(); } catch (e) { console.error(e); } }
window.openCoachManager = () => { document.getElementById('coach-manager-modal').classList.add('open'); renderCoachList(); };
function renderCoachList() { const c = document.getElementById('coach-list-container'); c.innerHTML = ''; [...currentPrompts].sort((a,b)=>(b.usage||0)-(a.usage||0)).forEach((p)=>{ const i=currentPrompts.findIndex(x=>x.id===p.id); const d=document.createElement('div'); d.className='coach-item'; d.innerHTML=`<div class="coach-text">${p.text}</div><div class="coach-meta">Use:${p.usage||0}</div><div class="coach-btn-group"><button class="coach-action-btn" onclick="editCoachPrompt(${i})">✏️</button><button class="coach-action-btn coach-delete" onclick="deleteCoachPrompt(${i})">🗑️</button></div>`; c.appendChild(d); }); }
window.addCoachPrompt = () => { const i=document.getElementById('new-prompt-input'); const t=i.value.trim(); if(!t)return; currentPrompts.unshift(createPromptObj(t)); i.value=''; savePromptsToDb(); };
window.deleteCoachPrompt = (i) => { if(confirm("Eliminare?")) { currentPrompts.splice(i,1); savePromptsToDb(); } };
window.editCoachPrompt = (i) => { const t=prompt("Modifica:", currentPrompts[i].text); if(t) { currentPrompts[i].text=t.trim(); savePromptsToDb(); } };
window.triggerBrainstorm = () => { if(currentPrompts.length===0) return; const p=currentPrompts[Math.floor(Math.random()*currentPrompts.length)]; document.getElementById('ai-title').innerText="Coach"; document.getElementById('ai-message').innerText=p.text; document.getElementById('ai-actions').innerHTML=`<button class="ai-btn-small" onclick="insertPrompt('${p.id}')">Inserisci</button>`; document.getElementById('ai-coach-area').style.display='block'; };
window.scrollToBottom = () => { const e=document.getElementById('editor'); e.focus(); const r=document.createRange(); r.selectNodeContents(e); r.collapse(false); window.getSelection().removeAllRanges(); window.getSelection().addRange(r); e.scrollTop=e.scrollHeight; };
window.insertPrompt = (id) => { const i=currentPrompts.findIndex(p=>p.id==id); let t="Domanda..."; if(i>-1){ currentPrompts[i].usage=(currentPrompts[i].usage||0)+1; t=currentPrompts[i].text; savePromptsToDb(); } window.scrollToBottom(); document.execCommand('insertHTML',false,`<br><p style="color:#ff9100;font-weight:bold;margin-bottom:5px;">Domanda: ${t}</p><p>Risposta: </p>`); document.getElementById('ai-coach-area').style.display='none'; setTimeout(()=>{document.getElementById('editor').scrollTop=document.getElementById('editor').scrollHeight;},100); saveData(); };

// --- CORE ---
window.changeDate = (d) => { currentDateString = d; loadDiaryForDate(d); };

async function loadDiaryForDate(dateStr) {
    document.getElementById('db-status').innerText = "Loading...";
    const docRef = doc(db, "diario", currentUser.uid, "entries", dateStr);
    onSnapshot(docRef, (snap) => {
        if (isLocalChange || (document.activeElement.id === 'editor' && document.hasFocus())) {
            // Se stiamo scrivendo, non ricarichiamo l'HTML, ma aggiorniamo la lista task in background
            if (snap.exists()) { collectedTasks = snap.data().tasks || []; }
            return; 
        }
        if (snap.exists()) {
            const data = snap.data();
            document.getElementById('editor').innerHTML = data.htmlContent || ""; 
            setTimeout(window.scrollToBottom, 200);
            currentDayStats = data.stats || {};
            collectedTasks = data.tasks || [];
            updateMetrics(data.htmlContent || "", updateCounts());
            document.getElementById('db-status').innerText = "Sync OK";
            document.getElementById('db-status').style.color = "#00e676";
        } else {
            document.getElementById('editor').innerHTML = ""; collectedTasks = []; updateMetrics("", 0); document.getElementById('db-status').innerText = "Nuovo Mese";
        }
    });
}

async function saveData() {
    if (!currentUser) return;
    const statusLabel = document.getElementById('db-status');
    statusLabel.innerText = "Saving..."; statusLabel.style.color = "orange";
    try {
        const content = document.getElementById('editor').innerHTML;
        const wordsToday = updateCounts();
        collectedTasks = harvestTasks(); 
        const dataToSave = { htmlContent: content, stats: { words: wordsToday, mood: currentDayStats.mood || "" }, tasks: collectedTasks, lastUpdate: new Date() };
        await setDoc(doc(db, "diario", currentUser.uid, "entries", currentDateString), dataToSave, { merge: true });
        const delta = wordsToday - (currentDayStats.words || 0);
        if (delta !== 0 || globalWordCount === 0) {
            let newGlobal = globalWordCount + delta; if(newGlobal < 0) newGlobal = 0;
            await setDoc(doc(db, "diario", currentUser.uid, "stats", "global"), { totalWords: newGlobal, lastUpdate: new Date() }, { merge: true });
        }
        statusLabel.innerText = "Saved"; statusLabel.style.color = "#00e676";
        updateMetrics(content, wordsToday);
    } catch (error) { console.error(error); statusLabel.innerText = "ERROR"; statusLabel.style.color = "red"; }
}

function loadGlobalStats() { onSnapshot(doc(db, "diario", currentUser.uid, "stats", "global"), (s) => { globalWordCount = s.exists() ? s.data().totalWords : 0; document.getElementById('count-global').innerText = globalWordCount; }); }
function updateCounts() { const t = document.getElementById('editor').innerText; const w = t.trim() ? t.trim().split(/\s+/).length : 0; updateMetrics(document.getElementById('editor').innerHTML, w); return w; }
function updateMetrics(content, wordsToday) { document.getElementById('count-today').innerText = wordsToday; const size = new Blob([content]).size; document.getElementById('file-weight').innerText = `${(size / 1024).toFixed(1)} KB`; }
window.saveApiKey = () => { const k = document.getElementById('gemini-api-key').value.trim(); if(k) { localStorage.setItem('GEMINI_API_KEY', k); alert("Saved!"); document.getElementById('settings-modal').classList.remove('open'); } };

// AI SUMMARY STATICO (Legacy)
window.generateAiSummary = async () => {
    const apiKey = localStorage.getItem('GEMINI_API_KEY'); if (!apiKey) { alert("Manca API Key"); return; }
    const text = document.getElementById('editor').innerText.trim(); if (text.length < 30) { alert("Scrivi di più!"); return; }
    document.getElementById('summary-modal').classList.add('open');
    const contentDiv = document.getElementById('ai-summary-content'); contentDiv.innerHTML = '<div class="ai-loading">Gemini 3.0 Flash Preview... 🧠</div>';
    const prompt = `Analizza: "${text}"\n1. Riassunto.\n2. Insight.\n3. Consiglio. Markdown.`;
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || "Err");
        contentDiv.innerHTML = marked.parse(data.candidates[0].content.parts[0].text);
    } catch (error) { contentDiv.innerHTML = `Err: ${error.message}`; }
};

// UTILS & LEGACY (Tag, WalkTalk, Charts)
const tagRules = { 'Relazioni': ['simona', 'nala', 'mamma', 'papà', 'amici'], 'Salute': ['cibo', 'dieta', 'allenamento', 'sonno'], 'Lavoro': ['progetto', 'app', 'business', 'soldi'], 'Mindset': ['gratitudine', 'ansia', 'felice', 'triste'] };
function detectTagsInContent(text) { const lower = text.toLowerCase(); const found = new Set(); for (const [tag, keywords] of Object.entries(tagRules)) { if (keywords.some(k => lower.includes(k))) found.add(tag); } return Array.from(found); }
window.openTagExplorer = () => { document.getElementById('tag-modal').classList.add('open'); const c = document.getElementById('tag-cloud'); c.innerHTML = ''; Object.keys(tagRules).forEach(tag => { const b = document.createElement('span'); b.className = 'tag-chip'; b.innerText = tag; b.onclick = () => searchByTag(tag); c.appendChild(b); }); };
async function searchByTag(tag) { const r = document.getElementById('tag-results'); r.innerHTML = "Cerco..."; const q = query(collection(db, "diario", currentUser.uid, "entries"), where("tags", "array-contains", tag)); const s = await getDocs(q); r.innerHTML = ''; if (s.empty) { r.innerHTML = "Nessun risultato."; return; } s.forEach((doc) => { const d = document.createElement('div'); d.className = 'result-row'; d.innerHTML = `<span>🗓️ ${doc.id}</span> <span>${doc.data().stats?.words || 0} parole</span>`; d.onclick = () => { document.getElementById('tag-modal').classList.remove('open'); document.getElementById('date-picker').value = doc.id; changeDate(doc.id); }; r.appendChild(d); }); }
window.handleKeyUp = (e) => { if (e.key === 'Enter') processLastBlock(); };
function processLastBlock() { const s = window.getSelection(); if (!s.rangeCount) return; let b = s.getRangeAt(0).startContainer; while (b && b.id !== 'editor' && b.tagName !== 'DIV' && b.tagName !== 'P') { b = b.parentNode; } if (b && b.previousElementSibling) { const p = b.previousElementSibling; if (!p.querySelector('.auto-tag') && p.innerText.trim().length > 10) { const tag = analyzeTextForTag(p.innerText); if (tag) { const ts = document.createElement('span'); ts.className = 'auto-tag'; ts.innerText = tag; ts.contentEditable = "false"; p.prepend(ts); saveData(); } } } }
function analyzeTextForTag(text) { const lower = text.toLowerCase(); for (const [tag, keywords] of Object.entries(tagRules)) { if (keywords.some(k => lower.includes(k))) return tag; } return null; }
let walkRecognition = null; let isWalkSessionActive = false;
window.openWalkTalk = () => document.getElementById('walk-talk-modal').classList.add('open');
window.closeWalkTalk = () => { stopWalkSession(); document.getElementById('walk-talk-modal').classList.remove('open'); };
window.toggleWalkSession = () => { if(isWalkSessionActive) stopWalkSession(); else startWalkSession(); };
function startWalkSession() { if (!('webkitSpeechRecognition' in window)) { alert("No speech support"); return; } isWalkSessionActive = true; document.getElementById('walk-mic-btn').classList.add('active'); document.getElementById('walk-status').innerText = "Ascolto..."; walkRecognition = new webkitSpeechRecognition(); walkRecognition.continuous = false; walkRecognition.lang = 'it-IT'; walkRecognition.onresult = (e) => { const t = e.results[0][0].transcript; document.getElementById('walk-transcript').innerText = t; const time = new Date().toLocaleTimeString('it-IT', {hour:'2-digit', minute:'2-digit'}); document.getElementById('editor').innerHTML += `<div style="margin-top:10px;"><b>🗣️ Walk (${time}):</b> ${t}</div>`; saveData(); setTimeout(() => { if(isWalkSessionActive) walkRecognition.start(); }, 1500); }; walkRecognition.start(); }
function stopWalkSession() { isWalkSessionActive = false; document.getElementById('walk-mic-btn').classList.remove('active'); document.getElementById('walk-status').innerText = "Stop"; if(walkRecognition) walkRecognition.stop(); }
let timeout;
let recognition = null; if ('webkitSpeechRecognition' in window) { recognition = new webkitSpeechRecognition(); recognition.continuous = true; recognition.interimResults = true; recognition.lang = 'it-IT'; recognition.onstart = () => {}; recognition.onend = () => {}; recognition.onresult = (e) => { let f = ''; for (let i = e.resultIndex; i < e.results.length; ++i) { if (e.results[i].isFinal) f += e.results[i][0].transcript; } if (f) { document.execCommand('insertText', false, f + " "); saveData(); } }; }
window.document.getElementById('editor').addEventListener('paste', (e) => { e.preventDefault(); const t = (e.originalEvent || e).clipboardData.getData('text/plain'); document.execCommand('insertText', false, t); });
window.format = (c) => { document.execCommand(c, false, null); document.getElementById('editor').focus(); };
window.triggerImageUpload = () => document.getElementById('img-input').click();
window.handleImageUpload = (i) => { const f = i.files[0]; if (!f) return; const r = new FileReader(); r.onload = (e) => { const im = new Image(); im.src = e.target.result; im.onload = () => { const c = document.createElement('canvas'); const x = c.getContext('2d'); const s = 600 / im.width; c.width = 600; c.height = im.height * s; x.drawImage(im, 0, 0, c.width, c.height); document.execCommand('insertHTML', false, `<img src="${c.toDataURL('image/jpeg', 0.7)}"><br>`); saveData(); }; }; r.readAsDataURL(f); };
window.openStats = () => { document.getElementById('stats-modal').classList.add('open'); renderChart(); };
window.openSettings = () => document.getElementById('settings-modal').classList.add('open');
window.toggleTheme = () => { document.body.classList.toggle('light-mode'); localStorage.setItem('theme', document.body.classList.contains('light-mode')?'light':'dark'); };
window.exportData = () => { const b = new Blob([document.getElementById('editor').innerHTML],{type:'text/html'}); const a = document.createElement('a'); a.href=URL.createObjectURL(b); a.download=`backup_${currentDateString}.html`; a.click(); };
function renderChart() { const x = document.getElementById('chartCanvas').getContext('2d'); if(window.myChart) window.myChart.destroy(); window.myChart = new Chart(x, { type:'bar', data:{labels:['Mese Corrente'], datasets:[{label:'Parole', data:[currentDayStats.words || 0], backgroundColor:'#7c4dff'}]}, options:{plugins:{legend:{display:false}}, scales:{x:{display:false}, y:{grid:{color:'#333'}}}} }); }