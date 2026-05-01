const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz8wfx6SW-_t83MqzY9ONg7xWfptd5of4WpWZu8nP_rJS-EqaTBXgtxHirccQeapNsl/exec';

/* ── POST to Apps Script as text/plain JSON (no-cors compatible) ── */
async function postToSheet(payload) {
  await fetch(APPS_SCRIPT_URL, {
    method:  'POST',
    mode:    'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body:    JSON.stringify(payload)
  });
}

/* ── State ── */
let step1Data       = {};
let step2Data       = {};
let currentRecordId = '';
const QUEUE_KEY     = 'whr_pending_queue';

/* ── Queue helpers ── */
function queueGet() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch(e) { return []; }
}
function queueSave(q) { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); }
function queueAdd(data) {
  const q = queueGet();
  q.push({ record_id: data.record_id, patient_name: data.patient_name || 'Unknown',
    age: data.age || '', sex: data.sex || '', bp: data.bp || '',
    job_area: data.job_area || '', submitted_at: data.submitted_at, _full: data });
  queueSave(q);
}
function queueRemove(rid) { queueSave(queueGet().filter(p => p.record_id !== rid)); }
function clearQueue() {
  if (!confirm('Clear all pending patients from the queue?')) return;
  queueSave([]); renderQueue();
}
function renderQueue() {
  const q = queueGet();
  const list  = document.getElementById('queueList');
  const badge = document.getElementById('queueCount');
  if (badge) badge.textContent = q.length;
  if (!list) return;
  if (q.length === 0) {
    list.innerHTML = '<div class="queue-empty"><p>No pending patients · Queue is empty</p></div>'; return;
  }
  list.innerHTML = q.map((p, i) => {
    const time = p.submitted_at
      ? new Date(p.submitted_at).toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'})
      : '—';
    const info = [p.age ? p.age+'y' : '', p.sex, p.bp].filter(Boolean).join(' · ');
    const shortId = p.record_id ? p.record_id.split('-').pop() : '—';
    return `<div class="queue-item">
      <div class="q-num">${i+1}</div>
      <div class="q-info">
        <div class="q-name">${p.patient_name}</div>
        <div class="q-meta">${info} &nbsp;·&nbsp; Submitted ${time}</div>
      </div>
      <span class="q-rid">${shortId}</span>
      <button class="q-btn" onclick="loadFromQueue('${p.record_id}')">Open</button>
    </div>`;
  }).join('');
}
function loadFromQueue(rid) {
  const q    = queueGet();
  const item = q.find(p => p.record_id === rid);
  if (!item) { showToast('Record not found in queue.', 'error'); return; }
  openDoctorForm(item._full || item, rid);
}

/* ── Helpers ── */
function show(id)  { document.getElementById(id).style.display = 'block'; }
function hide(id)  { document.getElementById(id).style.display = 'none'; }
function hideAll() {
  ['roleScreen','assistantFormScreen','assistantSuccessScreen','doctorEntryScreen','doctorFormScreen','prescriptionsScreen','dashboardScreen','patientPortalScreen']
    .forEach(id => hide(id));
}
function getChecked(name) {
  return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(e=>e.value).join(', ');
}
function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = `toast ${type}`; t.style.display = 'block';
  setTimeout(() => t.style.display = 'none', 4500);
}
function setRoleStrip(text, color) {
  const s = document.getElementById('roleStrip');
  s.innerHTML = text; s.className = 'role-strip visible';
  s.style.background = color || 'var(--teal-700)';
}
function generateRecordId() {
  const now  = new Date();
  const date = now.getFullYear() + String(now.getMonth()+1).padStart(2,'0') + String(now.getDate()).padStart(2,'0');
  const time = String(now.getHours()).padStart(2,'0') + String(now.getMinutes()).padStart(2,'0');
  const rand = Math.random().toString(36).substring(2,6).toUpperCase();
  return `WHR-${date}-${time}-${rand}`;
}

/* ── Role selector ── */
function startAssistant() {
  hideAll();
  show('assistantFormScreen');
  setRoleStrip('Medical Assistant<span class="role-tag">Sections 1 · 2 · 3</span>', '#2e7d32');
  window.scrollTo({top:0,behavior:'smooth'});
}
function startDoctor() {
  hideAll();
  if (currentRecordId) document.getElementById('doctorRidInput').value = currentRecordId;
  show('doctorEntryScreen');
  renderQueue();
  setRoleStrip('Doctor / Physician<span class="role-tag">Sections 4 · 5 · 6</span>', 'var(--teal-700)');
  window.scrollTo({top:0,behavior:'smooth'});
}
function continueFromSameSession() {
  if (!currentRecordId) { showToast('No session data found. Please enter the Record ID.', 'error'); return; }
  openDoctorForm(step1Data, currentRecordId);
}

/* ── Load Record (doctor enters ID) ── */
async function loadRecord() {
  const ridInput = document.getElementById('doctorRidInput');
  const rid      = ridInput.value.trim().toUpperCase();
  const errEl    = document.getElementById('ridError');
  errEl.style.display = 'none';

  if (!rid) { errEl.textContent = 'Please enter a Record ID.'; errEl.style.display = 'block'; return; }

  // If same session data matches → use it
  if (rid === currentRecordId && Object.keys(step1Data).length > 0) {
    openDoctorForm(step1Data, rid);
    return;
  }

  // Fetch from Apps Script
  const btn = document.querySelector('.btn-load');
  btn.textContent = 'Loading…'; btn.disabled = true;
  try {
    const res = await fetch(`${APPS_SCRIPT_URL}?action=getRecord&id=${encodeURIComponent(rid)}`);
    const json = await res.json();
    if (json.status === 'ok' && json.data) {
      openDoctorForm(json.data, rid);
    } else {
      errEl.textContent = 'Record not found. Check the ID and try again.';
      errEl.style.display = 'block';
    }
  } catch(err) {
    // If CORS/network fails, allow doctor to proceed without pre-fill
    openDoctorForm({}, rid);
    showToast('Could not fetch patient data — please fill all fields manually.', 'error');
  }
  btn.textContent = 'Load Patient'; btn.disabled = false;
}

/* ── Open doctor form ── */
function openDoctorForm(data, rid) {
  step1Data       = { ...data };
  currentRecordId = rid;
  hideAll();
  show('doctorFormScreen');
  document.getElementById('doctorFormRecordId').value = rid;
  document.getElementById('doctorRidDisplay').textContent = rid;
  document.querySelector('input[name="entry_date"]').valueAsDate = new Date();
  buildPatientSummary(data);
  show('patientSummary');
  window.scrollTo({top:0,behavior:'smooth'});
}

/* ── Build read-only patient summary card ── */
function buildPatientSummary(d) {
  const fmt = v => v || '—';
  const items = [
    ['Patient Name', fmt(d.patient_name)],
    ['Age / Sex',    (d.age ? d.age+' yrs' : '—') + ' · ' + fmt(d.sex)],
    ['Height / Weight', (d.height_cm||'—')+' cm · '+(d.weight_kg||'—')+' kg'],
    ['Blood Pressure', fmt(d.bp)],
    ['Job Role',       fmt(d.job_designation)],
    ['Total Exp.',     d.total_experience ? d.total_experience+' yrs' : '—'],
    ['Home Distance',  d.home_distance_km ? d.home_distance_km+' km' : '—'],
    ['Job Nature',     fmt(d.job_nature)],
    ['Work Area',      fmt(d.job_area)],
    ['Chem/Dust Exposure', fmt(d.chemical_exposure)],
    ['Physical Strain',    fmt(d.physical_strain)],
  ];
  const grid = document.getElementById('summaryGrid');
  grid.innerHTML = items.map(([l,v]) =>
    `<div class="summary-item"><div class="s-label">${l}</div><div class="s-value">${v}</div></div>`
  ).join('');
}

