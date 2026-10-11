// Compact media responses; external GIF requests keep their own headers.
async function apiFetch(url, options = {}) {
  if (!String(url).startsWith('https://') && typeof options.body === 'string' && options.body.length > 16384 && 'CompressionStream' in window) {
    const compressed = new Blob([options.body]).stream().pipeThrough(new CompressionStream('gzip'));
    options = {...options, body: await new Response(compressed).blob(), headers: {...options.headers, 'Content-Encoding': 'gzip'}};
  }
  return window.fetch(url, String(url).startsWith('https://') ? options : {
    ...options, headers: {'X-Bruma-Version': '3', ...options.headers}
  });
}
const outbox = new Map();
function roomKey() { return activePrivateFriend?.username || ''; }
const messagesElement = document.querySelector('#messages');
const replyComposer = document.querySelector('#reply-composer');
const replyAuthor = document.querySelector('#reply-author');
const replyText = document.querySelector('#reply-text');
const cancelReply = document.querySelector('#cancel-reply');
const deleteDialog = document.querySelector('#delete-dialog');
const cancelDelete = document.querySelector('#cancel-delete');
const confirmDelete = document.querySelector('#confirm-delete');
const deleteWithoutConfirmation = document.querySelector('#delete-without-confirmation');
const editDialog = document.querySelector('#edit-dialog');
const editInput = document.querySelector('#edit-input');
const cancelEdit = document.querySelector('#cancel-edit');
const saveEdit = document.querySelector('#save-edit');
const form = document.querySelector('#message-form');
const authorInput = document.querySelector('#author');
const avatarPicker = document.querySelector('#avatar-picker');
const avatarInput = document.querySelector('#avatar');
const profileMenu = document.querySelector('#profile-menu');
const closeProfile = document.querySelector('#close-profile');
const changeAvatar = document.querySelector('#change-avatar');
const saveProfile = document.querySelector('#save-profile');
const profileAvatarPreview = document.querySelector('#profile-avatar-preview');
const profileUsernameInput = document.querySelector('#profile-username');
const profileBioInput = document.querySelector('#profile-bio');
const bannerInput = document.querySelector('#profile-banner-input');
const profileStatus = document.querySelector('#profile-status');
let draftBannerData = '';
const textInput = document.querySelector('#text');
const imageInput = document.querySelector('#image');
const audioFileInput = document.querySelector('#audio-file');
const anyFileInput = document.querySelector('#any-file');
const attachmentToggle = document.querySelector('#attachment-toggle');
const attachmentMenu = document.querySelector('#attachment-menu');
const imageQueue = document.querySelector('#image-queue');
const imageStatus = document.querySelector('#image-status');
const recordButton = document.querySelector('#record');
const gifForm = document.querySelector('#gif-form');
const gifQuery = document.querySelector('#gif-query');
const gifResults = document.querySelector('#gif-results');
const gifStatus = document.querySelector('#gif-status');
const cleanupElement = document.querySelector('#next-cleanup');
const gifPanel = document.querySelector('#gif-panel');
const toggleGifs = document.querySelector('#toggle-gifs');
const chatPanel = document.querySelector('#chat-panel');
const accountToggle = document.querySelector('#account-toggle');
const accountDialog = document.querySelector('#account-dialog');
const closeAccount = document.querySelector('#close-account');
const accountEmail = document.querySelector('#account-email');
const accountUsername = document.querySelector('#account-username');
const accountPassword = document.querySelector('#account-password');
const loginAccount = document.querySelector('#login-account');
const registerAccount = document.querySelector('#register-account');
const logoutAccount = document.querySelector('#logout-account');
const accountStatus = document.querySelector('#account-status');
const groupRoom = document.querySelector('#group-room');
const friendList = document.querySelector('#friend-list');
const addFriend = document.querySelector('#add-friend');
const friendsMenu = document.querySelector('#friends-menu');
const closeFriends = document.querySelector('#close-friends');
const friendUsername = document.querySelector('#friend-username');
const sendFriendRequest = document.querySelector('#send-friend-request');
const friendsStatus = document.querySelector('#friends-status');
const incomingRequests = document.querySelector('#incoming-requests');
const outgoingRequests = document.querySelector('#outgoing-requests');
const roomTitle = document.querySelector('#room-title');
const friendsStrip = document.querySelector('#friends-strip');
const sidePanel = document.querySelector('#info-panel');
const sideRoomTitle = document.querySelector('#side-room-title');
const sideRoomDescription = document.querySelector('#side-room-description');
const sidePrivacyCopy = document.querySelector('#side-privacy-copy');
const mobileNavToggle = document.querySelector('#mobile-nav-toggle');
const mobileNavClose = document.querySelector('#mobile-nav-close');
const mobileInfoToggle = document.querySelector('#mobile-info-toggle');
const mobileInfoClose = document.querySelector('#mobile-info-close');
const mobileBackdrop = document.querySelector('#mobile-drawer-backdrop');
const mobileLayout = window.matchMedia('(max-width: 860px)');

let currentMessages = [];
const MESSAGE_PAGE_SIZE = 40;
let visibleMessageLimit = MESSAGE_PAGE_SIZE;
let renderedRoom = '';
let mediaRecorder;
let recordedChunks = [];
let audioData = '';
let recordingTimer;
let recordingSeconds = 0;
let selectedGifUrl = '';
let giphyApiKey = '';
let maxImagesPerMessage = 10;
let pendingImages = [];
let pendingFiles = [];
let avatarData = '';
let draftAvatarData = avatarData;
let gifsOpen = localStorage.getItem('bruma-gifs-open') === 'true'
  || (localStorage.getItem('bruma-gifs-open') === null && !mobileLayout.matches);
let replyToId = '';
let activeAccount = null;
let activePrivateFriend = null;
let friendsData = { friends: [], incoming: [], outgoing: [] };
let pendingDeleteId = '';
let pendingEditId = '';
let deleteConfirmationEnabled = localStorage.getItem('bruma-delete-confirmation') !== 'false';

function setMobileDrawer(panel = '') {
  const next = mobileLayout.matches ? panel : '';
  document.body.dataset.mobileDrawer = next;
  mobileBackdrop.hidden = !next;
  mobileNavToggle.setAttribute('aria-expanded', String(next === 'nav'));
  mobileInfoToggle.setAttribute('aria-expanded', String(next === 'info'));
  friendsStrip.inert = mobileLayout.matches && next !== 'nav';
  sidePanel.inert = mobileLayout.matches && next !== 'info';
  if (next !== 'nav') friendsMenu.hidden = true;
  if (next && next !== 'info') profileMenu.hidden = true;
}

mobileNavToggle.addEventListener('click', () => setMobileDrawer(document.body.dataset.mobileDrawer === 'nav' ? '' : 'nav'));
mobileInfoToggle.addEventListener('click', () => setMobileDrawer(document.body.dataset.mobileDrawer === 'info' ? '' : 'info'));
mobileNavClose.addEventListener('click', () => setMobileDrawer());
mobileInfoClose.addEventListener('click', () => setMobileDrawer());
mobileBackdrop.addEventListener('click', () => setMobileDrawer());
mobileLayout.addEventListener('change', () => setMobileDrawer());
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && document.body.dataset.mobileDrawer) setMobileDrawer();
});
setMobileDrawer();

