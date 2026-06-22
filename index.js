/**
 * ╔══════════════════════════════════════════════════════╗
 * ║                MINECRAFT AFK BOT — TUI               ║
 * ║   Logowanie Microsoft Premium, ruch na pozycję       ║
 * ║   Interaktywne menu tekstowe (TUI) w terminalu       ║
 * ╚══════════════════════════════════════════════════════╝
 *
 * Instalacja: npm install mineflayer mineflayer-pathfinder
 * Uruchomienie: node index.js
 */

const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const GoalXYZ = goals.GoalXYZ;
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Ukrywanie błędu "chunk size is X but only Y" z biblioteki prismarine-chunk
const originalConsoleWarn = console.warn;
console.warn = function(...args) {
  if (typeof args[0] === 'string' && args[0].toLowerCase().includes('chunk size is')) return;
  originalConsoleWarn.apply(console, args);
};
const originalConsoleError = console.error;
console.error = function(...args) {
  if (typeof args[0] === 'string' && args[0].toLowerCase().includes('chunk size is')) return;
  if (args[0] instanceof Error && args[0].message.toLowerCase().includes('chunk size is')) return;
  originalConsoleError.apply(console, args);
};
const originalConsoleLog = console.log;
console.log = function(...args) {
  if (typeof args[0] === 'string' && args[0].toLowerCase().includes('chunk size is')) return;
  originalConsoleLog.apply(console, args);
};

// ════════════════════════════════════════════════
//  KONFIGURACJA — PRZECHOWYWANA W CACHE
// ════════════════════════════════════════════════
const CACHE_DIR = path.join(__dirname, 'cache');
const CONFIG_FILE = path.join(CACHE_DIR, 'config.json');

// Domyślne wartości — CELOWO PUSTE, uzupełnia użytkownik przez TUI
const DEFAULT_CONFIG = {
  host:          '',          // IP serwera — wymagane
  port:          25565,       // port (domyślnie 25565)
  username:      '',          // nick bota (offline) LUB email Microsoft (premium) — wymagane
  version:       '1.21.4',   // wersja gry
  auth:          'offline',   // 'offline' = cracked | 'microsoft' = oryginalny (Premium)
  haslo:         '',          // hasło do /login lub /register (puste = pominie logowanie)

  // Pozycja, w której bot ma stać
  pozycja: {
    wlaczone: false,    // czy bot ma iść na pozycję docelową
    x: 0,
    y: 64,
    z: 0,
    yaw: 0,             // kierunek patrzenia w poziomie w stopniach
    pitch: 0            // kierunek patrzenia w pionie w stopniach
  },

  // Ochrona przed wyrzuceniem za AFK (Anti-AFK)
  antiAFK: {
    wlaczone: true,
    interwal: 20000     // co ile ms wykonywać mikro-ruch (co 20 sekund)
  },

  // Opóźnienia (ms)
  opoznienieLobby:   2000,
  opoznienieRuchu:   3000,
  opoznienieKlik:    700,
};

let CONFIG = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

// Upewnij się, że katalog cache/ istnieje
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Wczytanie konfiguracji z cache/config.json
if (fs.existsSync(CONFIG_FILE)) {
  try {
    const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    CONFIG = {
      ...DEFAULT_CONFIG,
      ...parsed,
      pozycja: { ...DEFAULT_CONFIG.pozycja, ...parsed.pozycja },
      antiAFK: { ...DEFAULT_CONFIG.antiAFK, ...parsed.antiAFK }
    };
  } catch (err) {
    console.error('Błąd podczas wczytywania cache/config.json, używam domyślnych wartości:', err.message);
  }
} else {
  zapiszConfig();
}

function zapiszConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(CONFIG, null, 2), 'utf-8');
  } catch (err) {
    console.error('Błąd zapisu config.json:', err.message);
  }
}

// ════════════════════════════════════════════════
//  INTERFEJS UŻYTKOWNIKA (TUI)
// ════════════════════════════════════════════════
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => rl.question(query, (ans) => {
    rl.close();
    resolve(ans.trim());
  }));
}

