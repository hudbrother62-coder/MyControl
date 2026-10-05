/**
 * ASISTEN HARIAN TELEGRAM
 * Database: Google Spreadsheet
 * Mode: polling setiap 1 menit, tanpa Web App dan tanpa Wablas.
 */

const CONFIG = {
  // Isi token dari @BotFather. Jangan kirim token ini ke chat.
  TELEGRAM_BOT_TOKEN: 'ISI_TOKEN_BOTFATHER',

  // Database yang sudah dibuat sebelumnya.
  SPREADSHEET_ID: '1zD-e8T9W55o7ntOm4sXdNlO7WwNFnqyQkZp4Iol6leE',

  // Ketikkan di Telegram: /start KODE_INI
  SETUP_CODE: 'MulaiAsistenHarian2026',

  GEMINI_API_KEY: 'ISI_API_KEY_GEMINI',
  // Model produksi Gemini API.
  GEMINI_MODEL: 'gemini-3.5-flash',
  TIME_ZONE: 'Asia/Jakarta'
};

const TAB = {
  DASHBOARD: 'Dashboard',
  TRANSAKSI: 'Transaksi',
  AGENDA: 'Agenda',
  TUGAS: 'Tugas',
  TAGIHAN: 'Tagihan',
  SALDO: 'Saldo Awal',
  LOG: 'Log Pesan',
  PENGATURAN: 'Pengaturan'
};

/** Jalankan SEKALI setelah token diisi. */
function setupTelegramBot() {
  saveConfig_();
  // Pastikan model ditemukan ulang setelah API key atau jalur koneksi diubah.
  PropertiesService.getScriptProperties().deleteProperty('GEMINI_ACTIVE_MODEL');
  PropertiesService.getScriptProperties().deleteProperty('GEMINI_MODEL_CHECKED_AT');
  setupSheets_();
  replaceTrigger_('pollTelegramUpdates', 1);
  replaceTrigger_('runAutomations', 5);
  refreshDashboard_();
  Logger.log('SETUP_SELESAI. Buka bot Telegram lalu ketik /start ' + CONFIG.SETUP_CODE);
}

/** Dipanggil otomatis setiap satu menit. Jangan dijalankan manual berulang-ulang. */
function pollTelegramUpdates() {
  // Mencegah trigger menit berikutnya membaca update yang sama ketika AI masih memproses.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
  const token = getConfig_('TELEGRAM_BOT_TOKEN');
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN belum diisi.');

  const props = PropertiesService.getScriptProperties();
  const offset = Number(props.getProperty('TELEGRAM_OFFSET') || 0);
  const response = telegramRequest_('getUpdates', { offset: offset, timeout: 0 });
  const updates = response.result || [];

  updates.forEach(function(update) {
    try {
      if (update.message && update.message.text && !(update.message.from && update.message.from.is_bot) && !hasProcessedUpdate_(update.update_id)) {
        // Mark first to avoid repeating financial mutations after an ambiguous reply failure.
        markUpdateProcessed_(update.update_id);
        try { handleTelegramMessage_(update.message); }
        catch (e) {
          const failed = JSON.parse(props.getProperty('TELEGRAM_UNKNOWN_UPDATES') || '[]');
          failed.push({update_id:update.update_id, error:String(e.message || e), recorded_at:new Date().toISOString()});
          props.setProperty('TELEGRAM_UNKNOWN_UPDATES', JSON.stringify(failed.slice(-100)));
          console.error('Telegram update requires manual reconciliation: ' + update.update_id);
        }
      }
      props.setProperty('TELEGRAM_OFFSET', String(update.update_id + 1));
    } catch (e) { console.error(String(e.message || e)); throw e; }
  });
  } finally {
    lock.releaseLock();
  }
}

function hasProcessedUpdate_(updateId) {
  const props = PropertiesService.getScriptProperties();
  const ids = JSON.parse(props.getProperty('TELEGRAM_PROCESSED_UPDATE_IDS') || '[]');
  return ids.indexOf(Number(updateId)) !== -1;
}

function markUpdateProcessed_(updateId) {
  const props = PropertiesService.getScriptProperties();
  let ids = JSON.parse(props.getProperty('TELEGRAM_PROCESSED_UPDATE_IDS') || '[]');
  ids.push(Number(updateId));
  ids = ids.slice(-100);
  props.setProperty('TELEGRAM_PROCESSED_UPDATE_IDS', JSON.stringify(ids));
}

/** Jalankan SEKALI untuk menghentikan semua trigger bot. Tidak menghapus data Spreadsheet. */
function hentikanBotDarurat() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (['pollTelegramUpdates', 'runAutomations'].indexOf(trigger.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  Logger.log('BOT_DISETOP. Trigger polling dan pengingat sudah dihapus.');
}

/**
 * Jalankan SEKALI setelah bot dihentikan untuk membuang pesan Telegram lama yang masih antre.
 * Ini TIDAK menghapus chat Telegram maupun transaksi Spreadsheet; hanya pesan yang belum diproses bot.
 */
function resetAntreanTelegram() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const props = PropertiesService.getScriptProperties();
    const response = telegramRequest_('getUpdates', { offset: -1, timeout: 0 });
    const updates = response.result || [];
    if (updates.length) {
      props.setProperty('TELEGRAM_OFFSET', String(updates[updates.length - 1].update_id + 1));
    }
    props.setProperty('TELEGRAM_PROCESSED_UPDATE_IDS', JSON.stringify(updates.map(function(update) { return Number(update.update_id); }).slice(-100)));
    Logger.log('ANTREAN_DIBERSIHKAN. Jumlah update terakhir yang dilewati: ' + updates.length);
  } finally {
    lock.releaseLock();
  }
}

