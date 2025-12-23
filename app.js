import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, collection, query, where, getDocs, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// --- CONFIGURAZIONE E VERSIONING ---
const APP_VERSION = "V17.0 Stable";
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

// --- VARIABILI GLOBALI DI STATO ---
let currentUser = null;

// Gestione Data: Usiamo un oggetto Date per facilitare la navigazione avanti/indietro
let currentDate = new Date(); 

// Cache dei dati: Contiene tutto il mese corrente scaricato dal DB
let currentMonthData = { days: {}, tasks: [], stats: {} };

// FLAG CRITICO PER IL BUG FIX
// Se true, significa che l'utente sta scrivendo e blocchiamo gli aggiornamenti in arrivo dal server
let isLocalChange = false; 

let globalWordCount = 0; 
let isMonthlyView = false; // Se true, siamo in modalità "Zoom Out"

// --- VARIABILI FEATURES (TRIP, CHAT, COACH) ---
let chatHistory = [];
let tripInterval = null;
let tripStartTime = null;
let tripStartWordCount = 0;
let isTripRunning = false;
let tripSeconds = 0;
let currentPrompts = [];
let collectedTasks = [];
let timeout; // Per il debounce del salvataggio

// --- PROMPTS DEFAULT ---
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

// --- INIT ---
if ('serviceWorker' in navigator) { navigator.serviceWorker.register('sw.js'); }

window.login = () => signInWithPopup(auth, provider);

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app').style.display = 'flex';
        document.getElementById('user-pic').src = user.photoURL;
        
        // Inizializza interfaccia data
        updateDateDisplay();
        
        loadSettings(); 
        const savedKey = localStorage.getItem('GEMINI_API_KEY');
        if(savedKey) { document.getElementById('gemini-api-key').value = savedKey; }

        loadGlobalStats(); 
        await loadMonthData(getCurrentMonthString());
        loadCoachPrompts();
    }
});

// --- HELPER DATE ---
// Restituisce "YYYY-MM" (es: 2025-10) per il nome del documento Firebase
function getCurrentMonthString() {
    return currentDate.toISOString().slice(0, 7); 
}

// Restituisce "DD" (es: 05) per la chiave all'interno del documento
function getCurrentDayString() {
    return currentDate.getDate().toString().padStart(2, '0');
}

function updateDateDisplay() {
    // Aggiorna il testo nell'header (es: Lunedì 23 Ottobre 2025)
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const dateStr = currentDate.toLocaleDateString('it-IT', options);
    // Prima lettera maiuscola
    document.getElementById('current-date-display').innerText = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
    
    // Aggiorna anche l'input hidden del calendario per coerenza
    document.getElementById('date-input-hidden').value = currentDate.toISOString().slice(0, 10);
}

// --- NAVIGAZIONE GIORNALIERA ---
window.changeDay = (offset) => {
    // 1. SALVATAGGIO FORZATO: Prima di muoverci, salviamo lo stato attuale in memoria e DB
    // Questo previene la perdita dell'ultima frase scritta.
    if (!isMonthlyView) {
        saveData(true); // true = force immediate execution
    }
    
    // 2. Cambia la data
    currentDate.setDate(currentDate.getDate() + offset);
    handleDateChange();
};

window.triggerDatePicker = () => {
    document.getElementById('date-input-hidden').showPicker();
};

window.jumpToDate = (val) => {
    if(!val) return;
    if (!isMonthlyView) {
        saveData(true);
    }
    currentDate = new Date(val);
    handleDateChange();
};

async function handleDateChange() {
    isMonthlyView = false; // Torniamo sempre alla vista editor quando cambiamo data
    updateDateDisplay();
    
    const newMonthStr = getCurrentMonthString();
    
    // Se il mese è cambiato rispetto ai dati che abbiamo in memoria, ricarichiamo dal DB
    // loadMonthData gestisce internamente il listener onSnapshot
    await loadMonthData(newMonthStr);
    
    // Aggiorna l'editor con il testo del nuovo giorno
    renderEditorForDay(getCurrentDayString());
}

// --- CORE: CARICAMENTO DATI (FIX BUG SOVRASCRITTURA) ---
let currentSnapshotUnsubscribe = null; // Per pulire listener se necessario (opzionale)

