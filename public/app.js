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
const textInput = document.querySelector('#text');
const imageInput = document.querySelector('#image');
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
let mediaRecorder;
let recordedChunks = [];
let audioData = '';
let recordingTimer;
let recordingSeconds = 0;
let selectedGifUrl = '';
let giphyApiKey = '';
let maxImagesPerMessage = 10;
let pendingImages = [];
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
  if (next) profileMenu.hidden = true;
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
  const response = await fetch(endpoint, {
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
  friendList.innerHTML = friendsData.friends.map(friend => friendAvatarMarkup(friend, activePrivateFriend?.username === friend.username ? 'active' : '')).join('');
  incomingRequests.innerHTML = friendsData.incoming.length
    ? friendsData.incoming.map(request => `<div class="friend-request"><span>${escapeHtml(request.from.displayName)} <small>${escapeHtml(request.from.username)}</small></span><button data-request-id="${request.id}" data-request-action="accept">Aceptar</button><button data-request-id="${request.id}" data-request-action="reject">×</button></div>`).join('')
    : '<small class="friend-empty">No tienes solicitudes pendientes.</small>';
  outgoingRequests.innerHTML = friendsData.outgoing.length
    ? friendsData.outgoing.map(request => `<div class="friend-request"><span>${escapeHtml(request.to.username)}</span><small>Pendiente</small></div>`).join('')
    : '<small class="friend-empty">No hay solicitudes enviadas.</small>';
}

async function loadFriends() {
  const response = await fetch('/api/friends');
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
  chatPanel.classList.add('private-mode');
  groupRoom.classList.remove('active');
  roomTitle.textContent = `${friend.displayName} ${friend.username}`;
  sideRoomTitle.textContent = friend.displayName;
  sideRoomDescription.textContent = `Conversación privada con ${friend.username}.`;
  sidePrivacyCopy.textContent = 'Los mensajes privados se eliminan después de 24 horas.';
  pendingImages = [];
  audioData = '';
  selectedGifUrl = '';
  renderPendingImages();
  imageStatus.textContent = '';
  updateGifPanel();
  renderFriends();
  const response = await fetch(`/api/private/messages/${encodeURIComponent(friend.username)}`);
  if (!response.ok) {
    imageStatus.textContent = 'No se pudo abrir el chat privado.';
    return;
  }
  render(await response.json());
}

async function openGroupChat() {
  setMobileDrawer();
  activePrivateFriend = null;
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
  const button = event.target.closest('[data-friend-username]');
  if (!button) return;
  const friend = friendsData.friends.find(item => item.username === button.dataset.friendUsername);
  if (friend) openPrivateChat(friend).catch(() => {});
});
addFriend.addEventListener('click', () => { friendsMenu.hidden = !friendsMenu.hidden; if (!friendsMenu.hidden) loadFriends().catch(() => {}); });
closeFriends.addEventListener('click', () => { friendsMenu.hidden = true; });

