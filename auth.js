// ---------------- Accounts, scores & friends (Supabase) ----------------

const SUPABASE_URL = 'https://jmykegsjbgnhtnvylodb.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_x5lSlinDHIUOq6kSsbGBgA_U6qBMXZw';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let currentProfile = null;

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ---------- Session ----------
async function refreshSession() {
  const { data: { session } } = await sb.auth.getSession();
  currentUser = session ? session.user : null;
  if (currentUser) {
    const { data } = await sb.from('profiles').select('id, username').eq('id', currentUser.id).single();
    currentProfile = data || null;
  } else {
    currentProfile = null;
  }
  updateAccountUI();
}

sb.auth.onAuthStateChange(() => { refreshSession(); });

function updateAccountUI() {
  const btn = document.getElementById('accountBtn');
  btn.textContent = currentProfile ? `👤 ${currentProfile.username}` : '👤 Sign In';

  const signedOut = document.getElementById('authSignedOut');
  const signedIn = document.getElementById('authSignedIn');
  if (currentProfile) {
    signedOut.style.display = 'none';
    signedIn.style.display = 'block';
    document.getElementById('authUsernameLabel').textContent = currentProfile.username;
    loadFriendsUI();
  } else {
    signedOut.style.display = 'block';
    signedIn.style.display = 'none';
  }
  refreshPresence();
}

function openAccountModal() { document.getElementById('accountModal').classList.add('show'); }

// ---------- Auth actions ----------
async function signUp(email, password, username) {
  const { data, error } = await sb.auth.signUp({ email, password, options: { data: { username } } });
  if (error) throw error;
  return data.session; // set if email confirmation is off (signs the user in immediately); null otherwise
}
async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}
async function signOut() {
  await sb.auth.signOut();
}

// ---------- Scores / leaderboard ----------
window.submitScore = async function(_name, totalMoves) {
  if (!currentUser) throw new Error('Not signed in');
  const { error } = await sb.from('scores').insert({ user_id: currentUser.id, total_moves: Math.round(totalMoves) });
  if (error) throw error;
};

window.loadLeaderboard = async function(scope) {
  if (scope === 'friends') {
    if (!currentUser) return [];
    const { data: friendIdRows, error: fErr } = await sb.rpc('my_friend_ids');
    if (fErr) throw fErr;
    const friendIds = (friendIdRows || []).map(r => typeof r === 'string' ? r : Object.values(r)[0]);
    const ids = [...friendIds, currentUser.id];
    const { data, error } = await sb.from('leaderboard').select('*').in('user_id', ids)
      .order('best_total_moves', { ascending: true }).limit(20);
    if (error) throw error;
    return (data || []).map(r => ({ name: r.username, totalMoves: r.best_total_moves }));
  }
  const { data, error } = await sb.from('leaderboard').select('*')
    .order('best_total_moves', { ascending: true }).limit(10);
  if (error) throw error;
  return (data || []).map(r => ({ name: r.username, totalMoves: r.best_total_moves }));
};

// ---------- Friends ----------
async function searchUsers(query) {
  const { data, error } = await sb.from('profiles').select('id, username')
    .ilike('username', `%${query}%`).neq('id', currentUser.id).limit(8);
  if (error) throw error;
  return data || [];
}
async function sendFriendRequest(addresseeId) {
  const { error } = await sb.from('friendships').insert({ requester_id: currentUser.id, addressee_id: addresseeId });
  if (error) throw error;
}
async function listIncomingRequests() {
  const { data, error } = await sb.from('friendships')
    .select('id, requester_id, profiles!friendships_requester_id_fkey(username)')
    .eq('addressee_id', currentUser.id).eq('status', 'pending');
  if (error) throw error;
  return data || [];
}
async function acceptFriendRequest(id) {
  const { error } = await sb.from('friendships').update({ status: 'accepted' }).eq('id', id);
  if (error) throw error;
}
async function listFriends() {
  const { data, error } = await sb.from('friendships')
    .select('id, requester_id, addressee_id, requester:profiles!friendships_requester_id_fkey(username), addressee:profiles!friendships_addressee_id_fkey(username)')
    .eq('status', 'accepted')
    .or(`requester_id.eq.${currentUser.id},addressee_id.eq.${currentUser.id}`);
  if (error) throw error;
  return (data || []).map(f => {
    const isRequester = f.requester_id === currentUser.id;
    return {
      friendshipId: f.id,
      id: isRequester ? f.addressee_id : f.requester_id,
      username: isRequester ? f.addressee.username : f.requester.username
    };
  });
}
async function removeFriend(friendshipId) {
  const { error } = await sb.from('friendships').delete().eq('id', friendshipId);
  if (error) throw error;
}