async function wyswietlTUI() {
  while (true) {
    console.clear();
    console.log('\x1b[36m══════════════════════════════════════════════════════════════\x1b[0m');
    console.log('\x1b[36m║                  MINECRAFT AFK BOT — TUI                   ║\x1b[0m');
    console.log('\x1b[36m══════════════════════════════════════════════════════════════\x1b[0m');
    console.log(`\x1b[1m1. 👉 URUCHOM BOTA\x1b[0m`);
    console.log(`2. Serwer:           \x1b[32m${CONFIG.host}:${CONFIG.port}\x1b[0m`);
    console.log(`3. Konto:            \x1b[32m${CONFIG.username}\x1b[0m (\x1b[35m${CONFIG.auth}\x1b[0m)`);
    console.log(`4. Hasło do loginu:  ${CONFIG.haslo ? '\x1b[32mUSTAWIONE\x1b[0m' : '\x1b[31mBRAK (logowanie pominięte)\x1b[0m'}`);
    console.log(`5. Pozycja AFK:      \x1b[33mX:${CONFIG.pozycja.x} Y:${CONFIG.pozycja.y} Z:${CONFIG.pozycja.z}\x1b[0m [Ruch: ${CONFIG.pozycja.wlaczone ? '\x1b[32mWŁĄCZONY\x1b[0m' : '\x1b[31mWYŁĄCZONY\x1b[0m'}]`);
    console.log(`6. System Anti-AFK:  ${CONFIG.antiAFK.wlaczone ? '\x1b[32mWŁĄCZONY\x1b[0m' : '\x1b[31mWYŁĄCZONY\x1b[0m'} (interwał: ${CONFIG.antiAFK.interwal}ms)`);
    console.log(`7. Wyjście`);
    console.log('\x1b[36m══════════════════════════════════════════════════════════════\x1b[0m');

    const wybor = await askQuestion('Wybierz opcję (1-7): ');

    if (wybor === '1') {
      // Walidacja — nie uruchamiamy bota bez wymaganych danych
      const brakHosta = !CONFIG.host.trim();
      const brakNicku = !CONFIG.username.trim();
      if (brakHosta || brakNicku) {
        console.log('');
        if (brakHosta) console.log('\x1b[31m⛔ Brak adresu serwera! Ustaw go w opcji 2.\x1b[0m');
        if (brakNicku) console.log('\x1b[31m⛔ Brak nicku / emaila konta! Ustaw go w opcji 3.\x1b[0m');
        await askQuestion('\nWciśnij Enter, aby wrócić do menu...');
        continue;
      }
      console.clear();
      console.log('\x1b[36m🚀 Uruchamianie połączenia z Minecraft...\x1b[0m');
      uruchomBota();
      break;
    } else if (wybor === '2') {
      const host = await askQuestion(`Podaj host serwera (obecny: ${CONFIG.host}): `);
      if (host) CONFIG.host = host;
      const portStr = await askQuestion(`Podaj port serwera (obecny: ${CONFIG.port}): `);
      if (portStr) {
        const port = parseInt(portStr);
        if (!isNaN(port)) CONFIG.port = port;
      }
      zapiszConfig();
    } else if (wybor === '3') {
      const username = await askQuestion(`Podaj nick bota lub email Microsoft (obecny: ${CONFIG.username}): `);
      if (username) CONFIG.username = username;

      console.log('\nWybierz typ autoryzacji:');
      console.log('1. offline (dla kont cracked/non-premium)');
      console.log('2. microsoft (dla kont premium)');
      const authWybor = await askQuestion('Wybierz (1 lub 2): ');
      if (authWybor === '1') CONFIG.auth = 'offline';
      else if (authWybor === '2') CONFIG.auth = 'microsoft';
      zapiszConfig();
    } else if (wybor === '4') {
      console.log('\nWpisz hasło do automatycznego logowania (/login, /register).');
      console.log('Zostaw puste pole i wciśnij Enter, aby całkowicie pominąć automatyczne logowanie czatem.');
      const haslo = await askQuestion('Podaj hasło: ');
      CONFIG.haslo = haslo ? haslo : '';
      zapiszConfig();
    } else if (wybor === '5') {
      console.log('\nCzy ruch do wyznaczonej pozycji ma być włączony?');
      console.log('1. Tak (bot użyje pathfindera, aby pójść na koordynaty)');
      console.log('2. Nie (bot będzie stał w miejscu, w którym się zespawnuje)');
      const ruchWybor = await askQuestion('Wybierz (1 lub 2): ');
      if (ruchWybor === '1') CONFIG.pozycja.wlaczone = true;
      else if (ruchWybor === '2') CONFIG.pozycja.wlaczone = false;

      if (CONFIG.pozycja.wlaczone) {
        const xStr = await askQuestion(`Podaj koordynat X (obecny: ${CONFIG.pozycja.x}): `);
        if (xStr && !isNaN(parseFloat(xStr))) CONFIG.pozycja.x = parseFloat(xStr);

        const yStr = await askQuestion(`Podaj koordynat Y (obecny: ${CONFIG.pozycja.y}): `);
        if (yStr && !isNaN(parseFloat(yStr))) CONFIG.pozycja.y = parseFloat(yStr);

        const zStr = await askQuestion(`Podaj koordynat Z (obecny: ${CONFIG.pozycja.z}): `);
        if (zStr && !isNaN(parseFloat(zStr))) CONFIG.pozycja.z = parseFloat(zStr);

        const yawStr = await askQuestion(`Podaj kąt obrotu Yaw w stopniach (obecny: ${CONFIG.pozycja.yaw}): `);
        if (yawStr && !isNaN(parseFloat(yawStr))) CONFIG.pozycja.yaw = parseFloat(yawStr);

        const pitchStr = await askQuestion(`Podaj kąt obrotu Pitch w stopniach (obecny: ${CONFIG.pozycja.pitch}): `);
        if (pitchStr && !isNaN(parseFloat(pitchStr))) CONFIG.pozycja.pitch = parseFloat(pitchStr);
      }
      zapiszConfig();
    } else if (wybor === '6') {
      console.log('\nCzy system Anti-AFK (delikatne ruchy głową) ma być aktywny?');
      console.log('1. Tak');
      console.log('2. Nie');
      const afkWybor = await askQuestion('Wybierz (1 lub 2): ');
      if (afkWybor === '1') CONFIG.antiAFK.wlaczone = true;
      else if (afkWybor === '2') CONFIG.antiAFK.wlaczone = false;

      const intStr = await askQuestion(`Podaj odstęp między ruchami w ms (obecny: ${CONFIG.antiAFK.interwal}): `);
      if (intStr && !isNaN(parseInt(intStr))) CONFIG.antiAFK.interwal = parseInt(intStr);
      zapiszConfig();
    } else if (wybor === '7') {
      console.log('Wyłączanie...');
      process.exit(0);
    }
  }
}

