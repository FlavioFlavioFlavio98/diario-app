import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, collection, query, where, getDocs, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// --- CONFIGURAZIONE VERSIONE ---
const APP_VERSION = "V16.0 Final";
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

// --- VARIABILI GLOBALI (Nuova Struttura V16) ---
let currentUser = null;
let currentMonthString = new Date().toISOString().slice(0, 7); // Es: "2023-10"
let currentDay = new Date().getDate().toString().padStart(2, '0'); // Es: "05"
let currentMonthData = { days: {}, tasks: [], stats: {} }; // Cache locale del mese intero
let isLocalChange = false; // Flag per evitare loop di salvataggio
let globalWordCount = 0; 

// Variabili Features (Legacy)
let chatHistory = [];
let tripInterval = null;
let tripStartTime = null;
let tripStartWordCount = 0;
let isTripRunning = false;
let tripSeconds = 0;
let currentPrompts = [];
let collectedTasks = [];
let timeout;

// --- PROMPTS COACH DEFAULT ---
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

// --- INIT SERVICE WORKER ---
if ('serviceWorker' in navigator) { navigator.serviceWorker.register('sw.js'); }

// --- AUTHENTICATION ---
window.login = () => signInWithPopup(auth, provider);

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app').style.display = 'flex';
        document.getElementById('user-pic').src = user.photoURL;
        document.getElementById('date-picker').value = currentMonthString;
        
        loadSettings(); // Carica font e size salvati
        
        const savedKey = localStorage.getItem('GEMINI_API_KEY');
        if(savedKey) { document.getElementById('gemini-api-key').value = savedKey; }

        loadGlobalStats(); 
        await loadMonthData(currentMonthString); // Carica il mese corrente
        loadCoachPrompts();
    }
});

// --- CORE: CARICAMENTO DATI (V16 LOGIC) ---
// Carica un intero mese e lo mette in cache (currentMonthData)
async function loadMonthData(monthStr) {
    document.getElementById('db-status').innerText = "Loading...";
    const docRef = doc(db, "diario", currentUser.uid, "entries", monthStr);
    
    onSnapshot(docRef, (snap) => {
        // Se stiamo scrivendo (isLocalChange) e siamo su un giorno singolo, ignoriamo l'update per non far saltare il cursore
        if (isLocalChange && currentDay !== 'ALL') return;

        if (snap.exists()) {
            const data = snap.data();
            // Gestione retrocompatibilità: se non c'è la struttura 'days', prova a vedere se c'è htmlContent vecchio stile
            if (!data.days && data.htmlContent) {
                // Migrazione al volo in memoria: metto tutto nel giorno 01
                currentMonthData = { days: { "01": data.htmlContent }, tasks: data.tasks || [] };
            } else {
                currentMonthData = { days: data.days || {}, tasks: data.tasks || [] };
            }
        } else {
            // Mese nuovo vuoto
            currentMonthData = { days: {}, tasks: [] };
        }
        
        // Renderizza l'interfaccia
        renderSidebar();
        renderEditorForDay(currentDay);
        
        document.getElementById('db-status').innerText = "Sync OK";
        document.getElementById('db-status').style.color = "#00e676";
    });
}

// --- RENDERING UI ---
function renderSidebar() {
    const list = document.getElementById('day-list');
    list.innerHTML = '';
    
    // Calcola quanti giorni ha il mese selezionato
    const [y, m] = currentMonthString.split('-');
    const daysInMonth = new Date(y, m, 0).getDate();
    
    for(let i=1; i<=daysInMonth; i++) {
        const dStr = i.toString().padStart(2, '0');
        // Controlla se c'è testo per quel giorno
        const hasContent = currentMonthData.days[dStr] && currentMonthData.days[dStr].trim().length > 10;
        
        const li = document.createElement('li');
        li.className = `day-item ${currentDay === dStr ? 'active' : ''}`;
        li.onclick = () => setDay(dStr);
        li.innerHTML = `
            <span>Giorno ${i}</span>
            ${hasContent ? '<span class="has-content-dot"></span>' : ''}
        `;
        list.appendChild(li);
    }
}