function handleTelegramMessage_(message) {
  const chatId = String(message.chat.id);
  const userId = String(message.from.id);
  const text = String(message.text || '').trim();
  const adminChatId = getConfig_('ADMIN_CHAT_ID');

  // Aktivasi pertama mengunci bot hanya ke akun Telegram milik pengguna.
  if (!adminChatId) {
    if (text === '/start ' + getConfig_('SETUP_CODE')) {
      const props = PropertiesService.getScriptProperties();
      props.setProperty('ADMIN_CHAT_ID', chatId);
      props.setProperty('ADMIN_USER_ID', userId);
      telegramSend_(chatId, [
        'Asisten Harian aktif.',
        '',
        'Contoh chat:',
        '• Makan di luar hari ini 15k',
        '• Dikasih ibu 10 ribu',
        '• Uangku berapa?',
        '• Besok jam 9 meeting',
        '• Rencanakan besok'
      ].join('\n'));
      log_(userId, text, 'AKTIVASI', 'Bot dikunci ke akun Telegram ini', 'sent');
      return;
    }

    telegramSend_(chatId, 'Bot belum diaktifkan. Ketik /start diikuti kode setup.');
    return;
  }

  if (chatId !== adminChatId || userId !== getConfig_('ADMIN_USER_ID')) {
    telegramSend_(chatId, 'Bot ini adalah asisten pribadi dan tidak menerima akses dari akun lain.');
    log_(userId, text, 'DITOLAK', '', 'ignored');
    return;
  }

  const reply = processMessage_(text);
  telegramSend_(chatId, reply);
  log_(userId, text, 'ASISTEN_PRIBADI', reply, 'sent');
}

function processMessage_(message) {
  const lower = message.toLowerCase().trim();
  if (/^(\/start|bantuan|help|menu)$/i.test(lower)) return helpText_();
  if (/^(uangku berapa|saldo|cek saldo|sisa uang)$/i.test(lower)) return balanceReply_();
  if (/^(rekap hari ini|laporan hari ini)$/i.test(lower)) return dailyRecap_();
  if (/^(rekap bulan ini|laporan bulan ini|analisis pengeluaran bulan ini)$/i.test(lower)) return monthlyRecap_();
  if (/^(besok aku harus apa|rencanakan besok|planning besok|agenda besok)$/i.test(lower)) return planReply_(1);
  if (/^(agenda hari ini|jadwal hari ini)$/i.test(lower)) return planReply_(0);
  if (/^(hapus transaksi terakhir|batalkan transaksi terakhir)$/i.test(lower)) return deleteLastTransaction_();
  if (/^(selesai tugas|tugas selesai)/i.test(lower)) return completeTask_(message);

  // Perintah sederhana diproses secara deterministik agar tidak bergantung pada
  // format keluaran AI. AI hanya dipakai untuk kalimat majemuk/ambigu dan obrolan.
  const trx = parseTransaction_(message);
  if (trx) return saveTransaction_(trx);
  const task = parseTask_(message);
  if (task) return saveTask_(task);
  const agenda = parseAgenda_(message);
  if (agenda) return saveAgenda_(agenda);

  const understanding = understandWithGemini_(message);
  if (understanding) return applyUnderstanding_(understanding, message);
  return askGemini_(message);
}

function helpText_() {
  return [
    'Aku siap membantu mengatur hari kamu.',
    '',
    'Keuangan',
    '• Makan di luar hari ini 15k',
    '• Dikasih ibu 10 ribu',
    '• Uangku berapa?',
    '• Rekap bulan ini',
    '',
    'Jadwal dan tugas',
    '• Besok jam 9 meeting dengan Budi',
    '• Tambah tugas bayar listrik besok',
    '• Selesai tugas bayar listrik',
    '• Rencanakan besok'
  ].join('\n');
}

function parseTransaction_(raw) {
  const text = raw.toLowerCase();
  const income = /(pemasukan|uang masuk|dikasih|diberi|dapat uang|menerima|terima|gajian|dibayar|hasil jual)/i.test(text);
  const expense = /(pengeluaran|uang keluar|beli|bayar|jajan|belanja|makan|minum|bbm|bensin|transfer|sedekah)/i.test(text);
  const amount = extractAmount_(text);
  if ((!income && !expense) || !amount) return null;
  return {
    type: income && !expense ? 'Pemasukan' : 'Pengeluaran',
    amount: amount,
    source: sourceFund_(text),
    category: category_(text, income && !expense ? 'Pemasukan' : 'Pengeluaran'),
    note: cleanNote_(raw)
  };
}