// ════════════════════════════════════════════════
//  STAN BOTA I ZMIENNE GLOBALNE
// ════════════════════════════════════════════════
const stan = {
  faza: 'LOBBY',          // LOBBY → WYBOR_TRYBU → PRZEJSCIE → SERWER
  czyZalogowany: false,
  czyByloLobby: false,
  czyNaSerwerzeDocelowym: false,
  naMiejscu: false,
};

let bot = null;
let antiAFKInterval = null;
let reconnectTimeout = null;

const PAKIETY_BLOKOWANE_TRANSFER = new Set([
  'position', 'position_look', 'look', 'flying',
  'window_close', 'window_click', 'held_item_slot',
  'arm_animation', 'entity_action', 'vehicle_move',
]);

// ════════════════════════════════════════════════
//  FUNKCJE POMOCNICZE
// ════════════════════════════════════════════════
function usunKolory(tekst) {
  if (!tekst) return '';
  let czystyTekst = tekst;
  if (typeof tekst === 'object') {
    try {
      czystyTekst = extractChatText(tekst) || JSON.stringify(tekst);
    } catch {
      czystyTekst = String(tekst);
    }
  } else {
    czystyTekst = String(tekst);
  }
  return czystyTekst.replace(/§[0-9a-fk-orA-FK-OR]/g, '').trim();
}

function extractChatText(obj) {
  if (!obj) return '';
  if (typeof obj === 'string') return obj;
  if (typeof obj === 'number') return String(obj);
  if (Array.isArray(obj)) return obj.map(extractChatText).join('');
  let res = '';
  if (obj.text !== undefined) res += obj.text;
  if (obj.translate !== undefined) res += obj.translate;
  if (Array.isArray(obj.extra)) res += obj.extra.map(extractChatText).join('');
  return res;
}

