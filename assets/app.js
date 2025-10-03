// assets/app.js

const db = window.DB;
const storage = window.STORE;
const PERMS = window.MOSH_PERMS;

let currentUser = null;
let isOwner = false;
let isJeff  = false;

// --- DOM ---
const L = {
  requested: document.getElementById('lane-requested'),
  priority:  document.getElementById('lane-priority'),
  inprog:    document.getElementById('lane-in-progress'),
  finished:  document.getElementById('lane-finished')
};
const modal = document.getElementById('taskModal');
const addBtn = document.getElementById('addTaskBtn');
const cancelModal = document.getElementById('cancelModal');
const submitIssue = document.getElementById('submitIssue');

const actions = document.querySelector('.actions');
const signInBtn  = document.createElement('button');
signInBtn.className = 'btn no-arrow';
signInBtn.id = 'signInBtn';
signInBtn.textContent = 'Sign in';
const signOutBtn = document.createElement('button');
signOutBtn.className = 'btn no-arrow';
signOutBtn.id = 'signOutBtn';
signOutBtn.textContent = 'Sign out';
signOutBtn.hidden = true;
actions.appendChild(signInBtn);
actions.appendChild(signOutBtn);

const googleProvider = new firebase.auth.GoogleAuthProvider();
signInBtn.onclick = async () => {
  try {
    await firebase.auth().signInWithPopup(googleProvider);
  } catch {
    const email = prompt('Email:');
    const pass  = prompt('Password:');
    if (!email || !pass) return;
    await firebase.auth().signInWithEmailAndPassword(email, pass);
  }
};
signOutBtn.onclick = () => firebase.auth().signOut();

// Auth state → role flags
firebase.auth().onAuthStateChanged(user => {
  currentUser = user;
  const email = user?.email || '';
  isOwner = !!email && PERMS.OWNERS.includes(email);
  isJeff  = !!email && PERMS.JEFFS.includes(email);

  signInBtn.hidden  = !!email;
  signOutBtn.hidden = !email;
});

// ----- Firestore -----
const tasks = db.collection('tasks');

function tag(txt, extra='') {
  const s = document.createElement('span');
  s.className = `tag ${extra}`.trim();
  s.textContent = txt;
  return s;
}

function fileLinks(att=[]) {
  if (!att?.length) return null;
  const wrap = document.createElement('div');
  wrap.className = 'meta';
  att.forEach(a => {
    const link = document.createElement('a');
    link.href = a.url;
    link.download = a.name;
    link.textContent = `Download: ${a.name}`;
    link.rel = 'noopener noreferrer';
    wrap.appendChild(link);
  });
  return wrap;
}

function card(task) {
  const el = document.createElement('article');
  el.className = 'card';

  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = task.title;

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.append(tag(`By ${task.submitter}`));
  if (task.priority) meta.append(tag('Priority','tag-priority'));
  if (task.priorityRequested && !task.priority) meta.append(tag('Priority requested','tag-due'));

  const atts = fileLinks(task.attachments);
  const ctrls = document.createElement('div');
  ctrls.className = 'meta';

  // Jeff can approve priority
  if (isJeff && !task.priority) {
    const approve = document.createElement('button');
    approve.className = 'btn no-arrow';
    approve.textContent = 'Approve Priority';
    approve.onclick = () => tasks.doc(task.id).update({
      priority: true,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    ctrls.appendChild(approve);
  }

  // I can move/delete
  if (isOwner) {
    const mk = (label, status) => {
      const b = document.createElement('button');
      b.className = 'btn no-arrow';
      b.textContent = label;
      b.onclick = () => tasks.doc(task.id).update({
        status, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      return b;
    };
    ctrls.append(mk('Requested','requested'), mk('In Progress','in-progress'), mk('Finished','finished'));

    const del = document.createElement('button');
    del.className = 'btn no-arrow';
    del.textContent = 'Delete';
    del.onclick = async () => {
      if (!confirm('Delete this task?')) return;
      await tasks.doc(task.id).delete();
      // optional: delete storage files (manual via console or add cloud function)
    };
    ctrls.appendChild(del);
  }

  el.append(title, meta);
  if (atts) el.append(atts);
  if (ctrls.childElementCount) el.append(ctrls);
  return el;
}

function render(bk) {
  L.requested.innerHTML = '';
  L.priority.innerHTML  = '';
  L.inprog.innerHTML    = '';
  L.finished.innerHTML  = '';

  const addOrEmpty = (lane, arr) => {
    if (!arr.length) {
      const empty = document.createElement('div');
      empty.className = 'card';
      empty.innerHTML = '<div class="meta">No cards</div>';
      lane.appendChild(empty);
      return;
    }
    arr.forEach(t => lane.appendChild(card(t)));
  };

  addOrEmpty(L.requested, bk.requested);
  addOrEmpty(L.priority,  bk.priority);
  addOrEmpty(L.inprog,    bk['in-progress']);
  addOrEmpty(L.finished,  bk.finished);
}

function bucketize(rows) {
  const b = { requested:[], priority:[], 'in-progress':[], finished:[] };
  rows.forEach(t => {
    if (t.status === 'finished') b.finished.push(t);
    else if (t.status === 'in-progress') b['in-progress'].push(t);
    else if (t.priority) b.priority.push(t);
    else b.requested.push(t);
  });
  return b;
}

let unsub = null;
function startFeed(){
  if (unsub) unsub();
  unsub = tasks.onSnapshot(s => {
    const rows = s.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a,b)=>(a.createdAt?.seconds||0)-(b.createdAt?.seconds||0));
    render(bucketize(rows));
  }, e => {
    console.error(e);
    alert('Failed to load tasks. Check Firestore rules/config.');
  });
}

// ---- Modal handlers ----
addBtn.onclick = () => {
  const saved = localStorage.getItem('mosh_submitter');
  if (saved) document.getElementById('submitterName').value = saved;
  modal.showModal();
};
cancelModal.onclick = (e) => { e.preventDefault(); modal.close(); };

submitIssue.onclick = async (e) => {
  e.preventDefault();
  const name = document.getElementById('submitterName').value.trim();
  const title = document.getElementById('taskTitle').value.trim();
  const details = document.getElementById('taskDetails').value.trim();
  const pr = document.getElementById('taskPriority').value.includes('Requesting');
  const files = Array.from(document.getElementById('taskFiles').files || []);

  if (!name || !title || !details) return alert('Please fill required fields.');
  localStorage.setItem('mosh_submitter', name);

  // create task first
  const ref = await tasks.add({
    title, details, submitter:name,
    priorityRequested: pr, priority:false,
    status:'requested',
    attachments: [],
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  // upload files if any
  if (files.length) {
    const metas = [];
    for (const f of files) {
      const path = `uploads/${ref.id}/${Date.now()}-${f.name}`;
      const sref = storage.ref(path);
      await sref.put(f);
      const url = await sref.getDownloadURL();
      metas.push({
        name: f.name, url, size: f.size, type: f.type,
        ts: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
    if (metas.length) {
      await ref.update({
        attachments: firebase.firestore.FieldValue.arrayUnion(...metas),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
  }

  modal.close();
};

// Refresh button re-subscribes
document.getElementById('refreshBtn').onclick = startFeed;

// Init
startFeed();
