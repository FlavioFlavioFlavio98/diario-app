import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, collection, query, where, getDocs, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { GoogleGenAI } from "https://cdn.jsdelivr.net/npm/@google/genai@1.33.0/dist/web/index.mjs";

let aiInstance = null;

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

// DEFAULT PROMPTS (Ora come oggetti con ID univoco e contatore)
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

// Funzione helper per creare oggetti prompt
function createPromptObj(text) {
    return { id: Date.now() + Math.random(), text: text, usage: 0 };
}

// VARIABILI GLOBALI
let currentUser = null;
// MODIFICA CRITICA: Uso formato MESE (YYYY-MM) invece di Giorno
let currentDateString = new Date().toISOString().slice(0, 7); 
let currentDayStats = {};
let questionHistory = {}; 
let currentTags = [];
let globalWordCount = 0; 
let sessionStartTime = Date.now();
let currentPrompts = [];
// Flag per evitare timestamp duplicati durante la sessione
let isSessionInitialized = false; 

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
            initializeAi(savedKey); 
        }

        loadGlobalStats(); 
        await loadDiaryForDate(currentDateString);
        
        // Carica le domande del Coach
        loadCoachPrompts();
    }
});

// --- COACH MANAGER LOGIC ---

async function loadCoachPrompts() {
    if (!currentUser) return;
    try {
        const docRef = doc(db, "diario", currentUser.uid, "settings", "coach");
        const snap = await getDoc(docRef);
        
        if (snap.exists() && snap.data().prompts && snap.data().prompts.length > 0) {
            let loaded = snap.data().prompts;
            // MIGRAZIONE DATI: Se sono stringhe vecchie, convertile in oggetti
            if (typeof loaded[0] === 'string') {
                currentPrompts = loaded.map(txt => createPromptObj(txt));
                savePromptsToDb(); // Salva subito la conversione
            } else {
                currentPrompts = loaded;
            }
        } else {
            // Default iniziali
            currentPrompts = defaultPromptsText.map(txt => createPromptObj(txt));
            await setDoc(docRef, { prompts: currentPrompts }, { merge: true });
        }
    } catch (e) {
        console.error("Errore caricamento prompts:", e);
        // Fallback sicuro
        currentPrompts = defaultPromptsText.map(txt => createPromptObj(txt));
    }
}

async function savePromptsToDb() {
    if (!currentUser) return;
    try {
        await setDoc(doc(db, "diario", currentUser.uid, "settings", "coach"), { 
            prompts: currentPrompts 
        }, { merge: true });
        renderCoachList(); 
    } catch (e) {
        alert("Errore salvataggio modifiche Coach: " + e.message);
    }
}

window.openCoachManager = () => {
    document.getElementById('coach-manager-modal').classList.add('open');
    renderCoachList();
};

function renderCoachList() {
    const listContainer = document.getElementById('coach-list-container');
    listContainer.innerHTML = '';
    
    // ORDINAMENTO: Decrescente per utilizzo (usage)
    const sortedPrompts = [...currentPrompts].sort((a, b) => (b.usage || 0) - (a.usage || 0));
    
    sortedPrompts.forEach((promptObj) => {
        // Troviamo l'indice originale per edit/delete
        const realIndex = currentPrompts.findIndex(p => p.id === promptObj.id);
        
        const div = document.createElement('div');
        div.className = 'coach-item';
        div.innerHTML = `
            <div class="coach-text">${promptObj.text}</div>
            <div class="coach-meta">Usata: ${promptObj.usage || 0}</div>
            <div class="coach-btn-group">
                <button class="coach-action-btn" onclick="editCoachPrompt(${realIndex})" title="Modifica">✏️</button>
                <button class="coach-action-btn coach-delete" onclick="deleteCoachPrompt(${realIndex})" title="Elimina">🗑️</button>
            </div>
        `;
        listContainer.appendChild(div);
    });
}

window.addCoachPrompt = () => {
    const input = document.getElementById('new-prompt-input');
    const text = input.value.trim();
    if (!text) return;
    
    currentPrompts.unshift(createPromptObj(text)); 
    input.value = '';
    savePromptsToDb();
};

window.deleteCoachPrompt = (index) => {
    if (confirm("Vuoi davvero eliminare questa domanda?")) {
        currentPrompts.splice(index, 1);
        savePromptsToDb();
    }
};

window.editCoachPrompt = (index) => {
    const newText = prompt("Modifica la domanda:", currentPrompts[index].text);
    if (newText !== null && newText.trim() !== "") {
        currentPrompts[index].text = newText.trim();
        savePromptsToDb();
    }
};