/* ── Operation toggle ── */
function toggleOp(val) {
  document.getElementById('operationDetailWrap').style.display = val === 'Yes' ? 'block' : 'none';
}

/* ── ASSISTANT FORM SUBMIT ── */
document.getElementById('assistantForm').addEventListener('submit', async function(e) {
  e.preventDefault();
  let valid = true;
  this.querySelectorAll('[required]').forEach(f => {
    f.style.borderColor = '';
    if (!f.value.trim()) { f.style.borderColor = '#c0392b'; valid = false; }
  });
  if (!document.querySelector('#assistantForm input[name="job_nature"]:checked')) {
    document.querySelectorAll('#assistantForm .radio-pill').forEach(p => p.style.borderColor = '#c0392b');
    valid = false;
  }
  if (!valid) { showToast('Please fill all required fields.', 'error'); return; }

  const btn = document.getElementById('assistantSubmitBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Saving…';

  const fd = new FormData(this);
  const data = {};
  for (const [k,v] of fd.entries()) { if (k !== 'job_area') data[k] = v; }
  data.job_area     = getChecked('job_area');
  data.bp           = `${data.bp_systolic||'—'}/${data.bp_diastolic||'—'}`;
  data.submitted_at = new Date().toISOString();
  data.record_id    = generateRecordId();
  data.form_step    = 'step1';

  try {
    await postToSheet(data);
    step1Data       = { ...data };
    currentRecordId = data.record_id;
    queueAdd(data);
    document.getElementById('displayRecordId').textContent = data.record_id;
    hideAll();
    show('assistantSuccessScreen');
    window.scrollTo({top:0,behavior:'smooth'});
  } catch(err) {
    showToast('Network error. Check connection and retry.', 'error');
  }
  btn.disabled = false; btn.textContent = 'Submit for Doctor Review';
});

/* ── DOCTOR FORM SUBMIT ── */
document.getElementById('doctorForm').addEventListener('submit', async function(e) {
  e.preventDefault();
  let valid = true;
  this.querySelectorAll('[required]').forEach(f => {
    f.style.borderColor = '';
    if (!f.value.trim()) { f.style.borderColor = '#c0392b'; valid = false; }
  });
  if (!valid) { showToast('Please fill all required fields.', 'error'); return; }

  const btn = document.getElementById('doctorSubmitBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Saving Final Record…';

  const fd = new FormData(this);
  const docData = {};
  for (const [k,v] of fd.entries()) {
    if (!['chronic_disease','habit','family_history'].includes(k)) docData[k] = v;
  }
  docData.chronic_disease = getChecked('chronic_disease');
  docData.habit           = getChecked('habit');
  docData.family_history  = getChecked('family_history');
  docData.leave_from      = document.getElementById('leaveFrom')?.value || '';
  docData.leave_to        = document.getElementById('leaveTo')?.value   || '';
  docData.doctor_submitted_at = new Date().toISOString();
  docData.form_step       = 'step2';

  try {
    await postToSheet(docData);
    step2Data = { ...docData };
    queueRemove(docData.record_id);
    prescAdd(step1Data, docData);
    document.getElementById('pdfPanel').style.display = 'block';
    document.getElementById('pdfPanel').scrollIntoView({behavior:'smooth', block:'center'});
    showToast('Record complete. Prescription added to Print Queue.', 'success');
  } catch(err) {
    showToast('Network error. Check connection and retry.', 'error');
  }
  btn.disabled = false; btn.textContent = 'Submit Final Patient Record';
});

/* ── Fill Print Receipt ── */
function fillReceipt(d1, d2) {
  const now = new Date();
  const fmt = v => v || '—';
  /* Ensure bp is always resolved even if only systolic/diastolic stored */
  if (!d1.bp && (d1.bp_systolic || d1.bp_diastolic)) {
    d1.bp = (d1.bp_systolic || '—') + '/' + (d1.bp_diastolic || '—');
  }
  const dateStr = d2.entry_date
    ? new Date(d2.entry_date+'T00:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})
    : '—';

  document.getElementById('pr-ref').textContent           = d1.record_id || '—';
  document.getElementById('pr-date').textContent          = dateStr;
  document.getElementById('pr-submitted').textContent     = now.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  document.getElementById('pr-facility-bar').textContent  = fmt(d2.facility);
  document.getElementById('pr-footer-date').textContent   = now.toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'});
  document.getElementById('pr-doctor_name').textContent   = fmt(d2.doctor_name);
  document.getElementById('pr-bmdc_reg').textContent      = fmt(d2.bmdc_reg);
  document.getElementById('pr-doctor_role').textContent   = fmt(d2.doctor_role);
  document.getElementById('pr-facility').textContent      = fmt(d2.facility);
  document.getElementById('pr-sig-name').textContent      = fmt(d2.doctor_name);
  document.getElementById('pr-sig-bmdc').textContent      = d2.bmdc_reg ? 'BMDC: '+d2.bmdc_reg : '';
  document.getElementById('pr-patient_name').textContent  = fmt(d1.patient_name);
  document.getElementById('pr-mobile_number').textContent = fmt(d1.mobile_number);
  document.getElementById('pr-age').textContent           = d1.age ? d1.age+' years' : '—';
  document.getElementById('pr-sex').textContent           = fmt(d1.sex);
  document.getElementById('pr-height_cm').textContent     = d1.height_cm ? d1.height_cm+' cm' : '—';
  document.getElementById('pr-weight_kg').textContent     = d1.weight_kg ? d1.weight_kg+' kg' : '—';
  document.getElementById('pr-bp').textContent            = fmt(d1.bp);
  document.getElementById('pr-bed_time').textContent      = fmt(d1.bed_time);
  document.getElementById('pr-wake_time').textContent     = fmt(d1.wake_time);
  document.getElementById('pr-sleep').textContent         = (d1.bed_time && d1.wake_time) ? d1.bed_time+' → '+d1.wake_time : '—';
  document.getElementById('pr-job_designation').textContent  = fmt(d1.job_designation);
  document.getElementById('pr-total_experience').textContent = d1.total_experience ? d1.total_experience+' yrs' : '—';
  document.getElementById('pr-home_distance_km').textContent = d1.home_distance_km ? d1.home_distance_km+' km'  : '—';
  document.getElementById('pr-hours_per_day').textContent  = d1.hours_per_day  ? d1.hours_per_day+' hrs'  : '—';
  document.getElementById('pr-hours_per_week').textContent = d1.hours_per_week ? d1.hours_per_week+' hrs' : '—';
  document.getElementById('pr-years_in_role').textContent  = d1.years_in_role  ? d1.years_in_role+' yrs'  : '—';
  document.getElementById('pr-job_nature').textContent    = fmt(d1.job_nature);
  document.getElementById('pr-job_area').textContent      = fmt(d1.job_area);
  document.getElementById('pr-chemical_exposure').textContent     = fmt(d1.chemical_exposure);
  document.getElementById('pr-noise_exposure').textContent        = fmt(d1.noise_exposure);
  document.getElementById('pr-physical_strain').textContent       = fmt(d1.physical_strain);
  document.getElementById('pr-temperature_condition').textContent = fmt(d1.temperature_condition);
  document.getElementById('pr-primary_symptoms').textContent   = fmt(d2.primary_symptoms);
  document.getElementById('pr-secondary_symptoms').textContent = fmt(d2.secondary_symptoms);
  document.getElementById('pr-duration').textContent    = d2.duration_days ? d2.duration_days+' '+(d2.duration_unit||'Days') : '—';
  const sevEl = document.getElementById('pr-severity');
  sevEl.textContent = fmt(d2.severity); sevEl.className = 'val sev-'+(d2.severity||'').toLowerCase();
  document.getElementById('pr-illness_type').textContent       = fmt(d2.illness_type);
  document.getElementById('pr-illness_earlier').textContent    = fmt(d2.illness_earlier);
  document.getElementById('pr-consultation_taken').textContent = fmt(d2.consultation_taken);
  document.getElementById('pr-medication_ongoing').textContent = fmt(d2.medication_ongoing);
  document.getElementById('pr-operation_history').textContent  = fmt(d2.operation_history);
  document.getElementById('pr-operation_detail').textContent   = fmt(d2.operation_detail);
  document.getElementById('pr-chronic_disease').textContent    = fmt(d2.chronic_disease);
  document.getElementById('pr-habit').textContent              = fmt(d2.habit);
  document.getElementById('pr-family_history').textContent     = fmt(d2.family_history);
  document.getElementById('pr-diagnosis').textContent          = fmt(d2.diagnosis);
  document.getElementById('pr-suggested_tests').textContent    = fmt(d2.suggested_tests);
  document.getElementById('pr-medicines').textContent          = fmt(d2.medicines);
  document.getElementById('pr-food_recommendation').textContent     = fmt(d2.food_recommendation);
  document.getElementById('pr-exercise_recommendation').textContent = fmt(d2.exercise_recommendation);
  document.getElementById('pr-followup').textContent = fmt(d2.followup);
  document.getElementById('pr-notes').textContent    = fmt(d2.notes);

  const leaveBox = document.getElementById('pr-leave-box');
  const leaveDays = d2.recommended_leave ? parseInt(d2.recommended_leave) : 0;
  if (leaveDays > 0) {
    document.getElementById('pr-leave-num').textContent = leaveDays;
    /* Format date range */
    const datesEl = document.getElementById('pr-leave-dates');
    if (datesEl) {
      if (d2.leave_from && d2.leave_to) {
        const fmtDate = iso => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'});
        datesEl.textContent = fmtDate(d2.leave_from) + '  →  ' + fmtDate(d2.leave_to);
      } else {
        datesEl.textContent = '';
      }
    }
    leaveBox.style.display = 'flex';
  } else { leaveBox.style.display = 'none'; }
}

/* ── Prescriptions queue ── */
const PRESC_KEY = 'whr_prescriptions';
function prescGet() {
  try { return JSON.parse(localStorage.getItem(PRESC_KEY) || '[]'); } catch(e) { return []; }
}
function prescSave(q) { localStorage.setItem(PRESC_KEY, JSON.stringify(q)); }
function prescAdd(d1, d2) {
  const q = prescGet();
  q.unshift({
    record_id:   d1.record_id || d2.record_id || '—',
    patient_name: d1.patient_name || '—',
    age:          d1.age || '',
    sex:          d1.sex || '',
    bp:           d1.bp || '',
    diagnosis:    d2.diagnosis || '',
    doctor_name:  d2.doctor_name || '',
    facility:     d2.facility || '',
    entry_date:   d2.entry_date || '',
    saved_at:     new Date().toISOString(),
    _d1: d1,
    _d2: d2
  });
  prescSave(q);
}
function prescRemove(rid) { prescSave(prescGet().filter(p => p.record_id !== rid)); renderPrescriptions(); }
function clearPrescriptions() {
  if (!confirm('Remove all prescriptions from the queue?')) return;
  prescSave([]); renderPrescriptions();
}
function startPrescriptions() {
  hideAll();
  show('prescriptionsScreen');
  renderPrescriptions();
  setRoleStrip('Print Prescriptions<span class="role-tag">Print Queue</span>', 'var(--blue-700)');
  window.scrollTo({top:0, behavior:'smooth'});
}
function renderPrescriptions() {
  const q     = prescGet();
  const list  = document.getElementById('prescList');
  const badge = document.getElementById('prescCount');
  if (badge) badge.textContent = q.length;
  if (!list) return;
  if (q.length === 0) {
    list.innerHTML = `<div class="presc-empty">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="#b3bcbe" stroke-width="1.5" stroke-linejoin="round"/><path d="M14 2v6h6M16 13H8m8 4H8" stroke="#b3bcbe" stroke-width="1.5" stroke-linecap="round"/></svg>
      <p>No prescriptions yet · Completed records will appear here</p>
    </div>`;
    return;
  }
  list.innerHTML = q.map((p, i) => {
    const initials = (p.patient_name || '?').split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase();
    const dateStr  = p.entry_date
      ? new Date(p.entry_date+'T00:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})
      : (p.saved_at ? new Date(p.saved_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short'}) : '—');
    const meta = [p.age ? p.age+'y' : '', p.sex, p.bp, p.doctor_name ? 'Dr. '+p.doctor_name.replace(/^Dr\.?\s*/i,'') : ''].filter(Boolean).join(' · ');
    return `<div class="presc-card">
      <div class="pc-avatar">${initials}</div>
      <div class="pc-info">
        <div class="pc-name">${p.patient_name}</div>
        <div class="pc-meta">${meta} &nbsp;·&nbsp; ${dateStr}</div>
        ${p.diagnosis ? `<div class="pc-diagnosis">${p.diagnosis}</div>` : ''}
      </div>
      <span class="pc-rid">${p.record_id}</span>
      <div class="pc-actions">
        <button class="btn-print" onclick="printPrescription('${p.record_id}')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2m-2 4H8v-6h8v6z" stroke="white" stroke-width="2" stroke-linejoin="round"/></svg>
          Print / PDF
        </button>
        <button class="btn-del" onclick="prescRemove('${p.record_id}')" title="Remove from queue">✕</button>
      </div>
    </div>`;
  }).join('');
}
function printPrescription(rid) {
  const q    = prescGet();
  const item = q.find(p => p.record_id === rid);
  if (!item) { showToast('Prescription not found.', 'error'); return; }
  fillReceipt(item._d1 || {}, item._d2 || {});
  setTimeout(() => window.print(), 150);
}





/* ── Leave calendar auto-calculator ── */
function calcLeaveDays() {
  const from = document.getElementById('leaveFrom')?.value;
  const to   = document.getElementById('leaveTo')?.value;
  const disp = document.getElementById('leaveDaysDisplay');
  const num  = document.getElementById('leaveDaysNum');
  const hidden = document.getElementById('recommendedLeaveHidden');
  if (from && to) {
    const diff = Math.round((new Date(to) - new Date(from)) / (1000 * 60 * 60 * 24)) + 1;
    if (diff > 0) {
      if (num)  num.textContent = diff;
      if (disp) disp.style.display = 'flex';
      if (hidden) hidden.value = diff;
    } else {
      if (disp) disp.style.display = 'none';
      if (hidden) hidden.value = '';
    }
  } else {
    if (disp) disp.style.display = 'none';
  }
}

function savePDF() {
  fillReceipt(step1Data, step2Data);
  setTimeout(() => window.print(), 150);
}

function startNewPatient() {
  step1Data = {}; step2Data = {}; currentRecordId = '';
  document.getElementById('assistantForm').reset();
  document.getElementById('doctorForm').reset();
  document.getElementById('pdfPanel').style.display = 'none';
  document.getElementById('patientSummary').style.display = 'none';
  document.getElementById('ridError').style.display = 'none';
  document.getElementById('roleStrip').className = 'role-strip';
  hideAll(); show('roleScreen');
  window.scrollTo({top:0,behavior:'smooth'});
}

/* ── Auto-refresh prescription badge on role screen ── */
document.addEventListener('DOMContentLoaded', () => {
  const q = prescGet();
  const el = document.querySelector('.presc-badge-count');
  if (el) el.textContent = q.length;
});

/* ════════════════════════════════════════════════════
   MANAGEMENT ANALYTICS DASHBOARD
   Uses same APPS_SCRIPT_URL — no separate config needed
════════════════════════════════════════════════════ */
let dashPeriod   = 'daily';
let dashRecords  = [];
let dashCharts   = {};
const DASH_COLORS = ['#0e7a82','#4db6c0','#0a5157','#cef0f2','#f59e0b','#fde68a','#dc2626','#fecaca','#16a34a','#bbf7d0','#1d4ed8','#bfdbfe','#7c3aed','#ddd6fe'];

function startDashboard() {
  hideAll();
  show('dashboardScreen');
  setRoleStrip('Management Dashboard<span class="role-tag">Analytics</span>', '#b45309');
  window.scrollTo({top:0,behavior:'smooth'});
  dashLoad();
}

let dashDateFrom = null;  // custom range start
let dashDateTo   = null;  // custom range end

function dashSetPeriod(p, btn) {
  dashPeriod = p;
  document.querySelectorAll('.dash-period-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');

  const rangeRow   = document.getElementById('dashDateRangeRow');
  const rangeLabel = document.getElementById('dashRangeLabel');

  if (p === 'weekly') {
    // Auto-set this week Mon–today
    const now  = new Date();
    const mon  = new Date(now);
    mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    document.getElementById('dashDateFrom').value = toISO(mon);
    document.getElementById('dashDateTo').value   = toISO(now);
    dashDateFrom = mon;
    dashDateTo   = new Date(now.setHours(23,59,59,999));
    rangeRow.style.display   = 'flex';
    rangeLabel.style.display = 'block';
    rangeLabel.textContent   = fmtShort(mon) + ' – ' + fmtShort(new Date());
    if (dashRecords.length) dashRenderAll();
  } else if (p === 'custom') {
    rangeRow.style.display   = 'flex';
    rangeLabel.style.display = 'none';
    // Keep previous dates if set, else default to last 30 days
    if (!document.getElementById('dashDateFrom').value) {
      const ago30 = new Date(); ago30.setDate(ago30.getDate() - 30);
      document.getElementById('dashDateFrom').value = toISO(ago30);
      document.getElementById('dashDateTo').value   = toISO(new Date());
    }
  } else {
    rangeRow.style.display   = 'none';
    rangeLabel.style.display = 'none';
    dashDateFrom = null;
    dashDateTo   = null;
    if (dashRecords.length) dashRenderAll();
  }
}

function dashApplyRange() {
  const fromVal = document.getElementById('dashDateFrom').value;
  const toVal   = document.getElementById('dashDateTo').value;
  if (!fromVal || !toVal) { showToast('Please select both From and To dates.', 'error'); return; }
  dashDateFrom = new Date(fromVal + 'T00:00:00');
  dashDateTo   = new Date(toVal   + 'T23:59:59');
  if (dashDateFrom > dashDateTo) { showToast('From date must be before To date.', 'error'); return; }
  const lbl = document.getElementById('dashRangeLabel');
  lbl.textContent   = fmtShort(dashDateFrom) + ' – ' + fmtShort(dashDateTo);
  lbl.style.display = 'block';
  if (dashRecords.length) dashRenderAll();
}

function toISO(d) {
  return d.getFullYear() + '-' +
    String(d.getMonth()+1).padStart(2,'0') + '-' +
    String(d.getDate()).padStart(2,'0');
}
function fmtShort(d) {
  return d.toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'});
}

async function dashLoad() {
  const btn = document.getElementById('dashRefreshBtn');
  btn.disabled = true;
  document.getElementById('dashInner').innerHTML =
    "<div class=\"dash-loading\"><div class=\"spin-ring\"></div><p style=\"font-family:DM Mono,monospace;font-size:11px;color:var(--ink-30)\">Fetching records from Google Sheets…</p></div>";

  try {
    const res  = await fetch(APPS_SCRIPT_URL + '?action=getAll');
    const json = await res.json();
    if (json.status !== 'ok' || !json.records) throw new Error(json.message || 'No data returned');
    dashRecords = json.records.filter(r => r.patient_name || r.primary_symptoms);
    dashRenderAll();
  } catch(err) {
    document.getElementById('dashInner').innerHTML =
      `<div class="dash-no-data">Failed to load: ${err.message}<br><br>
       <button onclick="dashLoad()" style="font-family:DM Mono,monospace;font-size:11px;background:var(--teal-700);color:white;border:none;border-radius:4px;padding:6px 16px;cursor:pointer">Retry</button></div>`;
  }
  btn.disabled = false;
}

function dashFilter() {
  const now = new Date();
  return dashRecords.filter(r => {
    const d = new Date(r.submitted_at || r.entry_date);
    if (isNaN(d)) return false;
    if (dashPeriod === 'daily')  return d.toDateString() === now.toDateString();
    if (dashPeriod === 'weekly' || dashPeriod === 'custom') {
      if (!dashDateFrom || !dashDateTo) return true;
      return d >= dashDateFrom && d <= dashDateTo;
    }
    if (dashPeriod === 'monthly') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    return d.getFullYear() === now.getFullYear(); // yearly
  });
}

function dashCount(records, field) {
  const m = {};
  records.forEach(r => {
    const v = r[field];
    if (!v || v === '' || v === '—') return;
    v.toString().split(',').forEach(x => {
      const k = x.trim();
      if (k && k !== 'None' && k !== 'None / Not known') m[k] = (m[k]||0) + 1;
    });
  });
  return Object.entries(m).sort((a,b)=>b[1]-a[1]);
}
function dashCountExact(records, field) {
  const m = {};
  records.forEach(r => { const k=(r[field]||'').trim(); if(k&&k!=='—') m[k]=(m[k]||0)+1; });
  return Object.entries(m).sort((a,b)=>b[1]-a[1]);
}
function dashAvg(records, field) {
  const v = records.map(r=>parseFloat(r[field])).filter(x=>!isNaN(x)&&x>0);
  return v.length ? (v.reduce((a,b)=>a+b,0)/v.length).toFixed(1) : '—';
}
function destroyDashChart(id) { if(dashCharts[id]){dashCharts[id].destroy();delete dashCharts[id];} }

function dashRenderAll() {
  const f = dashFilter();
  const all = dashRecords;
  const labelMap = {daily:'Today', weekly:'This Week', monthly:'This Month', yearly:'This Year', custom:'Custom Range'};
  let label = labelMap[dashPeriod] || dashPeriod;
  if ((dashPeriod === 'weekly' || dashPeriod === 'custom') && dashDateFrom && dashDateTo) {
    label = fmtShort(dashDateFrom) + ' → ' + fmtShort(dashDateTo);
  }
  document.getElementById('dashSubLabel').textContent =
    label + ' · ' + f.length + ' records (' + all.length + ' all-time) · Updated ' + new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});

  let html = '';

  // KPIs
  const crit  = f.filter(r=>r.severity==='Critical').length;
  const sev   = f.filter(r=>r.severity==='Severe').length;
  const comp  = f.filter(r=>r.doctor_submitted_at).length;
  const critPct = f.length ? Math.round(((crit+sev)/f.length)*100) : 0;
  html += `<div class="dash-kpi-row">
    <div class="dash-kpi"><div class="dash-kpi-label">Total Cases</div><div class="dash-kpi-val">${f.length}</div><div class="dash-kpi-sub">${all.length} all-time</div></div>
    <div class="dash-kpi d"><div class="dash-kpi-label">Critical + Severe</div><div class="dash-kpi-val" style="color:#dc2626">${crit+sev}</div><div class="dash-kpi-sub">${critPct}% of cases</div></div>
    <div class="dash-kpi w"><div class="dash-kpi-label">Avg Leave Days</div><div class="dash-kpi-val" style="color:#b45309">${dashAvg(f,'recommended_leave')}</div><div class="dash-kpi-sub">per patient</div></div>
    <div class="dash-kpi g"><div class="dash-kpi-label">Completed Records</div><div class="dash-kpi-val" style="color:#16a34a">${comp}</div><div class="dash-kpi-sub">${f.length-comp} pending doctor</div></div>
    <div class="dash-kpi i"><div class="dash-kpi-label">Avg Age</div><div class="dash-kpi-val" style="color:#1d4ed8">${dashAvg(f,'age')}</div><div class="dash-kpi-sub">years</div></div>
    <div class="dash-kpi"><div class="dash-kpi-label">Avg Hrs/Week</div><div class="dash-kpi-val">${dashAvg(f,'hours_per_week')}</div><div class="dash-kpi-sub">working hours</div></div>
  </div>`;

  // Insight strip
  const topArea = dashCount(f,'job_area')[0];
  const topDis  = dashCount(f,'chronic_disease')[0];
  html += `<div class="dash-insight">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style="flex-shrink:0;margin-top:2px"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke="#4db6c0" stroke-width="1.8" stroke-linejoin="round"/></svg>
    <p>${critPct}% of cases this period are Severe or Critical.${topArea?` Highest-risk area: <strong>${topArea[0]}</strong> (${topArea[1]} cases).`:''}${topDis?` Most common chronic condition: <strong>${topDis[0]}</strong> (${topDis[1]} patients).`:''}</p>
  </div>`;

  // Chart containers
  html += `
  <div class="dash-section-head">Illness Trend Over Time</div>
  <div class="dash-charts-1"><div class="dash-chart-card"><div class="dash-chart-title" id="trendTitle">Trend</div><div class="dash-chart-wrap h300"><canvas id="dc_trend"></canvas></div></div></div>

  <div class="dash-section-head">Job Area &amp; Job Nature</div>
  <div class="dash-charts-2">
    <div class="dash-chart-card"><div class="dash-chart-title">Cases by Work Area</div><div class="dash-chart-wrap h260"><canvas id="dc_area"></canvas></div></div>
    <div class="dash-chart-card"><div class="dash-chart-title">Cases by Job Nature</div><div class="dash-chart-wrap h260"><canvas id="dc_nature"></canvas></div></div>
  </div>

  <div class="dash-section-head">Disease &amp; Severity</div>
  <div class="dash-charts-2">
    <div class="dash-chart-card"><div class="dash-chart-title">Severity Distribution</div><div class="dash-chart-wrap h220"><canvas id="dc_severity"></canvas></div></div>
    <div class="dash-chart-card"><div class="dash-chart-title">Type of Illness</div><div class="dash-chart-wrap h220"><canvas id="dc_illtype"></canvas></div></div>
  </div>

  <div class="dash-section-head">Top Risk Factors</div>
  <div class="dash-charts-2">
    <div class="dash-chart-card"><div class="dash-chart-title">Top Chronic Diseases</div><ul class="dash-rank-list" id="dc_chronic"></ul></div>
    <div class="dash-chart-card"><div class="dash-chart-title">Environmental Exposure</div><ul class="dash-rank-list" id="dc_env"></ul></div>
  </div>

  <div class="dash-section-head">Demographics</div>
  <div class="dash-charts-3">
    <div class="dash-chart-card"><div class="dash-chart-title">Sex Distribution</div><div class="dash-chart-wrap h220"><canvas id="dc_sex"></canvas></div></div>
    <div class="dash-chart-card"><div class="dash-chart-title">Age Groups</div><div class="dash-chart-wrap h220"><canvas id="dc_age"></canvas></div></div>
    <div class="dash-chart-card"><div class="dash-chart-title">Work Hrs vs Severity</div><div class="dash-chart-wrap h220"><canvas id="dc_hrs"></canvas></div></div>
  </div>

  <div class="dash-section-head">Medical Leave &amp; Follow-up</div>
  <div class="dash-charts-2">
    <div class="dash-chart-card"><div class="dash-chart-title">Leave Duration</div><div class="dash-chart-wrap h220"><canvas id="dc_leave"></canvas></div></div>
    <div class="dash-chart-card"><div class="dash-chart-title">Follow-up Required</div><div class="dash-chart-wrap h220"><canvas id="dc_followup"></canvas></div></div>
  </div>

  <div class="dash-section-head">Management Action Plan <span style="font-weight:400;color:var(--ink-30);font-size:9px;letter-spacing:0;text-transform:none;margin-left:6px">Auto-generated from data</span></div>
  <div class="dash-action-grid" id="dc_actions"></div>
  <div style="height:2rem"></div>`;

  document.getElementById('dashInner').innerHTML = html;

  // Render charts after DOM update
  setTimeout(() => {
    dashDrawTrend(all); dashDrawArea(f); dashDrawNature(f);
    dashDrawSeverity(f); dashDrawIllType(f);
    dashDrawRank('dc_chronic', dashCount(f,'chronic_disease'));
    dashDrawEnvRank(f);
    dashDrawSex(f); dashDrawAge(f); dashDrawHrs(f);
    dashDrawLeave(f); dashDrawFollowup(f);
    dashDrawActions(f, all);
  }, 50);
}

function dashDrawTrend(all) {
  destroyDashChart('dc_trend');
  const grouped = {};
  all.forEach(r => {
    const d = new Date(r.submitted_at || r.entry_date);
    if (isNaN(d)) return;
    const key = (dashPeriod === 'daily' || dashPeriod === 'weekly' || dashPeriod === 'custom')
              ? d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'})
              : dashPeriod === 'monthly'
              ? d.toLocaleDateString('en-GB',{month:'short',year:'numeric'})
              : d.getFullYear().toString();
    grouped[key] = (grouped[key]||0) + 1;
  });
  const entries = Object.entries(grouped).slice(-30);
  const titles = {daily:'Daily Trend',weekly:'Weekly — Day by Day',monthly:'Monthly Trend',yearly:'Yearly Trend',custom:'Custom Range Trend'};
  document.getElementById('trendTitle').textContent = titles[dashPeriod] || 'Trend';
  const ctx = document.getElementById('dc_trend').getContext('2d');
  dashCharts.dc_trend = new Chart(ctx, {
    type:'line',
    data:{labels:entries.map(e=>e[0]),datasets:[{label:'Cases',data:entries.map(e=>e[1]),borderColor:'#0e7a82',backgroundColor:'rgba(14,122,130,0.07)',fill:true,tension:0.4,pointBackgroundColor:'#0e7a82',pointRadius:4,borderWidth:2}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{color:'rgba(0,0,0,0.04)'},ticks:{font:{size:10}}},y:{beginAtZero:true,grid:{color:'rgba(0,0,0,0.04)'},ticks:{stepSize:1,font:{size:10}}}}}
  });
}
function dashDrawBar(id, data, horizontal) {
  destroyDashChart(id);
  if (!data.length) return;
  const el = document.getElementById(id);
  if (!el) return;
  dashCharts[id] = new Chart(el.getContext('2d'), {
    type:'bar',
    data:{labels:data.map(d=>d[0]),datasets:[{label:'Cases',data:data.map(d=>d[1]),backgroundColor:DASH_COLORS,borderRadius:4,borderSkipped:false}]},
    options:{indexAxis:horizontal?'y':'x',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:horizontal?{color:'rgba(0,0,0,0.04)'}:{display:false},ticks:{font:{size:10}}},y:{grid:horizontal?{display:false}:{color:'rgba(0,0,0,0.04)'},beginAtZero:true,ticks:{font:{size:10}}}}}
  });
}
function dashDrawDoughnut(id, data) {
  destroyDashChart(id);
  if (!data.length) return;
  const el = document.getElementById(id);
  if (!el) return;
  dashCharts[id] = new Chart(el.getContext('2d'), {
    type:'doughnut',
    data:{labels:data.map(d=>d[0]),datasets:[{data:data.map(d=>d[1]),backgroundColor:DASH_COLORS.slice(0,data.length),borderWidth:2,borderColor:'#fff'}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{size:10},padding:10}}}}
  });
}
function dashDrawArea(f)     { dashDrawBar('dc_area', dashCount(f,'job_area').slice(0,8), true); }
function dashDrawNature(f)   { dashDrawDoughnut('dc_nature', dashCountExact(f,'job_nature')); }
function dashDrawIllType(f)  { dashDrawDoughnut('dc_illtype', dashCountExact(f,'illness_type').filter(d=>d[0])); }
function dashDrawSex(f)      { dashDrawDoughnut('dc_sex', dashCountExact(f,'sex')); }
function dashDrawSeverity(f) {
  destroyDashChart('dc_severity');
  const el = document.getElementById('dc_severity'); if(!el)return;
  const order=['Mild','Moderate','Severe','Critical'];
  const colors=['#16a34a','#f59e0b','#ea580c','#dc2626'];
  dashCharts.dc_severity = new Chart(el.getContext('2d'),{
    type:'bar',
    data:{labels:order,datasets:[{label:'Cases',data:order.map(s=>f.filter(r=>r.severity===s).length),backgroundColor:colors,borderRadius:6,borderSkipped:false}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{font:{size:10}}},y:{beginAtZero:true,grid:{color:'rgba(0,0,0,0.04)'},ticks:{stepSize:1,font:{size:10}}}}}
  });
}
function dashDrawAge(f) {
  destroyDashChart('dc_age');
  const el=document.getElementById('dc_age'); if(!el)return;
  const b={'15–24':0,'25–34':0,'35–44':0,'45–54':0,'55+':0};
  f.forEach(r=>{const a=parseInt(r.age);if(!a)return;if(a<25)b['15–24']++;else if(a<35)b['25–34']++;else if(a<45)b['35–44']++;else if(a<55)b['45–54']++;else b['55+']++;});
  dashCharts.dc_age=new Chart(el.getContext('2d'),{type:'bar',data:{labels:Object.keys(b),datasets:[{data:Object.values(b),backgroundColor:'#4db6c0',borderRadius:4,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{font:{size:10}}},y:{beginAtZero:true,grid:{color:'rgba(0,0,0,0.04)'},ticks:{stepSize:1,font:{size:10}}}}}});
}
function dashDrawHrs(f) {
  destroyDashChart('dc_hrs');
  const el=document.getElementById('dc_hrs'); if(!el)return;
  const order=['Mild','Moderate','Severe','Critical'];
  const colors=['#16a34a','#f59e0b','#ea580c','#dc2626'];
  const avgs=order.map(s=>{const v=f.filter(r=>r.severity===s).map(r=>parseFloat(r.hours_per_week)).filter(x=>!isNaN(x)&&x>0);return v.length?+(v.reduce((a,b)=>a+b)/v.length).toFixed(1):0;});
  dashCharts.dc_hrs=new Chart(el.getContext('2d'),{type:'bar',data:{labels:order,datasets:[{data:avgs,backgroundColor:colors,borderRadius:4,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{font:{size:10}}},y:{beginAtZero:true,grid:{color:'rgba(0,0,0,0.04)'},ticks:{font:{size:10}}}}}});
}
function dashDrawLeave(f) {
  destroyDashChart('dc_leave');
  const el=document.getElementById('dc_leave'); if(!el)return;
  const b={'0 days':0,'1–3':0,'4–7':0,'8–14':0,'15+':0};
  f.forEach(r=>{const d=parseInt(r.recommended_leave);if(isNaN(d)||d===0)b['0 days']++;else if(d<=3)b['1–3']++;else if(d<=7)b['4–7']++;else if(d<=14)b['8–14']++;else b['15+']++;});
  dashCharts.dc_leave=new Chart(el.getContext('2d'),{type:'doughnut',data:{labels:Object.keys(b),datasets:[{data:Object.values(b),backgroundColor:['#cef0f2','#4db6c0','#0e7a82','#f59e0b','#dc2626'],borderWidth:2,borderColor:'#fff'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{size:10},padding:8}}}}});
}
function dashDrawFollowup(f) { dashDrawBar('dc_followup', dashCountExact(f,'followup').filter(d=>d[0]&&d[0]!=='Not required'), true); }

