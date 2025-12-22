import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, collection, query, where, getDocs, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// --- NESSUNA LIBRERIA AI ESTERNA ---

// --- VERSIONE APP ---
const APP_VERSION = "V14.7";
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

// DEFAULT PROMPTS
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
let collectedTasks = []; // Array per i task raccolti

// TIMER VARIABLES
let timerInterval = null;
let timerSeconds = 0;
let isTimerRunning = false;
let lastTypingTime = Date.now(); // Per l'auto-pausa

if ('serviceWorker' in navigator) { navigator.serviceWorker.register('sw.js'); }

window.login = () => signInWithPopup(auth, provider);

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app').style.display = 'flex';
        document.getElementById('user-pic').src = user.photoURL;
        document.getElementById('date-picker').value = currentDateString;
        
        const savedKey = localStorage.getItem('GEMINI_API_KEY');
        if(savedKey) {
            document.getElementById('gemini-api-key').value = savedKey;
        }

        loadGlobalStats(); 
        await loadDiaryForDate(currentDateString);
        loadCoachPrompts();
        
        // Avvio automatico timer
        timerPlay();
    }
});

// --- NUOVA FUNZIONE: FORCE APP REFRESH ---
window.forceAppRefresh = async () => {
    if (confirm("Questo ricaricherà completamente l'app e cancellerà la cache locale per forzare l'aggiornamento. Procedere?")) {
        // 1. Unregister Service Worker
        if (navigator.serviceWorker) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (let registration of registrations) {
                await registration.unregister();
            }
        }
        // 2. Clear Caches
        const keys = await caches.keys();
        for (const key of keys) {
            await caches.delete(key);
        }
        // 3. Hard Reload
        window.location.reload(true);
    }
};


// --- INPUT LISTENER: @now e @task ---
document.getElementById('editor').addEventListener('input', (e) => {
    // Aggiorno l'orario di digitazione per il timer intelligente
    lastTypingTime = Date.now();
    // Se scrivo e il timer è in pausa, lo riavvio
    if (!isTimerRunning) timerPlay();

    const sel = window.getSelection();
    if (sel.rangeCount > 0) {
        const node = sel.anchorNode;
        if (node.nodeType === 3) {
            const text = node.textContent;
            const caretPos = sel.anchorOffset;
            const textBeforeCaret = text.substring(0, caretPos);
            
            // LOGICA @now
            if (textBeforeCaret.endsWith('@now')) {
                const range = document.createRange();
                range.setStart(node, caretPos - 4);
                range.setEnd(node, caretPos);
                sel.removeAllRanges();
                sel.addRange(range);
                
                const now = new Date();
                const dateStr = now.toLocaleDateString('it-IT');
                const timeStr = now.toLocaleTimeString('it-IT', {hour: '2-digit', minute:'2-digit'});
                const htmlToInsert = `<span style="color: #ff5252; font-weight: bold;">📅 ${dateStr} - ${timeStr}</span>&nbsp;`;
                
                document.execCommand('insertHTML', false, htmlToInsert);
            }

            // LOGICA @task (Nuova)
            if (textBeforeCaret.endsWith('@task')) {
                const range = document.createRange();
                range.setStart(node, caretPos - 5); // @task = 5 chars
                range.setEnd(node, caretPos);
                sel.removeAllRanges();
                sel.addRange(range);
                
                // Inserisco checkbox. La classe 'smart-task' serve per il riconoscimento
                const htmlToInsert = `<input type="checkbox" class="smart-task">&nbsp;`;
                document.execCommand('insertHTML', false, htmlToInsert);
            }
        }
    }
    updateCounts(); 
    clearTimeout(timeout); 
    timeout = setTimeout(saveData, 1500);
});

// --- SMART TIMER LOGIC ---
window.timerPlay = () => {
    if (isTimerRunning) return;
    isTimerRunning = true;
    lastTypingTime = Date.now(); // Reset idle time
    
    if (timerInterval) clearInterval(timerInterval); // Sicurezza
    
    timerInterval = setInterval(() => {
        timerSeconds++;
        updateTimerDisplay();
        
        // CONTROLLO IDLE (2 MINUTI)
        const idleTime = Date.now() - lastTypingTime;
        if (idleTime > 120000) { // 120.000 ms = 2 minuti
            timerPause();
            // Opzionale: notifico l'utente o cambio icona
            console.log("Timer in pausa per inattività");
        }
    }, 1000);
};

