import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, collection, query, where, getDocs, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// --- CONFIGURAZIONE E VERSIONING ---
const APP_VERSION = "V18.0 DayByDay";
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

// --- STATO GLOBALE ---
let currentUser = null;
let currentDate = new Date(); // La data attiva
let isLocalChange = false; // Flag scrittura
let unsubscribeSnapshot = null; // Gestore listener database
let globalWordCount = 0;

// --- FEATURES VARS ---
let chatHistory = [];
let tripInterval = null, tripStartTime = null, tripStartWordCount = 0, isTripRunning = false, tripSeconds = 0;
let currentPrompts = [];
let collectedTasks = [];
let timeout;

// --- PROMPTS ---
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
function createPromptObj(t) { return { id: Date.now()+Math.random(), text: t, usage: 0 }; }

// --- INIT ---
if ('serviceWorker' in navigator) { navigator.serviceWorker.register('sw.js'); }

window.login = () => signInWithPopup(auth, provider);

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app').style.display = 'flex';
        document.getElementById('user-pic').src = user.photoURL;
        
        loadSettings();
        const savedKey = localStorage.getItem('GEMINI_API_KEY');
        if(savedKey) document.getElementById('gemini-api-key').value = savedKey;

        loadGlobalStats(); 
        loadCoachPrompts();
        
        // AVVIO: Carica il giorno corrente
        updateDateDisplay();
        loadDayData(getDateStringISO(currentDate));
    }
});

// --- HELPER DATE (FORMATO: YYYY-MM-DD) ---
// Questa funzione è fondamentale: crea l'ID univoco del file per ogni giorno
function getDateStringISO(dateObj) {
    const offset = dateObj.getTimezoneOffset();
    const localDate = new Date(dateObj.getTime() - (offset * 60 * 1000));
    return localDate.toISOString().slice(0, 10); // Restituisce "2025-12-22"
}

function updateDateDisplay() {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const dateStr = currentDate.toLocaleDateString('it-IT', options);
    document.getElementById('current-date-display').innerText = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
    document.getElementById('date-input-hidden').value = getDateStringISO(currentDate);
}

// --- NAVIGAZIONE GIORNALIERA ---

window.changeDay = async (offset) => {
    // 1. PRIMA DI TUTTO: Stacca il listener del DB vecchio per fermare aggiornamenti indesiderati
    if(unsubscribeSnapshot) { unsubscribeSnapshot(); unsubscribeSnapshot = null; }

    // 2. Salva forzatamente il giorno attuale prima di lasciarlo
    await saveData(true); 

    // 3. Pulisci editor visivamente (Feedback immediato per l'utente)
    document.getElementById('editor').innerHTML = ""; 
    document.getElementById('editor').contentEditable = "false"; // Blocca scrittura finché non carica

    // 4. Cambia Data
    currentDate.setDate(currentDate.getDate() + offset);
    updateDateDisplay();

    // 5. Carica il nuovo file
    loadDayData(getDateStringISO(currentDate));
};

window.triggerDatePicker = () => {
    document.getElementById('date-input-hidden').showPicker();
};

window.jumpToDate = async (val) => {
    if(!val) return;
    // Stacca listener precedente
    if(unsubscribeSnapshot) { unsubscribeSnapshot(); unsubscribeSnapshot = null; }
    
    // Salva corrente
    await saveData(true);
    
    // Pulisci e cambia
    document.getElementById('editor').innerHTML = "";
    currentDate = new Date(val);
    updateDateDisplay();
    
    // Carica nuovo
    loadDayData(getDateStringISO(currentDate));
};

// --- CARICAMENTO DATI (NUOVA LOGICA: 1 GIORNO = 1 FILE) ---
async function loadDayData(dateId) {
    document.getElementById('db-status').innerText = "Loading...";
    
    // Percorso: diario / UID / days / 2025-12-22
    // Ogni giorno è un documento separato. Impossibile confondersi.
    const docRef = doc(db, "diario", currentUser.uid, "days", dateId);
    
    // Ascolta in tempo reale SOLO questo giorno specifico
    unsubscribeSnapshot = onSnapshot(docRef, (snap) => {
        const isEditing = isLocalChange || (document.activeElement && document.activeElement.id === 'editor');
        
        // Se l'utente sta scrivendo, ignoriamo il server per evitare conflitti
        if(isEditing) return;

        if (snap.exists()) {
            const data = snap.data();
            document.getElementById('editor').innerHTML = data.content || "";
        } else {
            // Se il file non esiste, è un giorno nuovo vuoto
            document.getElementById('editor').innerHTML = "";
        }
        
        // Aggiorna conteggi e task DOPO aver caricato l'HTML
        updateCounts();
        collectedTasks = harvestTasks(); // Aggiorna la memoria dei task con quelli a schermo

        document.getElementById('editor').contentEditable = "true";
        document.getElementById('db-status').innerText = "Sync OK";
        document.getElementById('db-status').style.color = "#00e676";
    });
}