function getCookie(name) {
  const prefix = `${name}=`;
  const cookie = document.cookie.split('; ').find(item => item.startsWith(prefix));
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : '';
}

function updateGifPanel() {
  if (gifsOpen) {
    gifPanel.hidden = false;
    chatPanel.classList.remove('gifs-collapsed');
    syncGifSpace();
  } else {
    if (!gifPanel.hidden) syncGifSpace();
    gifPanel.hidden = true;
    chatPanel.classList.add('gifs-collapsed');
  }
  toggleGifs.setAttribute('aria-expanded', String(gifsOpen));
  toggleGifs.innerHTML = `GIFs <span>${gifsOpen ? '⌃' : '⌄'}</span>`;
}

function syncGifSpace() {
  chatPanel.style.setProperty('--gif-space', `${gifPanel.getBoundingClientRect().height}px`);
}

toggleGifs.addEventListener('click', () => {
  gifsOpen = !gifsOpen;
  localStorage.setItem('bruma-gifs-open', String(gifsOpen));
  updateGifPanel();
});

accountToggle.addEventListener('click', () => { setMobileDrawer(); accountDialog.hidden = false; accountEmail.focus(); });
closeAccount.addEventListener('click', () => { accountDialog.hidden = true; });

async function accountRequest(endpoint) {
  const response = await apiFetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: accountEmail.value.trim(), username: accountUsername.value.trim(), password: accountPassword.value })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'No se pudo completar la operación.');
  return result;
}

function friendAvatarMarkup(friend, extraClass = '') {
  const content = friend.avatarData
    ? `<img src="${escapeHtml(friend.avatarData)}" alt="${escapeHtml(friend.displayName)}">`
    : escapeHtml((friend.displayName || friend.username || '?').slice(0, 1).toUpperCase());
  return `<button class="friend-avatar ${extraClass}" data-friend-username="${escapeHtml(friend.username)}" title="${escapeHtml(friend.displayName)} (${escapeHtml(friend.username)})" aria-label="Abrir chat con ${escapeHtml(friend.username)}">${content}</button>`;
}

function renderFriends() {
  friendList.innerHTML = friendsData.friends.map(friend => `<div class="friend-entry">${friendAvatarMarkup(friend, activePrivateFriend?.username === friend.username ? 'active' : '')}<button class="friend-profile-link" type="button" data-view-profile="${escapeHtml(friend.username)}" aria-label="Ver perfil de ${escapeHtml(friend.username)}">Perfil</button></div>`).join('');
  refreshNoticeBadges();
  incomingRequests.innerHTML = friendsData.incoming.length
    ? friendsData.incoming.map(request => `<div class="friend-request"><span>${escapeHtml(request.from.displayName)} <small>${escapeHtml(request.from.username)}</small></span><button data-request-id="${request.id}" data-request-action="accept">Aceptar</button><button data-request-id="${request.id}" data-request-action="reject">×</button></div>`).join('')
    : '<small class="friend-empty">No tienes solicitudes pendientes.</small>';
  outgoingRequests.innerHTML = friendsData.outgoing.length
    ? friendsData.outgoing.map(request => `<div class="friend-request"><span>${escapeHtml(request.to.username)}</span><small>Pendiente</small></div>`).join('')
    : '<small class="friend-empty">No hay solicitudes enviadas.</small>';
}

async function loadFriends() {
  const response = await apiFetch('/api/friends');
  if (!response.ok) {
    friendsData = { friends: [], incoming: [], outgoing: [] };
    renderFriends();
    friendsStatus.textContent = activeAccount ? 'No se pudieron cargar tus amigos.' : 'Inicia sesión para agregar amigos.';
    return;
  }
  friendsData = await response.json();
  friendsStatus.textContent = '';
  renderFriends();
}

async function openPrivateChat(friend) {
  setMobileDrawer();
  activePrivateFriend = friend;
  readActiveRoom();
  render([]);
  chatPanel.classList.add('private-mode');
  groupRoom.classList.remove('active');
  roomTitle.textContent = `${friend.displayName} ${friend.username}`;
  sideRoomTitle.textContent = friend.displayName;
  sideRoomDescription.textContent = `Conversación privada con ${friend.username}.`;
  sidePrivacyCopy.textContent = 'Los mensajes privados se eliminan después de 24 horas.';
  pendingImages = [];
  pendingFiles = [];
  audioData = '';
  selectedGifUrl = '';
  renderPendingImages();
  imageStatus.textContent = '';
  updateGifPanel();
  renderFriends();
  const response = await apiFetch(`/api/private/messages/${encodeURIComponent(friend.username)}`);
  if (!response.ok) {
    imageStatus.textContent = 'No se pudo abrir el chat privado.';
    return;
  }
  const history = await response.json();
  if (activePrivateFriend?.username === friend.username) render(history);
}

async function openGroupChat() {
  setMobileDrawer();
  const wasPrivate = Boolean(activePrivateFriend);
  activePrivateFriend = null;
  readActiveRoom();
  if (wasPrivate) render([]);
  chatPanel.classList.remove('private-mode');
  groupRoom.classList.add('active');
  roomTitle.textContent = 'Sala del grupo';
  sideRoomTitle.textContent = 'Sala del grupo';
  sideRoomDescription.textContent = 'Un espacio pequeño para hablar, compartir y dejar que los mensajes desaparezcan.';
  sidePrivacyCopy.textContent = 'Los mensajes se guardan temporalmente y se eliminan durante la limpieza diaria.';
  renderFriends();
  await loadMessages();
}

groupRoom.addEventListener('click', () => { openGroupChat().catch(() => {}); });
friendList.addEventListener('click', event => {
  const profile = event.target.closest('[data-view-profile]');
  if (profile) { viewProfile(profile.dataset.viewProfile); return; }
  const button = event.target.closest('[data-friend-username]');
  if (!button) return;
  const friend = friendsData.friends.find(item => item.username === button.dataset.friendUsername);
  if (friend) openPrivateChat(friend).catch(() => {});
});
addFriend.addEventListener('click', () => { friendsMenu.hidden = !friendsMenu.hidden; if (!friendsMenu.hidden) { notices.read('#friends'); refreshNoticeBadges(); loadFriends().catch(() => {}); } });
closeFriends.addEventListener('click', () => { friendsMenu.hidden = true; });