window.timerPause = () => {
    isTimerRunning = false;
    clearInterval(timerInterval);
};

window.timerStop = () => {
    isTimerRunning = false;
    clearInterval(timerInterval);
    timerSeconds = 0;
    updateTimerDisplay();
};

function updateTimerDisplay() {
    const m = Math.floor(timerSeconds / 60).toString().padStart(2, '0');
    const s = (timerSeconds % 60).toString().padStart(2, '0');
    document.getElementById('session-timer').innerText = `${m}:${s}`;
}

// --- TASK HARVESTER & MANAGER ---

// Funzione per estrarre i task dal testo HTML
function harvestTasks() {
    const editor = document.getElementById('editor');
    const checkboxes = editor.querySelectorAll('.smart-task');
    const tasks = [];
    
    checkboxes.forEach((cb, index) => {
        // Cerco il testo subito dopo la checkbox
        let taskText = "Task vuoto";
        // Il nodo successivo potrebbe essere un testo o uno span
        let nextNode = cb.nextSibling;
        if (nextNode && nextNode.textContent) {
            taskText = nextNode.textContent.trim();
            // Prendi solo la prima riga o un pezzo ragionevole
            taskText = taskText.split('\n')[0].substring(0, 50); 
        }
        
        tasks.push({
            id: `task_${index}`, // ID semplice basato sull'ordine
            text: taskText,
            done: cb.checked
        });
    });
    return tasks;
}

window.openTodoList = () => {
    const modal = document.getElementById('todo-modal');
    const container = document.getElementById('todo-list-container');
    container.innerHTML = '';
    
    if (collectedTasks.length === 0) {
        container.innerHTML = "<div style='text-align:center; padding:20px; color:#666;'>Nessun task trovato (@task) nel diario di questo mese.</div>";
    } else {
        collectedTasks.forEach(task => {
            const row = document.createElement('div');
            row.style.cssText = "padding:10px; border-bottom:1px solid #333; display:flex; align-items:center; gap:10px;";
            // Se checked, sbarrato
            const styleText = task.done ? "text-decoration:line-through; color:#666;" : "";
            row.innerHTML = `
                <span style="font-size:1.2rem;">${task.done ? '✅' : '⬜'}</span>
                <span style="${styleText}">${task.text || '...'}</span>
            `;
            container.appendChild(row);
        });
    }
    
    modal.classList.add('open');
};

// --- COACH MANAGER LOGIC ---
// (Rimasta invariata ma inclusa per completezza)
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

async function savePromptsToDb() {
    if (!currentUser) return;
    try {
        await setDoc(doc(db, "diario", currentUser.uid, "settings", "coach"), { prompts: currentPrompts }, { merge: true });
        renderCoachList(); 
    } catch (e) { console.error(e); }
}

window.openCoachManager = () => { document.getElementById('coach-manager-modal').classList.add('open'); renderCoachList(); };

function renderCoachList() {
    const listContainer = document.getElementById('coach-list-container');
    listContainer.innerHTML = '';
    const sortedPrompts = [...currentPrompts].sort((a, b) => (b.usage || 0) - (a.usage || 0));
    sortedPrompts.forEach((promptObj) => {
        const realIndex = currentPrompts.findIndex(p => p.id === promptObj.id);
        const div = document.createElement('div');
        div.className = 'coach-item';
        div.innerHTML = `
            <div class="coach-text">${promptObj.text}</div>
            <div class="coach-meta">Usata: ${promptObj.usage || 0}</div>
            <div class="coach-btn-group">
                <button class="coach-action-btn" onclick="editCoachPrompt(${realIndex})">✏️</button>
                <button class="coach-action-btn coach-delete" onclick="deleteCoachPrompt(${realIndex})">🗑️</button>
            </div>`;
        listContainer.appendChild(div);
    });
}
window.addCoachPrompt = () => {
    const input = document.getElementById('new-prompt-input');
    const text = input.value.trim(); if (!text) return;
    currentPrompts.unshift(createPromptObj(text)); input.value = ''; savePromptsToDb();
};
window.deleteCoachPrompt = (index) => { if (confirm("Eliminare?")) { currentPrompts.splice(index, 1); savePromptsToDb(); } };
window.editCoachPrompt = (index) => { const t = prompt("Modifica:", currentPrompts[index].text); if (t) { currentPrompts[index].text = t.trim(); savePromptsToDb(); } };