async function loadMonthData(monthStr) {
    document.getElementById('db-status').innerText = "Loading...";
    
    const docRef = doc(db, "diario", currentUser.uid, "entries", monthStr);
    
    onSnapshot(docRef, (snap) => {
        // --- IL CUORE DEL FIX ---
        // Se isLocalChange è true, significa che l'utente sta digitando.
        // In questo caso, IGNORIAMO l'aggiornamento che arriva dal server per evitare che
        // il testo salti o venga cancellato mentre si scrive.
        const userIsTyping = isLocalChange || (document.activeElement && document.activeElement.id === 'editor');
        
        if (snap.exists()) {
            const data = snap.data();
            
            // Retrocompatibilità: se non c'è la mappa 'days', ma c'è 'htmlContent', migra al volo
            if (!data.days && data.htmlContent) {
                currentMonthData = { days: { "01": data.htmlContent }, tasks: data.tasks || [] };
            } else {
                currentMonthData = { days: data.days || {}, tasks: data.tasks || [] };
            }
        } else {
            // Mese nuovo/vuoto
            currentMonthData = { days: {}, tasks: [] };
        }
        
        // Aggiorniamo l'HTML dell'editor SOLO se l'utente NON sta scrivendo e non siamo in vista mensile
        if (!userIsTyping && !isMonthlyView) {
            renderEditorForDay(getCurrentDayString());
        }
        
        document.getElementById('db-status').innerText = "Sync OK";
        document.getElementById('db-status').style.color = "#00e676";
    });
}

// --- RENDERING EDITOR ---
function renderEditorForDay(dayStr) {
    const editor = document.getElementById('editor');
    
    if (isMonthlyView) {
        renderMonthlyView();
        return;
    }
    
    // Recupera il contenuto per il giorno specifico, o stringa vuota
    const content = currentMonthData.days[dayStr] || "";
    
    // Aggiorna solo se diverso per evitare sfarfallii
    if (editor.innerHTML !== content) {
        editor.innerHTML = content;
    }
    
    editor.contentEditable = "true";
    updateCounts();
    
    // IMPORTANTE: Aggiorna la lista task globale in base a ciò che è visibile ora
    // (Nota: in V17 i task sono salvati per mese, quindi facciamo un harvest visuale)
    collectedTasks = harvestTasks();
}

window.enableMonthlyView = () => {
    isMonthlyView = true;
    renderMonthlyView();
    document.getElementById('settings-modal').classList.remove('open');
};

function renderMonthlyView() {
    const editor = document.getElementById('editor');
    let fullHtml = `<h2 style="color:var(--accent); text-align:center;">Panoramica: ${getCurrentMonthString()}</h2><hr>`;
    
    const days = Object.keys(currentMonthData.days).sort();
    
    if (days.length === 0) {
        fullHtml += "<p style='text-align:center; color:#666;'>Nessuna pagina scritta in questo mese.</p>";
    } else {
        days.forEach(d => {
            if(currentMonthData.days[d] && currentMonthData.days[d].trim()) {
                fullHtml += `<div style="margin-bottom:40px;">
                    <h3 style="background:var(--tag-bg); padding:8px 15px; border-radius:8px; border-left:4px solid var(--accent); margin-bottom:10px;">
                        📅 Giorno ${d}
                    </h3>
                    <div style="padding:0 10px; border-left:1px solid #333; margin-left:10px;">
                        ${currentMonthData.days[d]}
                    </div>
                </div>`;
            }
        });
    }
    
    editor.innerHTML = fullHtml;
    editor.contentEditable = "false"; // Solo lettura
    document.getElementById('count-today').innerText = "View Only";
}

