import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, collection, query, where, getDocs, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
// IMPORT SDK GENAI (aggiornata)
import { GoogleGenAI } from "https://cdn.jsdelivr.net/npm/@google/genai@1.33.0/dist/web/index.mjs";

// VARIABILE per l'istanza AI
let aiInstance = null;

// CONFIGURAZIONE FIREBASE
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

// VARIABILI GLOBALI
let currentUser = null;
let currentDateString = new Date().toISOString().split('T')[0];
let currentDayStats = {};
let questionHistory = {};
let questionPrefs = {};
let currentTags = [];
let globalWordCount = 0;
let sessionStartTime = Date.now();

// SERVICE WORKER & LOGIN
if ('serviceWorker' in navigator) { navigator.serviceWorker.register('sw.js'); }

// Esportiamo la funzione login globalmente per il pulsante HTML
window.login = () => signInWithPopup(auth, provider);

// GESTIONE STATO UTENTE
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app').style.display = 'flex';
        document.getElementById('user-pic').src = user.photoURL;
        document.getElementById('date-picker').value = currentDateString;

        const savedKey = localStorage.getItem('GEMINI_API_KEY');
        if (savedKey) {
            document.getElementById('gemini-api-key').value = savedKey;
            initializeAi(savedKey); // Inizializza l'AI al login
        }

        // Caricamento dati
        await loadGlobalStats();
        loadDiaryForDate(currentDateString);
        startSessionTimer();
    }
});

// --- DASHBOARD FUNCTIONS ---
function startSessionTimer() {
    sessionStartTime = Date.now();
    setInterval(() => {
        const diff = Math.floor((Date.now() - sessionStartTime) / 1000);
        const m = Math.floor(diff / 60).toString().padStart(2, '0');
        const s = (diff % 60).toString().padStart(2, '0');
        document.getElementById('session-timer').innerText = `${m}:${s}`;
    }, 1000);
}

async function loadGlobalStats() {
    try {
        const docRef = doc(db, "diario", currentUser.uid, "stats", "global");
        const snap = await getDoc(docRef);
        if (snap.exists()) {
            globalWordCount = snap.data().totalWords || 0;
        }
        document.getElementById('count-global').innerText = globalWordCount;
    } catch (e) { console.log("No global stats yet"); }
}

function updateMetrics(content, wordsToday) {
    document.getElementById('count-today').innerText = wordsToday;
    document.getElementById('stat-count-today').innerText = wordsToday;

    // Peso file (approx)
    const size = new Blob([content]).size;
    const kb = (size / 1024).toFixed(1);
    const weightEl = document.getElementById('file-weight');
    weightEl.innerText = `${kb} KB`;

    if (size > 800000) { weightEl.classList.add('metric-danger'); weightEl.innerText += " ⚠️"; }
    else { weightEl.classList.remove('metric-danger'); }
}

// --- GEMINI AI INTEGRATION ---

// Funzione di inizializzazione AI
function initializeAi(apiKey) {
    aiInstance = new GoogleGenAI({ apiKey: apiKey });
}

window.saveApiKey = () => {
    const key = document.getElementById('gemini-api-key').value.trim();
    if (key) {
        localStorage.setItem('GEMINI_API_KEY', key);
        initializeAi(key); // Inizializza l'AI dopo aver salvato
        alert("Chiave salvata e AI Service aggiornato!");
        document.getElementById('settings-modal').classList.remove('open');
    }
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
        const response = await aiInstance.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });

        const aiText = response.text;
        contentDiv.innerHTML = marked.parse(aiText);
    } catch (error) {
        console.error("Errore Gemini SDK:", error);

        // Mostra l'errore reale (fondamentale per capire se è MODELLO, PERMESSI, QUOTA, ecc.)
        const status = (error && (error.status || error.code)) ? (error.status || error.code) : "n/a";
        const message = (error && error.message) ? error.message : String(error);
        contentDiv.innerText = `Errore AI (status: ${status}).\n\n${message}`;
    }
};

// --- CORE FUNCTIONS ---
window.changeDate = (newDate) => { currentDateString = newDate; loadDiaryForDate(newDate); };

async function loadDiaryForDate(dateStr) {
    document.getElementById('db-status').innerText = "Loading.";
    document.getElementById('editor').innerHTML = "";
    const docRef = doc(db, "diario", currentUser.uid, "entries", dateStr);
    onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            document.getElementById('editor').innerHTML = data.content || "";
            currentDayStats = data.stats || {};
            currentTags = data.tags || [];
            questionHistory = data.questions || {};
            questionPrefs = data.prefs || {};
            updateCounts();
        } else {
            currentDayStats = { words: 0 };
            currentTags = [];
            questionHistory = {};
            questionPrefs = {};
        }
        document.getElementById('db-status').innerText = "Ready";
    });
}