// --- BRAINSTORMING & INSERIMENTO DOMANDE ---

window.triggerBrainstorm = () => { 
    if (currentPrompts.length === 0) {
        alert("Nessuna domanda disponibile. Aggiungine una!");
        return;
    }
    // Pesca casualmente, ma potremmo anche pescare tra le meno usate se volessimo variare
    const randIndex = Math.floor(Math.random() * currentPrompts.length);
    const pObj = currentPrompts[randIndex];
    
    document.getElementById('ai-title').innerText = "Coach";
    document.getElementById('ai-message').innerText = pObj.text;
    
    // Passiamo l'ID del prompt per incrementare il contatore
    document.getElementById('ai-actions').innerHTML = `<button class="ai-btn-small" onclick="insertPrompt('${pObj.id}')">Inserisci</button>`;
    document.getElementById('ai-coach-area').style.display = 'block';
};

window.insertPrompt = (promptId) => {
    // 1. Trova domanda e incrementa contatore
    // promptId viene passato come stringa, convertiamo se necessario, ma gli ID creati con Date.now() sono numeri
    // Se passato via HTML attribute, è stringa.
    const pIndex = currentPrompts.findIndex(p => p.id == promptId);
    
    let textToInsert = "Domanda...";
    if (pIndex > -1) {
        currentPrompts[pIndex].usage = (currentPrompts[pIndex].usage || 0) + 1;
        textToInsert = currentPrompts[pIndex].text;
        savePromptsToDb(); // Salva incremento
    }

    document.getElementById('editor').focus();
    
    // 2. Inserimento HTML Stilizzato (Rosso)
    const html = `<br><p style="color: #ff5252; font-weight: bold; margin-bottom: 5px;">Domanda: ${textToInsert}</p><p>Risposta: </p>`;
    document.execCommand('insertHTML', false, html);
    
    document.getElementById('ai-coach-area').style.display = 'none';
    saveData();
};

// --- LOGICA SESSIONE & TIMESTAMP ---

// Funzione per inserire il Timestamp all'avvio
function appendSessionTimestamp() {
    if (isSessionInitialized) return; // Fallo solo una volta per sessione/caricamento
    
    const now = new Date();
    const dateStr = now.toLocaleDateString('it-IT');
    const timeStr = now.toLocaleTimeString('it-IT', {hour: '2-digit', minute:'2-digit'});
    
    const timestampHtml = `<br><div class="session-timestamp">📅 ${dateStr} - ${timeStr}</div><br>`;
    
    const editor = document.getElementById('editor');
    
    // Controllo per non aggiungerlo se il file è vuoto (opzionale, ma meglio metterlo)
    // O se l'ultima cosa scritta è già un timestamp (per evitare refresh multipli)
    if (!editor.innerHTML.includes(timestampHtml.trim())) {
         // Usiamo una selezione range per appendere alla fine in modo sicuro o innerHTML
         editor.innerHTML += timestampHtml;
         // Salviamo subito per persistere il timestamp
         saveData();
    }
    
    isSessionInitialized = true;
}

// --- CORE FUNCTIONS ---

window.changeDate = (newDate) => { 
    // newDate sarà YYYY-MM
    currentDateString = newDate; 
    isSessionInitialized = false; // Reset flag cambio data
    loadDiaryForDate(newDate); 
};

async function loadDiaryForDate(dateStr) {
    document.getElementById('db-status').innerText = "Loading...";
    document.getElementById('editor').innerHTML = ""; 
    
    // NOTA: dateStr ora è YYYY-MM
    const docRef = doc(db, "diario", currentUser.uid, "entries", dateStr);
    
    // Usiamo onSnapshot per real-time updates
    onSnapshot(docRef, (snap) => {
        if (snap.exists()) {
            const data = snap.data();
            
            // Aggiorniamo l'editor solo se non stiamo scrivendo attivamente per evitare conflitti cursore
            // Ma al primo caricamento dobbiamo farlo.
            if (document.activeElement.id !== 'editor') { 
                document.getElementById('editor').innerHTML = data.htmlContent || ""; 
            }
            
            // Qui proviamo ad appendere il timestamp SE è il caricamento iniziale
            if (!isSessionInitialized) {
                // Piccolo timeout per assicurarsi che l'HTML sia renderizzato
                setTimeout(() => appendSessionTimestamp(), 500);
            }

            currentDayStats = data.stats || {};
            currentTags = data.tags || [];
            
            const words = updateCounts();
            updateMetrics(data.htmlContent || "", words);
            
            document.getElementById('db-status').innerText = "Sync OK";
            document.getElementById('db-status').style.color = "#00e676";
        } else {
            // Nuovo Mese
            document.getElementById('editor').innerHTML = ""; 
            updateMetrics("", 0);
            document.getElementById('db-status').innerText = "New Month";
            document.getElementById('db-status').style.color = "#aaa";
            
            // Anche se è nuovo, mettiamo il timestamp
            if (!isSessionInitialized) {
                 setTimeout(() => appendSessionTimestamp(), 500);
            }
        }
    });
}