sendFriendRequest.addEventListener('click', async () => {
  const username = friendUsername.value.trim();
  if (!username) return;
  const response = await apiFetch('/api/friends/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username }) });
  const result = await response.json();
  friendsStatus.textContent = result.error || (result.accepted ? 'Solicitud aceptada. Ya son amigos.' : 'Solicitud enviada.');
  if (response.ok) { friendUsername.value = ''; await loadFriends(); }
});

incomingRequests.addEventListener('click', async event => {
  const button = event.target.closest('[data-request-id]');
  if (!button) return;
  const response = await apiFetch(`/api/friends/requests/${encodeURIComponent(button.dataset.requestId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: button.dataset.requestAction }) });
  const result = await response.json();
  friendsStatus.textContent = result.error || 'Solicitud actualizada.';
  if (response.ok) await loadFriends();
});

function showAccount(account) {
  if (activeAccount?.email !== account?.email) { notices.reset(); notificationToast.hidden = true; refreshNoticeBadges(); }
  activeAccount = account;
  if (!account) { profileBioInput.value = ''; draftBannerData = ''; updateProfileCard(); }
  const loggedIn = Boolean(account);
  accountEmail.hidden = loggedIn;
  accountUsername.hidden = loggedIn;
  accountPassword.hidden = loggedIn;
  loginAccount.hidden = loggedIn;
  registerAccount.hidden = loggedIn;
  logoutAccount.hidden = !loggedIn;
  accountStatus.textContent = loggedIn ? `Sesión iniciada como ${account.email}` : '';
  accountToggle.textContent = loggedIn ? 'Cuenta ✓' : 'Cuenta';
  if (loggedIn) {
    authorInput.value = account.displayName || account.email.split('@')[0];
    profileUsernameInput.value = account.username || '';
    profileBioInput.value = account.bio || '';
    draftBannerData = account.bannerData || '';
    updateProfileCard();
    saveNameCookie(authorInput.value);
    avatarData = account.avatarData || '';
    draftAvatarData = avatarData;
    if (avatarData) localStorage.setItem('bruma-avatar', avatarData);
    else localStorage.removeItem('bruma-avatar');
    updateAvatarPreview(avatarData);
  }
  loadFriends().catch(() => {});
}

registerAccount.addEventListener('click', async () => {
  try { const result = await accountRequest('/api/auth/register'); showAccount(result.account); connectEvents(); await loadMessages(); } catch (error) { accountStatus.textContent = error.message; }
});

loginAccount.addEventListener('click', async () => {
  try { const result = await accountRequest('/api/auth/login'); showAccount(result.account); connectEvents(); await loadMessages(); } catch (error) { accountStatus.textContent = error.message; }
});

logoutAccount.addEventListener('click', async () => {
  await apiFetch('/api/auth/logout', { method: 'POST' });
  avatarData = '';
  draftAvatarData = '';
  localStorage.removeItem('bruma-avatar');
  deleteCookie('bruma-author');
  authorInput.value = generateGuestName();
  saveNameCookie(authorInput.value);
  updateAvatarPreview('');
  accountEmail.value = '';
  accountUsername.value = '';
  accountPassword.value = '';
  showAccount(null);
  connectEvents();
  await openGroupChat();
});

function saveNameCookie(name) {
  // Dura un año y solo se usa para recordar el nombre en este navegador.
  document.cookie = `bruma-author=${encodeURIComponent(name)}; Max-Age=31536000; Path=/; SameSite=Lax`;
}

function generateGuestName() {
  return `Kimux86-${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
}

function deleteCookie(name) {
  document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
}

authorInput.value = getCookie('bruma-author');
if (!authorInput.value) {
  authorInput.value = generateGuestName();
  saveNameCookie(authorInput.value);
}

function timeLabel(timestamp) {
  return new Date(timestamp).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
}

function render(messages) {
  if (renderedRoom !== roomKey()) { visibleMessageLimit = MESSAGE_PAGE_SIZE; renderedRoom = roomKey(); }
  currentMessages = messages.filter(message => !message.pending);
  // A reconnect snapshot can acknowledge a send whose POST response was lost.
  for (const message of currentMessages) if (message.clientId) outbox.delete(message.clientId);
  for (const [id, item] of outbox) {
    if (item.room === roomKey() && !currentMessages.some(message => message.clientId === id)) currentMessages.push(item.message);
  }
  renderVisibleMessages();
  messagesElement.scrollTop = messagesElement.scrollHeight;
}

function renderVisibleMessages() {
  const first = Math.max(0, currentMessages.length - visibleMessageLimit);
  messagesElement.innerHTML = currentMessages.length
    ? (first ? '<button type="button" class="history-more" data-history-more>Mostrar mensajes anteriores</button>' : '')
      + currentMessages.slice(first).map(messageMarkup).join('')
    : '<p class="empty">Todavía no hay mensajes. Deja el primero.</p>';
}

messagesElement.addEventListener('click', event => {
  if (!event.target.closest('[data-history-more]')) return;
  const oldHeight = messagesElement.scrollHeight, oldTop = messagesElement.scrollTop;
  visibleMessageLimit += MESSAGE_PAGE_SIZE;
  renderVisibleMessages();
  messagesElement.scrollTop = oldTop + messagesElement.scrollHeight - oldHeight;
});

function messageMarkup(message) {
  return `
    <article class="message" data-message-id="${message.id}">
      <div class="message-meta" ${message.isAccount && message.username ? `role="button" tabindex="0" data-profile-username="${escapeHtml(message.username)}" aria-label="Ver perfil de ${escapeHtml(message.username)}"` : ''}>${avatarMarkup(message)}<div class="message-name-row"><strong>${escapeHtml(message.author)}${message.isAccount ? `<span class="account-star" title="Cuenta registrada">★</span><span class="message-username">${escapeHtml(message.username || '')}</span>` : ''}</strong><time>${timeLabel(message.createdAt)}${message.edited ? ' · editado' : ''}</time></div></div>
      ${message.replyTo ? `<div class="reply-preview"><strong>↪ ${escapeHtml(message.replyTo.author)}</strong><span>${escapeHtml(message.replyTo.text)}</span></div>` : ''}
      ${renderImages(message)}
      ${message.gifUrl ? renderMedia(message.gifUrl, `GIF enviado por ${message.author}`) : ''}
      ${message.audioData ? `<audio class="message-audio" controls preload="none" src="${escapeHtml(message.audioData)}"></audio>` : ''}
      ${renderFiles(message)}
      ${message.text ? `<p>${escapeHtml(message.text)}</p>` : ''}
      ${message.pending ? `<div class="delivery-status">${message.failed ? 'No enviado · ' : 'Enviando…'}${message.failed ? `<button type="button" data-retry-id="${message.clientId}">Reintentar</button>` : ''}</div>` : ''}
      <div class="message-actions" ${message.pending ? 'hidden' : ''}>
        <button class="reply-button" data-reply-id="${message.id}">Responder</button>
        ${message.canEdit ? `<button class="edit-button" data-message-id="${message.id}">Editar</button><button class="delete-button" data-delete-id="${message.id}">Borrar</button>` : ''}
      </div>
    </article>`;
}

function messageNode(id) { return messagesElement.querySelector(`[data-message-id="${CSS.escape(id)}"]`); }
function addIncomingMessage(message) {
  if (!message?.id) return;
  if (message.clientId && !message.pending) outbox.delete(message.clientId);
  const pending = message.clientId && currentMessages.find(item => item.pending && item.clientId === message.clientId);
  if (pending) {
    const index = currentMessages.indexOf(pending);
    currentMessages[index] = message;
    const node = messageNode(pending.id);
    if (node) node.outerHTML = messageMarkup(message);
    return;
  }
  if (currentMessages.some(item => item.id === message.id)) return;
  const nearBottom = messagesElement.scrollHeight - messagesElement.scrollTop - messagesElement.clientHeight < 100;
  if (!currentMessages.length) messagesElement.innerHTML = '';
  currentMessages.push(message);
  messagesElement.insertAdjacentHTML('beforeend', messageMarkup(message));
  if (nearBottom || message.pending) {
    // Bound the live DOM while following the conversation; preserve an older reading position.
    const nodes = messagesElement.querySelectorAll('article.message');
    for (let index = 0; index < nodes.length - visibleMessageLimit; index++) nodes[index].remove();
    if (currentMessages.length > visibleMessageLimit && !messagesElement.querySelector('[data-history-more]')) {
      messagesElement.insertAdjacentHTML('afterbegin', '<button type="button" class="history-more" data-history-more>Mostrar mensajes anteriores</button>');
    }
  }
  if (nearBottom || message.pending) messagesElement.scrollTop = messagesElement.scrollHeight;
}
function updateIncomingMessage(message) {
  const index = currentMessages.findIndex(item => item.id === message?.id);
  if (index < 0) return;
  currentMessages[index] = message;
  const node = messageNode(message.id);
  if (node) node.outerHTML = messageMarkup(message);
}
function deleteIncomingMessage(id) {
  currentMessages = currentMessages.filter(item => item.id !== id);
  messageNode(id)?.remove();
  if (!currentMessages.length) render([]);
  else if (messagesElement.querySelectorAll('article.message').length < Math.min(visibleMessageLimit, currentMessages.length)) {
    const oldTop = messagesElement.scrollTop;
    renderVisibleMessages();
    messagesElement.scrollTop = oldTop;
  }
}

function avatarMarkup(message) {
  if (message.avatarData) return `<img class="profile-avatar" src="${escapeHtml(message.avatarData)}" loading="lazy" decoding="async" alt="Foto de perfil de ${escapeHtml(message.author)}">`;
  return `<div class="profile-avatar profile-fallback" aria-hidden="true">${escapeHtml((message.author || '?').slice(0, 1).toUpperCase())}</div>`;
}

function renderImages(message) {
  const images = message.images || (message.imageData ? [message.imageData] : []);
  return images.length ? `<div class="message-images ${images.length === 1 ? 'single' : ''}">${images.map((image, index) => renderMedia(image, `Imagen ${index + 1} enviada por ${message.author}`)).join('')}</div>` : '';
}

function renderFiles(message) {
  if (message.pending) return (message.files || []).map(file => `<span class="message-file">📎 ${escapeHtml(file.name)}</span>`).join('');
  return (message.files || []).map(file => {
    const url = `/api/uploads/${encodeURIComponent(file.id)}${file.token ? `?token=${encodeURIComponent(file.token)}` : ''}`;
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.type || '')) return renderMedia(url, file.name || 'Imagen');
    return `<a class="message-file" href="${url}" target="_blank" rel="noopener">📎 ${escapeHtml(file.name || 'Archivo')} <small>${formatBytes(file.size || 0)}</small></a>`;
  }).join('');
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

function renderMedia(url, alt) {
  return `<div class="message-media"><img class="message-image" src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy"></div>`;
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function updateCleanupClock() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const hours = Math.floor((midnight - now) / 3_600_000);
  const minutes = Math.floor((midnight - now) / 60_000) % 60;
  cleanupElement.textContent = `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m · 00:00`;
}

async function loadMessages() {
  const response = await apiFetch('/api/messages');
  const history = await response.json();
  if (!activePrivateFriend) render(history);
}

async function uploadAttachment(file, recipientUsername = '') {
  if (file.size <= 10_000_000) {
    const response = await apiFetch('/api/uploads', {method: 'POST', headers: {
      'Content-Type': file.type || 'application/octet-stream', 'X-Bruma-File-Name': encodeURIComponent(file.name),
      ...(recipientUsername ? {'X-Bruma-Recipient': recipientUsername} : {})
    }, body: file, signal: AbortSignal.timeout(120000)});
    const uploaded = await response.json();
    if (!response.ok) throw new Error(uploaded.error || 'No se pudo subir el archivo.');
    return uploaded;
  }
  const startResponse = await apiFetch('/api/uploads/start', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: file.name, type: file.type || 'application/octet-stream', size: file.size, recipientUsername })
  });
  const started = await startResponse.json();
  if (!startResponse.ok) throw new Error(started.error || 'No se pudo iniciar la subida.');
  const chunkSize = 2 * 1024 * 1024;
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    const chunkResponse = await apiFetch(`/api/uploads/${encodeURIComponent(started.id)}/chunk`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file.slice(offset, offset + chunkSize)
    });
    if (!chunkResponse.ok) {
      const error = await chunkResponse.json().catch(() => ({}));
      throw new Error(error.error || 'No se pudo subir una parte del archivo.');
    }
  }
  const finishResponse = await apiFetch(`/api/uploads/${encodeURIComponent(started.id)}/finish`, { method: 'POST' });
  const uploaded = await finishResponse.json();
  if (!finishResponse.ok) throw new Error(uploaded.error || 'No se pudo completar la subida.');
  return uploaded;
}