// --- CORE: SALVATAGGIO ---
async function saveData(forceImmediate = false) {
    if (!currentUser || isMonthlyView) return;
    
    const statusLabel = document.getElementById('db-status');
    statusLabel.innerText = "Saving..."; statusLabel.style.color = "orange";
    
    try {
        const currentDayStr = getCurrentDayString();
        const content = document.getElementById('editor').innerHTML;
        const wordsToday = updateCounts();
        
        // 1. Aggiorna Cache Locale Immediatamente
        currentMonthData.days[currentDayStr] = content;
        
        // 2. Harvest Dati
        collectedTasks = harvestTasks();
        const detectedTags = detectTagsInContent(document.getElementById('editor').innerText);

        // 3. Prepara Update Firebase (Nested Fields)
        // Usiamo la sintassi "days.05" per aggiornare SOLO quel campo senza sovrascrivere tutto il documento
        const updateObj = {};
        updateObj[`days.${currentDayStr}`] = content;
        updateObj['lastUpdate'] = new Date();
        updateObj['tasks'] = collectedTasks; // Aggiorna lista task del mese
        
        if (detectedTags.length > 0) {
            updateObj['tags'] = detectedTags;
        }

        const docRef = doc(db, "diario", currentUser.uid, "entries", getCurrentMonthString());
        await setDoc(docRef, updateObj, { merge: true });
        
        // 4. Update Global Stats
        await setDoc(doc(db, "diario", currentUser.uid, "stats", "global"), { lastUpdate: new Date() }, { merge: true });

        statusLabel.innerText = "Saved"; statusLabel.style.color = "#00e676";
        
    } catch (error) { 
        console.error("Errore salvataggio:", error); 
        statusLabel.innerText = "Err"; 
        statusLabel.style.color = "red"; 
    }
}

// --- INPUT LISTENERS (LOGICA ANTI-BUG & FEATURES) ---
document.getElementById('editor').addEventListener('input', (e) => {
    if (isMonthlyView) return;
    
    // ATTIVIAMO IL BLOCCO: "Utente sta scrivendo, Firebase stai fermo"
    isLocalChange = true;
    
    // Logica @now e @task
    const sel = window.getSelection();
    if (sel.rangeCount > 0) {
        const node = sel.anchorNode;
        if (node.nodeType === 3) {
            const text = node.textContent;
            const caretPos = sel.anchorOffset;
            const textBeforeCaret = text.substring(0, caretPos);
            
            if (textBeforeCaret.endsWith('@now')) {
                const range = document.createRange(); range.setStart(node, caretPos - 4); range.setEnd(node, caretPos); sel.removeAllRanges(); sel.addRange(range);
                const now = new Date();
                const htmlToInsert = `<span style="color: #ff5252; font-weight: bold;">📅 ${now.toLocaleTimeString('it-IT', {hour: '2-digit', minute:'2-digit'})}</span>&nbsp;`;
                document.execCommand('insertHTML', false, htmlToInsert);
            }

            if (textBeforeCaret.endsWith('@task')) {
                const range = document.createRange(); range.setStart(node, caretPos - 5); range.setEnd(node, caretPos); sel.removeAllRanges(); sel.addRange(range);
                const taskId = 'task_' + Date.now();
                const htmlToInsert = `<input type="checkbox" id="${taskId}" class="smart-task">&nbsp;`;
                document.execCommand('insertHTML', false, htmlToInsert);
            }
        }
    }
    
    updateCounts();
    if(isTripRunning) updateTripUI();
    
    clearTimeout(timeout);
    timeout = setTimeout(() => {
        saveData(); 
        // Solo dopo aver salvato rilasciamo il blocco, permettendo a Firebase di aggiornare se necessario
        // (anche se onSnapshot è intelligente e non lo farà se il dato è uguale)
        isLocalChange = false; 
    }, 1500);
});

// Listener per Click Checkbox (fix cursore che salta)
document.getElementById('editor').addEventListener('click', (e) => {
    if (e.target.classList.contains('smart-task') && !isMonthlyView) {
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

// --- FEATURES COMPLETE (COPIATE DA V15) ---

// 1. CHAT ANALISI (Adattata per Giorno/Mese)
window.openAnalysisChat = () => {
    let context = "";
    if (isMonthlyView) {
        context = Object.values(currentMonthData.days).join("\n\n");
        context = `ANALISI MENSILE (${getCurrentMonthString()}). Contenuto:\n${context}`;
    } else {
        context = document.getElementById('editor').innerText;
        context = `ANALISI GIORNALIERA (${getCurrentDayString()}). Contenuto:\n${context}`;
    }

    if(context.length < 30) { alert("Troppo poco testo per analizzare."); return; }

    document.getElementById('chat-modal').classList.add('open');
    document.getElementById('chat-history-container').innerHTML = '';
    
    chatHistory = [
        {
            role: "user",
            parts: [{ text: `Agisci come un coach empatico. ${context}. Fai domande brevi e profonde.` }]
        }
    ];
    sendChatRequest();
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
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: chatHistory })
        });
        const data = await response.json();
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
    if(isMonthlyView) { alert("Vai in un giorno specifico per salvare."); return; }
    let htmlToAppend = "<br><hr><h3>🧠 Analisi AI</h3>";
    for (let i = 1; i < chatHistory.length; i++) {
        const msg = chatHistory[i];
        const text = msg.parts[0].text;
        htmlToAppend += `<p><b>${msg.role}:</b> ${text}</p>`;
    }
    document.execCommand('insertHTML', false, htmlToAppend);
    saveData();
    window.closeAnalysisChat();
};