async function saveData() {
    if (!currentUser) return;
    const statusLabel = document.getElementById('db-status');
    statusLabel.innerText = "Saving...";
    statusLabel.style.color = "orange";

    try {
        const content = document.getElementById('editor').innerHTML;
        const wordsToday = updateCounts();
        const detectedTags = detectTagsInContent(document.getElementById('editor').innerText);

        // Calcolo Delta per Statistiche Globali
        const wordsBefore = currentDayStats.words || 0;
        const deltaWords = wordsToday - wordsBefore;

        const dataToSave = {
            htmlContent: content,
            stats: { words: wordsToday, mood: currentDayStats.mood || "" }, 
            tags: detectedTags,
            lastUpdate: new Date()
        };

        await setDoc(doc(db, "diario", currentUser.uid, "entries", currentDateString), dataToSave, { merge: true });

        if (deltaWords !== 0 || globalWordCount === 0) { 
            let newGlobalCount = globalWordCount + deltaWords;
            if (newGlobalCount < 0) newGlobalCount = 0; 
            
            await setDoc(doc(db, "diario", currentUser.uid, "stats", "global"), {
                totalWords: newGlobalCount,
                lastUpdate: new Date()
            }, { merge: true });
        }

        statusLabel.innerText = "Saved";
        statusLabel.style.color = "#00e676";
        updateMetrics(content, wordsToday);

    } catch (error) {
        console.error(error);
        statusLabel.innerText = "ERROR";
        statusLabel.style.color = "red";
    }
}

// --- UTILS, STATS & OTHERS ---
// Mantenute identiche, solo pulizia variabili non usate

function startSessionTimer() {
    sessionStartTime = Date.now();
    setInterval(() => {
        const diff = Math.floor((Date.now() - sessionStartTime) / 1000);
        const m = Math.floor(diff / 60).toString().padStart(2, '0');
        const s = (diff % 60).toString().padStart(2, '0');
        document.getElementById('session-timer').innerText = `${m}:${s}`;
    }, 1000);
}

function loadGlobalStats() {
    const docRef = doc(db, "diario", currentUser.uid, "stats", "global");
    onSnapshot(docRef, (snap) => {
        if (snap.exists()) { globalWordCount = snap.data().totalWords || 0; } 
        else { globalWordCount = 0; }
        document.getElementById('count-global').innerText = globalWordCount;
    });
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

function initializeAi(apiKey) { aiInstance = new GoogleGenAI({ apiKey: apiKey }); }

window.saveApiKey = () => {
    const key = document.getElementById('gemini-api-key').value.trim();
    if(key) { localStorage.setItem('GEMINI_API_KEY', key); initializeAi(key); alert("Chiave salvata!"); document.getElementById('settings-modal').classList.remove('open'); }
};

window.generateAiSummary = async () => {
    if (!aiInstance) { alert("Inserisci API Key nelle Impostazioni"); return; }
    const text = document.getElementById('editor').innerText.trim();
    if (text.length < 30) { alert("Scrivi di più!"); return; }
    document.getElementById('summary-modal').classList.add('open');
    const contentDiv = document.getElementById('ai-summary-content');
    contentDiv.innerHTML = '<div class="ai-loading">Analizzo... 🧠</div>';
    const prompt = `Analizza questo diario:\n"${text}"\n\n1. Riassunto.\n2. Insight Emotivo.\n3. Consiglio. Formatta la risposta in Markdown.`;
    try {
        const response = await aiInstance.models.generateContent({ model: 'gemini-pro', contents: prompt });
        contentDiv.innerHTML = marked.parse(response.text);
    } catch (error) { contentDiv.innerHTML = "Errore AI."; }
};

const tagRules = {
    'Relazioni': ['simona', 'nala', 'mamma', 'papà', 'amici', 'relazione'],
    'Salute': ['cibo', 'dieta', 'fumo', 'allenamento', 'sonno', 'salute'],
    'Lavoro': ['progetto', 'app', 'business', 'soldi', 'produttività'],
    'Mindset': ['gratitudine', 'ansia', 'felice', 'triste', 'paura']
};

function detectTagsInContent(text) {
    const lower = text.toLowerCase();
    const found = new Set();
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
    const resultsDiv = document.getElementById('tag-results');
    resultsDiv.innerHTML = "Cerco...";
    // Nota: La ricerca per tag ora cercherà nei documenti MENSILI.
    const q = query(collection(db, "diario", currentUser.uid, "entries"), where("tags", "array-contains", tagName));
    const querySnapshot = await getDocs(q);
    resultsDiv.innerHTML = '';
    if (querySnapshot.empty) { resultsDiv.innerHTML = "Nessun risultato."; return; }
    querySnapshot.forEach((doc) => {
        const d = doc.data();
        const div = document.createElement('div'); div.className = 'result-row';
        div.innerHTML = `<span>🗓️ ${doc.id}</span> <span>${d.stats?.words || 0} parole</span>`;
        div.onclick = () => { document.getElementById('tag-modal').classList.remove('open'); document.getElementById('date-picker').value = doc.id; changeDate(doc.id); };
        resultsDiv.appendChild(div);
    });
}

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
        saveData(); 
        setTimeout(() => { if(isWalkSessionActive) walkRecognition.start(); }, 1500);
    };
    walkRecognition.start();
}
function stopWalkSession() { isWalkSessionActive = false; document.getElementById('walk-mic-btn').classList.remove('active'); document.getElementById('walk-status').innerText = "Stop"; if(walkRecognition) walkRecognition.stop(); }