async function transmit(item) {
  if (item.running) return;
  if (item.identity !== (activeAccount?.email || 'guest')) { imageStatus.textContent = 'Vuelve a la cuenta que inició este envío para reintentarlo.'; return; }
  item.running = true;
  item.message.failed = false;
  if (roomKey() === item.room) updateIncomingMessage(item.message);
  try {
    while (item.payload.files.length < item.files.length) {
      const file = item.files[item.payload.files.length];
      item.payload.files.push(await uploadAttachment(file, item.room));
    }
    let response;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await apiFetch(item.room ? '/api/private/messages' : '/api/messages', {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(item.payload), signal: AbortSignal.timeout(20000)
        });
        if (response.status < 500 || attempt) break;
      } catch (error) { if (attempt) throw error; }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'No se pudo enviar.');
    outbox.delete(item.payload.clientId);
    if (roomKey() === item.room) addIncomingMessage(result);
  } catch (error) {
    // SSE may already have confirmed an HTTP request whose response was lost.
    if (outbox.has(item.payload.clientId)) {
      item.message.failed = true;
      if (roomKey() === item.room) updateIncomingMessage(item.message);
      imageStatus.textContent = error.message || 'No se pudo enviar. Puedes reintentar.';
    }
  } finally { item.running = false; }
}
form.addEventListener('submit', event => {
  event.preventDefault();
  const room = roomKey(), author = authorInput.value.trim(), text = textInput.value.trim();
  if ((!room && !author) || (!text && !pendingImages.length && !pendingFiles.length && !audioData && !selectedGifUrl)) return;
  if (outbox.size >= 20) { imageStatus.textContent = 'Hay envíos pendientes. Espera o reinténtalos antes de enviar más.'; return; }
  const clientId = crypto.randomUUID();
  const images = pendingImages.map(item => item.dataUrl);
  const payload = {clientId, text, images, audioData, gifUrl: selectedGifUrl, files: []};
  if (room) payload.recipientUsername = room;
  else { payload.author = author; payload.replyToId = replyToId; if (!activeAccount && avatarData) payload.avatarData = avatarData; }
  const message = {id: `pending-${clientId}`, clientId, author: activeAccount?.displayName || author,
    text, images, audioData, gifUrl: selectedGifUrl, createdAt: Date.now(), pending: true,
    avatarData: activeAccount?.avatarData || avatarData, files: pendingFiles.map(item => ({name: item.file.name, size: item.file.size}))};
  const item = {room, identity: activeAccount?.email || 'guest', payload, message, files: pendingFiles.map(item => item.file), running: false};
  outbox.set(clientId, item);
  addIncomingMessage(message);
  textInput.value = ''; imageInput.value = ''; audioFileInput.value = ''; anyFileInput.value = '';
  pendingImages = []; pendingFiles = []; audioData = ''; selectedGifUrl = ''; replyToId = '';
  replyComposer.hidden = true; renderPendingImages(); imageStatus.textContent = ''; textInput.focus();
  transmit(item);
});
messagesElement.addEventListener('click', event => {
  const id = event.target.closest('[data-retry-id]')?.dataset.retryId;
  if (id && outbox.has(id)) transmit(outbox.get(id));
});

