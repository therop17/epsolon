/**
 * ESPOLÓN — tg.js
 * Telegram WebApp integration + persistent state management
 */

// ══ Telegram WebApp init ══
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

// ══ User data from Telegram ══
const TG_USER = tg?.initDataUnsafe?.user || null;
const TG_ID   = TG_USER?.id ? String(TG_USER.id) : null;

// ══ State keys ══
const STATE_KEY = TG_ID ? `espolon_${TG_ID}` : 'espolon_guest';

// ══ State management ══
function getState() {
  try {
    return JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
  } catch { return {}; }
}

function setState(update) {
  const current = getState();
  const next = Object.assign({}, current, update);
  localStorage.setItem(STATE_KEY, JSON.stringify(next));
  return next;
}

function getField(key) {
  return getState()[key];
}

// ══ Navigation ══
window.showPage = function(pageId) {
  document.querySelectorAll('.page, .nom-detail-page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById(pageId);
  if (page) page.classList.add('active');
  window.scrollTo(0, 0);
};

// ══ Toast notifications ══
let toastTimer = null;
window.showToast = function(msg, isError) {
  let toast = document.getElementById('globalToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'globalToast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.toggle('error', !!isError);
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
};

// ══ Haptic ══
window.haptic = function(type) {
  try { tg?.HapticFeedback?.impactOccurred(type || 'light'); } catch {}
};

// ══ Load user profile ══
function loadUserProfile() {
  const nameEl     = document.getElementById('profileName');
  const usernameEl = document.getElementById('profileUsername');
  const imgEl      = document.getElementById('profileImg');

  if (TG_USER) {
    const full  = [TG_USER.first_name, TG_USER.last_name].filter(Boolean).join(' ');
    const uname = TG_USER.username ? '@' + TG_USER.username : `ID: ${TG_USER.id}`;

    if (nameEl)     nameEl.textContent     = full || 'Пользователь';
    if (usernameEl) usernameEl.textContent = uname;

    if (TG_USER.photo_url) {
      const avatarHTML = `<img src="${TG_USER.photo_url}" style="width:100%;height:100%;object-fit:cover;" alt="avatar">`;
      if (imgEl) imgEl.innerHTML = avatarHTML;
    }
  } else {
    if (nameEl)     nameEl.textContent     = 'Дарья Куксина';
    if (usernameEl) usernameEl.textContent = '@d_sakhalinskaya';
    if (imgEl) {

    imgEl.innerHTML = `

      <img 

        src="./img/devmode.jpg"

        style="width:100%;height:100%;object-fit:cover;"

        alt="avatar"

      >

    `;

  }
  }
}

// ══ Registration state ══
window.teamRegistered = false;

/**
 * Apply "registered" UI state — single source of truth, no duplicates.
 * Shows menu button, locks reg button, restores menu upload status.
 */
function applyRegisteredUI() {
  window.teamRegistered = true;

  // Separate menuNavBtn stays hidden (regNavBtn takes its role)
  const menuBtn = document.getElementById('menuNavBtn');
  if (menuBtn) menuBtn.style.display = 'none';

  const state = getState();
  if (state.menu_uploaded) {
    // Menu already uploaded — show final "done" state
    applyMenuUploadedUI();
  } else {
    // Team registered, menu not yet uploaded — show "Загрузить меню"
    const regBtn   = document.getElementById('regNavBtn');
    const regIcon  = document.getElementById('regNavIcon');
    const regLabel = document.getElementById('regNavLabel');
    if (regBtn && regIcon && regLabel) {
      regBtn.classList.add('registered');
      regBtn.classList.remove('done');
      regIcon.textContent  = '💀';
      regLabel.textContent = 'Загрузить меню';
      regBtn.onclick = function() { showPage('menuUploadPage'); };
    }
  }
}

/**
 * Called after menu is successfully uploaded.
 * Changes the nav button to a "done" state and shows the success banner.
 */
function applyMenuUploadedUI() {
  // Nav button → "Вы участник"
  const regBtn   = document.getElementById('regNavBtn');
  const regIcon  = document.getElementById('regNavIcon');
  const regLabel = document.getElementById('regNavLabel');
  if (regBtn && regIcon && regLabel) {
    regBtn.classList.add('registered', 'done');
    regIcon.textContent  = '✅';
    regLabel.textContent = 'Вы участник';
    regBtn.onclick = null;
  }

  // Make sure the upload page shows success state (form hidden, banner shown)
  const successEl = document.getElementById('menuUploadSuccess');
  if (successEl) successEl.style.display = 'block';
  const submitBtn = document.getElementById('menuSubmitBtn');
  if (submitBtn) submitBtn.style.display = 'none';
  const inputGroup = document.getElementById('menuInputGroup');
  if (inputGroup) inputGroup.style.display = 'none';
}

/**
 * Reset all local state — called when server says the user is NOT in the sheet.
 */
function clearAllLocalState() {
  window.teamRegistered = false;
  try { localStorage.removeItem(STATE_KEY); } catch {}

  // Reset registration nav button back to "Регистрация"
  const regBtn   = document.getElementById('regNavBtn');
  const regIcon  = document.getElementById('regNavIcon');
  const regLabel = document.getElementById('regNavLabel');
  if (regBtn && regIcon && regLabel) {
    regBtn.classList.remove('registered', 'done');
    regIcon.textContent  = '💬';
    regLabel.textContent = 'Регистрация Команды';
    regBtn.onclick = function() { showPage('registrationPage'); };
  }
}

/**
 * Verify registration against the Google Sheet.
 * If server disagrees with localStorage, fix localStorage.
 */
async function verifyRegistrationWithServer() {
  const state = getState();

  // ── Step 1: Apply localStorage immediately (no delay for the user) ──
  if (state.team_registered) {
    applyRegisteredUI();
  }

  // ── Step 2: Verify with server in background ──
  if (!TG_ID) return; // dev/browser mode — trust localStorage, done

  try {
    const res  = await fetch('/api/check-registration?tg_id=' + encodeURIComponent(TG_ID));
    const data = await res.json();

    if (data.error) {
      // Server error — keep whatever localStorage says
      return;
    }

    if (data.registered === true) {
      // Server confirms — keep UI, sync nomination states from server
      setState({ team_registered: true });
      if (!window.teamRegistered) applyRegisteredUI(); // in case localStorage was wrong

      // Sync submitted nomination states
      if (Array.isArray(data.nominations)) {
        const update = {};
        data.nominations.forEach(id => { update['nom_' + id] = 'submitted'; });
        setState(update);
      }

      // Sync enrolled states (Тишина / Драйверы / Просветитель)
      if (Array.isArray(data.enrolled)) {
        const enrollUpdate = {};
        data.enrolled.forEach(id => { enrollUpdate['nom_enrolled_' + id] = true; });
        setState(enrollUpdate);
      }

    } else if (data.registered === false) {
      // Server says NOT registered — clear stale state and revert UI
      clearAllLocalState();
    }

  } catch (err) {
    // Network error — keep localStorage state, do nothing
  }
}

// Kept for compatibility (called from inline onclick after successful registration submit)
function checkRegistration() {
  // No-op: initial check is now done by verifyRegistrationWithServer()
}

// ══ Nominations state restore ══
function restoreNomStates() {
  if (!window.teamRegistered) return; // don't restore if not actually registered
  const state = getState();
  ['tiresome', 'cristalino', 'enlighten', 'spirit', 'stereo'].forEach(id => {
    if (state['nom_' + id] === 'submitted') {
      const badge = document.getElementById('nomBadge-' + id);
      if (badge) { badge.textContent = '✓'; badge.classList.add('done'); }
      const card = document.getElementById('nomCard-' + id);
      if (card) card.classList.add('submitted');
    }
  });
}

// ══ Check if user can access nominations ══
// Uses runtime flag (set by server verification), not stale localStorage
window.canUseNominations = function() {
  return window.teamRegistered === true;
};

// ══ Registration submit ══
window.submitRegistration = async function() {
  const fields = {
    city:         document.getElementById('regCity')?.value.trim(),
    venue:        document.getElementById('regVenue')?.value.trim(),
    venue_link:   document.getElementById('regVenueLink')?.value.trim(),
    captain_link: document.getElementById('regCaptainLink')?.value.trim(),
    area:         document.getElementById('regArea')?.value.trim(),
    license:      document.getElementById('regLicense')?.value.trim(),
    license_link: document.getElementById('regLicenseLink')?.value.trim(),
    legal:        document.getElementById('regLegal')?.value.trim(),
  };

  // Validate required
  let hasError = false;
  ['city', 'venue', 'legal'].forEach(f => {
    const el = document.getElementById('reg' + f.charAt(0).toUpperCase() + f.slice(1));
    if (!fields[f]) {
      if (el) { el.classList.add('error'); setTimeout(() => el.classList.remove('error'), 600); }
      hasError = true;
    }
  });

  if (hasError) { showToast('Заполните обязательные поля', true); return; }

  const btn = document.querySelector('#registrationPage .reg-submit-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="btn-spinner"></span>Отправляем...'; }

  try {
    const payload = Object.assign({}, fields, {
      telegram_user_id: TG_ID,
      telegram_username: TG_USER?.username || '',
      telegram_name: [TG_USER?.first_name, TG_USER?.last_name].filter(Boolean).join(' '),
      submitted_at: new Date().toISOString(),
    });

    const res = await fetch('/api/register-team', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка сервера');

    // Save state
    setState({ team_registered: true, team_data: payload });
    window.teamRegistered = true;
    applyRegisteredUI();

    // Show success
    document.getElementById('regFormContent').style.display = 'none';
    document.getElementById('regSuccess').style.display = 'block';
    haptic('medium');

  } catch (err) {
    showToast('Ошибка: ' + err.message, true);
    if (btn) { btn.disabled = false; btn.innerHTML = 'Отправить заявку →'; }
  }
};

// ══ Nomination helpers ══
window.openNomDetail = function(nomId) {
  if (!canUseNominations()) {
    showToast('Сначала зарегистрируйте команду!', true);
    return;
  }
  document.querySelectorAll('.page, .nom-detail-page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById('nomDetailPage-' + nomId);
  if (page) page.classList.add('active');

  // If already enrolled in extra nominations, show enrolled screen
  const state = getState();
  const isExtra = ['tiresome', 'cristalino', 'enlighten'].includes(nomId);
  if (isExtra && state['nom_enrolled_' + nomId] && state['nom_' + nomId] !== 'submitted') {
    showNomEnrolled(nomId);
  } else if (state['nom_' + nomId] === 'submitted') {
    // Show success screen
    showNomConfirm(nomId);
    const successEl = document.getElementById('nomSuccess-' + nomId);
    if (successEl) {
      const confirmEl = document.getElementById('nomConfirm-' + nomId);
      if (confirmEl) confirmEl.style.display = 'none';
      successEl.style.display = 'block';
    }
  } else {
    showNomConfirm(nomId);
  }
  window.scrollTo(0, 0);
};

window.showNomConfirm = function(nomId) {
  ['nomConfirm-', 'nomForm-', 'nomSuccess-', 'nomEnrolled-'].forEach(prefix => {
    const el = document.getElementById(prefix + nomId);
    if (el) {
      if (prefix === 'nomConfirm-') el.style.display = 'block';
      else { el.style.display = 'none'; el.classList.remove('active'); }
    }
  });
};

window.showNomForm = function(nomId) {
  const confirm = document.getElementById('nomConfirm-' + nomId);
  const form    = document.getElementById('nomForm-' + nomId);
  if (confirm) confirm.style.display = 'none';
  if (form)    form.style.display    = 'block';
  window.scrollTo(0, 0);
};

window.submitNomDetail = async function(nomId) {
  // Collect all inputs in the form
  const form = document.getElementById('nomForm-' + nomId);
  if (!form) return;

  const inputs = form.querySelectorAll('input');
  const formData = {};
  inputs.forEach(inp => { formData[inp.id || inp.name] = inp.value.trim(); });

  const btn = form.querySelector('.nom-submit, .reg-submit-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="btn-spinner"></span>Отправляем...'; }

  try {
    const payload = Object.assign({}, formData, {
      nomination_id: nomId,
      telegram_user_id: TG_ID,
      telegram_username: TG_USER?.username || '',
      telegram_name: [TG_USER?.first_name, TG_USER?.last_name].filter(Boolean).join(' '),
      submitted_at: new Date().toISOString(),
    });

    const res = await fetch('/api/submit-nomination', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка сервера');

    // Mark step done
    const step3 = document.getElementById('nomStep3-' + nomId);
    if (step3) step3.classList.add('done');

    // Hide form, show success
    if (btn) { btn.disabled = false; btn.innerHTML = 'Отправить →'; }
    const success = document.getElementById('nomSuccess-' + nomId);
    if (form)    form.style.display    = 'none';
    if (success) { success.style.display = 'block'; success.classList.add('active'); }

    // Mark card on hub
    const badge = document.getElementById('nomBadge-' + nomId);
    if (badge) { badge.textContent = '✓'; badge.classList.add('done'); }
    const card = document.getElementById('nomCard-' + nomId);
    if (card) card.classList.add('submitted');

    // Save state
    setState({ ['nom_' + nomId]: 'submitted' });
    haptic('medium');
    window.scrollTo(0, 0);

  } catch (err) {
    showToast('Ошибка: ' + err.message, true);
    if (btn) { btn.disabled = false; btn.innerHTML = 'Отправить →'; }
  }
};

// ══ Registration nav button ══
window.handleRegNavBtn = function() {
  if (window.teamRegistered) {
    showToast('Ваша команда уже зарегистрирована!');
  } else {
    showPage('registrationPage');
  }
};

// ══════════════════════════════════════
// DATE-BASED DATA ENTRY PERIODS
// ══════════════════════════════════════
const DATA_PERIODS = {
  spirit:     { start: new Date('2026-08-24'), end: new Date('2026-08-31') },
  tiresome:   { start: new Date('2026-07-09'), end: new Date('2026-07-16') },
  cristalino: { start: new Date('2026-08-01'), end: new Date('2026-08-08') },
  enlighten:  { start: new Date('2026-08-24'), end: new Date('2026-08-30') },
};

function isDataEntryPeriod(nomId) {
  const now = new Date();
  const period = DATA_PERIODS[nomId];
  if (!period) return false;
  return now >= period.start && now <= period.end;
}

function updateFillDataBtns() {
  Object.keys(DATA_PERIODS).forEach(nomId => {
    const btn = document.getElementById('fillDataBtn-' + nomId);
    if (btn) {
      if (isDataEntryPeriod(nomId)) {
        btn.classList.add('visible');
        btn.style.display = 'block';
      } else {
        btn.style.display = 'none';
      }
    }
  });
}

// ══════════════════════════════════════
// ENROLLED STATE MANAGEMENT (task 6)
// ══════════════════════════════════════

// Show enrolled screen (after "Да, участвую")
window.showNomEnrolled = function(nomId) {
  ['nomConfirm-', 'nomForm-', 'nomSuccess-', 'nomEnrolled-'].forEach(prefix => {
    const el = document.getElementById(prefix + nomId);
    if (el) el.style.display = 'none';
  });
  const enrolled = document.getElementById('nomEnrolled-' + nomId);
  if (enrolled) enrolled.style.display = 'block';
  // Update fill data button visibility
  const btn = document.getElementById('fillDataBtn-' + nomId);
  if (btn) btn.style.display = isDataEntryPeriod(nomId) ? 'block' : 'none';
  window.scrollTo(0, 0);
};

// Enroll in a nomination (save state + show enrolled screen + write to Sheets)
window.enrollNom = function(nomId) {
  haptic('medium');
  // Save enrolled state locally immediately (optimistic)
  setState({ ['nom_enrolled_' + nomId]: true });
  showNomEnrolled(nomId);
  // Mark card badge
  const badge = document.getElementById('nomBadge-' + nomId);
  if (badge && badge.textContent !== '✓') {
    badge.textContent = '●';
    badge.style.color = 'var(--hot)';
  }
  // Write enrollment to Google Sheets
  const payload = {
    nomination_id:     nomId,
    telegram_user_id:  TG_ID   || '',
    telegram_username: TG_USER?.username || '',
    telegram_name:     [TG_USER?.first_name, TG_USER?.last_name].filter(Boolean).join(' '),
  };
  fetch('/api/enroll-nomination', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  })
  .then(r => r.json())
  .then(d => {
    if (d.error) showToast('Ошибка записи: ' + d.error, true);
  })
  .catch(() => showToast('Нет связи — попробуй позже', true));
};

// Show the actual data entry form (from enrolled screen)
window.showNomFormFill = function(nomId) {
  ['nomConfirm-', 'nomForm-', 'nomSuccess-', 'nomEnrolled-'].forEach(prefix => {
    const el = document.getElementById(prefix + nomId);
    if (el) el.style.display = 'none';
  });
  const form = document.getElementById('nomForm-' + nomId);
  if (form) form.style.display = 'block';
  window.scrollTo(0, 0);
};

// ══════════════════════════════════════
// DYNAMIC LINK ADDITION (task 7)
// ══════════════════════════════════════
let enlightenLinkCount = 3;

window.addEnlightenLink = function() {
  enlightenLinkCount++;
  const container = document.getElementById('enlighten-extra-links');
  if (!container) return;
  const div = document.createElement('div');
  div.className = 'reg-field-group';
  div.innerHTML = `
    <label for="enlighten-link${enlightenLinkCount}">Ссылка ${enlightenLinkCount} — дополнительно</label>
    <input type="url" id="enlighten-link${enlightenLinkCount}" placeholder="https://..." />
  `;
  container.appendChild(div);
  // Focus new field
  setTimeout(() => div.querySelector('input')?.focus(), 50);
};

// ══════════════════════════════════════
// LICENSE FILE UPLOAD (task 9)
// ══════════════════════════════════════
window.licenseFileData = null;

window.handleLicenseFile = function(input) {
  const file = input.files[0];
  if (!file) return;
  const label = document.getElementById('licenseUploadLabel');
  const nameEl = document.getElementById('licenseFileName');
  if (label) label.classList.add('has-file');
  if (nameEl) nameEl.textContent = '✓ ' + file.name;

  // Read as base64
  const reader = new FileReader();
  reader.onload = function(e) {
    window.licenseFileData = { name: file.name, data: e.target.result };
  };
  reader.readAsDataURL(file);
};

// ══════════════════════════════════════
// MENU PHOTO UPLOAD (task 10)
// ══════════════════════════════════════
window.menuFileData = null;

window.handleMenuFile = function(input) {
  const file = input.files[0];
  if (!file) return;
  const label = document.getElementById('menuUploadLabel');
  const nameEl = document.getElementById('menuFileName');
  const preview = document.getElementById('menuPreview');
  if (label) label.classList.add('has-file');
  if (nameEl) nameEl.textContent = '✓ ' + file.name;

  const reader = new FileReader();
  reader.onload = function(e) {
    window.menuFileData = { name: file.name, data: e.target.result };
    if (preview) {
      preview.src = e.target.result;
      preview.classList.add('visible');
    }
  };
  reader.readAsDataURL(file);
};

window.submitMenuPhoto = async function() {
  const link = document.getElementById('menuPhotoLink')?.value.trim();
  if (!link) {
    showToast('Вставьте ссылку на фото меню', true);
    return;
  }
  const btn = document.getElementById('menuSubmitBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="btn-spinner"></span>Отправляем...'; }

  try {
    const payload = {
      type: 'menu_photo',
      menu_link: link,
      telegram_user_id: TG_ID,
      telegram_username: TG_USER?.username || '',
      telegram_name: [TG_USER?.first_name, TG_USER?.last_name].filter(Boolean).join(' '),
      submitted_at: new Date().toISOString(),
    };
    const res = await fetch('/api/upload-menu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка сервера');

    setState({ menu_uploaded: true });
    haptic('medium');
    applyMenuUploadedUI();
    showToast('Меню успешно загружено!');
  } catch (err) {
    showToast('Ошибка: ' + err.message, true);
    if (btn) { btn.disabled = false; btn.innerHTML = 'Отправить меню →'; }
  }
};

// (applyRegisteredUI is now fully defined near the top — no duplicate needed)

// ══════════════════════════════════════
// RESTORE ENROLLED STATES
// ══════════════════════════════════════
function restoreEnrolledStates() {
  if (!window.teamRegistered) return; // don't restore if not actually registered
  const state = getState();
  ['tiresome', 'cristalino', 'enlighten'].forEach(id => {
    if (state['nom_enrolled_' + id] && state['nom_' + id] !== 'submitted') {
      const badge = document.getElementById('nomBadge-' + id);
      if (badge && badge.textContent === '›') {
        badge.textContent = '●';
        badge.style.color = 'var(--hot)';
      }
    }
  });
}

// ══════════════════════════════════════
// CONSENT FLOW (first visit)
// ══════════════════════════════════════
const CONSENT_KEY = 'espolon_consent_done';

function hasConsented() {
  try { return localStorage.getItem(CONSENT_KEY) === 'yes'; } catch { return false; }
}
function saveConsent() {
  try { localStorage.setItem(CONSENT_KEY, 'yes'); } catch {}
}

// Which step was last declined (to know which agreement to retry)
let _declinedStep = 1;

function showConsent() {
  const overlay = document.getElementById('consentOverlay');
  if (overlay) overlay.style.display = 'flex';
}
function hideConsent() {
  const overlay = document.getElementById('consentOverlay');
  if (overlay) overlay.style.display = 'none';
}

function showConsentStep(id) {
  ['consentStep1', 'consentStep2', 'consentDeclined'].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.style.display = s === id ? 'block' : 'none';
  });
}

window.consentAccept1 = function() {
  // Agreed to personal data — show push agreement
  showConsentStep('consentStep2');
};

window.consentAccept2 = function() {
  // Agreed to both — done
  saveConsent();
  hideConsent();
  haptic('medium');
};

window.consentDecline = function() {
  // Find which step was active
  const step2 = document.getElementById('consentStep2');
  _declinedStep = (step2 && step2.style.display !== 'none') ? 2 : 1;
  showConsentStep('consentDeclined');
};

window.consentRetry = function() {
  // Go back to whichever step was declined
  showConsentStep(_declinedStep === 2 ? 'consentStep2' : 'consentStep1');
};

// ══ Init ══
document.addEventListener('DOMContentLoaded', function() {
  loadUserProfile();
  updateFillDataBtns();

  // Show consent overlay on first visit (before anything else)
  if (!hasConsented()) {
    showConsentStep('consentStep1');
    showConsent();
  }

  // Verify registration against the Google Sheet (async, updates UI when resolved)
  verifyRegistrationWithServer().then(() => {
    // Restore nomination states only AFTER server confirms registration
    restoreNomStates();
    restoreEnrolledStates();
  });
});