let timeout;
document.getElementById('editor').addEventListener('input', () => { updateCounts(); clearTimeout(timeout); timeout = setTimeout(saveData, 1500); });
document.getElementById('editor').addEventListener('paste', (e) => { e.preventDefault(); const text = (e.originalEvent || e).clipboardData.getData('text/plain'); document.execCommand('insertText', false, text); });

function updateCounts() {
    const text = document.getElementById('editor').innerText;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    updateMetrics(document.getElementById('editor').innerHTML, words);
    return words;
}

window.format = (cmd) => { document.execCommand(cmd, false, null); document.getElementById('editor').focus(); };
window.insertMood = (e) => { document.execCommand('insertText', false, ` ${e} `); currentDayStats.mood = e; saveData(); };
window.triggerImageUpload = () => document.getElementById('img-input').click();
window.handleImageUpload = (input) => { const file = input.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = (e) => { const img = new Image(); img.src = e.target.result; img.onload = () => { const c = document.createElement('canvas'); const ctx = c.getContext('2d'); const scale = 600 / img.width; c.width = 600; c.height = img.height * scale; ctx.drawImage(img, 0, 0, c.width, c.height); document.execCommand('insertHTML', false, `<img src="${c.toDataURL('image/jpeg', 0.7)}"><br>`); saveData(); }; }; reader.readAsDataURL(file); };

let recognition = null; if ('webkitSpeechRecognition' in window) { recognition = new webkitSpeechRecognition(); recognition.continuous = true; recognition.interimResults = true; recognition.lang = 'it-IT'; recognition.onstart = () => document.getElementById('mic-btn').classList.add('recording'); recognition.onend = () => document.getElementById('mic-btn').classList.remove('recording'); recognition.onresult = (e) => { let final = ''; for (let i = e.resultIndex; i < e.results.length; ++i) { if (e.results[i].isFinal) final += e.results[i][0].transcript; } if (final) { document.execCommand('insertText', false, final + " "); saveData(); } }; }
window.toggleDictation = () => { if(recognition) { document.getElementById('mic-btn').classList.contains('recording') ? recognition.stop() : recognition.start(); } else alert("No support"); };

window.openStats = () => { document.getElementById('stats-modal').classList.add('open'); renderChart(); };
window.openSettings = () => document.getElementById('settings-modal').classList.add('open');
window.toggleTheme = () => { document.body.classList.toggle('light-mode'); localStorage.setItem('theme', document.body.classList.contains('light-mode')?'light':'dark'); };
window.exportData = () => { const b = new Blob([document.getElementById('editor').innerHTML],{type:'text/html'}); const a = document.createElement('a'); a.href=URL.createObjectURL(b); a.download=`backup_${currentDateString}.html`; a.click(); };

function renderChart() { const ctx = document.getElementById('chartCanvas').getContext('2d'); if(window.myChart) window.myChart.destroy(); window.myChart = new Chart(ctx, { type:'bar', data:{labels:['Mese Corrente'], datasets:[{label:'Parole', data:[currentDayStats.words || 0], backgroundColor:'#7c4dff'}]}, options:{plugins:{legend:{display:false}}, scales:{x:{display:false}, y:{grid:{color:'#333'}}}} }); }