function openProfileEditor() {
  setMobileDrawer('info'); profileMenu.hidden = false;
  profileMenu.scrollIntoView({block:'nearest'}); updateProfileCard();
}
avatarPicker.addEventListener('click', openProfileEditor);
document.querySelector('#edit-profile').addEventListener('click',openProfileEditor);
closeProfile.addEventListener('click', () => { profileMenu.hidden = true; });
changeAvatar.addEventListener('click', () => avatarInput.click());

avatarInput.addEventListener('change', async () => {
  if (!activeAccount) {
    profileStatus.textContent = 'Inicia sesión para usar una foto de perfil.';
    avatarInput.value = '';
    return;
  }
  const file = avatarInput.files[0];
  avatarInput.value = '';
  if (!file) return;
  if (file.size > 4_000_000) {
    profileStatus.textContent = 'La foto de perfil debe pesar como máximo 4 MB.';
    return;
  }
  try {
    draftAvatarData = await prepareAvatar(file);
    updateAvatarPreview(draftAvatarData);
    profileStatus.textContent = 'Foto lista. Pulsa “Guardar cambios” en tu perfil.';
  } catch (error) {
    profileStatus.textContent = error.message || 'No se pudo preparar la foto de perfil.';
  }
});

saveProfile.addEventListener('click', async () => {
  const name = authorInput.value.trim();
  if (!name) {
    authorInput.focus();
    return;
  }
  if (!activeAccount) {
    saveNameCookie(name);
    updateProfileCard();
  profileStatus.textContent = 'Perfil guardado.';
    profileStatus.textContent = 'Los invitados no pueden guardar una foto de perfil.';
    return;
  }
  const username = profileUsernameInput.value.trim();
  if (!/^@[a-zA-Z0-9_]{3,20}$/.test(username)) {
    profileUsernameInput.focus();
    profileStatus.textContent = 'El usuario debe empezar con @ y tener entre 3 y 20 caracteres.';
    return;
  }
  const response = await apiFetch('/api/auth/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: name, username, avatarData: draftAvatarData, bannerData: draftBannerData, bio: profileBioInput.value })
  });
  const result = await response.json();
  if (!response.ok) {
    profileStatus.textContent = result.error || 'No se pudo actualizar el perfil.';
    return;
  }
  activeAccount = result.account;
  profileBioInput.value = result.account.bio || '';
  draftBannerData = result.account.bannerData || '';
  authorInput.value = result.account.displayName;
  profileUsernameInput.value = result.account.username;
  avatarData = result.account.avatarData || '';
  draftAvatarData = avatarData;
  saveNameCookie(authorInput.value);
  localStorage.setItem('bruma-avatar', avatarData);
  updateAvatarPreview(avatarData);
  updateProfileCard();
  profileStatus.textContent = 'Perfil guardado.';
  profileStatus.textContent = 'Perfil actualizado.';
  loadFriends().catch(() => {});
});

function updateAvatarPreview(data) {
  if (data) {
    avatarPicker.innerHTML = `<img src="${data}" alt="">`;
    profileAvatarPreview.innerHTML = `<img src="${data}" alt="">`;
    profileAvatarPreview.classList.remove('profile-fallback');
  } else {
    avatarPicker.textContent = 'Bm';
    profileAvatarPreview.textContent = (authorInput.value || '?').slice(0, 1).toUpperCase();
    profileAvatarPreview.classList.add('profile-fallback');
  }
}

async function prepareAvatar(file) {
  const signature = new Uint8Array(await file.slice(0,6).arrayBuffer());
  const isGif = signature.length === 6 && String.fromCharCode(...signature).match(/^GIF8[79]a$/);
  if (isGif) {
    if (file.size > 4_000_000) return Promise.reject(new Error('El GIF de perfil debe pesar como máximo 4 MB.'));
    const dataUrl = await readFileAsDataUrl(file);
    return 'data:image/gif;base64,' + dataUrl.slice(dataUrl.indexOf(',') + 1); // Preserve frames and normalize picker MIME.
  }
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      const size = 256;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight);
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL('image/jpeg', 0.78));
    };
    image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Imagen inválida')); };
    image.src = objectUrl;
  });
}

gifForm.addEventListener('submit', async event => {
  event.preventDefault();
  const query = gifQuery.value.trim();
  if (!giphyApiKey) {
    gifStatus.textContent = 'Falta configurar GIPHY_API_KEY en el servidor.';
    return;
  }
  if (!query) return;
  gifStatus.textContent = 'Buscando...';
  try {
    const params = new URLSearchParams({ api_key: giphyApiKey, q: query, limit: '12', rating: 'g', lang: 'es' });
    const response = await apiFetch(`https://api.giphy.com/v1/gifs/search?${params}`);
    if (!response.ok) throw new Error('GIPHY no respondió');
    const result = await response.json();
    gifResults.innerHTML = result.data.map(gif => {
      const url = gif.images?.fixed_width?.url || gif.images?.original?.url;
      return url ? `<button class="gif-result" type="button" data-gif-url="${escapeHtml(url)}"><img src="${escapeHtml(url)}" alt="${escapeHtml(gif.title || 'GIF')}" loading="lazy"></button>` : '';
    }).join('');
    gifStatus.textContent = result.data.length ? 'Elige un GIF para adjuntarlo.' : 'No encontramos GIFs para esa búsqueda.';
    requestAnimationFrame(syncGifSpace);
  } catch {
    gifStatus.textContent = 'No se pudo conectar con GIPHY.';
  }
});

gifResults.addEventListener('click', event => {
  const button = event.target.closest('.gif-result');
  if (!button) return;
  selectedGifUrl = button.dataset.gifUrl;
  gifStatus.textContent = 'GIF seleccionado. Puedes añadir texto y enviarlo.';
  gifResults.querySelectorAll('.gif-result').forEach(item => item.classList.remove('selected'));
  button.classList.add('selected');
});