// 2. TASK SYSTEM
function harvestTasks() {
    const checkboxes = document.querySelectorAll('#editor .smart-task');
    const tasks = [];
    checkboxes.forEach((cb) => {
        let taskText = "Task";
        let nextNode = cb.nextSibling;
        if (nextNode && nextNode.textContent) taskText = nextNode.textContent.trim().substring(0, 50);
        tasks.push({ id: cb.id, text: taskText, done: cb.checked });
    });
    return tasks;
}

window.toggleTaskFromModal = (taskId, isChecked) => {
    const checkbox = document.getElementById(taskId);
    if (checkbox) {
        checkbox.checked = isChecked;
        if (isChecked) checkbox.setAttribute('checked', 'true');
        else checkbox.removeAttribute('checked');
        saveData();
    }
};

window.openTodoList = () => {
    collectedTasks = harvestTasks(); // Refresh live
    const container = document.getElementById('todo-list-container');
    container.innerHTML = '';
    
    if (collectedTasks.length === 0) {
        container.innerHTML = "<div style='text-align:center; padding:20px; color:#666;'>Nessun task oggi.</div>";
    } else {
        collectedTasks.forEach(task => {
            const row = document.createElement('div');
            row.style.cssText = "padding:10px; border-bottom:1px solid #333; display:flex; align-items:center; gap:10px;";
            const cb = document.createElement('input'); cb.type = "checkbox"; cb.checked = task.done;
            cb.onchange = (e) => toggleTaskFromModal(task.id, e.target.checked);
            const txt = document.createElement('span'); txt.innerText = task.text || '...';
            if(task.done) txt.style.cssText = "text-decoration:line-through; color:#666;";
            row.appendChild(cb); row.appendChild(txt); container.appendChild(row);
        });
    }
    document.getElementById('todo-modal').classList.add('open');
};

// 3. TRIP MODE
window.tripStart = () => {
    if (isTripRunning) return;
    isTripRunning = true;
    tripStartTime = Date.now() - (tripSeconds * 1000); 
    tripStartWordCount = parseInt(document.getElementById('count-today').innerText) || 0;
    if (tripInterval) clearInterval(tripInterval);
    tripInterval = setInterval(updateTripUI, 1000);
};
window.tripPause = () => { isTripRunning = false; clearInterval(tripInterval); };
window.tripReset = () => { isTripRunning = false; clearInterval(tripInterval); tripSeconds = 0; tripStartTime = null; document.getElementById('trip-timer').innerText = "00:00"; document.getElementById('trip-words').innerText = "0w"; };
function updateTripUI() {
    if (!isTripRunning) return;
    tripSeconds = Math.floor((Date.now() - tripStartTime) / 1000);
    const m = Math.floor(tripSeconds / 60).toString().padStart(2, '0');
    const s = (tripSeconds % 60).toString().padStart(2, '0');
    document.getElementById('trip-timer').innerText = `${m}:${s}`;
    const cw = parseInt(document.getElementById('count-today').innerText) || 0;
    document.getElementById('trip-words').innerText = Math.max(0, cw - tripStartWordCount) + "w";
}