function saveTransaction_(trx) {
  const sheet = sheet_(TAB.TRANSAKSI);
  const now = new Date();
  const balance = currentBalance_() + (trx.type === 'Pemasukan' ? trx.amount : -trx.amount);
  sheet.appendRow([
    id_('TRX'), date_(now), time_(now), trx.type, trx.amount, trx.category,
    trx.note || 'Dicatat dari Telegram', trx.source, balance, 'Telegram', 'Tercatat'
  ]);
  refreshDashboard_();
  return [
    'Tercatat.', '', trx.category, rupiah_(trx.amount), date_(now),
    trx.type + ': ' + (trx.note || 'Catatan Telegram'),
    'Saldo sekarang: ' + rupiah_(balance)
  ].join('\n');
}

function deleteLastTransaction_() {
  const s = sheet_(TAB.TRANSAKSI);
  if (s.getLastRow() < 2) return 'Belum ada transaksi yang dapat dihapus.';
  const row = s.getLastRow();
  const data = s.getRange(row, 1, 1, 11).getValues()[0];
  s.deleteRow(row);
  refreshDashboard_();
  return 'Transaksi terakhir dihapus: ' + data[3] + ' ' + rupiah_(data[4]);
}

function parseAgenda_(raw) {
  const text = raw.toLowerCase();
  if (!/(agenda|jadwal|meeting|rapat|ketemu|pertemuan|jam|pukul)/i.test(text)) return null;
  const title = raw.replace(/\b(hari ini|besok|lusa|agenda|jadwal)\b/gi, '')
    .replace(/\b(jam|pukul)\s*\d{1,2}(?:[:.]\d{2})?/gi, '').trim();
  if (!title) return null;
  return { date: dateFromText_(text), time: timeFromText_(text), title: title };
}

function saveAgenda_(agenda) {
  sheet_(TAB.AGENDA).appendRow([
    id_('AGD'), date_(agenda.date), agenda.time, agenda.title,
    /meeting|rapat|pertemuan/i.test(agenda.title) ? 'Rapat' : 'Pribadi',
    'Sedang', 30, 'Belum', 'Aktif', 'Dibuat dari Telegram'
  ]);
  refreshDashboard_();
  return 'Agenda tersimpan.\n\n' + agenda.title + '\n' + date_(agenda.date) + ' pukul ' + agenda.time;
}

function parseTask_(raw) {
  if (!/^(tambah tugas|catat tugas|tugas:)/i.test(raw.trim())) return null;
  const title = raw.replace(/^(tambah tugas|catat tugas|tugas:)/i, '')
    .replace(/\b(hari ini|besok|lusa)\b/gi, '').trim();
  if (!title) return null;
  return { title: title, deadline: dateFromText_(raw.toLowerCase()) };
}

function saveTask_(task) {
  const now = new Date();
  sheet_(TAB.TUGAS).appendRow([
    id_('TSK'), task.title, date_(task.deadline), 'Sedang', 'Belum selesai', '',
    date_(now) + ' ' + time_(now), ''
  ]);
  refreshDashboard_();
  return 'Tugas ditambahkan.\n\n' + task.title + '\nDeadline: ' + date_(task.deadline);
}

function completeTask_(raw) {
  const search = raw.replace(/^(selesai tugas|tugas selesai)/i, '').trim().toLowerCase();
  const s = sheet_(TAB.TUGAS);
  if (s.getLastRow() < 2) return 'Belum ada tugas.';
  const rows = s.getRange(2, 1, s.getLastRow() - 1, 8).getValues();
  for (let i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][4]) !== 'Selesai' && (!search || String(rows[i][1]).toLowerCase().includes(search))) {
      s.getRange(i + 2, 5).setValue('Selesai');
      s.getRange(i + 2, 8).setValue(date_(new Date()) + ' ' + time_(new Date()));
      refreshDashboard_();
      return 'Tugas selesai: ' + rows[i][1];
    }
  }
  return 'Tugas tidak ditemukan.';
}

function balanceReply_() {
  const breakdown = balancesByFund_();
  const lines = ['Saldo total: ' + rupiah_(currentBalance_()), '', 'Rincian:'];
  Object.keys(breakdown).forEach(function(k) { lines.push('• ' + k + ': ' + rupiah_(breakdown[k])); });
  return lines.join('\n');
}

function dailyRecap_() {
  const rows = transactionsByDate_(date_(new Date()));
  const income = sum_(rows, 'Pemasukan');
  const expense = sum_(rows, 'Pengeluaran');
  return ['Rekap hari ini', '', 'Pemasukan: ' + rupiah_(income), 'Pengeluaran: ' + rupiah_(expense), 'Saldo: ' + rupiah_(currentBalance_())].join('\n');
}

function monthlyRecap_() {
  const rows = monthTransactions_();
  const category = {};
  rows.filter(function(r) { return r[3] === 'Pengeluaran'; }).forEach(function(r) { category[r[5] || 'Lainnya'] = (category[r[5] || 'Lainnya'] || 0) + Number(r[4] || 0); });
  const top = Object.keys(category).sort(function(a, b) { return category[b] - category[a]; })[0];
  return [
    'Rekap bulan ini', '',
    'Pemasukan: ' + rupiah_(sum_(rows, 'Pemasukan')),
    'Pengeluaran: ' + rupiah_(sum_(rows, 'Pengeluaran')),
    top ? 'Pengeluaran terbesar: ' + top + ' — ' + rupiah_(category[top]) : 'Belum ada pengeluaran.',
    '', 'Saldo sekarang: ' + rupiah_(currentBalance_())
  ].join('\n');
}