async function loadFriendsUI() {
  try {
    const [requests, friends] = await Promise.all([listIncomingRequests(), listFriends()]);

    const reqEl = document.getElementById('friendRequestsList');
    reqEl.innerHTML = '';
    if (!requests.length) {
      reqEl.innerHTML = '<p class="hintText">No pending requests.</p>';
    }
    requests.forEach(r => {
      const row = document.createElement('div');
      row.className = 'friendRow';
      row.innerHTML = `<span>${r.profiles.username}</span>`;
      const btn = document.createElement('button');
      btn.textContent = 'Accept';
      btn.onclick = async () => { await acceptFriendRequest(r.id); loadFriendsUI(); };
      row.appendChild(btn);
      reqEl.appendChild(row);
    });

    const listEl = document.getElementById('friendsList');
    listEl.innerHTML = '';
    if (!friends.length) {
      listEl.innerHTML = '<p class="hintText">No friends yet — search above.</p>';
    }
    friends.forEach(f => {
      const row = document.createElement('div');
      row.className = 'friendRow';
      row.innerHTML = `<span>${f.username}</span>`;
      const btn = document.createElement('button');
      btn.textContent = '✕';
      btn.title = 'Remove friend';
      btn.onclick = async () => { await removeFriend(f.friendshipId); loadFriendsUI(); };
      row.appendChild(btn);
      listEl.appendChild(row);
    });
  } catch (e) {
    console.warn('Could not load friends', e);
  }
}

// ---------- UI wiring ----------
document.getElementById('accountBtn').onclick = openAccountModal;
document.getElementById('closeAccount').onclick = () => document.getElementById('accountModal').classList.remove('show');

document.getElementById('authSignUpBtn').onclick = async () => {
  const username = document.getElementById('authUsername').value.trim();
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const errEl = document.getElementById('authError');
  errEl.style.display = 'none';
  if (!username) { errEl.textContent = 'Pick a username.'; errEl.style.display = 'block'; return; }
  try {
    const session = await signUp(email, password, username);
    if (session) {
      document.getElementById('accountModal').classList.remove('show');
      showToast('Account created! 🎉');
    } else {
      showToast('Check your email to confirm your account, then sign in.');
    }
  } catch (e) {
    errEl.textContent = e.message || 'Sign up failed.';
    errEl.style.display = 'block';
  }
};

document.getElementById('authSignInBtn').onclick = async () => {
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const errEl = document.getElementById('authError');
  errEl.style.display = 'none';
  try {
    await signIn(email, password);
    document.getElementById('accountModal').classList.remove('show');
    showToast('Signed in! 🎉');
  } catch (e) {
    errEl.textContent = e.message || 'Sign in failed.';
    errEl.style.display = 'block';
  }
};

document.getElementById('authSignOutBtn').onclick = async () => {
  await signOut();
  showToast('Signed out.');
};

document.getElementById('friendSearchInput').oninput = debounce(async (e) => {
  const q = e.target.value.trim();
  const resultsEl = document.getElementById('friendSearchResults');
  resultsEl.innerHTML = '';
  if (!q) return;
  try {
    const results = await searchUsers(q);
    results.forEach(u => {
      const row = document.createElement('div');
      row.className = 'friendRow';
      row.innerHTML = `<span>${u.username}</span>`;
      const btn = document.createElement('button');
      btn.textContent = 'Add';
      btn.onclick = async () => {
        try {
          await sendFriendRequest(u.id);
          showToast('Friend request sent!');
          row.remove();
        } catch (e) {
          showToast(e.message || 'Could not send request.');
        }
      };
      row.appendChild(btn);
      resultsEl.appendChild(row);
    });
  } catch (e) {
    console.warn('Search failed', e);
  }
}, 300);

// ---------- Live presence ("who's online") ----------
const presenceChannel = sb.channel('boxlogic-online', {
  config: { presence: { key: crypto.randomUUID() } }
});
let presenceReady = false;

function myPresencePayload() {
  return {
    username: currentProfile ? currentProfile.username : 'Guest',
    signedIn: !!currentProfile
  };
}

function renderOnlineUI() {
  const entries = Object.values(presenceChannel.presenceState()).map(arr => arr[0]);
  const badge = document.getElementById('onlineBadge');
  if (badge) badge.textContent = `🟢 ${entries.length} online`;

  const listEl = document.getElementById('onlineList');
  if (!listEl) return;
  listEl.innerHTML = '';
  if (!entries.length) {
    listEl.innerHTML = '<p class="hintText">No one else online right now.</p>';
    return;
  }
  entries
    .sort((a, b) => (b.signedIn ? 1 : 0) - (a.signedIn ? 1 : 0))
    .forEach(p => {
      const row = document.createElement('div');
      row.className = 'friendRow';
      row.innerHTML = `<span>${p.signedIn ? '👤' : '👻'} ${p.username}</span>`;
      listEl.appendChild(row);
    });
}

function refreshPresence() {
  if (presenceReady) presenceChannel.track(myPresencePayload());
}

presenceChannel
  .on('presence', { event: 'sync' }, renderOnlineUI)
  .subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      presenceReady = true;
      await presenceChannel.track(myPresencePayload());
    }
  });

document.getElementById('onlineBadge').onclick = () => document.getElementById('onlineModal').classList.add('show');
document.getElementById('closeOnline').onclick = () => document.getElementById('onlineModal').classList.remove('show');

refreshSession();