async function saveData() {
    const statusLabel = document.getElementById('db-status');
    statusLabel.innerText = "Saving...";
    statusLabel.style.color = "#aaa";

    const content = document.getElementById('editor').innerHTML;
    const wordsToday = updateCounts();
    const prevWords = currentDayStats.words || 0;
    const deltaWords = wordsToday - prevWords;

    currentDayStats.words = wordsToday;
    currentDayStats.lastUpdate = new Date();

    const tags = detectTagsInContent(document.getElementById('editor').innerText);

    try {
        const docRef = doc(db, "diario", currentUser.uid, "entries", currentDateString);

        const dataToSave = {
            content: content,
            stats: currentDayStats,
            tags: tags,
            questions: questionHistory,
            prefs: questionPrefs,
        };

        await setDoc(docRef, dataToSave, { merge: true });

        if (deltaWords !== 0) {
            globalWordCount += deltaWords;
            if (globalWordCount < 0) globalWordCount = 0;
            document.getElementById('count-global').innerText = globalWordCount;
            await setDoc(doc(db, "diario", currentUser.uid, "stats", "global"), {
                totalWords: globalWordCount,
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
        alert("Errore Salvataggio: " + error.message);
    }
}

// --- UTILS & TAGS ---
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
    resultsDiv.innerHTML = "Cerco.";
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
    const selection = window.getSelection(); if (!selection.rangeCount) return;
    let block = selection.anchorNode;
    while (block && block.nodeName !== 'DIV') { block = block.parentNode; }
    if (!block) return;
    const text = block.innerText.trim();
    // Placeholder: logica originale
}

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
window.handleImageUpload = (input) => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.src = e.target.result;
        img.onload = () => {
            const c = document.createElement('canvas');
            const ctx = c.getContext('2d');
            const scale = 600 / img.width;
            c.width = 600;
            c.height = img.height * scale;
            ctx.drawImage(img, 0, 0, c.width, c.height);
            document.execCommand('insertHTML', false, `<img src="${c.toDataURL('image/jpeg', 0.7)}"><br>`);
            saveData();
        };
    };
    reader.readAsDataURL(file);
};

let recognition = null;
if ('webkitSpeechRecognition' in window) {
    recognition = new webkitSpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'it-IT';
    recognition.onstart = () => document.getElementById('mic-btn').classList.add('recording');
    recognition.onend = () => document.getElementById('mic-btn').classList.remove('recording');
    recognition.onresult = (e) => {
        let final = '';
        for (let i = e.resultIndex; i < e.results.length; ++i) {
            if (e.results[i].isFinal) final += e.results[i][0].transcript;
        }
        if (final) { document.execCommand('insertText', false, final + " "); saveData(); }
    };
}
window.toggleDictation = () => { if (recognition) { document.getElementById('mic-btn').classList.contains('recording') ? recognition.stop() : recognition.start(); } else alert("No support"); };

window.openStats = () => { document.getElementById('stats-modal').classList.add('open'); renderChart(); };
window.openSettings = () => document.getElementById('settings-modal').classList.add('open');
window.toggleTheme = () => { document.body.classList.toggle('light-mode'); localStorage.setItem('theme', document.body.classList.contains('light-mode') ? 'light' : 'dark'); };
window.exportData = () => {
    const b = new Blob([document.getElementById('editor').innerHTML], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = `diario-${currentDateString}.html`;
    a.click();
};

// Placeholder per grafico (logica originale)
function renderChart() {
    // ...
}

// Placeholder per domande (logica originale)
window.openQuestionsHistory = () => {
    document.getElementById('questions-modal').classList.add('open');
    // ...
};

// Placeholder per brainstorm (logica originale)
window.triggerBrainstorm = () => {
    alert("Funzione Brainstorm (placeholder).");
};

// Placeholder Walk & Talk (logica originale)
let walkRecognition = null;
window.openWalkTalk = () => document.getElementById('walk-talk-modal').classList.add('open');
window.closeWalkTalk = () => { document.getElementById('walk-talk-modal').classList.remove('open'); if (walkRecognition) walkRecognition.stop(); };
window.toggleWalkSession = () => alert("Walk & Talk (placeholder).");