window.triggerBrainstorm = () => { 
    if (currentPrompts.length === 0) return;
    const pObj = currentPrompts[Math.floor(Math.random() * currentPrompts.length)];
    document.getElementById('ai-title').innerText = "Coach";
    document.getElementById('ai-message').innerText = pObj.text;
    document.getElementById('ai-actions').innerHTML = `<button class="ai-btn-small" onclick="insertPrompt('${pObj.id}')">Inserisci</button>`;
    document.getElementById('ai-coach-area').style.display = 'block';
};

window.scrollToBottom = () => {
    const editor = document.getElementById('editor'); editor.focus();
    const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    editor.scrollTop = editor.scrollHeight;
};

window.insertPrompt = (promptId) => {
    const pIndex = currentPrompts.findIndex(p => p.id == promptId);
    let textToInsert = "Domanda...";
    if (pIndex > -1) {
        currentPrompts[pIndex].usage = (currentPrompts[pIndex].usage || 0) + 1;
        textToInsert = currentPrompts[pIndex].text;
        savePromptsToDb();
    }
    window.scrollToBottom();
    const html = `<br><p style="color: #ff9100; font-weight: bold; margin-bottom: 5px;">Domanda: ${textToInsert}</p><p>Risposta: </p>`;
    document.execCommand('insertHTML', false, html);
    document.getElementById('ai-coach-area').style.display = 'none';
    setTimeout(() => { document.getElementById('editor').scrollTop = document.getElementById('editor').scrollHeight; }, 100);
    saveData();
};

// --- CORE FUNCTIONS ---
window.changeDate = (newDate) => { currentDateString = newDate; loadDiaryForDate(newDate); };

async function loadDiaryForDate(dateStr) {
    document.getElementById('db-status').innerText = "Loading...";
    document.getElementById('editor').innerHTML = ""; 
    const docRef = doc(db, "diario", currentUser.uid, "entries", dateStr);
    
    onSnapshot(docRef, (snap) => {
        if (snap.exists()) {
            const data = snap.data();
            if (document.activeElement.id !== 'editor') { 
                document.getElementById('editor').innerHTML = data.htmlContent || ""; 
            }
            setTimeout(window.scrollToBottom, 200);
            currentDayStats = data.stats || {};
            currentTags = data.tags || [];
            collectedTasks = data.tasks || []; // Carica i task salvati
            
            updateMetrics(data.htmlContent || "", updateCounts());
            document.getElementById('db-status').innerText = "Sync OK";
            document.getElementById('db-status').style.color = "#00e676";
        } else {
            document.getElementById('editor').innerHTML = ""; 
            collectedTasks = [];
            updateMetrics("", 0);
            document.getElementById('db-status').innerText = "Nuovo Mese";
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
        const detectedTags = detectTagsInContent(document.getElementById('editor').innerText);
        
        // HARVEST TASKS
        collectedTasks = harvestTasks();

        const dataToSave = {
            htmlContent: content,
            stats: { words: wordsToday, mood: currentDayStats.mood || "" }, 
            tags: detectedTags,
            tasks: collectedTasks, // Salvo i task estratti
            lastUpdate: new Date()
        };

        await setDoc(doc(db, "diario", currentUser.uid, "entries", currentDateString), dataToSave, { merge: true });

        // Global stats (simplified logic)
        const delta = wordsToday - (currentDayStats.words || 0);
        if (delta !== 0 || globalWordCount === 0) {
            let newGlobal = globalWordCount + delta; if(newGlobal<0) newGlobal=0;
            await setDoc(doc(db, "diario", currentUser.uid, "stats", "global"), { totalWords: newGlobal, lastUpdate: new Date() }, { merge: true });
        }

        statusLabel.innerText = "Saved"; statusLabel.style.color = "#00e676";
        updateMetrics(content, wordsToday);
    } catch (error) { console.error(error); statusLabel.innerText = "ERROR"; statusLabel.style.color = "red"; }
}

function loadGlobalStats() {
    onSnapshot(doc(db, "diario", currentUser.uid, "stats", "global"), (snap) => {
        globalWordCount = snap.exists() ? snap.data().totalWords : 0;
        document.getElementById('count-global').innerText = globalWordCount;
    });
}

function updateCounts() {
    const text = document.getElementById('editor').innerText;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    updateMetrics(document.getElementById('editor').innerHTML, words);
    return words;
}

function updateMetrics(content, wordsToday) {
    document.getElementById('count-today').innerText = wordsToday;
    document.getElementById('stat-count-today').innerText = wordsToday;
    const size = new Blob([content]).size;
    const kb = (size / 1024).toFixed(1);
    const weightEl = document.getElementById('file-weight');
    weightEl.innerText = `${kb} KB`;
    if (size > 800000) { weightEl.classList.add('metric-danger'); weightEl.innerText += " ⚠️"; }
    else { weightEl.classList.remove('metric-danger'); }
}

window.saveApiKey = () => {
    const key = document.getElementById('gemini-api-key').value.trim();
    if(key) { localStorage.setItem('GEMINI_API_KEY', key); alert("Saved!"); document.getElementById('settings-modal').classList.remove('open'); }
};

window.generateAiSummary = async () => {
    const apiKey = localStorage.getItem('GEMINI_API_KEY');
    if (!apiKey) { alert("Manca API Key"); return; }
    const text = document.getElementById('editor').innerText.trim();
    if (text.length < 30) { alert("Scrivi di più!"); return; }

    document.getElementById('summary-modal').classList.add('open');
    const contentDiv = document.getElementById('ai-summary-content');
    contentDiv.innerHTML = '<div class="ai-loading">Gemini 3.0 Flash Preview... 🧠</div>';
    
    const prompt = `Analizza: "${text}"\n1. Riassunto.\n2. Insight.\n3. Consiglio. Markdown.`;

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || "Err");
        contentDiv.innerHTML = marked.parse(data.candidates[0].content.parts[0].text);
    } catch (error) { contentDiv.innerHTML = `Err: ${error.message}`; }
};