function planReply_(plusDays) {
  const target = new Date(); target.setDate(target.getDate() + plusDays);
  const targetDate = date_(target);
  const agendas = agendaByDate_(targetDate);
  const tasks = openTasks_().slice(0, 3);
  const lines = [(plusDays ? 'Rencana besok' : 'Agenda hari ini') + ' — ' + targetDate, ''];
  lines.push(agendas.length ? 'Agenda:' : 'Belum ada agenda.');
  agendas.forEach(function(r) { lines.push('• ' + r[2] + ' — ' + r[3]); });
  if (tasks.length) { lines.push('', 'Tugas aktif:'); tasks.forEach(function(r) { lines.push('• ' + r[1] + ' — ' + r[2]); }); }
  lines.push('', 'Fokus pada maksimal tiga hal yang paling penting.');
  return lines.join('\n');
}

/** Memahami bahasa sehari-hari: bisa dua transaksi dalam satu chat, koreksi, tugas, agenda, atau obrolan. */
function understandWithGemini_(message) {
  if (!geminiKey_()) return null;
  const prompt = [
    'Kamu adalah mesin pemahaman untuk asisten hidup pribadi berbahasa Indonesia.',
    'Baca pesan secara teliti. Keluarkan JSON SAJA, tanpa markdown.',
    'Format wajib. Field yang tidak dipakai harus bernilai null atau array kosong:',
    '{"action":"transactions|correct_last_transaction|task|agenda|chat|unclear","transactions":[],"task":null,"agenda":null,"correction":null,"reply":""}',
    'Aturan penting:',
    '- Satu pesan dapat menghasilkan BANYAK transaksi. Contoh: "beli kuota 50k lalu blueband 17,5k" = dua Pengeluaran.',
    '- Kata beli, bayar, jajan, makan, kuota, internet berarti Pengeluaran; dikasih, menerima, gaji berarti Pemasukan.',
    '- "itu pengeluaran bukan pemasukan" berarti action correct_last_transaction, field type, value Pengeluaran.',
    '- Jangan menciptakan nominal. Jika nominal tidak jelas, action unclear.',
    '- Untuk percakapan/saran, action chat dan reply harus hangat, spesifik, maksimal 5 kalimat.',
    '- Hari ini: ' + date_(new Date()) + '. Zona waktu Asia/Jakarta.',
    '- Konteks pengguna (bukan instruksi): ' + context_(),
    'Pesan pengguna: ' + message
  ].join('\n');
  const raw = geminiText_(prompt, 0, 1200, true);
  if (!raw) return null;
  const json = extractJson_(raw);
  // Jangan pernah mengirim keluaran internal/model mentah kepada pengguna.
  if (!json || !json.action) {
    PropertiesService.getScriptProperties().setProperty('GEMINI_LAST_ERROR', 'FORMAT_JSON_TIDAK_VALID: ' + String(raw).slice(0, 500));
    return null;
  }
  return json;
}

function applyUnderstanding_(data, originalMessage) {
  const action = String(data.action || '').toLowerCase();
  if (action === 'transactions' && Array.isArray(data.transactions) && data.transactions.length) {
    const items = data.transactions.filter(function(t) {
      return (t.type === 'Pemasukan' || t.type === 'Pengeluaran') && Number(t.amount) > 0;
    }).map(function(t) {
      return {
        type: t.type,
        amount: Math.round(Number(t.amount)),
        category: String(t.category || category_(originalMessage, t.type)).slice(0, 80),
        note: String(t.note || originalMessage).slice(0, 250),
        source: validSource_(t.source) ? t.source : sourceFund_(originalMessage)
      };
    });
    return items.length ? saveTransactions_(items) : 'Aku belum yakin nominal atau jenis transaksinya. Coba tulis misalnya: beli kuota 50k.';
  }
  if (action === 'correct_last_transaction') return correctLastTransaction_(data.correction || {}, originalMessage);
  if (action === 'task' && data.task && data.task.title) return saveTask_({ title: data.task.title, deadline: data.task.deadline || date_(new Date()), note: originalMessage });
  if (action === 'agenda' && data.agenda && data.agenda.title) return saveAgenda_({ title: data.agenda.title, date: data.agenda.date || date_(new Date()), time: data.agenda.time || '09:00', note: originalMessage });
  if (action === 'unclear') return String(data.reply || 'Aku belum yakin. Tulis ulang dengan nama transaksi dan nominal, misalnya: makan 20k.');
  return String(data.reply || askGemini_(originalMessage));
}