sendFriendRequest.addEventListener('click', async () => {
  const username = friendUsername.value.trim();
  if (!username) return;
  const response = await fetch('/api/friends/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username }) });
  const result = await response.json();
  friendsStatus.textContent = result.error || (result.accepted ? 'Solicitud aceptada. Ya son amigos.' : 'Solicitud enviada.');
  if (response.ok) { friendUsername.value = ''; await loadFriends(); }
});

incomingRequests.addEventListener('click', async event => {
  const button = event.target.closest('[data-request-id]');
  if (!button) return;
  const response = await fetch(`/api/friends/requests/${encodeURIComponent(button.dataset.requestId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: button.dataset.requestAction }) });
  const result = await response.json();
  friendsStatus.textContent = result.error || 'Solicitud actualizada.';
  if (response.ok) await loadFriends();
});

function showAccount(account) {
  activeAccount = account;
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
  await fetch('/api/auth/logout', { method: 'POST' });
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
  currentMessages = messages;
  messagesElement.innerHTML = messages.length ? messages.map(message => `
    <article class="message">
      <div class="message-meta">${avatarMarkup(message)}<div class="message-name-row"><strong>${escapeHtml(message.author)}${message.isAccount ? `<span class="account-star" title="Cuenta registrada">★</span><span class="message-username">${escapeHtml(message.username || '')}</span>` : ''}</strong><time>${timeLabel(message.createdAt)}${message.edited ? ' · editado' : ''}</time></div></div>
      ${message.replyTo ? `<div class="reply-preview"><strong>↪ ${escapeHtml(message.replyTo.author)}</strong><span>${escapeHtml(message.replyTo.text)}</span></div>` : ''}
      ${renderImages(message)}
      ${message.gifUrl ? renderMedia(message.gifUrl, `GIF enviado por ${message.author}`) : ''}
      ${message.audioData ? `<audio class="message-audio" controls preload="metadata" src="${message.audioData}"></audio>` : ''}
      ${message.text ? `<p>${escapeHtml(message.text)}</p>` : ''}
      <div class="message-actions">
        <button class="reply-button" data-reply-id="${message.id}">Responder</button>
        ${message.canEdit ? `<button class="edit-button" data-message-id="${message.id}">Editar</button><button class="delete-button" data-delete-id="${message.id}">Borrar</button>` : ''}
      </div>
    </article>`).join('') : '<p class="empty">Todavía no hay mensajes. Deja el primero.</p>';
  messagesElement.scrollTop = messagesElement.scrollHeight;
}

function avatarMarkup(message) {
  if (message.avatarData) return `<img class="profile-avatar" src="${message.avatarData}" alt="Foto de perfil de ${escapeHtml(message.author)}">`;
  return `<div class="profile-avatar profile-fallback" aria-hidden="true">${escapeHtml((message.author || '?').slice(0, 1).toUpperCase())}</div>`;
}

function renderImages(message) {
  const images = message.images || (message.imageData ? [message.imageData] : []);
  return images.length ? `<div class="message-images ${images.length === 1 ? 'single' : ''}">${images.map((image, index) => renderMedia(image, `Imagen ${index + 1} enviada por ${message.author}`)).join('')}</div>` : '';
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
  const response = await fetch('/api/messages');
  render(await response.json());
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (activePrivateFriend) {
    const privateText = textInput.value.trim();
    if (!privateText) return;
    if (pendingImages.length || audioData || selectedGifUrl) {
      imageStatus.textContent = 'El chat privado admite mensajes de texto por ahora.';
      return;
    }
    try {
      const response = await fetch('/api/private/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipientUsername: activePrivateFriend.username, text: privateText }) });
      const result = await response.json();
      if (!response.ok) { imageStatus.textContent = result.error || 'No se pudo enviar el mensaje privado.'; return; }
      textInput.value = '';
      imageStatus.textContent = '';
      return;
    } catch {
      imageStatus.textContent = 'No se pudo conectar con el chat privado.';
      return;
    }
  }
  const author = authorInput.value.trim();
  const text = textInput.value.trim();
  if (!author || (!text && !pendingImages.length && !audioData && !selectedGifUrl)) return;
  authorInput.value = author;
  saveNameCookie(author);
  try {
    const images = pendingImages.map(item => item.dataUrl);
    const response = await fetch('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ author, text, images, audioData, gifUrl: selectedGifUrl, avatarData, replyToId }) });
    const result = await response.json();
    if (!response.ok) {
      imageStatus.textContent = result.error || 'No se pudo enviar el mensaje.';
      return;
    }
    textInput.value = '';
    imageInput.value = '';
    pendingImages = [];
    renderPendingImages();
    audioData = '';
    selectedGifUrl = '';
    replyToId = '';
    replyComposer.hidden = true;
    imageStatus.textContent = '';
    textInput.focus();
  } catch {
    imageStatus.textContent = 'No se pudo conectar con el servidor. Ejecuta: npm start';
  }
});

avatarPicker.addEventListener('click', () => { profileMenu.hidden = !profileMenu.hidden; });
closeProfile.addEventListener('click', () => { profileMenu.hidden = true; });
changeAvatar.addEventListener('click', () => avatarInput.click());

avatarInput.addEventListener('change', async () => {
  if (!activeAccount) {
    imageStatus.textContent = 'Inicia sesión para usar una foto de perfil.';
    avatarInput.value = '';
    return;
  }
  const file = avatarInput.files[0];
  avatarInput.value = '';
  if (!file) return;
  if (file.size > 4 * 1024 * 1024) {
    imageStatus.textContent = 'La foto de perfil debe pesar menos de 4 MB.';
    return;
  }
  try {
    draftAvatarData = await prepareAvatar(file);
    updateAvatarPreview(draftAvatarData);
    imageStatus.textContent = 'Foto lista. Pulsa “Guardar cambios” en tu perfil.';
  } catch {
    imageStatus.textContent = 'No se pudo preparar la foto de perfil.';
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
    profileMenu.hidden = true;
    imageStatus.textContent = 'Los invitados no pueden guardar una foto de perfil.';
    return;
  }
  const username = profileUsernameInput.value.trim();
  if (!/^@[a-zA-Z0-9_]{3,20}$/.test(username)) {
    profileUsernameInput.focus();
    imageStatus.textContent = 'El usuario debe empezar con @ y tener entre 3 y 20 caracteres.';
    return;
  }
  const response = await fetch('/api/auth/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: name, username, avatarData: draftAvatarData })
  });
  const result = await response.json();
  if (!response.ok) {
    imageStatus.textContent = result.error || 'No se pudo actualizar el perfil.';
    return;
  }
  activeAccount = result.account;
  authorInput.value = result.account.displayName;
  profileUsernameInput.value = result.account.username;
  avatarData = result.account.avatarData || '';
  draftAvatarData = avatarData;
  saveNameCookie(authorInput.value);
  localStorage.setItem('bruma-avatar', avatarData);
  updateAvatarPreview(avatarData);
  profileMenu.hidden = true;
  imageStatus.textContent = 'Perfil actualizado.';
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

function prepareAvatar(file) {
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
    const response = await fetch(`https://api.giphy.com/v1/gifs/search?${params}`);
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

async function addImages(files) {
  if (pendingImages.length + files.length > maxImagesPerMessage) {
    imageStatus.textContent = `Puedes acumular como máximo ${maxImagesPerMessage} imágenes.`;
    return;
  }
  if (files.some(file => file.size > 4 * 1024 * 1024)) {
    imageStatus.textContent = 'Cada imagen debe pesar menos de 4 MB.';
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
    </div>`).join('');
}

imageQueue.addEventListener('click', event => {
  const button = event.target.closest('[data-remove-image]');
  if (!button) return;
  pendingImages = pendingImages.filter(image => image.id !== button.dataset.removeImage);
  renderPendingImages();
  imageStatus.textContent = pendingImages.length ? `${pendingImages.length} imágenes listas para enviar.` : '';
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
  const response = await fetch(deleteUrl, { method: 'DELETE' });
  const result = await response.json();
  if (response.ok) {
    await loadMessages();
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
  const response = await fetch(`/api/messages/${encodeURIComponent(messageId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  if (response.ok) await loadMessages();
  else imageStatus.textContent = 'No se pudo editar el mensaje.';
});

let events;
function connectEvents() {
  events?.close();
  events = new EventSource('/api/events');
  events.addEventListener('messages', event => { if (!activePrivateFriend) render(JSON.parse(event.data)); });
  events.addEventListener('friends', () => { loadFriends().catch(() => {}); });
  events.addEventListener('private', event => {
    const data = JSON.parse(event.data);
    if (activePrivateFriend?.username === data.friendUsername) render(data.messages);
  });
}
connectEvents();
fetch('/api/config').then(response => response.json()).then(config => {
  giphyApiKey = config.giphyApiKey || '';
  maxImagesPerMessage = config.maxImages || 10;
  if (!giphyApiKey) gifStatus.textContent = 'Configura GIPHY_API_KEY para activar el buscador.';
});
fetch('/api/auth/me').then(response => response.json()).then(result => {
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
}).catch(() => {});
updateAvatarPreview(avatarData);
loadFriends().catch(() => {});
updateGifPanel();
loadMessages().catch(() => { messagesElement.innerHTML = '<p class="empty">No se pudo conectar con la sala.</p>'; });
updateCleanupClock();
setInterval(updateCleanupClock, 30_000);