function dashDrawRank(id, data) {
  const el=document.getElementById(id); if(!el)return;
  if(!data.length){el.innerHTML='<li class="dash-rank-item"><span style="font-size:0.8rem;color:var(--ink-30)">No data</span></li>';return;}
  const max=data[0][1];
  el.innerHTML=data.slice(0,8).map((d,i)=>`
    <li class="dash-rank-item">
      <span class="dash-rank-n">${i+1}</span>
      <span class="dash-rank-label">${d[0]}</span>
      <div class="dash-rank-bar-wrap"><div class="dash-rank-bar" style="width:${Math.round((d[1]/max)*100)}%"></div></div>
      <span class="dash-rank-count">${d[1]}</span>
    </li>`).join('');
}

function dashDrawEnvRank(f) {
  const risks=[
    ...dashCountExact(f,'chemical_exposure').filter(d=>d[0]&&!d[0].startsWith('No')),
    ...dashCountExact(f,'noise_exposure').filter(d=>d[0]&&!d[0].includes('Normal')),
    ...dashCountExact(f,'physical_strain').filter(d=>d[0]==='High'),
    ...dashCountExact(f,'temperature_condition').filter(d=>d[0]&&d[0]!=='Normal')
  ].sort((a,b)=>b[1]-a[1]);
  dashDrawRank('dc_env', risks);
}