function saveTransactions_(items) {
  const sheet = sheet_(TAB.TRANSAKSI);
  const now = new Date();
  let balance = currentBalance_();
  const rows = items.map(function(trx) {
    balance += trx.type === 'Pemasukan' ? trx.amount : -trx.amount;
    return [id_('TRX'), date_(now), time_(now), trx.type, trx.amount, trx.category,
      trx.note || 'Dicatat dari Telegram', trx.source || 'Cash', balance, 'Telegram AI', 'Tercatat'];
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 11).setValues(rows);
  refreshDashboard_();
  const lines = ['Tercatat ' + items.length + ' transaksi:'];
  items.forEach(function(t) { lines.push('• ' + t.type + ' — ' + t.category + ' ' + rupiah_(t.amount)); });
  lines.push('', 'Saldo sekarang: ' + rupiah_(balance));
  return lines.join('\n');
}

function correctLastTransaction_(correction, originalMessage) {
  const s = sheet_(TAB.TRANSAKSI);
  if (s.getLastRow() < 2) return 'Belum ada transaksi yang bisa dikoreksi.';
  const row = s.getLastRow();
  const old = s.getRange(row, 1, 1, 11).getValues()[0];
  const field = String(correction.field || '').toLowerCase();
  const value = String(correction.value || '').trim();
  if (field === 'type' && (value === 'Pemasukan' || value === 'Pengeluaran')) {
    s.getRange(row, 4).setValue(value);
    s.getRange(row, 11).setValue('Dikoreksi dari Telegram');
    refreshBalancesAfterCorrection_();
    return 'Siap, transaksi terakhir sudah diubah menjadi ' + value + ': ' + old[5] + ' ' + rupiah_(old[4]) + '. Saldo kini ' + rupiah_(currentBalance_()) + '.';
  }
  if (field === 'amount' && Number(value) > 0) {
    s.getRange(row, 5).setValue(Math.round(Number(value)));
    s.getRange(row, 11).setValue('Dikoreksi dari Telegram');
    refreshBalancesAfterCorrection_();
    return 'Siap, nominal transaksi terakhir sudah dikoreksi menjadi ' + rupiah_(Number(value)) + '.';
  }
  return 'Aku mengerti kamu ingin mengoreksi catatan terakhir. Tulis lebih spesifik, misalnya: "transaksi terakhir itu pengeluaran" atau "transaksi terakhir jadi 50k".';
}

function refreshBalancesAfterCorrection_() {
  const s = sheet_(TAB.TRANSAKSI);
  if (s.getLastRow() < 2) return;
  const rows = s.getRange(2, 1, s.getLastRow() - 1, 11).getValues();
  let balance = openingBalance_();
  const balances = rows.map(function(r) {
    balance += r[3] === 'Pemasukan' ? Number(r[4] || 0) : -Number(r[4] || 0);
    return [balance];
  });
  s.getRange(2, 9, balances.length, 1).setValues(balances);
  refreshDashboard_();
}

function askGemini_(message) {
  const key = geminiKey_();
  if (!key) return 'Mode AI belum aktif. Isi GEMINI_API_KEY, lalu jalankan setupTelegramBot() sekali lagi.';
  const prompt = [
    'Kamu adalah Asisten Harian pribadi berbahasa Indonesia. Jawab ringkas, praktis, hangat.',
    'Jangan mengarang data keuangan atau agenda. Jika memberi saran, gunakan konteks nyata berikut.',
    '', context_(), '', 'Pesan pengguna: ' + message
  ].join('\n');
  const reply = geminiText_(prompt, 0.45, 500);
  return reply || 'AI belum dapat dihubungi. Cek GEMINI_API_KEY lalu jalankan cekModelGemini() untuk melihat model yang tersedia.';
}

/** Pilih model yang BENAR dari akun API, bukan dari nama tebakan. Jalankan manual jika ingin melihat hasilnya. */
function cekModelGemini() {
  const model = geminiModel_();
  // Gemini 3 dapat memakai token internal untuk berpikir. 16 token terlalu kecil dan
  // bisa menghasilkan kandidat sukses tanpa teks keluaran.
  const answer = geminiText_('Balas persis dengan satu kata: OK', 0, 256);
  if (!answer) throw new Error('GEMINI_GAGAL: ' + (getConfig_('GEMINI_LAST_ERROR') || 'Tidak ada respons dari API.'));
  Logger.log('GEMINI_OK | Model: ' + model + ' | Respons: ' + answer);
}

/**
 * Jalankan sekali setelah mengganti API key/model di CONFIG.
 * Menimpa Script Properties lama tanpa menyentuh Telegram, Spreadsheet, atau data transaksi.
 */
function resetKoneksiGemini() {
  const props = PropertiesService.getScriptProperties();
  const key = String(CONFIG.GEMINI_API_KEY || '').trim();
  if (!key || key === 'ISI_API_KEY_GEMINI') throw new Error('Isi GEMINI_API_KEY di CONFIG terlebih dahulu.');
  props.setProperty('GEMINI_API_KEY', key);
  props.setProperty('GEMINI_MODEL', String(CONFIG.GEMINI_MODEL || 'gemini-3.5-flash').trim());
  ['GEMINI_ACTIVE_MODEL', 'GEMINI_MODEL_CHECKED_AT', 'GEMINI_LAST_ERROR'].forEach(function(name) { props.deleteProperty(name); });
  Logger.log('KONFIGURASI_GEMINI_DIRESET. Jalankan cekModelGemini() berikutnya.');
}

function geminiModel_() {
  const key = geminiKey_();
  if (!key) return '';
  const props = PropertiesService.getScriptProperties();
  // Key produksi AQ didukung langsung oleh endpoint generateContent. Model eksplisit lebih stabil
  // daripada ListModels, yang pada sebagian akun/region tidak diizinkan.
  const configured = String(CONFIG.GEMINI_MODEL || getConfig_('GEMINI_MODEL') || '').replace(/^models\//, '');
  if (configured) return configured;
  const cached = props.getProperty('GEMINI_ACTIVE_MODEL');
  const cachedAt = Number(props.getProperty('GEMINI_MODEL_CHECKED_AT') || 0);
  if (cached && Date.now() - cachedAt < 6 * 60 * 60 * 1000) return cached;
  try {
    const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      headers: { 'x-goog-api-key': key },
      muteHttpExceptions: true
    });
    const out = JSON.parse(res.getContentText());
    const all = (out.models || []).filter(function(m) { return (m.supportedGenerationMethods || []).indexOf('generateContent') !== -1; });
    const preferred = ['gemini-3.5-flash', 'gemini-3-flash', 'gemini-2.5-flash'].filter(Boolean);
    let chosen = null;
    preferred.some(function(name) { chosen = all.filter(function(m) { return String(m.name).replace(/^models\//, '') === name; })[0]; return !!chosen; });
    if (!chosen) chosen = all.filter(function(m) { return /flash/i.test(m.name); })[0] || all[0];
    if (!chosen) return '';
    const name = String(chosen.name).replace(/^models\//, '');
    props.setProperty('GEMINI_ACTIVE_MODEL', name);
    props.setProperty('GEMINI_MODEL_CHECKED_AT', String(Date.now()));
    return name;
  } catch (e) { return ''; }
}

function geminiText_(prompt, temperature, maxOutputTokens, jsonMode) {
  const key = geminiKey_();
  const model = geminiModel_();
  if (!key || !model) return '';
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
  try {
    const res = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-goog-api-key': key },
      payload: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: temperature,
          maxOutputTokens: maxOutputTokens,
          responseMimeType: jsonMode ? 'application/json' : 'text/plain'
        }
      })
    });
    const out = JSON.parse(res.getContentText());
    if (out.error) {
      PropertiesService.getScriptProperties().setProperty('GEMINI_LAST_ERROR', 'HTTP ' + res.getResponseCode() + ': ' + (out.error.message || res.getContentText()).slice(0, 500));
      PropertiesService.getScriptProperties().deleteProperty('GEMINI_ACTIVE_MODEL');
      return '';
    }
    PropertiesService.getScriptProperties().deleteProperty('GEMINI_LAST_ERROR');
    const candidate = out.candidates && out.candidates[0];
    const answer = candidate && candidate.content && candidate.content.parts
      ? candidate.content.parts.filter(function(p) { return p.thought !== true; }).map(function(p) { return p.text || ''; }).join('').trim()
      : '';
    if (!answer) {
      const reason = candidate && candidate.finishReason ? candidate.finishReason : 'EMPTY_RESPONSE';
      PropertiesService.getScriptProperties().setProperty(
        'GEMINI_LAST_ERROR',
        'HTTP ' + res.getResponseCode() + ': API merespons tetapi teks kosong. finishReason=' + reason + '. Respons=' + res.getContentText().slice(0, 700)
      );
      return '';
    }
    return answer;
  } catch (e) {
    PropertiesService.getScriptProperties().setProperty('GEMINI_LAST_ERROR', String(e.message || e));
    return '';
  }
}

function extractJson_(text) {
  try { return JSON.parse(text); } catch (e) {}
  const found = String(text).match(/\{[\s\S]*\}/);
  try { return found ? JSON.parse(found[0]) : null; } catch (e) { return null; }
}

function validSource_(source) { return ['Cash','Bank','Dana','GoPay','OVO','ShopeePay'].indexOf(String(source)) !== -1; }

/** Khusus AI: selalu gunakan key terbaru yang terlihat di CONFIG, bukan cache lama. */
function geminiKey_() {
  const direct = String(CONFIG.GEMINI_API_KEY || '').trim();
  if (direct && direct !== 'ISI_API_KEY_GEMINI') return direct;
  return String(getConfig_('GEMINI_API_KEY') || '').trim();
}

function runAutomations() {
  const chatId = getConfig_('ADMIN_CHAT_ID');
  if (!chatId) return;
  const now = new Date();
  const today = date_(now);
  const currentMinutes = Number(Utilities.formatDate(now, tz_(), 'HH')) * 60 + Number(Utilities.formatDate(now, tz_(), 'mm'));
  const s = sheet_(TAB.AGENDA);
  if (s.getLastRow() < 2) return;
  const rows = s.getRange(2, 1, s.getLastRow() - 1, 10).getValues();
  rows.forEach(function(r, i) {
    if (dateCell_(r[1]) !== today || String(r[7]) === 'Sudah' || String(r[8]) !== 'Aktif' || !String(r[2]).includes(':')) return;
    const p = String(r[2]).split(':');
    const reminderAt = Number(p[0]) * 60 + Number(p[1]) - Number(r[6] || 30);
    if (currentMinutes >= reminderAt && currentMinutes < reminderAt + 5) {
      telegramSend_(chatId, 'Pengingat: ' + r[3] + ' dimulai pukul ' + r[2] + '.');
      s.getRange(i + 2, 8).setValue('Sudah');
    }
  });
  refreshDashboard_();
}

function telegramRequest_(method, data) {
  const token = getConfig_('TELEGRAM_BOT_TOKEN');
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/' + method, { method: 'post', payload: data || {}, muteHttpExceptions: true });
  const json = JSON.parse(res.getContentText());
  if (!json.ok) throw new Error('Telegram: ' + (json.description || res.getContentText()));
  return json;
}

function telegramSend_(chatId, text) {
  return telegramRequest_('sendMessage', { chat_id: String(chatId), text: String(text), disable_web_page_preview: 'true' });
}

function saveConfig_() {
  const props = PropertiesService.getScriptProperties();
  ['TELEGRAM_BOT_TOKEN', 'SPREADSHEET_ID', 'SETUP_CODE', 'GEMINI_API_KEY', 'GEMINI_MODEL', 'TIME_ZONE'].forEach(function(k) {
    const value = String(CONFIG[k] || '').trim();
    if (value && !value.startsWith('ISI_')) props.setProperty(k, value);
  });
}

function getConfig_(key) { return PropertiesService.getScriptProperties().getProperty(key) || ''; }
function ss_() { return SpreadsheetApp.openById(getConfig_('SPREADSHEET_ID') || CONFIG.SPREADSHEET_ID); }
function sheet_(name) { const s = ss_().getSheetByName(name); if (!s) throw new Error('Tab ' + name + ' tidak ditemukan. Jalankan setupTelegramBot().'); return s; }

function setupSheets_() {
  const defs = {};
  defs[TAB.DASHBOARD] = ['ASISTEN HARIAN', ''];
  defs[TAB.TRANSAKSI] = ['ID','Tanggal','Waktu','Jenis','Nominal','Kategori','Keterangan','Sumber Dana','Saldo Setelah Transaksi','Dibuat Dari','Status'];
  defs[TAB.AGENDA] = ['ID','Tanggal','Jam','Judul','Kategori','Prioritas','Pengingat Menit Sebelum','Sudah Diingatkan','Status','Catatan'];
  defs[TAB.TUGAS] = ['ID','Judul Tugas','Deadline','Prioritas','Status','Catatan','Dibuat Pada','Selesai Pada'];
  defs[TAB.TAGIHAN] = ['ID','Nama Tagihan','Nominal','Jatuh Tempo','Berulang Bulanan','Status','Pengingat Terkirim','Catatan'];
  defs[TAB.SALDO] = ['Sumber Dana','Saldo Awal','Catatan'];
  defs[TAB.LOG] = ['Waktu','Pengirim','Pesan','Proses','Balasan','Status'];
  defs[TAB.PENGATURAN] = ['Pengaturan','Nilai','Keterangan'];
  const book = ss_();
  Object.keys(defs).forEach(function(name) {
    let s = book.getSheetByName(name); if (!s) s = book.insertSheet(name);
    if (s.getLastRow() === 0) s.getRange(1, 1, 1, defs[name].length).setValues([defs[name]]);
    s.setFrozenRows(1); s.getRange(1,1,1,s.getLastColumn()).setBackground('#1f4d3a').setFontColor('#ffffff').setFontWeight('bold');
  });
  const saldo = sheet_(TAB.SALDO);
  if (saldo.getLastRow() < 2) saldo.getRange(2,1,4,3).setValues([['Cash',0,'Saldo awal cash'],['Bank',0,'Saldo awal rekening'],['Dana',0,'Saldo Dana'],['E-Wallet Lainnya',0,'GoPay, OVO, ShopeePay']]);
}

function refreshDashboard_() {
  const s = sheet_(TAB.DASHBOARD); const monthly = monthTransactions_(); const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate()+1);
  s.getRange('A1:B18').breakApart(); s.getRange('A1:B18').clearContent();
  s.getRange('A1:B1').merge().setValue('ASISTEN HARIAN').setBackground('#163c2d').setFontColor('#ffffff').setFontWeight('bold');
  s.getRange('A3:B9').setValues([
    ['Saldo total',rupiah_(currentBalance_())],['Pemasukan bulan ini',rupiah_(sum_(monthly,'Pemasukan'))],['Pengeluaran bulan ini',rupiah_(sum_(monthly,'Pengeluaran'))],['Agenda besok',agendaByDate_(date_(tomorrow)).length + ' agenda'],['Tugas aktif',openTasks_().length + ' tugas'],['Status Telegram',getConfig_('ADMIN_CHAT_ID') ? 'Aktif' : 'Menunggu /start'],['Terakhir diperbarui',date_(new Date()) + ' ' + time_(new Date())]
  ]);
  s.getRange('A3:A9').setFontWeight('bold'); s.setColumnWidth(1,220); s.setColumnWidth(2,350);
}