// ... Tag Logic ...
const tagRules = {
    'Relazioni': ['simona', 'nala', 'mamma', 'papà', 'amici', 'relazione'],
    'Salute': ['cibo', 'dieta', 'fumo', 'allenamento', 'sonno', 'salute'],
    'Lavoro': ['progetto', 'app', 'business', 'soldi', 'produttività'],
    'Mindset': ['gratitudine', 'ansia', 'felice', 'triste', 'paura']
};
function detectTagsInContent(text) {
    const lower = text.toLowerCase(); const found = new Set();
    for (const [tag, keywords] of Object.entries(tagRules)) { if (keywords.some(k => lower.includes(k))) found.add(tag); }
    return Array.from(found);
}
window.openTagExplorer = () => {
    document.getElementById('tag-modal').classList.add('open');
    const cloud = document.getElementById('tag-cloud'); cloud.innerHTML = '';
    Object.keys(tagRules).forEach(tag => {
        const btn = document.createElement('span'); btn.className = 'tag-chip'; btn.innerText = tag; btn.onclick = () => searchByTag(tag); cloud.appendChild(btn);
    });
};
async function searchByTag(tagName) {
    const resultsDiv = document.getElementById('tag-results'); resultsDiv.innerHTML = "Cerco...";
    const q = query(collection(db, "diario", currentUser.uid, "entries"), where("tags", "array-contains", tagName));
    const querySnapshot = await getDocs(q); resultsDiv.innerHTML = '';
    if (querySnapshot.empty) { resultsDiv.innerHTML = "Nessun risultato."; return; }
    querySnapshot.forEach((doc) => {
        const div = document.createElement('div'); div.className = 'result-row';
        div.innerHTML = `<span>🗓️ ${doc.id}</span> <span>${doc.data().stats?.words || 0} parole</span>`;
        div.onclick = () => { document.getElementById('tag-modal').classList.remove('open'); document.getElementById('date-picker').value = doc.id; changeDate(doc.id); };
        resultsDiv.appendChild(div);
    });
}

// ... Utilities ...
window.handleKeyUp = (e) => { if (e.key === 'Enter') processLastBlock(); };
function processLastBlock() { 
     const selection = window.getSelection(); if (!selection.rangeCount) return; let block = selection.getRangeAt(0).startContainer; while (block && block.id !== 'editor' && block.tagName !== 'DIV' && block.tagName !== 'P') { block = block.parentNode; } if (block && block.previousElementSibling) { const prevBlock = block.previousElementSibling; if (!prevBlock.querySelector('.auto-tag') && prevBlock.innerText.trim().length > 10) { const tag = analyzeTextForTag(prevBlock.innerText); if (tag) { const tagSpan = document.createElement('span'); tagSpan.className = 'auto-tag'; tagSpan.innerText = tag; tagSpan.contentEditable = "false"; prevBlock.prepend(tagSpan); saveData(); } } }
}
function analyzeTextForTag(text) { const lower = text.toLowerCase(); for (const [tag, keywords] of Object.entries(tagRules)) { if (keywords.some(k => lower.includes(k))) return tag; } return null; }

