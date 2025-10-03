// --- Config & DOM refs ---
const cfg = window.MOSH_BOARD;
const lanes = {
  requested: document.getElementById('lane-requested'),
  'priority': document.getElementById('lane-priority'),
  'in-progress': document.getElementById('lane-in-progress'),
  finished: document.getElementById('lane-finished')
};

const GH_API = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}`;

// --- Card factory ---
function cardTemplate(issue) {
  const url = issue.html_url;
  const title = issue.title.replace(/^\[Task\]\s*/i, '');
  const createdBy = issue.user?.login || 'unknown';
  const body = issue.body || '';

  // Parse submitter name (from the Issue Form body)
  // Looks for "**Your name**" then captures the next non-empty line
  const nameMatch = body.match(/\*\*Your name\*\*[\s\S]*?\n\n([^\n]+)/i);
  const submitterName = (nameMatch?.[1] || createdBy).trim();

  // Parse due date (no lookbehind—portable)
  // Looks for "Suggested due date" and captures the next line
  const dueMatch = body.match(/Suggested due date[^\n]*\n+([^\n]+)/i);
  const due = (dueMatch?.[1] || '').trim();

  const el = document.createElement('article');
  el.className = 'card';
  el.innerHTML = `
    <div class="title">${title}</div>
    <div class="meta">
      <span class="tag">By ${submitterName}</span>
      ${issue.labels.some(l => l.name === 'priority') ? '<span class="tag tag-priority">Priority</span>' : ''}
      ${due ? `<span class="tag tag-due">Due ${due}</span>` : ''}
      <a href="${url}" target="_blank" rel="noopener">View in GitHub</a>
    </div>
  `;
  return el;
}

// --- GitHub fetch ---
async function fetchAllIssues() {
  // Open + closed (so Finished can include closed issues)
  const endpoints = [
    `${GH_API}/issues?state=open&per_page=${cfg.perPage}`,
    `${GH_API}/issues?state=closed&per_page=${cfg.perPage}`
  ];

  const pages = await Promise.all(
    endpoints.map(u => fetch(u, { headers: { 'Accept': 'application/vnd.github+json' } }).then(r => {
      if (!r.ok) throw new Error(`GitHub API: ${r.status}`);
      return r.json();
    }))
  );

  // Filter out PRs (GitHub mixes them into /issues)
  return pages.flat().filter(it => !it.pull_request);
}

// --- Group issues into lanes by label ---
function bucketize(issues) {
  const by = { requested: [], priority: [], 'in-progress': [], finished: [] };
  for (const issue of issues) {
    const labels = issue.labels.map(l => l.name);
    if (labels.includes('finished')) by['finished'].push(issue);
    else if (labels.includes('in-progress')) by['in-progress'].push(issue);
    else if (labels.includes('priority')) by['priority'].push(issue);
    else by['requested'].push(issue);
  }
  return by;
}

function clearLanes() {
  Object.values(lanes).forEach(el => (el.innerHTML = ''));
}

// --- Render board ---
function render(byLabel) {
  clearLanes();
  Object.entries(byLabel).forEach(([name, list]) => {
    // Oldest first for a gentle “FIFO” feel; swap to desc if you prefer
    list.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    const lane = lanes[name];
    list.forEach(issue => lane.appendChild(cardTemplate(issue)));

    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'card';
      empty.innerHTML = '<div class="meta">No cards</div>';
      lane.appendChild(empty);
    }
  });
}

// --- Refresh cycle ---
async function refresh() {
  try {
    const issues = await fetchAllIssues();
    const buckets = bucketize(issues);
    render(buckets);
  } catch (err) {
    console.error(err);
    alert('Failed to fetch tasks from GitHub. Make sure the repo is public (or add a proxy/token).');
  }
}

// --- Modal + Issue form handoff ---
const modal = document.getElementById('taskModal');
const addBtn = document.getElementById('addTaskBtn');
const cancelModal = document.getElementById('cancelModal');
const submitIssue = document.getElementById('submitIssue');

addBtn.addEventListener('click', () => {
  const saved = localStorage.getItem('mosh_submitter');
  if (saved) document.getElementById('submitterName').value = saved;
  modal.showModal();
});

cancelModal.addEventListener('click', (e) => {
  e.preventDefault();
  modal.close();
});

submitIssue.addEventListener('click', (e) => {
  e.preventDefault();
  const name = document.getElementById('submitterName').value.trim();
  const t = document.getElementById('taskTitle').value.trim();
  const d = document.getElementById('taskDetails').value.trim();
  const pr = document.getElementById('taskPriority').value;

  if (!name || !t || !d) return alert('Please fill required fields.');
  localStorage.setItem('mosh_submitter', name);

  const title = encodeURIComponent(`[Task] ${t}`);
  const body = encodeURIComponent(
`**Your name**

${name}

**Task details**

${d}

**Priority request**

${pr}`
  );

  const url = `https://github.com/${cfg.owner}/${cfg.repo}/issues/new?template=task.yml&title=${title}&body=${body}`;
  window.open(url, '_blank');
  modal.close();
});

// --- Controls & initial load ---
document.getElementById('refreshBtn').addEventListener('click', refresh);
refresh();