// --- SALVATAGGIO (NUOVA LOGICA: SALVA SU FILE UNICO) ---
async function saveData(force = false) {
    if (!currentUser) return;
    // Se l'editor è bloccato (es. vista mese), non salvare
    if(document.getElementById('editor').contentEditable === "false") return;
    
    const statusLabel = document.getElementById('db-status');
    statusLabel.innerText = "Saving..."; statusLabel.style.color = "orange";
    
    try {
        const dateId = getDateStringISO(currentDate);
        const content = document.getElementById('editor').innerHTML;
        const plainText = document.getElementById('editor').innerText;
        
        collectedTasks = harvestTasks();
        const detectedTags = detectTagsInContent(plainText);
        const wordCount = updateCounts();

        const dataToSave = {
            content: content,
            textPreview: plainText.substring(0, 150), // Per anteprime future
            tasks: collectedTasks,
            tags: detectedTags,
            words: wordCount,
            lastUpdate: new Date(),
            date: dateId // Utile per le query
        };

        // Salvataggio nel file del giorno specifico
        await setDoc(doc(db, "diario", currentUser.uid, "days", dateId), dataToSave, { merge: true });

        // Update Globali (totale parole approssimativo)
        setDoc(doc(db, "diario", currentUser.uid, "stats", "global"), { lastUpdate: new Date() }, { merge: true });

        statusLabel.innerText = "Saved"; statusLabel.style.color = "#00e676";
        
    } catch (error) {
        console.error("Errore Save:", error);
        statusLabel.innerText = "Err"; statusLabel.style.color = "red";
    }
}

// --- VISTA MENSILE (ZOOM OUT - RICOSTRUITA) ---
// Ora deve fare una query per prendere tutti i giorni del mese e unirli
window.enableMonthlyView = async () => {
    // 1. Salva corrente
    await saveData(true);
    
    // Stacca listener per evitare reload mentre guardiamo il mese
    if(unsubscribeSnapshot) { unsubscribeSnapshot(); unsubscribeSnapshot = null; }
    
    const editor = document.getElementById('editor');
    editor.innerHTML = "<div style='text-align:center; padding:20px;'>🔄 Caricamento mese in corso...</div>";
    
    const monthPrefix = getDateStringISO(currentDate).slice(0, 7); // "2025-12"
    
    // Query: Dammi tutti i documenti ID che stanno tra "2025-12-01" e "2025-12-31"
    const startId = monthPrefix + "-01";
    const endId = monthPrefix + "-31";
    
    const q = query(
        collection(db, "diario", currentUser.uid, "days"),
        where("__name__", ">=", startId),
        where("__name__", "<=", endId)
    );
    
    const querySnapshot = await getDocs(q);
    
    let fullHtml = `<h2 style="color:var(--accent); text-align:center;">Panoramica: ${monthPrefix}</h2><hr>`;
    
    if(querySnapshot.empty) {
        fullHtml += "<p style='text-align:center'>Nessun dato scritto in questo mese.</p>";
    } else {
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            if(data.content && data.content.trim()) {
                fullHtml += `<div style="margin-bottom:30px;">
                    <h3 style="background:var(--tag-bg); padding:5px 10px; border-radius:5px; border-left:4px solid var(--accent);">
                        📅 ${doc.id}
                    </h3>
                    <div style="padding:10px;">${data.content}</div>
                </div>`;
            }
        });
    }
    
    editor.innerHTML = fullHtml;
    editor.contentEditable = "false";
    document.getElementById('settings-modal').classList.remove('open');
};

// --- INPUT LISTENER (Anti-Conflitto) ---
document.getElementById('editor').addEventListener('input', (e) => {
    if(document.getElementById('editor').contentEditable === "false") return;
    
    isLocalChange = true;
    
    // Logica @now e @task (Copiata da V17)
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
    timeout = setTimeout(() => { saveData(); isLocalChange = false; }, 1500);
});