// 4. COACH MANAGER
async function loadCoachPrompts() {
    if (!currentUser) return;
    try {
        const docRef = doc(db, "diario", currentUser.uid, "settings", "coach");
        const snap = await getDoc(docRef);
        if (snap.exists() && snap.data().prompts) {
            currentPrompts = snap.data().prompts;
        } else {
            currentPrompts = defaultPromptsText.map(txt => createPromptObj(txt));
        }
    } catch (e) { currentPrompts = defaultPromptsText.map(txt => createPromptObj(txt)); }
}
async function savePromptsToDb() { if (!currentUser) return; try { await setDoc(doc(db, "diario", currentUser.uid, "settings", "coach"), { prompts: currentPrompts }, { merge: true }); renderCoachList(); } catch (e) { console.error(e); } }
window.openCoachManager = () => { document.getElementById('coach-manager-modal').classList.add('open'); renderCoachList(); };
function renderCoachList() { const c = document.getElementById('coach-list-container'); c.innerHTML = ''; [...currentPrompts].sort((a,b)=>(b.usage||0)-(a.usage||0)).forEach((p, i)=>{ const d=document.createElement('div'); d.className='coach-item'; d.innerHTML=`<div class="coach-text">${p.text}</div><div class="coach-btn-group"><button class="coach-action-btn" onclick="deleteCoachPrompt(${i})">🗑️</button></div>`; c.appendChild(d); }); }
window.addCoachPrompt = () => { const i=document.getElementById('new-prompt-input'); const t=i.value.trim(); if(!t)return; currentPrompts.unshift(createPromptObj(t)); i.value=''; savePromptsToDb(); };
window.deleteCoachPrompt = (i) => { if(confirm("Eliminare?")) { currentPrompts.splice(i,1); savePromptsToDb(); } };
window.triggerBrainstorm = () => { if(currentPrompts.length===0) return; const p=currentPrompts[Math.floor(Math.random()*currentPrompts.length)]; document.getElementById('ai-title').innerText="Coach"; document.getElementById('ai-message').innerText=p.text; document.getElementById('ai-actions').innerHTML=`<button class="ai-btn-small" onclick="insertPrompt('${p.id}')">Inserisci</button>`; document.getElementById('ai-coach-area').style.display='block'; };
window.insertPrompt = (id) => { const i=currentPrompts.findIndex(p=>p.id==id); if(i>-1){ currentPrompts[i].usage++; savePromptsToDb(); document.execCommand('insertHTML',false,`<br><p style="color:#ff9100;font-weight:bold;">${currentPrompts[i].text}</p><p></p>`); document.getElementById('ai-coach-area').style.display='none'; saveData(); }};

// 5. TAGS & SEARCH
const tagRules = { 'Relazioni': ['simona', 'nala', 'mamma', 'papà', 'amici'], 'Salute': ['cibo', 'dieta', 'allenamento', 'sonno'], 'Lavoro': ['progetto', 'app', 'business', 'soldi'], 'Mindset': ['gratitudine', 'ansia', 'felice', 'triste'] };
function detectTagsInContent(text) { const lower = text.toLowerCase(); const found = new Set(); for (const [tag, keywords] of Object.entries(tagRules)) { if (keywords.some(k => lower.includes(k))) found.add(tag); } return Array.from(found); }
window.openTagExplorer = () => { document.getElementById('tag-modal').classList.add('open'); const c = document.getElementById('tag-cloud'); c.innerHTML = ''; Object.keys(tagRules).forEach(tag => { const b = document.createElement('span'); b.className = 'tag-chip'; b.innerText = tag; b.onclick = () => searchByTag(tag); c.appendChild(b); }); };
async function searchByTag(tag) { 
    const r = document.getElementById('tag-results'); r.innerHTML = "Cerco..."; 
    const q = query(collection(db, "diario", currentUser.uid, "entries"), where("tags", "array-contains", tag)); 
    const s = await getDocs(q); r.innerHTML = ''; 
    if (s.empty) { r.innerHTML = "Nessun risultato."; return; } 
    s.forEach((doc) => { 
        const d = document.createElement('div'); d.className = 'result-row'; 
        d.innerHTML = `<span>🗓️ Mese ${doc.id}</span>`; 
        d.onclick = () => { document.getElementById('tag-modal').classList.remove('open'); jumpToDate(doc.id + "-01"); }; 
        r.appendChild(d); 
    }); 
}

// 6. STATS & CHARTS
window.openStats = () => { document.getElementById('stats-modal').classList.add('open'); renderChart(); };
function renderChart() { 
    const ctx = document.getElementById('chartCanvas').getContext('2d'); 
    if(window.myChart) window.myChart.destroy(); 
    window.myChart = new Chart(ctx, { 
        type:'bar', 
        data:{labels:['Oggi'], datasets:[{label:'Parole', data:[updateCounts()], backgroundColor:'#7c4dff'}]}, 
        options:{plugins:{legend:{display:false}}, scales:{x:{display:false}, y:{grid:{color:'#333'}}}} 
    }); 
}