// ════════════════════════════════════════════════
//  AUTOMATYCZNE PONOWNE POŁĄCZENIE (RECONNECT)
// ════════════════════════════════════════════════
function scheduleReconnect() {
  wyczyscAntiAFK();
  if (reconnectTimeout) return;

  console.log('\x1b[33m🔄 Zaplanowano próbę ponownego połączenia za 15 sekund...\x1b[0m');
  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null;
    console.log('\x1b[36m🔄 Ponowne łączenie...\x1b[0m');
    
    // Zresetowanie stanu bota
    stan.faza = 'LOBBY';
    stan.czyZalogowany = false;
    stan.czyByloLobby = false;
    stan.czyNaSerwerzeDocelowym = false;
    stan.naMiejscu = false;
    
    uruchomBota();
  }, 15000);
}

// ════════════════════════════════════════════════
//  URUCHOMIENIE BOTA MINECRAFT
// ════════════════════════════════════════════════
function uruchomBota() {
  // Wyczyszczenie starego bota oraz jego listenerów, aby uniknąć przecieków
  if (bot) {
    try {
      bot.removeAllListeners();
      bot.quit();
    } catch (e) {}
    bot = null;
  }
  wyczyscAntiAFK();

  bot = mineflayer.createBot({
    host:           CONFIG.host,
    port:           CONFIG.port,
    username:       CONFIG.username,
    version:        CONFIG.version,
    auth:           CONFIG.auth,
    profilesFolder: path.join(CACHE_DIR, 'nmp-cache'), // cache sesji Microsoft (przechowywane w cache/)
  });

  // Rejestracja obsługi błędów i rozłączeń NATYCHMIAST
  bot.on('error', (err) => {
    console.error('❌ Błąd połączenia bota:', err.message);
    scheduleReconnect();
  });

  bot.on('kicked', (reason) => {
    console.log('⚠️ Wyrzucono bota z serwera:', usunKolory(reason));
    scheduleReconnect();
  });

  bot.on('end', () => {
    console.log('⚠️ Połączenie z serwerem zakończone.');
    scheduleReconnect();
  });

  bot.loadPlugin(pathfinder);

  // Blokada pakietów PLAY podczas transferu BungeeCord (zapobiega DecoderException / kick)
  if (bot._client) {
    const oldWrite = bot._client.write.bind(bot._client);
    bot._client.write = (name, params) => {
      if (stan.faza === 'PRZEJSCIE' && PAKIETY_BLOKOWANE_TRANSFER.has(name)) {
        return;
      }
      oldWrite(name, params);
    };

    // Obsługa resource packów podczas transferu
    bot._client.on('add_resource_pack', (data) => {
      if (stan.faza !== 'PRZEJSCIE') return;
      console.log('📦 Akceptuję resource pack serwera...');
      oldWrite('resource_pack_receive', { uuid: data.uuid, result: 3 });
      oldWrite('resource_pack_receive', { uuid: data.uuid, result: 0 });
    });

    // Reakcja na zakończenie konfiguracji po transferze
    bot._client.on('finish_configuration', () => {
      if (stan.faza === 'PRZEJSCIE') {
        setTimeout(() => poWejsciuNaSerwerDocelowy(), 1500);
      }
    });
  } else {
    console.warn('⚠️ Brak obiektu bot._client. Optymalizacja BungeeCord wyłączona.');
  }

  // Obsługa zdarzeń gry
  bot.on('death', () => {
    console.log('💀 Bot zginął! Respawnuję się i próbuję wrócić na miejsce...');
    wyczyscAntiAFK();
    stan.czyNaSerwerzeDocelowym = false;
    stan.naMiejscu = false;
    stan.faza = 'PRZEJSCIE';
    
    setTimeout(() => {
      try {
        bot.respawn();
      } catch (err) {
        console.error('❌ Błąd podczas respawnu:', err.message);
      }
    }, 2000);
  });

  bot.on('spawn', () => {
    if (!stan.czyByloLobby) {
      stan.czyByloLobby = true;
      stan.faza = 'LOBBY';

      if (CONFIG.auth === 'microsoft') {
        console.log('🌐 Zalogowano przez Microsoft (Premium). Przechodzę na serwer docelowy...');
        stan.czyZalogowany = true;
        setTimeout(() => {
          wejdzNaSerwer();
        }, CONFIG.opoznienieLobby);
        return;
      }

      console.log('🌐 Połączono z lobby — oczekuję na komendę logowania...');
      
      // Jeżeli hasło jest puste, natychmiast uznajemy logowanie za pominięte
      if (!CONFIG.haslo) {
        console.log('⏳ Brak skonfigurowanego hasła w TUI. Pomijam wpisywanie loginu.');
        stan.czyZalogowany = true;
        setTimeout(() => {
          wejdzNaSerwer();
        }, CONFIG.opoznienieLobby);
        return;
      }

      // W przeciwnym razie czekamy 6 sekund na ewentualne autologowanie, jeśli nie nastąpi wcześniej
      setTimeout(() => {
        if (!stan.czyZalogowany) {
          console.log('⏳ Brak prośby o logowanie. Zakładam aktywną sesję.');
          stan.czyZalogowany = true;
          wejdzNaSerwer();
        }
      }, 6000);

      return;
    }

    if (stan.faza === 'PRZEJSCIE') {
      setTimeout(() => poWejsciuNaSerwerDocelowy(), 1500);
    }
  });

  bot.on('message', (msg) => {
    const tekst = msg.toString();
    const lower  = tekst.toLowerCase();
    console.log('[CHAT]', tekst);

    // Jeśli hasło jest puste w konfiguracji, nie reagujemy na zapytania o login/register
    if (!CONFIG.haslo) return;

    // ── Rejestracja ──
    if (lower.includes('/register') || lower.includes('zarejestruj')) {
      console.log('📝 Wykryto prośbę o rejestrację. Rejestruję konto...');
      setTimeout(() => bot.chat(`/register ${CONFIG.haslo} ${CONFIG.haslo}`), 600);
      return;
    }

    // ── Logowanie ──
    if ((lower.includes('/login') || lower.includes('zaloguj')) && !stan.czyZalogowany) {
      console.log('🔑 Wykryto prośbę o logowanie. Loguję się...');
      setTimeout(() => bot.chat(`/login ${CONFIG.haslo}`), 600);
      return;
    }

    // ── Potwierdzenie zalogowania ──
    const potwierdzenia = ['zalogowano', 'zalogowałeś', 'pomyślnie', 'logged in', 'witaj', 'welcome', 'poprawnie', 'successfully'];
    if (!stan.czyZalogowany && potwierdzenia.some(p => lower.includes(p))) {
      stan.czyZalogowany = true;
      console.log(`✅ Zalogowano! Przechodzę na serwer za ${CONFIG.opoznienieLobby / 1000}s...`);
      setTimeout(() => {
        wejdzNaSerwer();
      }, CONFIG.opoznienieLobby);
    }
  });

  bot.on('windowOpen', (window) => {
    const tytul = usunKolory(window.title ?? '').toUpperCase();
    console.log(`\n📦 Otwarto okno: "${tytul}" (faza: ${stan.faza})`);

    setTimeout(() => {
      if (stan.faza === 'WYBOR_TRYBU') {
        const cel = window.slots[13];
        console.log(`🎮 Wybieram tryb Survival (slot 14, indeks 13). Item: ${cel ? cel.name : 'BRAK'}`);

        bot.clickWindow(13, 0, 0).catch(() => {
          console.log('ℹ️ Klik przerwany przez transfer (oczekiwane).');
        });
        console.log('✅ Wysłano klik — rozpoczynam transfer...');
        rozpocznijTransfer();
      }
    }, CONFIG.opoznienieKlik);
  });

  // Obsługa pathfindera wewnątrz uruchomBota
  bot.on('goal_reached', () => {
    console.log('🎯 Osiągnięto cel! Bot stoi na wyznaczonym miejscu.');
    stan.naMiejscu = true;
    
    if (CONFIG.pozycja.yaw !== undefined && CONFIG.pozycja.pitch !== undefined) {
      const yawRad = CONFIG.pozycja.yaw * Math.PI / 180;
      const pitchRad = CONFIG.pozycja.pitch * Math.PI / 180;
      bot.look(yawRad, pitchRad, true);
    }
    
    rozpocznijAntiAFK();
  });

  bot.on('path_update', (results) => {
    if (results.status === 'noPath') {
      console.log('⚠️ Pathfinder nie znalazł ścieżki do celu! Sprawdź przeszkody lub czy koordynaty są poprawne.');
    }
  });
}