let walkRecognition = null; let isWalkSessionActive = false;
window.openWalkTalk = () => document.getElementById('walk-talk-modal').classList.add('open');
window.closeWalkTalk = () => { stopWalkSession(); document.getElementById('walk-talk-modal').classList.remove('open'); };
window.toggleWalkSession = () => { if(isWalkSessionActive) stopWalkSession(); else startWalkSession(); };
function startWalkSession() {
    if (!('webkitSpeechRecognition' in window)) { alert("No speech support"); return; }
    isWalkSessionActive = true; document.getElementById('walk-mic-btn').classList.add('active'); document.getElementById('walk-status').innerText = "Ascolto...";
    walkRecognition = new webkitSpeechRecognition(); walkRecognition.continuous = false; walkRecognition.lang = 'it-IT';
    walkRecognition.onresult = (e) => {
        const t = e.results[0][0].transcript; document.getElementById('walk-transcript').innerText = t;
        const time = new Date().toLocaleTimeString('it-IT', {hour:'2-digit', minute:'2-digit'});
        document.getElementById('editor').innerHTML += `<div style="margin-top:10px;"><b>🗣️ Walk (${time}):</b> ${t}</div>`;
        saveData(); setTimeout(() => { if(isWalkSessionActive) walkRecognition.start(); }, 1500);
    };
    walkRecognition.start();
}
function stopWalkSession() { isWalkSessionActive = false; document.getElementById('walk-mic-btn').classList.remove('active'); document.getElementById('walk-status').innerText = "Stop"; if(walkRecognition) walkRecognition.stop(); }

let timeout;
let recognition = null; if ('webkitSpeechRecognition' in window) { recognition = new webkitSpeechRecognition(); recognition.continuous = true; recognition.interimResults = true; recognition.lang = 'it-IT'; recognition.onstart = () => document.getElementById('mic-btn').classList.add('recording'); recognition.onend = () => document.getElementById('mic-btn').classList.remove('recording'); recognition.onresult = (e) => { let final = ''; for (let i = e.resultIndex; i < e.results.length; ++i) { if (e.results[i].isFinal) final += e.results[i][0].transcript; } if (final) { document.execCommand('insertText', false, final + " "); saveData(); } }; }
window.toggleDictation = () => { if(recognition) { document.getElementById('mic-btn').classList.contains('recording') ? recognition.stop() : recognition.start(); } else alert("No support"); };

window.document.getElementById('editor').addEventListener('paste', (e) => { e.preventDefault(); const text = (e.originalEvent || e).clipboardData.getData('text/plain'); document.execCommand('insertText', false, text); });
window.format = (cmd) => { document.execCommand(cmd, false, null); document.getElementById('editor').focus(); };
window.triggerImageUpload = () => document.getElementById('img-input').click();
window.handleImageUpload = (input) => { const file = input.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = (e) => { const img = new Image(); img.src = e.target.result; img.onload = () => { const c = document.createElement('canvas'); const ctx = c.getContext('2d'); const scale = 600 / img.width; c.width = 600; c.height = img.height * scale; ctx.drawImage(img, 0, 0, c.width, c.height); document.execCommand('insertHTML', false, `<img src="${c.toDataURL('image/jpeg', 0.7)}"><br>`); saveData(); }; }; reader.readAsDataURL(file); };

window.openStats = () => { document.getElementById('stats-modal').classList.add('open'); renderChart(); };
window.openSettings = () => document.getElementById('settings-modal').classList.add('open');
window.toggleTheme = () => { document.body.classList.toggle('light-mode'); localStorage.setItem('theme', document.body.classList.contains('light-mode')?'light':'dark'); };
window.exportData = () => { const b = new Blob([document.getElementById('editor').innerHTML],{type:'text/html'}); const a = document.createElement('a'); a.href=URL.createObjectURL(b); a.download=`backup_${currentDateString}.html`; a.click(); };

function renderChart() { const ctx = document.getElementById('chartCanvas').getContext('2d'); if(window.myChart) window.myChart.destroy(); window.myChart = new Chart(ctx, { type:'bar', data:{labels:['Mese Corrente'], datasets:[{label:'Parole', data:[currentDayStats.words || 0], backgroundColor:'#7c4dff'}]}, options:{plugins:{legend:{display:false}}, scales:{x:{display:false}, y:{grid:{color:'#333'}}}} }); }