// Funzione per cambiare giorno attivo
window.setDay = (dayStr) => {
    saveData(); // Salva eventuali modifiche pendenti prima di cambiare
    currentDay = dayStr;
    renderSidebar(); // Aggiorna la classe 'active'
    renderEditorForDay(dayStr);
    
    // Su mobile chiude la sidebar dopo il click
    document.getElementById('app-container').classList.remove('sidebar-open');
    document.getElementById('sidebar').classList.remove('open');
};

function renderEditorForDay(dayStr) {
    const editor = document.getElementById('editor');
    
    if (dayStr === 'ALL') {
        // MODALITÀ VISIONE MESE (SOLO LETTURA)
        let fullHtml = `<h2 style="color:var(--accent); text-align:center;">Visione Mese: ${currentMonthString}</h2><hr>`;
        const days = Object.keys(currentMonthData.days).sort();
        if (days.length === 0) fullHtml += "<p style='text-align:center; color:#666;'>Nessun contenuto in questo mese.</p>";
        
        days.forEach(d => {
            if(currentMonthData.days[d] && currentMonthData.days[d].trim()) {
                fullHtml += `<div style="margin-bottom:30px;">
                    <h3 style="background:var(--tag-bg); padding:8px; border-radius:5px; border-left:4px solid var(--accent);">📅 Giorno ${d}</h3>
                    <div style="padding:10px;">${currentMonthData.days[d]}</div>
                </div>`;
            }
        });
        editor.innerHTML = fullHtml;
        editor.contentEditable = "false"; 
        document.getElementById('count-today').innerText = "View Only";
    } else {
        // MODALITÀ EDITOR GIORNALIERO
        editor.contentEditable = "true";
        editor.innerHTML = currentMonthData.days[dayStr] || "";
        updateCounts();
        
        // Reimposta i listener per i task nel nuovo contenuto
        // (Nota: collectedTasks viene aggiornato in background)
    }
}

// --- CORE: SALVATAGGIO (V16 LOGIC) ---
async function saveData() {
    if (!currentUser || currentDay === 'ALL') return; // Non salvare in modalità visione totale
    
    const statusLabel = document.getElementById('db-status');
    statusLabel.innerText = "Saving..."; statusLabel.style.color = "orange";
    
    try {
        const content = document.getElementById('editor').innerHTML;
        const wordsToday = updateCounts();
        
        // 1. Aggiorna la cache locale
        currentMonthData.days[currentDay] = content;
        
        // 2. Estrai i task presenti nel testo attuale
        collectedTasks = harvestTasks(); 
        
        // 3. Estrai Tag presenti nel testo attuale (Legacy support)
        const detectedTags = detectTagsInContent(document.getElementById('editor').innerText);

        // 4. Prepara l'aggiornamento per Firestore (Solo i campi modificati)
        const updateObj = {};
        updateObj[`days.${currentDay}`] = content; // Aggiorna solo la chiave del giorno specifico
        updateObj['lastUpdate'] = new Date();
        updateObj['tasks'] = collectedTasks; // Aggiorna lista task (semplificato: sovrascrive)
        if(detectedTags.length > 0) {
            updateObj['tags'] = detectedTags; // Aggiorna tags
        }
        
        // Scrive nel documento del MESE
        await setDoc(doc(db, "diario", currentUser.uid, "entries", currentMonthString), updateObj, { merge: true });
        
        // Aggiorna Stats Globali (Conteggio approssimativo per performance)
        await setDoc(doc(db, "diario", currentUser.uid, "stats", "global"), { lastUpdate: new Date() }, { merge: true });

        statusLabel.innerText = "Saved"; statusLabel.style.color = "#00e676";
    } catch (error) { 
        console.error(error); 
        statusLabel.innerText = "ERROR"; 
        statusLabel.style.color = "red"; 
    }
}

