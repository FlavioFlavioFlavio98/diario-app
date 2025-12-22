import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, collection, query, where, getDocs, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// --- VERSIONE APP ---
const APP_VERSION = "V14.8";
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

// DEFAULT PROMPTS (omessi per brevità, sono gli stessi)
const defaultPromptsText = ["Qual è stata la cosa migliore che ti è successa oggi?","Scrivi 3 cose, anche piccole, per cui sei grato in questo momento.","C'è stato un momento oggi in cui ti sei sentito veramente in pace?","Cosa ti ha fatto sorridere oggi?","Qual è la lezione più importante che hai imparato oggi?","Chi ha reso la tua giornata migliore e perché?","Come ti sei preso cura di te stesso oggi?","Qual è l'obiettivo principale che vuoi raggiungere domani?","C'è qualcosa che stai rimandando? Perché?","Se potessi rifare la giornata di oggi, cosa cambieresti?","Quale piccola azione puoi fare ora per migliorare la tua settimana?","Cosa ti ha fatto perdere tempo oggi?","Hai fatto un passo avanti verso i tuoi sogni oggi? Quale?","Come valuti la tua energia oggi da 1 a 10 e perché?","Quale emozione ha prevalso oggi?","C'è qualcosa che ti preoccupa? Scrivilo per toglierlo dalla testa.","C'è una conversazione che avresti voluto affrontare diversamente?","Cosa ti sta togliendo energia in questo periodo?","Cosa faresti se non avessi paura di fallire?","C'è un pensiero ricorrente che ti sta disturbando?","Scrivi una lettera al te stesso di 5 anni fa.","C'è qualcosa che devi 'lasciar andare' prima di dormire?","Se la tua giornata fosse un film, che titolo avrebbe?","Descrivi la giornata di oggi usando solo 3 parole.","Se potessi essere ovunque nel mondo ora, dove saresti?","Qual è l'idea più strana che ti è venuta in mente oggi?","Scrivi la prima frase del libro della tua vita.","Come ti immagini tra un anno esatto?","Qual è la cosa che aspetti con più ansia nel prossimo futuro?","Scrivi un messaggio di incoraggiamento per il te stesso di domani mattina."];
function createPromptObj(text) { return { id: Date.now() + Math.random(), text: text, usage: 0 }; }

// VARIABILI GLOBALI
let currentUser = null;
let currentDateString = new Date().toISOString().slice(0, 7); 
let currentDayStats = {};
let currentTags = [];
let globalWordCount = 0; 
let currentPrompts = [];
let collectedTasks = [];
let isLocalChange = false; // FLAG CRITICO PER EVITARE REFRESH CURSORE

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
        
        loadSettings(); // Carica Font/Size
        
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
    
    // Aggiorna UI dropdown
    document.getElementById('font-family-select').value = font;
    document.getElementById('font-size-select').value = size;
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
    if (confirm("Reset completo e aggiornamento?")) {
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
// Delegated event listener per gestire i click sulle checkbox senza ricaricare
document.getElementById('editor').addEventListener('click', (e) => {
    if (e.target.classList.contains('smart-task')) {
        // Toggle manuale attributo DOM
        if (e.target.hasAttribute('checked')) {
            e.target.removeAttribute('checked');
            e.target.checked = false; // visivo
        } else {
            e.target.setAttribute('checked', 'true');
            e.target.checked = true; // visivo
        }
        
        // Segnala che è una modifica locale per bloccare onSnapshot
        isLocalChange = true;
        saveData();
        
        // Dopo un po' resettiamo il flag, ma onSnapshot lo controllerà
        setTimeout(() => isLocalChange = false, 2000);
    }
});

document.getElementById('editor').addEventListener('input', (e) => {
    isLocalChange = true; // Stiamo scrivendo, non ricaricare
    const sel = window.getSelection();
    if (sel.rangeCount > 0) {
        const node = sel.anchorNode;
        if (node.nodeType === 3) {
            const text = node.textContent;
            const caretPos = sel.anchorOffset;
            const textBeforeCaret = text.substring(0, caretPos);
            
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
        isLocalChange = false; // Reset dopo il salvataggio
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
            id: cb.id, // ID univoco salvato nel DOM
            text: taskText,
            done: cb.checked
        });
    });
    return tasks;
}

// Funzione chiamata dal MODALE per aggiornare l'EDITOR
window.toggleTaskFromModal = (taskId, isChecked) => {
    const editor = document.getElementById('editor');
    const checkbox = editor.querySelector(`#${taskId}`);
    
    if (checkbox) {
        // Aggiorna lo stato nel DOM (senza focus)
        if (isChecked) {
            checkbox.setAttribute('checked', 'true');
            checkbox.checked = true;
        } else {
            checkbox.removeAttribute('checked');
            checkbox.checked = false;
        }
        
        // Salva immediatamente
        saveData();
        
        // Ridisegna la lista task per riflettere lo stato
        setTimeout(window.openTodoList, 100); 
    }
};