// Listener Checkbox
document.getElementById('editor').addEventListener('click', (e) => {
    if (e.target.classList.contains('smart-task') && document.getElementById('editor').contentEditable === "true") {
        if (e.target.hasAttribute('checked')) { e.target.removeAttribute('checked'); e.target.checked = false; } 
        else { e.target.setAttribute('checked', 'true'); e.target.checked = true; }
        saveData();
    }
});

// --- CHAT AI (Aggiornata per nuova struttura) ---
window.openAnalysisChat = async () => {
    let context = "";
    // Se siamo in "Zoom Out" (non editabile), prendiamo tutto il testo visualizzato
    if (document.getElementById('editor').contentEditable === "false") {
        context = `ANALISI MESE. Contenuto:\n${document.getElementById('editor').innerText}`;
    } else {
        context = `ANALISI GIORNO ${getDateStringISO(currentDate)}.\nContenuto:\n${document.getElementById('editor').innerText}`;
    }
    if(context.length<30){alert("Poco testo."); return;}
    document.getElementById('chat-modal').classList.add('open');
    document.getElementById('chat-history-container').innerHTML = '';
    chatHistory = [{role:"user", parts:[{text:`Agisci come coach. ${context}. Fai domande brevi.`}]}];
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
    if(document.getElementById('editor').contentEditable==="false"){alert("Apri un giorno specifico.");return;} 
    let htmlToAppend = "<br><hr><h3>AI Chat</h3>";
    for(let i=1;i<chatHistory.length;i++) htmlToAppend+=`<p><b>${chatHistory[i].role}:</b> ${chatHistory[i].parts[0].text}</p>`;
    document.execCommand('insertHTML',false,htmlToAppend);
    saveData();
    window.closeAnalysisChat();
};

// --- TASK SYSTEM ---
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

// --- COACH MANAGER ---
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

// --- TRIP MODE ---
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

// --- TAGS & SEARCH (Aggiornato per cercare nei 'days') ---
const tagRules = { 'Relazioni': ['simona', 'nala', 'mamma', 'papà', 'amici'], 'Salute': ['cibo', 'dieta', 'allenamento', 'sonno'], 'Lavoro': ['progetto', 'app', 'business', 'soldi'], 'Mindset': ['gratitudine', 'ansia', 'felice', 'triste'] };
function detectTagsInContent(text) { const lower = text.toLowerCase(); const found = new Set(); for (const [tag, keywords] of Object.entries(tagRules)) { if (keywords.some(k => lower.includes(k))) found.add(tag); } return Array.from(found); }
window.openTagExplorer = () => { document.getElementById('tag-modal').classList.add('open'); const c = document.getElementById('tag-cloud'); c.innerHTML = ''; Object.keys(tagRules).forEach(tag => { const b = document.createElement('span'); b.className = 'tag-chip'; b.innerText = tag; b.onclick = () => searchByTag(tag); c.appendChild(b); }); };
async function searchByTag(tag) { 
    const r = document.getElementById('tag-results'); r.innerHTML = "Cerco..."; 
    const q = query(collection(db, "diario", currentUser.uid, "days"), where("tags", "array-contains", tag)); 
    const s = await getDocs(q); r.innerHTML = ''; 
    if (s.empty) { r.innerHTML = "Nessun risultato."; return; } 
    s.forEach((doc) => { 
        const d = document.createElement('div'); d.className = 'result-row'; 
        d.innerHTML = `<span>🗓️ ${doc.id}</span>`; 
        d.onclick = () => { document.getElementById('tag-modal').classList.remove('open'); jumpToDate(doc.id); }; 
        r.appendChild(d); 
    }); 
}

// --- UTILITIES E SETTINGS ---
function updateCounts() { 
    if(document.getElementById('editor').contentEditable === "false") return 0;
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
    if (e.key === 'Enter') { /* Logica custom eventuale */ } 
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
window.toggleTheme = () => { document.body.classList.toggle('light-mode'); localStorage.setItem('theme', document.body.classList.contains('light-mode')?'light':'dark'); };
window.exportData = () => { 
    const data = document.getElementById('editor').innerHTML;
    const b = new Blob([data],{type:'text/html'}); 
    const a = document.createElement('a'); 
    a.href=URL.createObjectURL(b); 
    a.download=`backup_${getDateStringISO(currentDate)}.html`; 
    a.click(); 
};
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