recordButton.addEventListener('click', async () => {
  if (mediaRecorder?.state === 'recording') {
    mediaRecorder.stop();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    imageStatus.textContent = 'Este navegador no permite grabar audio.';
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type)) || '';
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recordedChunks = [];
    recordingSeconds = 0;
    audioData = '';
    mediaRecorder.addEventListener('dataavailable', event => { if (event.data.size) recordedChunks.push(event.data); });
    mediaRecorder.addEventListener('stop', async () => {
      stream.getTracks().forEach(track => track.stop());
      const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      if (blob.size > 6 * 1024 * 1024) {
        imageStatus.textContent = 'El audio es demasiado grande. Graba uno más corto.';
        recordButton.textContent = '● Voz';
        return;
      }
      audioData = await readFileAsDataUrl(blob);
      imageStatus.textContent = 'Audio listo para enviar.';
      recordButton.textContent = '● Voz';
    });
    mediaRecorder.start();
    recordButton.classList.add('recording');
    recordButton.textContent = '■ 00:00';
    recordingTimer = setInterval(() => {
      recordingSeconds += 1;
      recordButton.textContent = `■ 00:${String(recordingSeconds).padStart(2, '0')}`;
      if (recordingSeconds >= 60) mediaRecorder.stop();
    }, 1000);
    mediaRecorder.addEventListener('stop', () => {
      clearInterval(recordingTimer);
      recordButton.classList.remove('recording');
    }, { once: true });
  } catch {
    imageStatus.textContent = 'No se pudo acceder al micrófono. Revisa el permiso del navegador.';
  }
});

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result));
    reader.addEventListener('error', reject);
    reader.readAsDataURL(file);
  });
}

function prepareImage(file) {
  // Las fotos del móvil suelen ser grandes; reducirlas evita que el mensaje
  // completo supere el límite cuando se seleccionan varias.
  if (file.type === 'image/gif' || file.size < 700_000) return readFileAsDataUrl(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      const maxSide = 1600;
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL('image/jpeg', 0.78));
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('No se pudo preparar una imagen.'));
    };
    image.src = objectUrl;
  });
}

imageInput.addEventListener('change', () => {
  addImages([...imageInput.files]);
  imageInput.value = '';
});

attachmentToggle.addEventListener('click', () => {
  attachmentMenu.hidden = !attachmentMenu.hidden;
  attachmentToggle.setAttribute('aria-expanded', String(!attachmentMenu.hidden));
});

attachmentMenu.addEventListener('click', event => {
  const button = event.target.closest('[data-attachment]');
  if (!button) return;
  attachmentMenu.hidden = true;
  attachmentToggle.setAttribute('aria-expanded', 'false');
  if (button.dataset.attachment === 'image') imageInput.click();
  if (button.dataset.attachment === 'audio') audioFileInput.click();
  if (button.dataset.attachment === 'file') anyFileInput.click();
});

audioFileInput.addEventListener('change', async () => {
  const file = audioFileInput.files[0];
  audioFileInput.value = '';
  if (!file) return;
  if (!file.type.startsWith('audio/') || file.size > 10 * 1024 * 1024) {
    imageStatus.textContent = 'Cada audio debe ser válido y pesar como máximo 10 MB.';
    return;
  }
  audioData = await readFileAsDataUrl(file);
  imageStatus.textContent = 'Audio listo para enviar.';
});

anyFileInput.addEventListener('change', () => {
  const file = anyFileInput.files[0];
  anyFileInput.value = '';
  if (!file) return;
  if (file.size > 500 * 1024 * 1024) {
    imageStatus.textContent = 'Cada archivo debe pesar como máximo 500 MB.';
    return;
  }
  pendingFiles.push({ id: crypto.randomUUID(), file });
  renderPendingImages();
  imageStatus.textContent = `${pendingFiles.length} archivo(s) listo(s) para enviar.`;
});

async function addImages(files) {
  if (pendingImages.length + files.length > maxImagesPerMessage) {
    imageStatus.textContent = `Puedes acumular como máximo ${maxImagesPerMessage} imágenes.`;
    return;
  }
  if (files.some(file => file.size > 10 * 1024 * 1024)) {
    imageStatus.textContent = 'Cada imagen debe pesar como máximo 10 MB.';
    return;
  }
  try {
    imageStatus.textContent = 'Preparando imágenes...';
    const prepared = await Promise.all(files.map(async file => ({
      id: crypto.randomUUID(),
      name: file.name,
      dataUrl: await prepareImage(file)
    })));
    pendingImages.push(...prepared);
    renderPendingImages();
    imageStatus.textContent = `${pendingImages.length} imagen${pendingImages.length === 1 ? '' : 'es'} lista${pendingImages.length === 1 ? '' : 's'} para enviar.`;
  } catch {
    imageStatus.textContent = 'No se pudo preparar una de las imágenes.';
  }
}

function renderPendingImages() {
  imageQueue.innerHTML = pendingImages.map(image => `
    <div class="queued-image">
      <img src="${image.dataUrl}" alt="${escapeHtml(image.name)}">
      <button type="button" data-remove-image="${image.id}" aria-label="Quitar ${escapeHtml(image.name)}">×</button>
    </div>`).join('') + pendingFiles.map(item => `
    <div class="queued-file"><span>📎 ${escapeHtml(item.file.name)}</span><button type="button" data-remove-file="${item.id}" aria-label="Quitar archivo">×</button></div>`).join('');
}

imageQueue.addEventListener('click', event => {
  const button = event.target.closest('[data-remove-image], [data-remove-file]');
  if (!button) return;
  pendingImages = pendingImages.filter(image => image.id !== button.dataset.removeImage);
  pendingFiles = pendingFiles.filter(item => item.id !== button.dataset.removeFile);
  renderPendingImages();
  imageStatus.textContent = pendingImages.length || pendingFiles.length ? 'Contenido listo para enviar.' : '';
});

messagesElement.addEventListener('click', async event => {
  const button = event.target.closest('.edit-button');
  if (button) {
    const message = currentMessages.find(item => item.id === button.dataset.messageId);
    if (!message?.canEdit) return;
    pendingEditId = message.id;
    editInput.value = message.text;
    editDialog.hidden = false;
    editInput.focus();
    return;
  }
  const deleteButton = event.target.closest('.delete-button');
  if (deleteButton) {
    const message = currentMessages.find(item => item.id === deleteButton.dataset.deleteId);
    if (!message?.canEdit) return;
    if (!deleteConfirmationEnabled) {
      await deleteMessage(message.id);
    } else {
      pendingDeleteId = message.id;
      deleteDialog.hidden = false;
      confirmDelete.focus();
    }
    return;
  }
  const replyButton = event.target.closest('.reply-button');
  if (replyButton) {
    const message = currentMessages.find(item => item.id === replyButton.dataset.replyId);
    if (!message) return;
    replyToId = message.id;
    replyAuthor.textContent = message.author;
    replyText.textContent = message.text || (message.images ? 'Imagen' : message.gifUrl ? 'GIF' : message.audioData ? 'Mensaje de voz' : 'Mensaje');
    replyComposer.hidden = false;
    textInput.focus();
  }
});