window.openTodoList = () => {
    const modal = document.getElementById('todo-modal');
    const container = document.getElementById('todo-list-container');
    container.innerHTML = '';
    
    if (collectedTasks.length === 0) {
        container.innerHTML = "<div style='text-align:center; padding:20px; color:#666;'>Nessun task trovato.</div>";
    } else {
        collectedTasks.forEach(task => {
            const row = document.createElement('div');
            row.style.cssText = "padding:10px; border-bottom:1px solid #333; display:flex; align-items:center; gap:10px;";
            
            // Creiamo checkbox che comanda l'editor
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

// ... COACH (Invariato) ...
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

// ... CORE ...
window.changeDate = (d) => { currentDateString = d; loadDiaryForDate(d); };

async function loadDiaryForDate(dateStr) {
    document.getElementById('db-status').innerText = "Loading...";
    const docRef = doc(db, "diario", currentUser.uid, "entries", dateStr);
    
    onSnapshot(docRef, (snap) => {
        // SE STIAMO SCRIVENDO (isLocalChange) o SE L'ELEMENTO ATTIVO È L'EDITOR, IGNORA L'UPDATE VISIVO
        // Questo impedisce il "salto" del cursore
        if (isLocalChange || (document.activeElement.id === 'editor' && document.hasFocus())) {
            // Aggiorniamo solo le stats silenziose, non l'HTML
            if (snap.exists()) {
                const data = snap.data();
                collectedTasks = data.tasks || [];
                // Non tocchiamo editor.innerHTML
            }
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
        collectedTasks = harvestTasks(); // Legge task dal DOM attuale

        const dataToSave = {
            htmlContent: content,
            stats: { words: wordsToday, mood: currentDayStats.mood || "" }, 
            tasks: collectedTasks,
            lastUpdate: new Date()
        };

        await setDoc(doc(db, "diario", currentUser.uid, "entries", currentDateString), dataToSave, { merge: true });

        const delta = wordsToday - (currentDayStats.words || 0);
        if (delta !== 0 || globalWordCount === 0) {
            let newGlobal = globalWordCount + delta; if(newGlobal<0) newGlobal=0;
            await setDoc(doc(db, "diario", currentUser.uid, "stats", "global"), { totalWords: newGlobal, lastUpdate: new Date() }, { merge: true });
        }

        statusLabel.innerText = "Saved"; statusLabel.style.color = "#00e676";
        updateMetrics(content, wordsToday);
    } catch (error) { console.error(error); statusLabel.innerText = "ERROR"; statusLabel.style.color = "red"; }
}

function loadGlobalStats() { onSnapshot(doc(db, "diario", currentUser.uid, "stats", "global"), (s) => { globalWordCount = s.exists() ? s.data().totalWords : 0; document.getElementById('count-global').innerText = globalWordCount; }); }
function updateCounts() { const t = document.getElementById('editor').innerText; const w = t.trim() ? t.trim().split(/\s+/).length : 0; updateMetrics(document.getElementById('editor').innerHTML, w); return w; }
function updateMetrics(content, wordsToday) {
    document.getElementById('count-today').innerText = wordsToday;
    const size = new Blob([content]).size;
    const kb = (size / 1024).toFixed(1);
    document.getElementById('file-weight').innerText = `${kb} KB`;
}

window.saveApiKey = () => { const k = document.getElementById('gemini-api-key').value.trim(); if(k) { localStorage.setItem('GEMINI_API_KEY', k); alert("Saved!"); document.getElementById('settings-modal').classList.remove('open'); } };

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

window.handleKeyUp = (e) => { if (e.key === 'Enter') processLastBlock(); };
function processLastBlock() { /* (Logica tag esistente...) */ }
window.triggerImageUpload = () => document.getElementById('img-input').click();
window.handleImageUpload = (input) => { const file = input.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = (e) => { const img = new Image(); img.src = e.target.result; img.onload = () => { const c = document.createElement('canvas'); const ctx = c.getContext('2d'); const scale = 600 / img.width; c.width = 600; c.height = img.height * scale; ctx.drawImage(img, 0, 0, c.width, c.height); document.execCommand('insertHTML', false, `<img src="${c.toDataURL('image/jpeg', 0.7)}"><br>`); saveData(); }; }; reader.readAsDataURL(file); };
window.toggleTheme = () => { document.body.classList.toggle('light-mode'); localStorage.setItem('theme', document.body.classList.contains('light-mode')?'light':'dark'); };
window.exportData = () => { const b = new Blob([document.getElementById('editor').innerHTML],{type:'text/html'}); const a = document.createElement('a'); a.href=URL.createObjectURL(b); a.download=`backup_${currentDateString}.html`; a.click(); };
window.format = (cmd) => { document.execCommand(cmd, false, null); document.getElementById('editor').focus(); };
let timeout;