// 7. UTILITIES
function updateCounts() { 
    if(isMonthlyView) return 0;
    const t = document.getElementById('editor').innerText; 
    const w = t.trim() ? t.trim().split(/\s+/).length : 0; 
    document.getElementById('count-today').innerText = w; 
    return w; 
}
function loadGlobalStats() { onSnapshot(doc(db, "diario", currentUser.uid, "stats", "global"), (s) => { globalWordCount = s.exists() ? s.data().totalWords : 0; document.getElementById('count-global').innerText = globalWordCount; }); }

window.generateAiSummary = async () => {
    const k = localStorage.getItem('GEMINI_API_KEY'); if (!k) { alert("Manca API Key"); return; }
    const t = document.getElementById('editor').innerText; if (t.length < 30) { alert("Scrivi di più!"); return; }
    document.getElementById('summary-modal').classList.add('open');
    const c = document.getElementById('ai-summary-content'); c.innerHTML = '<div class="ai-loading">Gemini 3.0 Flash Preview... 🧠</div>';
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${k}`;
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: `Analizza: "${t}"\n1. Riassunto.\n2. Insight.\n3. Consiglio.` }] }] }) });
        const data = await response.json();
        c.innerHTML = marked.parse(data.candidates[0].content.parts[0].text);
    } catch (error) { c.innerHTML = `Err: ${error.message}`; }
};

window.handleKeyUp = (e) => { 
    if (e.key === 'Enter') {
        // Logica semplice per pulizia o auto-format (opzionale)
    } 
};
window.insertMood = (e) => { document.execCommand('insertText', false, ` ${e} `); saveData(); };
window.format = (cmd) => { document.execCommand(cmd, false, null); document.getElementById('editor').focus(); };
window.triggerImageUpload = () => document.getElementById('img-input').click();
window.handleImageUpload = (input) => { 
    const file = input.files[0]; if (!file) return; 
    const reader = new FileReader(); 
    reader.onload = (e) => { 
        const img = new Image(); img.src = e.target.result; 
        img.onload = () => { 
            const c = document.createElement('canvas'); const ctx = c.getContext('2d'); 
            const scale = 600 / img.width; c.width = 600; c.height = img.height * scale; 
            ctx.drawImage(img, 0, 0, c.width, c.height); 
            document.execCommand('insertHTML', false, `<img src="${c.toDataURL('image/jpeg', 0.7)}"><br>`); 
            saveData(); 
        }; 
    }; 
    reader.readAsDataURL(file); 
};
window.toggleTheme = () => { document.body.classList.toggle('light-mode'); localStorage.setItem('theme', document.body.classList.contains('light-mode')?'light':'dark'); };
window.exportData = () => { const b = new Blob([JSON.stringify(currentMonthData)],{type:'application/json'}); const a = document.createElement('a'); a.href=URL.createObjectURL(b); a.download=`backup_${getCurrentMonthString()}.json`; a.click(); };
window.openSettings = () => document.getElementById('settings-modal').classList.add('open');
window.saveApiKey = () => { const k = document.getElementById('gemini-api-key').value.trim(); if(k) { localStorage.setItem('GEMINI_API_KEY', k); alert("Saved!"); document.getElementById('settings-modal').classList.remove('open'); } };
function loadSettings() {
    const f = localStorage.getItem('editorFont') || 'system-ui';
    const s = localStorage.getItem('editorSize') || '1.1rem';
    document.documentElement.style.setProperty('--editor-font', f);
    document.documentElement.style.setProperty('--editor-size', s);
    if(document.getElementById('font-family-select')) document.getElementById('font-family-select').value = f;
    if(document.getElementById('font-size-select')) document.getElementById('font-size-select').value = s;
}
window.changeEditorFont = (v) => { document.documentElement.style.setProperty('--editor-font', v); localStorage.setItem('editorFont', v); };
window.changeEditorSize = (v) => { document.documentElement.style.setProperty('--editor-size', v); localStorage.setItem('editorSize', v); };
window.forceAppRefresh = async () => { if (confirm("Reset completo?")) { const keys = await caches.keys(); for (const key of keys) await caches.delete(key); window.location.reload(true); } };