cancelReply.addEventListener('click', () => {
  replyToId = '';
  replyComposer.hidden = true;
});

async function deleteMessage(messageId) {
  const deleteUrl = `/api/messages/${encodeURIComponent(messageId)}`;
  const response = await apiFetch(deleteUrl, { method: 'DELETE' });
  const result = await response.json();
  if (response.ok) {
    deleteIncomingMessage(messageId);
    return true;
  }
  imageStatus.textContent = result.error || 'No se pudo borrar el mensaje.';
  return false;
}

function closeDeleteDialog() {
  pendingDeleteId = '';
  deleteDialog.hidden = true;
}

cancelDelete.addEventListener('click', closeDeleteDialog);

confirmDelete.addEventListener('click', async () => {
  if (!pendingDeleteId) return;
  const messageId = pendingDeleteId;
  closeDeleteDialog();
  await deleteMessage(messageId);
});

deleteWithoutConfirmation.addEventListener('click', async () => {
  if (!pendingDeleteId) return;
  deleteConfirmationEnabled = false;
  localStorage.setItem('bruma-delete-confirmation', 'false');
  const messageId = pendingDeleteId;
  closeDeleteDialog();
  await deleteMessage(messageId);
});

function closeEditDialog() {
  pendingEditId = '';
  editDialog.hidden = true;
}

cancelEdit.addEventListener('click', closeEditDialog);