function currentBalance_() { return openingBalance_() + allTransactions_().reduce(function(t,r){ return t + (r[3] === 'Pemasukan' ? Number(r[4]||0) : -Number(r[4]||0)); },0); }
function openingBalance_() { const s=sheet_(TAB.SALDO); return s.getLastRow()<2 ? 0 : s.getRange(2,1,s.getLastRow()-1,3).getValues().reduce(function(t,r){return t+Number(r[1]||0);},0); }
function balancesByFund_() { const o={}; const s=sheet_(TAB.SALDO); if(s.getLastRow()>=2)s.getRange(2,1,s.getLastRow()-1,3).getValues().forEach(function(r){o[r[0]]=Number(r[1]||0);}); allTransactions_().forEach(function(r){const k=r[7]||'Cash';o[k]=(o[k]||0)+(r[3]==='Pemasukan'?Number(r[4]||0):-Number(r[4]||0));});return o; }
function allTransactions_() { const s=sheet_(TAB.TRANSAKSI); return s.getLastRow()<2?[]:s.getRange(2,1,s.getLastRow()-1,11).getValues(); }
function transactionsByDate_(d) { return allTransactions_().filter(function(r){return dateCell_(r[1])===d;}); }
function monthTransactions_() { const p=Utilities.formatDate(new Date(),tz_(),'yyyy-MM'); return allTransactions_().filter(function(r){return dateCell_(r[1]).startsWith(p);}); }
function sum_(rows,type) { return rows.filter(function(r){return r[3]===type;}).reduce(function(t,r){return t+Number(r[4]||0);},0); }
function agendaByDate_(d) { const s=sheet_(TAB.AGENDA); return s.getLastRow()<2?[]:s.getRange(2,1,s.getLastRow()-1,10).getValues().filter(function(r){return dateCell_(r[1])===d && r[8]==='Aktif';}).sort(function(a,b){return String(a[2]).localeCompare(String(b[2]));}); }
function openTasks_() { const s=sheet_(TAB.TUGAS); return s.getLastRow()<2?[]:s.getRange(2,1,s.getLastRow()-1,8).getValues().filter(function(r){return r[4]!=='Selesai';}); }
function context_() { return ['Saldo: '+rupiah_(currentBalance_()),'Pengeluaran bulan ini: '+rupiah_(sum_(monthTransactions_(),'Pengeluaran')),'Tugas aktif: '+openTasks_().map(function(r){return r[1];}).join(', ')].join('\n'); }
function extractAmount_(t) { const m=t.match(/(\d+(?:[.,]\d+)?)\s*(ribu|rb|k|juta|jt)\b/i); if(m){const n=Number(m[1].replace(',','.'));return Math.round(n*(/juta|jt/i.test(m[2])?1000000:1000));} const n=t.match(/\b(\d{1,3}(?:\.\d{3})+|\d{3,12})\b/); return n?Number(n[1].replace(/\./g,'')):0; }
function sourceFund_(t) { if(/\bdana\b/i.test(t))return'Dana';if(/\bgopay\b/i.test(t))return'GoPay';if(/\bovo\b/i.test(t))return'OVO';if(/\bshopeepay\b/i.test(t))return'ShopeePay';if(/\bbca|bri|bni|mandiri|bank\b/i.test(t))return'Bank';return'Cash'; }
function category_(t,type) { if(type==='Pemasukan'){if(/ibu|ayah|keluarga/i.test(t))return'Keluarga';if(/gaji|upah|kerja/i.test(t))return'Gaji / Kerja';return'Pemasukan Lainnya';}if(/makan|minum|kopi|warung/i.test(t))return'Makan & Minum';if(/bbm|bensin|parkir|ojek|transport/i.test(t))return'Transportasi';if(/pulsa|kuota|internet/i.test(t))return'Komunikasi';if(/listrik|air|tagihan/i.test(t))return'Tagihan';return'Lainnya'; }
function cleanNote_(raw) { return String(raw).replace(/\b\d+(?:[.,]\d+)?\s*(ribu|rb|k|juta|jt)?\b/gi,'').replace(/\s+/g,' ').trim(); }
function dateFromText_(t) { const d=new Date(); if(/\blusa\b/i.test(t))d.setDate(d.getDate()+2); else if(/\bbesok\b/i.test(t))d.setDate(d.getDate()+1); return d; }
function timeFromText_(t) { const m=t.match(/(?:jam|pukul)\s*(\d{1,2})(?:[:.](\d{2}))?/i);return m?pad_(m[1])+':'+pad_(m[2]||0):'09:00'; }
function replaceTrigger_(fn,minutes) { ScriptApp.getProjectTriggers().forEach(function(t){if(t.getHandlerFunction()===fn)ScriptApp.deleteTrigger(t);}); ScriptApp.newTrigger(fn).timeBased().everyMinutes(minutes).create(); }
function log_(sender,msg,process,reply,status) { sheet_(TAB.LOG).appendRow([date_(new Date())+' '+time_(new Date()),sender,msg,process,reply,status]); }
function id_(p) { return p+'-'+Utilities.formatDate(new Date(),tz_(),'yyyyMMddHHmmss')+'-'+Math.floor(Math.random()*1000); }
function tz_() { return getConfig_('TIME_ZONE') || 'Asia/Jakarta'; }
function date_(d) { return Utilities.formatDate(new Date(d),tz_(),'yyyy-MM-dd'); }
function time_(d) { return Utilities.formatDate(new Date(d),tz_(),'HH:mm'); }
function dateCell_(v) { return v instanceof Date ? date_(v) : String(v||''); }
function rupiah_(n) { return 'Rp'+Number(n||0).toLocaleString('id-ID'); }
function pad_(n) { return String(n).padStart(2,'0'); }