function wejdzNaSerwer() {
  if (stan.faza === 'WYBOR_TRYBU' || stan.faza === 'PRZEJSCIE' || stan.czyNaSerwerzeDocelowym) return;

  console.log('🧭 Używam przedmiotu na 5 slotcie paska by otworzyć menu wyboru trybu...');
  stan.faza = 'WYBOR_TRYBU';

  setTimeout(() => {
    try {
      if (bot) {
        bot.setQuickBarSlot(4);
        bot.activateItem();
        console.log('✅ Użyto przedmiotu z paska!');
      }
    } catch (err) {
      console.error('❌ Błąd podczas używania przedmiotu z paska:', err.message);
    }
  }, 2000);
}

function rozpocznijTransfer() {
  stan.faza = 'PRZEJSCIE';
  if (bot) {
    bot.physicsEnabled = false;
  }
  console.log('🔄 Transfer na serwer docelowy — wstrzymuję fizykę i pakiety ruchu...');

  clearTimeout(stan.transferTimeout);
  stan.transferTimeout = setTimeout(() => {
    if (stan.faza === 'PRZEJSCIE') {
      console.log('⏰ Timeout transferu — próbuję kontynuować...');
      poWejsciuNaSerwerDocelowy();
    }
  }, 30000);
}

function poWejsciuNaSerwerDocelowy() {
  if (stan.czyNaSerwerzeDocelowym) return;
  stan.czyNaSerwerzeDocelowym = true;
  stan.faza = 'SERWER';
  if (bot) {
    bot.physicsEnabled = true;
  }
  clearTimeout(stan.transferTimeout);

  console.log(`✅ Jestem na serwerze docelowym!`);
  
  if (CONFIG.pozycja.wlaczone) {
    console.log(`🧭 Przygotowuję ruch do wyznaczonego miejsca za ${CONFIG.opoznienieRuchu / 1000}s...`);
    setTimeout(() => {
      startNavigation();
    }, CONFIG.opoznienieRuchu);
  } else {
    console.log('ℹ️ Ruch wyłączony w konfiguracji. Stoję w miejscu spawnu.');
    rozpocznijAntiAFK();
  }
}