function dashDrawActions(f, all) {
  const el=document.getElementById('dc_actions'); if(!el)return;
  if(!f.length){el.innerHTML='<p class="dash-no-data">No records in this period for action plan.</p>';return;}
  const total=f.length;
  const critSev=f.filter(r=>r.severity==='Critical'||r.severity==='Severe').length;
  const critPct=Math.round((critSev/total)*100);
  const topArea=dashCount(f,'job_area')[0];
  const topDis=dashCount(f,'chronic_disease')[0];
  const highStrain=f.filter(r=>r.physical_strain==='High').length;
  const highNoise=f.filter(r=>r.noise_exposure&&!r.noise_exposure.includes('Normal')).length;
  const avgHrs=parseFloat(dashAvg(f,'hours_per_week'));
  const avgLeave=parseFloat(dashAvg(f,'recommended_leave'));
  const pending=f.filter(r=>!r.doctor_submitted_at).length;

  const acts=[];
  if(critPct>=30) acts.push({c:'cr',pri:'Urgent Action',t:'High Rate of Severe/Critical Cases',b:`${critPct}% of cases are Severe or Critical. Activate emergency medical protocols immediately.`,m:`${critSev} of ${total} cases`});
  else if(critSev>0) acts.push({c:'wa',pri:'Action Required',t:'Severe Cases Detected',b:`${critSev} severe/critical cases. Ensure rapid triage and specialist referral pathways are active.`,m:`${critPct}% severity rate`});

  if(topArea&&topArea[1]>=2) acts.push({c:'wa',pri:'Action Required',t:`High Risk Area: ${topArea[0]}`,b:'Conduct immediate ergonomic and environmental audit. Consider workstation improvements and job rotation policies.',m:`${topArea[1]} cases from this area`});

  if(topDis&&topDis[1]>=2) acts.push({c:'wa',pri:'Action Required',t:`Chronic Disease: ${topDis[0]}`,b:'Arrange periodic health screening camps and disease management education. Coordinate with MBBS doctors for follow-up.',m:`${topDis[1]} patients affected`});

  if(highStrain>=3) acts.push({c:'wa',pri:'Action Required',t:'Physical Strain Overload',b:'Introduce job rotation, scheduled rest breaks, and ergonomic training. Review manual handling workload standards.',m:`${highStrain} high-strain workers`});

  if(highNoise>=3) acts.push({c:'in',pri:'Monitor',t:'Noise Exposure Risk',b:'Workers in above-normal noise. Enforce hearing protection, conduct audiometry testing, and do noise level mapping.',m:`${highNoise} workers exposed`});

  if(avgHrs>54) acts.push({c:'wa',pri:'Action Required',t:'Excessive Working Hours',b:`Average ${avgHrs} hrs/week exceeds recommended 48 hrs. Review shift scheduling and ensure mandatory rest compliance.`,m:`${avgHrs} avg hrs/week`});
  else if(avgHrs>0) acts.push({c:'go',pri:'Positive',t:'Working Hours Within Limit',b:`Average ${avgHrs} hrs/week is within acceptable range. Continue monitoring for compliance.`,m:`${avgHrs} avg hrs/week`});

  if(avgLeave>5) acts.push({c:'in',pri:'Monitor',t:'High Medical Leave Usage',b:'Average leave exceeds 5 days. Review root causes of prolonged illness and address occupational stressors.',m:`${avgLeave} avg leave days`});

  if(pending>0) acts.push({c:'in',pri:'Monitor',t:`${pending} Records Pending Doctor Review`,b:'Ensure timely clinical completion for all registered patients.',m:`${pending} incomplete records`});

  acts.push({c:'in',pri:'Preventive Programme',t:'Regular Health Screening',b:'Schedule quarterly health camps: BP, glucose, BMI, and vision. Prioritise departments with highest illness rates.',m:'Recommended quarterly'});

  if(!acts.find(a=>a.c==='go')) acts.push({c:'go',pri:'Positive',t:'Active Health Monitoring',b:`All-time registry contains ${all.length} patient records. Continued data collection strengthens workplace health evidence base.`,m:`${all.length} records total`});

  el.innerHTML=acts.map(a=>`
    <div class="dash-action ${a.c}">
      <div class="dash-action-pri">${a.c==='cr'?'🔴':a.c==='wa'?'🟡':a.c==='go'?'🟢':'ℹ️'} ${a.pri}</div>
      <h4>${a.t}</h4>
      <p>${a.b}</p>
      <div class="dash-action-metric">${a.m}</div>
    </div>`).join('');
}