// --- EVENT LISTENERS EDITOR ---
document.getElementById('editor').addEventListener('input', (e) => {
    if (currentDay === 'ALL') return;
    isLocalChange = true;
    
    const sel = window.getSelection();
    if (sel.rangeCount > 0) {
        const node = sel.anchorNode;
        if (node.nodeType === 3) {
            const text = node.textContent;
            const caretPos = sel.anchorOffset;
            const textBeforeCaret = text.substring(0, caretPos);
            
            // Logica @now
            if (textBeforeCaret.endsWith('@now')) {
                const range = document.createRange();
                range.setStart(node, caretPos - 4);
                range.setEnd(node, caretPos);
                sel.removeAllRanges();
                sel.addRange(range);
                const now = new Date();
                const htmlToInsert = `<span style="color: #ff5252; font-weight: bold;">📅 ${now.toLocaleTimeString('it-IT', {hour: '2-digit', minute:'2-digit'})}</span>&nbsp;`;
                document.execCommand('insertHTML', false, htmlToInsert);
            }

            // Logica @task
            if (textBeforeCaret.endsWith('@task')) {
                const range = document.createRange();
                range.setStart(node, caretPos - 5);
                range.setEnd(node, caretPos);
                sel.removeAllRanges();
                sel.addRange(range);
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
        isLocalChange = false; 
    }, 1500);
});

// Listener per Click Checkbox (evita reload cursore)
document.getElementById('editor').addEventListener('click', (e) => {
    if (e.target.classList.contains('smart-task') && currentDay !== 'ALL') {
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

// --- CHAT ANALISI (CONTESTO INTELLIGENTE V16) ---
window.openAnalysisChat = () => {
    let contextText = "";
    
    if (currentDay === 'ALL') {
        // Se siamo in visione mese, inviamo tutto il mese
        contextText = Object.values(currentMonthData.days).join("\n\n");
        contextText = `ANALISI MENSILE (${currentMonthString}). Ecco il contenuto del mese:\n${contextText}`;
    } else {
        // Se siamo nel giorno singolo, inviamo solo oggi
        contextText = document.getElementById('editor').innerText;
        contextText = `ANALISI GIORNALIERA (Giorno ${currentDay}). Ecco il contenuto di oggi:\n${contextText}`;
    }

    if(contextText.length < 30) { alert("Troppo poco testo per analizzare."); return; }

    document.getElementById('chat-modal').classList.add('open');
    const container = document.getElementById('chat-history-container');
    container.innerHTML = '';
    
    // Inizializza Chat
    chatHistory = [
        {
            role: "user",
            parts: [{ text: `Agisci come un coach empatico e saggio. 
            Analizza il seguente diario dell'utente. 
            ${contextText}
            Fai domande brevi e profonde per stimolare la riflessione.` }]
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
    if(currentDay === 'ALL') { alert("Seleziona un giorno specifico per salvare la chat."); return; }
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
    // Scrolla giù e inserisci
    const editor = document.getElementById('editor');
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    
    document.execCommand('insertHTML', false, htmlToAppend);
    saveData();
};

// --- TRIP MODE (Legacy V15) ---
window.tripStart = () => {
    if (isTripRunning) return;
    isTripRunning = true;
    tripStartTime = Date.now() - (tripSeconds * 1000); 
    tripStartWordCount = parseInt(document.getElementById('count-today').innerText) || 0;
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
    tripSeconds = Math.floor((Date.now() - tripStartTime) / 1000);
    const m = Math.floor(tripSeconds / 60).toString().padStart(2, '0');
    const s = (tripSeconds % 60).toString().padStart(2, '0');
    document.getElementById('trip-timer').innerText = `${m}:${s}`;
    
    const currentWords = parseInt(document.getElementById('count-today').innerText) || 0;
    const sessionWords = currentWords - tripStartWordCount;
    document.getElementById('trip-words').innerText = `${sessionWords > 0 ? sessionWords : 0}w`;
}

// --- TASKS SYSTEM (V16 Update) ---
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
        tasks.push({ id: cb.id, text: taskText, done: cb.checked });
    });
    return tasks;
}

window.toggleTaskFromModal = (taskId, isChecked) => {
    const checkbox = document.getElementById(taskId);
    if (checkbox) {
        if (isChecked) { checkbox.setAttribute('checked', 'true'); checkbox.checked = true; } 
        else { checkbox.removeAttribute('checked'); checkbox.checked = false; }
        saveData();
        setTimeout(window.openTodoList, 100); 
    }
};

window.openTodoList = () => {
    const modal = document.getElementById('todo-modal');
    const container = document.getElementById('todo-list-container');
    container.innerHTML = '';
    
    collectedTasks = harvestTasks(); // Refresh live dal giorno corrente
    
    if (collectedTasks.length === 0) {
        container.innerHTML = "<div style='text-align:center; padding:20px; color:#666;'>Nessun task in questo giorno.</div>";
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
    modal.classList.add('open');
};

// --- COACH MANAGER (Legacy) ---
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
function renderCoachList() { const c = document.getElementById('coach-list-container'); c.innerHTML = ''; [...currentPrompts].sort((a,b)=>(b.usage||0)-(a.usage||0)).forEach((p)=>{ const i=currentPrompts.findIndex(x=>x.id===p.id); const d=document.createElement('div'); d.className='coach-item'; d.innerHTML=`<div class="coach-text">${p.text}</div><div class="coach-btn-group"><button class="coach-action-btn" onclick="editCoachPrompt(${i})">✏️</button><button class="coach-action-btn coach-delete" onclick="deleteCoachPrompt(${i})">🗑️</button></div>`; c.appendChild(d); }); }
window.addCoachPrompt = () => { const i=document.getElementById('new-prompt-input'); const t=i.value.trim(); if(!t)return; currentPrompts.unshift(createPromptObj(t)); i.value=''; savePromptsToDb(); };
window.deleteCoachPrompt = (i) => { if(confirm("Eliminare?")) { currentPrompts.splice(i,1); savePromptsToDb(); } };
window.editCoachPrompt = (i) => { const t=prompt("Modifica:", currentPrompts[i].text); if(t) { currentPrompts[i].text=t.trim(); savePromptsToDb(); } };
window.triggerBrainstorm = () => { if(currentPrompts.length===0) return; const p=currentPrompts[Math.floor(Math.random()*currentPrompts.length)]; document.getElementById('ai-title').innerText="Coach"; document.getElementById('ai-message').innerText=p.text; document.getElementById('ai-actions').innerHTML=`<button class="ai-btn-small" onclick="insertPrompt('${p.id}')">Inserisci</button>`; document.getElementById('ai-coach-area').style.display='block'; };
window.insertPrompt = (id) => { const i=currentPrompts.findIndex(p=>p.id==id); let t="Domanda..."; if(i>-1){ currentPrompts[i].usage=(currentPrompts[i].usage||0)+1; t=currentPrompts[i].text; savePromptsToDb(); } const e=document.getElementById('editor'); e.focus(); const r=document.createRange(); r.selectNodeContents(e); r.collapse(false); window.getSelection().removeAllRanges(); window.getSelection().addRange(r); e.scrollTop=e.scrollHeight; document.execCommand('insertHTML',false,`<br><p style="color:#ff9100;font-weight:bold;margin-bottom:5px;">Domanda: ${t}</p><p>Risposta: </p>`); document.getElementById('ai-coach-area').style.display='none'; saveData(); };

// --- TAGS (Legacy) ---
const tagRules = { 'Relazioni': ['simona', 'nala', 'mamma', 'papà', 'amici'], 'Salute': ['cibo', 'dieta', 'allenamento', 'sonno'], 'Lavoro': ['progetto', 'app', 'business', 'soldi'], 'Mindset': ['gratitudine', 'ansia', 'felice', 'triste'] };
function detectTagsInContent(text) { const lower = text.toLowerCase(); const found = new Set(); for (const [tag, keywords] of Object.entries(tagRules)) { if (keywords.some(k => lower.includes(k))) found.add(tag); } return Array.from(found); }
window.openTagExplorer = () => { document.getElementById('tag-modal').classList.add('open'); const c = document.getElementById('tag-cloud'); c.innerHTML = ''; Object.keys(tagRules).forEach(tag => { const b = document.createElement('span'); b.className = 'tag-chip'; b.innerText = tag; b.onclick = () => searchByTag(tag); c.appendChild(b); }); };
async function searchByTag(tag) { const r = document.getElementById('tag-results'); r.innerHTML = "Cerco..."; const q = query(collection(db, "diario", currentUser.uid, "entries"), where("tags", "array-contains", tag)); const s = await getDocs(q); r.innerHTML = ''; if (s.empty) { r.innerHTML = "Nessun risultato."; return; } s.forEach((doc) => { const d = document.createElement('div'); d.className = 'result-row'; d.innerHTML = `<span>🗓️ ${doc.id}</span> <span>${doc.data().stats?.words || 0} parole</span>`; d.onclick = () => { document.getElementById('tag-modal').classList.remove('open'); document.getElementById('date-picker').value = doc.id; changeMonth(doc.id); }; r.appendChild(d); }); }
window.handleKeyUp = (e) => { if (e.key === 'Enter') processLastBlock(); };
function processLastBlock() { const s = window.getSelection(); if (!s.rangeCount) return; let b = s.getRangeAt(0).startContainer; while (b && b.id !== 'editor' && b.tagName !== 'DIV' && b.tagName !== 'P') { b = b.parentNode; } if (b && b.previousElementSibling) { const p = b.previousElementSibling; if (!p.querySelector('.auto-tag') && p.innerText.trim().length > 10) { const tag = analyzeTextForTag(p.innerText); if (tag) { const ts = document.createElement('span'); ts.className = 'auto-tag'; ts.innerText = tag; ts.contentEditable = "false"; p.prepend(ts); saveData(); } } } }
function analyzeTextForTag(text) { const lower = text.toLowerCase(); for (const [tag, keywords] of Object.entries(tagRules)) { if (keywords.some(k => lower.includes(k))) return tag; } return null; }

// --- WALK & TALK (Legacy) ---
window.openWalkTalk = () => document.getElementById('walk-talk-modal').classList.add('open');
window.closeWalkTalk = () => { stopWalkSession(); document.getElementById('walk-talk-modal').classList.remove('open'); };
window.toggleWalkSession = () => { if(isWalkSessionActive) stopWalkSession(); else startWalkSession(); };
function startWalkSession() { if (!('webkitSpeechRecognition' in window)) { alert("No speech support"); return; } isWalkSessionActive = true; document.getElementById('walk-mic-btn').classList.add('active'); document.getElementById('walk-status').innerText = "Ascolto..."; walkRecognition = new webkitSpeechRecognition(); walkRecognition.continuous = false; walkRecognition.lang = 'it-IT'; walkRecognition.onresult = (e) => { const t = e.results[0][0].transcript; document.getElementById('walk-transcript').innerText = t; const time = new Date().toLocaleTimeString('it-IT', {hour:'2-digit', minute:'2-digit'}); document.getElementById('editor').innerHTML += `<div style="margin-top:10px;"><b>🗣️ Walk (${time}):</b> ${t}</div>`; saveData(); setTimeout(() => { if(isWalkSessionActive) walkRecognition.start(); }, 1500); }; walkRecognition.start(); }
function stopWalkSession() { isWalkSessionActive = false; document.getElementById('walk-mic-btn').classList.remove('active'); document.getElementById('walk-status').innerText = "Stop"; if(walkRecognition) walkRecognition.stop(); }

// --- UTILS, SETTINGS, STATS ---
window.changeMonth = (val) => { saveData(); currentMonthString = val; currentDay = "01"; loadMonthData(val); };
window.toggleSidebar = () => { document.getElementById('sidebar').classList.toggle('open'); document.getElementById('app-container').classList.toggle('sidebar-open'); };
window.saveApiKey = () => { const k = document.getElementById('gemini-api-key').value.trim(); if(k) { localStorage.setItem('GEMINI_API_KEY', k); alert("Saved!"); document.getElementById('settings-modal').classList.remove('open'); } };
window.generateAiSummary = async () => {
    const k=localStorage.getItem('GEMINI_API_KEY'); if(!k){alert("No Key");return;}
    const t=document.getElementById('editor').innerText; if(t.length<30){alert("Scrivi di più");return;}
    document.getElementById('summary-modal').classList.add('open');
    const c=document.getElementById('ai-summary-content'); c.innerHTML='Loading...';
    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${k}`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({contents:[{parts:[{text:`Analizza:\n${t}`}]}]})});
        const d = await res.json();
        c.innerHTML = marked.parse(d.candidates[0].content.parts[0].text);
    } catch(e){ c.innerHTML = "Error: "+e.message; }
};
window.format = (c) => { document.execCommand(c, false, null); document.getElementById('editor').focus(); };
window.triggerImageUpload = () => document.getElementById('img-input').click();
window.handleImageUpload = (i) => { const f = i.files[0]; if (!f) return; const r = new FileReader(); r.onload = (e) => { const im = new Image(); im.src = e.target.result; im.onload = () => { const c = document.createElement('canvas'); const x = c.getContext('2d'); const s = 600 / im.width; c.width = 600; c.height = im.height * s; x.drawImage(im, 0, 0, c.width, c.height); document.execCommand('insertHTML', false, `<img src="${c.toDataURL('image/jpeg', 0.7)}"><br>`); saveData(); }; }; r.readAsDataURL(f); };
window.toggleTheme = () => { document.body.classList.toggle('light-mode'); localStorage.setItem('theme', document.body.classList.contains('light-mode')?'light':'dark'); };
window.exportData = () => { const b = new Blob([JSON.stringify(currentMonthData)],{type:'application/json'}); const a = document.createElement('a'); a.href=URL.createObjectURL(b); a.download=`backup_${currentMonthString}.json`; a.click(); };
window.openSettings = () => document.getElementById('settings-modal').classList.add('open');
window.openStats = () => { document.getElementById('stats-modal').classList.add('open'); renderChart(); };
function renderChart() { const x = document.getElementById('chartCanvas').getContext('2d'); if(window.myChart) window.myChart.destroy(); window.myChart = new Chart(x, { type:'bar', data:{labels:['Oggi'], datasets:[{label:'Parole', data:[updateCounts()], backgroundColor:'#7c4dff'}]}, options:{plugins:{legend:{display:false}}, scales:{x:{display:false}, y:{grid:{color:'#333'}}}} }); }
function updateCounts() { if(currentDay==='ALL') return 0; const t = document.getElementById('editor').innerText; const w = t.trim() ? t.trim().split(/\s+/).length : 0; document.getElementById('count-today').innerText = w; return w; }
function loadGlobalStats() { onSnapshot(doc(db, "diario", currentUser.uid, "stats", "global"), (s) => { globalWordCount = s.exists() ? s.data().totalWords : 0; document.getElementById('count-global').innerText = globalWordCount; }); }
window.changeEditorFont = (v) => { document.documentElement.style.setProperty('--editor-font', v); localStorage.setItem('editorFont', v); };
window.changeEditorSize = (v) => { document.documentElement.style.setProperty('--editor-size', v); localStorage.setItem('editorSize', v); };
function loadSettings() { const f=localStorage.getItem('editorFont')||'system-ui'; const s=localStorage.getItem('editorSize')||'1.1rem'; document.documentElement.style.setProperty('--editor-font', f); document.documentElement.style.setProperty('--editor-size', s); if(document.getElementById('font-family-select'))document.getElementById('font-family-select').value=f; if(document.getElementById('font-size-select'))document.getElementById('font-size-select').value=s; }
window.forceAppRefresh = async () => { if(confirm("Reset cache?")) { const ks = await caches.keys(); for(const k of ks) await caches.delete(k); window.location.reload(true); }};
window.insertMood = (e) => { document.execCommand('insertText', false, ` ${e} `); saveData(); };