// ════════════════════════════════════════════════
//  LOGIKA PATHFINDERA (RUCHU)
// ════════════════════════════════════════════════
function startNavigation() {
  if (!bot) return;
  try {
    const mcData = bot.registry || require('minecraft-data')(bot.version);
    const movements = new Movements(bot, mcData);
    
    movements.canDig = false; // Nie niszczymy mapy
    
    bot.pathfinder.setMovements(movements);

    const goal = new GoalXYZ(CONFIG.pozycja.x, CONFIG.pozycja.y, CONFIG.pozycja.z);
    console.log(`🏃 Rozpoczynam drogę do celu: X:${CONFIG.pozycja.x}, Y:${CONFIG.pozycja.y}, Z:${CONFIG.pozycja.z}`);
    
    bot.pathfinder.setGoal(goal);
  } catch (err) {
    console.error('❌ Błąd konfiguracji pathfindera:', err.message);
    console.log('⚠️ Próbuję stać w miejscu ze względu na błąd pathfindera.');
    rozpocznijAntiAFK();
  }
}

// ════════════════════════════════════════════════
//  ANTI-AFK SYSTEM
// ════════════════════════════════════════════════
function rozpocznijAntiAFK() {
  if (!CONFIG.antiAFK.wlaczone) return;
  if (antiAFKInterval) return;

  console.log('🔄 Uruchamiam system anty-AFK (delikatne ruchy głową)...');
  let lookLeft = true;
  
  antiAFKInterval = setInterval(() => {
    if (!bot || !bot.entity) return;
    
    let baseYaw = CONFIG.pozycja.yaw !== undefined ? CONFIG.pozycja.yaw * Math.PI / 180 : bot.entity.yaw;
    let basePitch = CONFIG.pozycja.pitch !== undefined ? CONFIG.pozycja.pitch * Math.PI / 180 : bot.entity.pitch;
    
    const diff = lookLeft ? 0.05 : -0.05;
    lookLeft = !lookLeft;
    
    bot.look(baseYaw + diff, basePitch, true);
  }, CONFIG.antiAFK.interwal);
}

function wyczyscAntiAFK() {
  if (antiAFKInterval) {
    clearInterval(antiAFKInterval);
    antiAFKInterval = null;
    console.log('🛑 Zatrzymano system anty-AFK.');
  }
}

// ════════════════════════════════════════════════
//  START TUI NA STARCIE APLIKACJI
// ════════════════════════════════════════════════
wyswietlTUI();