/* ── Auto-refresh prescription badge on role screen ── */
document.addEventListener('DOMContentLoaded', () => {
  const q = prescGet();
  const el = document.querySelector('.presc-badge-count');
  if (el) el.textContent = q.length;
});

/* ════════════════════════════════════════════════════
   PATIENT PORTAL — My Health File
   Patient enters mobile number → sees all their visits
════════════════════════════════════════════════════ */

// Active portal records for printing
let portalRecords = [];

function startPatientPortal() {
  hideAll();
  show('patientPortalScreen');
  setRoleStrip('Patient Portal<span class="role-tag">My Health File</span>', '#7c3aed');
  // Clear previous search
  document.getElementById('portalMobileInput').value = '';
  document.getElementById('portalError').style.display = 'none';
  document.getElementById('portalResults').style.display = 'none';
  document.getElementById('portalResults').innerHTML = '';
  portalRecords = [];
  window.scrollTo({top:0, behavior:'smooth'});
  setTimeout(() => document.getElementById('portalMobileInput').focus(), 300);
}

async function portalSearch() {
  const mobile = document.getElementById('portalMobileInput').value.trim();
  const errEl  = document.getElementById('portalError');
  const btn    = document.getElementById('portalSearchBtn');

  errEl.style.display = 'none';
  document.getElementById('portalResults').style.display = 'none';

  if (!mobile) {
    errEl.textContent = 'Please enter your mobile number.';
    errEl.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="border-color:rgba(255,255,255,0.3);border-top-color:white;width:12px;height:12px;border-width:2px"></span> Searching…';

  try {
    const res  = await fetch(APPS_SCRIPT_URL + '?action=getPatient&mobile=' + encodeURIComponent(mobile));
    const json = await res.json();

    if (json.status !== 'ok') {
      errEl.textContent = 'Server error: ' + (json.message || 'Unknown error');
      errEl.style.display = 'block';
    } else if (!json.records || json.records.length === 0) {
      // Show debug info to help trace the issue
      const debugMsg = json.message || '';
      errEl.textContent = 'No records found for this mobile number. ' +
        (debugMsg ? '(' + debugMsg + ')' : 'Please check the number and try again.');
      errEl.style.display = 'block';
    } else {
      portalRecords = json.records;
      renderPortalResults(json.records);
    }
  } catch(err) {
    errEl.textContent = 'Could not connect. Please check your internet and try again.';
    errEl.style.display = 'block';
  }

  btn.disabled = false;
  btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke="white" stroke-width="2"/><path d="M21 21l-4.35-4.35" stroke="white" stroke-width="2" stroke-linecap="round"/></svg> Find My Records';
}

function renderPortalResults(records) {
  const fmt  = v => (v && v !== '' && v !== '—') ? v : '—';
  const first = records[0];
  const name  = fmt(first.patient_name);
  const initials = name.split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase();

  let html = '';

  // Patient banner
  html += `
  <div class="portal-patient-banner">
    <div class="portal-avatar">${initials}</div>
    <div class="portal-patient-info">
      <h3>${name}</h3>
      <p>${fmt(first.mobile_number)} &nbsp;·&nbsp; ${first.age ? first.age + ' years' : ''} &nbsp;·&nbsp; ${fmt(first.sex)}</p>
    </div>
    <div class="portal-visit-count">
      <div class="vc-num">${records.length}</div>
      <div class="vc-label">Visit${records.length !== 1 ? 's' : ''}</div>
    </div>
  </div>`;

  // Visit cards (newest first)
  html += '<div class="portal-visits-list">';
  [...records].reverse().forEach((r, i) => {
    const visitNum  = records.length - i;
    const dateStr   = r.entry_date
      ? new Date(r.entry_date + 'T00:00:00').toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'})
      : (r.submitted_at ? new Date(r.submitted_at).toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'}) : '—');
    const sev       = (r.severity || '').toLowerCase();
    const sevClass  = sev ? 'sev-' + sev : '';
    const sevBadge  = r.severity ? `<span class="portal-sev-badge ${sevClass}">${r.severity}</span>` : '';
    const isComplete = r.doctor_submitted_at || r.doctor_name;

    html += `
    <div class="portal-visit-card">
      <div class="portal-visit-header">
        <div class="portal-visit-num">${visitNum}</div>
        <div class="portal-visit-date">${dateStr}</div>
        ${sevBadge}
        <div class="portal-visit-doc">${r.doctor_name ? 'Dr. ' + r.doctor_name.replace(/^Dr\.?\s*/i,'') : 'Pending doctor'}</div>
      </div>
      <div class="portal-visit-body">`;

    if (!isComplete) {
      html += `<p style="font-size:0.83rem;color:var(--ink-30);font-family:DM Mono,monospace;text-align:center;padding:1rem 0">Record pending doctor assessment</p>`;
    } else {
      // Basic info row
      html += `<div class="portal-detail-grid">
        <div class="portal-detail-item">
          <div class="pd-label">Facility</div>
          <div class="pd-val">${fmt(r.facility)}</div>
        </div>
        <div class="portal-detail-item">
          <div class="pd-label">Job / Work Area</div>
          <div class="pd-val">${fmt(r.job_area)}</div>
        </div>`;

      if (r.primary_symptoms) {
        html += `<div class="portal-detail-item full">
          <div class="pd-label">Primary Symptoms</div>
          <div class="pd-val">${fmt(r.primary_symptoms)}</div>
        </div>`;
      }
      if (r.secondary_symptoms) {
        html += `<div class="portal-detail-item full">
          <div class="pd-label">Secondary Symptoms</div>
          <div class="pd-val">${fmt(r.secondary_symptoms)}</div>
        </div>`;
      }
      if (r.duration_days) {
        html += `<div class="portal-detail-item">
          <div class="pd-label">Duration</div>
          <div class="pd-val">${r.duration_days} ${r.duration_unit || 'Days'}</div>
        </div>`;
      }
      if (r.diagnosis) {
        html += `<div class="portal-detail-item full">
          <div class="pd-label">Diagnosis</div>
          <div class="pd-val">${fmt(r.diagnosis)}</div>
        </div>`;
      }
      html += `</div>`;

      // Prescription box
      const hasRx = r.medicines || r.suggested_tests || r.food_recommendation || r.exercise_recommendation;
      if (hasRx) {
        html += `<div class="portal-rx-box">
          <div class="portal-rx-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" stroke="#0a5157" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Doctor's Prescription
          </div>
          <div class="portal-rx-grid">`;

        if (r.medicines) html += `<div class="portal-detail-item full"><div class="pd-label">Recommended Medicines</div><div class="pd-val" style="white-space:pre-wrap">${fmt(r.medicines)}</div></div>`;
        if (r.suggested_tests) html += `<div class="portal-detail-item full"><div class="pd-label">Suggested Tests</div><div class="pd-val" style="white-space:pre-wrap">${fmt(r.suggested_tests)}</div></div>`;
        if (r.food_recommendation) html += `<div class="portal-detail-item"><div class="pd-label">Food Recommendation</div><div class="pd-val" style="white-space:pre-wrap">${fmt(r.food_recommendation)}</div></div>`;
        if (r.exercise_recommendation) html += `<div class="portal-detail-item"><div class="pd-label">Exercise Recommendation</div><div class="pd-val" style="white-space:pre-wrap">${fmt(r.exercise_recommendation)}</div></div>`;

        html += `</div>`; // rx-grid

        if (r.followup) {
          html += `<div style="margin-top:10px"><div class="pd-label">Follow-up</div><div class="pd-val" style="margin-top:3px">${fmt(r.followup)}</div></div>`;
        }
        html += `</div>`; // rx-box
      }

      // Leave pill
      if (r.recommended_leave && parseInt(r.recommended_leave) > 0) {
        const leaveDates = (r.leave_from && r.leave_to)
          ? ` (${new Date(r.leave_from+'T00:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short'})} – ${new Date(r.leave_to+'T00:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})})`
          : '';
        html += `<div class="portal-leave-pill">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="18" rx="2" stroke="#b45309" stroke-width="1.8"/><path d="M16 2v4M8 2v4M3 10h18" stroke="#b45309" stroke-width="1.8" stroke-linecap="round"/></svg>
          Medical leave: <strong>${r.recommended_leave} days</strong>${leaveDates}
        </div>`;
      }

      // Print button
      html += `<button class="btn-print-rx" onclick="portalPrint(${records.indexOf(r)})">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2m-2 4H8v-6h8v6z" stroke="white" stroke-width="1.8" stroke-linejoin="round"/></svg>
        Print Prescription
      </button>`;
    }

    html += `</div></div>`; // visit-body, visit-card
  });

  html += '</div>'; // visits-list

  const el = document.getElementById('portalResults');
  el.innerHTML = html;
  el.style.display = 'block';
  el.scrollIntoView({behavior:'smooth', block:'start'});
}

function portalPrint(idx) {
  const r  = portalRecords[idx];
  if (!r) return;
  // Build a step1Data and step2Data from the single record
  const d1 = { ...r };
  const d2 = { ...r };
  fillReceipt(d1, d2);
  setTimeout(() => window.print(), 150);
}

/* ── Auto-refresh prescription badge on role screen ── */
document.addEventListener('DOMContentLoaded', () => {
  const q = prescGet();
  const el = document.querySelector('.presc-badge-count');
  if (el) el.textContent = q.length;
});