saveEdit.addEventListener('click', async () => {
  const text = editInput.value.trim();
  if (!pendingEditId || !text) return;
  const messageId = pendingEditId;
  closeEditDialog();
  const response = await apiFetch(`/api/messages/${encodeURIComponent(messageId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  if (response.ok) updateIncomingMessage(await response.json());
  else imageStatus.textContent = 'No se pudo editar el mensaje.';
});

const notices = new BrumaNotices();
const notificationToggle = document.querySelector('#toggle-notifications');
const notificationStatus = document.querySelector('#notification-status');
const notificationToast = document.querySelector('#notification-toast');
let notificationsEnabled = localStorage.getItem('bruma-notifications') === 'true';
let noticeTimer;
let noticeAction = null;

function refreshNoticeBadges() {
  document.title = notices.count() ? `(${notices.count()}) Bruma — chat efímero` : 'Bruma — chat efímero';
  groupRoom.dataset.unread = String(notices.unread.get('') || 0);
  addFriend.dataset.unread = String(notices.unread.get('#friends') || 0);
  for (const button of friendList.querySelectorAll('[data-friend-username]')) button.dataset.unread = String(notices.unread.get(button.dataset.friendUsername) || 0);
}
function readActiveRoom() {
  if (!document.hidden && document.hasFocus()) { notices.read(roomKey()); refreshNoticeBadges(); }
}
function notificationSettings() {
  notificationToggle.textContent = notificationsEnabled ? 'Desactivar notificaciones' : 'Activar notificaciones';
  notificationToggle.setAttribute('aria-pressed', String(notificationsEnabled));
  notificationStatus.textContent = !notificationsEnabled ? 'Avisos desactivados.' :
    !('Notification' in window) ? 'Avisos dentro de Bruma. Este navegador no admite avisos del sistema.' :
    Notification.permission === 'granted' ? 'Avisos activados mientras Bruma esté abierta.' : 'Avisos dentro de Bruma. Los avisos del sistema necesitan permiso del navegador.';
}
notificationToggle.addEventListener('click', async () => {
  notificationsEnabled = !notificationsEnabled;
  localStorage.setItem('bruma-notifications', String(notificationsEnabled));
  if (notificationsEnabled && 'Notification' in window && Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch { /* In-app notices remain available. */ }
  }
  if (!notificationsEnabled) notificationToast.hidden = true;
  notificationSettings();
});
notificationToast.addEventListener('click', () => { notificationToast.hidden = true; noticeAction?.(); });
document.addEventListener('visibilitychange', readActiveRoom);
window.addEventListener('focus', readActiveRoom);

function notifyIncoming(message, room, own = false, request = false) {
  const visible = !document.hidden && document.hasFocus() && (request ? !friendsMenu.hidden : roomKey() === room);
  if (!notices.receive(message,room,own,visible)) return;
  refreshNoticeBadges();
  if (!notificationsEnabled) return;
  const title = request ? 'Nueva solicitud de amistad' : room ? `Mensaje de ${message.author || room}` : `Sala del grupo · ${message.author || 'Mensaje nuevo'}`;
  const text = request ? `${message.author} quiere agregarte.` : message.text || 'Ha compartido un archivo o contenido multimedia.';
  const open = () => {
    if (request) { setMobileDrawer('nav'); friendsMenu.hidden = false; loadFriends().catch(() => {}); notices.read('#friends'); refreshNoticeBadges(); }
    else if (!room) openGroupChat().catch(() => {});
    else {
      const friend = friendsData.friends.find(item => item.username === room);
      if (friend) openPrivateChat(friend).catch(() => {});
    }
  };
  noticeAction = open; notificationToast.textContent = `${title}: ${text}`; notificationToast.hidden = false;
  clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { notificationToast.hidden = true; },8000);
  if ('Notification' in window && Notification.permission === 'granted' && (document.hidden || !document.hasFocus())) {
    try {
      const notification = new Notification(title,{body: text,tag: request ? 'bruma-friends' : `bruma:${room}`, data: {room}});
      notification.onclick = () => { notification.close(); window.focus(); open(); };
      setTimeout(() => notification.close(),10000);
    } catch { /* Some mobile browsers require push; the in-app notice still works. */ }
  }
}
notificationSettings();

const publicProfileDialog = document.querySelector('#public-profile');
let profileRequestGeneration = 0;
let viewedProfile = null;
document.querySelector('#close-public-profile').addEventListener('click', () => { ++profileRequestGeneration; publicProfileDialog.close(); });
document.querySelector('#public-profile-chat').addEventListener('click', () => {
  if (!viewedProfile) return;
  publicProfileDialog.close(); openPrivateChat(viewedProfile).catch(() => {});
});
async function viewProfile(username) {
  const generation = ++profileRequestGeneration;
  const name = document.querySelector('#public-profile-name');
  const handle = document.querySelector('#public-profile-username');
  const avatar = document.querySelector('#public-profile-avatar');
  const status = document.querySelector('#public-profile-status');
  const chat = document.querySelector('#public-profile-chat');
  renderBanner(document.querySelector('#public-profile-banner'),''); document.querySelector('#public-profile-bio').hidden = true;
  viewedProfile = null; name.textContent = ''; handle.textContent = ''; avatar.textContent = '?'; avatar.classList.add('profile-fallback'); chat.hidden = true; status.textContent = 'Cargando perfil…';
  if (!publicProfileDialog.open) publicProfileDialog.showModal();
  try {
    const response = await apiFetch(`/api/profiles/${encodeURIComponent(username)}`);
    const result = await response.json();
    if (generation !== profileRequestGeneration || !publicProfileDialog.open) return;
    if (!response.ok) { status.textContent = result.error || 'No se pudo abrir el perfil.'; return; }
    const profile = result.profile; viewedProfile = profile;
    renderBanner(document.querySelector('#public-profile-banner'),profile.bannerData);
    const bio = document.querySelector('#public-profile-bio'); bio.textContent = profile.bio || ''; bio.hidden = !profile.bio;
    name.textContent = profile.displayName; handle.textContent = profile.username; status.textContent = '';
    avatar.textContent = (profile.displayName || '?').slice(0,1).toUpperCase();
    if (profile.avatarData) { const image = document.createElement('img'); image.src = profile.avatarData; image.alt = `Foto de ${profile.displayName}`; avatar.replaceChildren(image); avatar.classList.remove('profile-fallback'); }
    chat.hidden = !friendsData.friends.some(friend => friend.username === profile.username);
  } catch { if (generation === profileRequestGeneration) status.textContent = 'No se pudo conectar para abrir el perfil.'; }
}
messagesElement.addEventListener('click', event => { const target = event.target.closest('[data-profile-username]'); if (target) viewProfile(target.dataset.profileUsername); });
messagesElement.addEventListener('keydown', event => { if (!['Enter',' '].includes(event.key)) return; const target = event.target.closest('[data-profile-username]'); if (target) { event.preventDefault(); viewProfile(target.dataset.profileUsername); } });
roomTitle.addEventListener('click', () => { if (activePrivateFriend) viewProfile(activePrivateFriend.username); });

let events;
function connectEvents() {
  events?.close();
  events = new EventSource('/api/events?v=3');
  events.addEventListener('messages', event => { if (!activePrivateFriend) render(JSON.parse(event.data)); });
  events.addEventListener('message-created', event => { const message = JSON.parse(event.data); notifyIncoming(message,'',Boolean(message.canEdit || outbox.has(message.clientId))); if (!activePrivateFriend) addIncomingMessage(message); else if (message.clientId) outbox.delete(message.clientId); });
  events.addEventListener('message-updated', event => { if (!activePrivateFriend) updateIncomingMessage(JSON.parse(event.data)); });
  events.addEventListener('message-deleted', event => { if (!activePrivateFriend) deleteIncomingMessage(JSON.parse(event.data).id); });
  events.addEventListener('friends', () => { loadFriends().catch(() => {}); });
  events.addEventListener('friend-request', event => { const data = JSON.parse(event.data); notifyIncoming({id: `friend:${data.id}`,author: data.from.displayName},'#friends',false,true); });
  events.addEventListener('private-created', event => {
    const data = JSON.parse(event.data);
    notifyIncoming(data.message,data.friendUsername,Boolean(data.isOwn || data.message?.username === activeAccount?.username || outbox.has(data.message?.clientId)));
    if (activePrivateFriend?.username === data.friendUsername) addIncomingMessage(data.message);
    else if (data.message?.clientId) outbox.delete(data.message.clientId);
  });
  events.addEventListener('private-deleted', event => { const data = JSON.parse(event.data); if (roomKey() === data.friendUsername) deleteIncomingMessage(data.id); });
  events.addEventListener('private', event => {
    const data = JSON.parse(event.data);
    if (activePrivateFriend?.username === data.friendUsername) render(data.messages);
  });
}
apiFetch('/api/config').then(response => response.json()).then(config => {
  giphyApiKey = config.giphyApiKey || '';
  maxImagesPerMessage = config.maxImages || 10;
  if (!giphyApiKey) gifStatus.textContent = 'Configura GIPHY_API_KEY para activar el buscador.';
});
apiFetch('/api/auth/me').then(response => response.json()).then(result => {
  if (result.account) {
    avatarData = localStorage.getItem('bruma-avatar') || '';
    draftAvatarData = avatarData;
    updateAvatarPreview(avatarData);
  } else {
    avatarData = '';
    draftAvatarData = '';
    localStorage.removeItem('bruma-avatar');
    updateAvatarPreview('');
  }
  showAccount(result.account);
  connectEvents();
  loadFriends().catch(() => {});
  setTimeout(() => { if (!currentMessages.length) loadMessages().catch(() => {}); }, 3000);
}).catch(() => { imageStatus.textContent = 'No se pudo conectar. Recarga para reintentar.'; });
updateAvatarPreview(avatarData);
updateGifPanel();
updateCleanupClock();
setInterval(updateCleanupClock, 30_000);

function renderBanner(target,data) {
  target.replaceChildren();
  if (data) { const img = document.createElement('img'); img.src = data; img.alt = 'Banner del perfil'; target.append(img); }
}
function updateProfileCard() {
  renderBanner(document.querySelector('#profile-banner-preview'),draftBannerData);
  document.querySelector('#profile-name-preview').textContent = authorInput.value || 'Tu nombre';
  document.querySelector('#profile-handle-preview').textContent = profileUsernameInput.value || '@usuario';
  const bio = document.querySelector('#profile-bio-preview'); bio.textContent = profileBioInput.value; bio.hidden = !profileBioInput.value;
  document.querySelector('#bio-count').textContent = `${profileBioInput.value.length} / 2000`;
}
for (const input of [authorInput,profileUsernameInput,profileBioInput]) input.addEventListener('input',updateProfileCard);
document.querySelector('#change-banner').addEventListener('click',() => bannerInput.click());
document.querySelector('#remove-banner').addEventListener('click',() => { draftBannerData = ''; updateProfileCard(); profileStatus.textContent = 'Pulsa Guardar cambios para quitar el banner.'; });
bannerInput.addEventListener('change',async () => {
  const file = bannerInput.files[0]; bannerInput.value = '';
  if (!file) return;
  if (!activeAccount) { profileStatus.textContent = 'Inicia sesión para editar tu banner.'; return; }
  try { draftBannerData = await prepareBanner(file); updateProfileCard(); profileStatus.textContent = 'Banner listo. Pulsa Guardar cambios.'; }
  catch(error) { profileStatus.textContent = error.message; }
});
async function prepareBanner(file) {
  if (file.size > 10_000_000) throw new Error('El archivo del banner supera 10 MB.');
  const prefix = new Uint8Array(await file.slice(0,6).arrayBuffer());
  if (String.fromCharCode(...prefix).match(/^GIF8[79]a$/)) throw new Error('Elige un banner estático PNG, JPEG o WebP.');
  return new Promise((resolve,reject) => {
    const image = new Image(), url = URL.createObjectURL(file);
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 480;
        const ctx = canvas.getContext('2d');
        const scale = Math.max(canvas.width/image.naturalWidth,canvas.height/image.naturalHeight);
        const w = image.naturalWidth*scale, h = image.naturalHeight*scale;
        ctx.drawImage(image,(canvas.width-w)/2,(canvas.height-h)/2,w,h);
        let data = canvas.toDataURL('image/jpeg',0.85);
        if (data.length > 1_333_360) data = canvas.toDataURL('image/jpeg',0.65);
        if (data.length > 1_333_360) throw new Error('El banner preparado supera 1 MB. Elige otra imagen.');
        resolve(data);
      } catch(error) { reject(error); } finally { URL.revokeObjectURL(url); }
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer el banner. Elige PNG, JPEG o WebP.')); };
    image.src = url;
  });
}
updateProfileCard();
