// app.js

const db = window.DB;
const PERMS = window.MOSH_PERMS || { JEFF_PASS: "approved", OWNER_PASS: "owner" };

let jeffMode = false;
let ownerMode = false;

// DOM refs
const lanes = {
  requested: document.getElementById('lane-requested'),
  'priority': document.getElementById('lane-priority'),
  'in-progress': document.getElementById('lane-in-progress'),
  finished: document.getElementById('lane-finished')
};

const modal = document.getElementById('taskModal');
const addBtn = document.getElementById('addTaskBtn');
const cancelModal = document.getElementById('cancelModal');
const submitIssue = document.getElementById('submitIssue');
const actionsBar = document.querySelector('.actions');

// Add an Unlock button for roles
const unlockBtn = document.createElement('button');
unlockBtn.className = 'btn no-arrow';
unlockBtn.textContent = 'Unlock';
actionsBar.appendChild(unlockBtn);

unlockBtn.addEventListener('click', () => {
  const role = prompt('Type "jeff" to approve priority or "owner" to move tasks:').trim().toLowerCase();
  if (role === 'jeff') {
    const pw = prompt('Jeff password:');
    jeffMode = (pw === PERMS.JEFF_PASS);
    alert(jeffMode ? 'Jeff mode ON' : 'Wrong password');
  } else if (role === 'owner') {
    const pw = prompt('Owner password:');
    ownerMode = (pw === PERMS.OWNER_PASS);
    alert(ownerMode ? 'Owner mode ON' : 'Wrong password');
  }
});

// ---------- Firestore helpers ----------
const tasksCol = db.collection('tasks');

function addTask(task) {
  return tasksCol.add({
    title: task.title,
    details: task.details,
    submitter: task.submitter,
    priorityRequested: task.priorityRequested || false,
    priority: false,
    status: 'requested',
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

function updateTask(id, patch) {
  patch.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
  return tasksCol.doc(id).update(patch);
}

function deleteTask(id) {
  return tasksCol.doc(id).delete();
}

// ---------- UI ----------
function clearLanes() {
  Object.values(lanes).forEach(el => (el.innerHTML = ''));
}

function tag(text, extra='') {
  const span = document.createElement('span');
  span.className = `tag ${extra}`.trim();
  span.textContent = text;
  return span;
}

function cardTemplate(task) {
  const el = document.createElement('article');
  el.className = 'card';

  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = task.title;

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.append(tag(`By ${task.submitter}`));
  if (task.priority) meta.append(tag('Priority', 'tag-priority'));
  if (task.priorityRequested && !task.priority) meta.append(tag('Priority requested', 'tag-due'));

  // controls 
  const controls = document.createElement('div');
  controls.className = 'meta';

  if (jeffMode && !task.priority) {
    const approve = document.createElement('button');
    approve.className = 'btn no-arrow';
    approve.textContent = 'Approve Priority';
    approve.addEventListener('click', async () => {
      try { await updateTask(task.id, { priority: true }); }
      catch (e) { alert('Update failed'); console.error(e); }
    });
    controls.append(approve);
  }

  if (ownerMode) {
    const toReq = document.createElement('button');
    toReq.className = 'btn no-arrow';
    toReq.textContent = 'Requested';
    toReq.addEventListener('click', () => updateTask(task.id, { status: 'requested' }).catch(console.error));

    const toProg = document.createElement('button');
    toProg.className = 'btn no-arrow';
    toProg.textContent = 'In Progress';
    toProg.addEventListener('click', () => updateTask(task.id, { status: 'in-progress' }).catch(console.error));

    const toFin = document.createElement('button');
    toFin.className = 'btn no-arrow';
    toFin.textContent = 'Finished';
    toFin.addEventListener('click', () => updateTask(task.id, { status: 'finished' }).catch(console.error));

    const del = document.createElement('button');
    del.className = 'btn no-arrow';
    del.textContent = 'Delete';
    del.addEventListener('click', async () => {
      if (confirm('Delete this task?')) await deleteTask(task.id);
    });

    controls.append(toReq, toProg, toFin, del);
  }

  el.append(title, meta);
  if (controls.childElementCount) el.append(controls);
  return el;
}

function bucketize(tasks) {
  const by = { requested: [], priority: [], 'in-progress': [], finished: [] };
  for (const t of tasks) {
    if (t.status === 'finished') by.finished.push(t);
    else if (t.status === 'in-progress') by['in-progress'].push(t);
    else if (t.priority) by.priority.push(t);
    else by.requested.push(t);
  }
  return by;
}

function render(byLabel) {
  clearLanes();
  Object.entries(byLabel).forEach(([name, list]) => {
    const lane = lanes[name];

    // consistent header height already handled by CSS; render cards:
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'card';
      empty.innerHTML = '<div class="meta">No cards</div>';
      lane.appendChild(empty);
      return;
    }

    list.sort((a,b) => (a.createdAt?.seconds||0) - (b.createdAt?.seconds||0));
    list.forEach(task => lane.appendChild(cardTemplate(task)));
  });
}

// ---------- Live feed ----------
let unsub = null;
function startFeed() {
  if (unsub) unsub();
  unsub = tasksCol.orderBy('createdAt','asc').onSnapshot(snap => {
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render(bucketize(data));
  }, err => {
    console.error(err);
    alert('Failed to load tasks. Check Firestore permissions.');
  });
}

// ---------- Modal submit ----------
addBtn.addEventListener('click', () => {
  const saved = localStorage.getItem('mosh_submitter');
  if (saved) document.getElementById('submitterName').value = saved;
  modal.showModal();
});
cancelModal.addEventListener('click', (e) => { e.preventDefault(); modal.close(); });

submitIssue.addEventListener('click', async (e) => {
  e.preventDefault();
  const name = document.getElementById('submitterName').value.trim();
  const t = document.getElementById('taskTitle').value.trim();
  const d = document.getElementById('taskDetails').value.trim();
  const pr = document.getElementById('taskPriority').value.includes('Requesting');

  if (!name || !t || !d) return alert('Please fill required fields.');
  localStorage.setItem('mosh_submitter', name);

  try {
    await addTask({ title: t, details: d, submitter: name, priorityRequested: pr });
    modal.close();
  } catch (err) {
    console.error(err);
    alert('Could not add task. Check Firestore config/rules.');
  }
});

// Refresh button 
document.getElementById('refreshBtn').addEventListener('click', startFeed);

// Init
startFeed();
