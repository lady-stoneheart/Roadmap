import {
  collection,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
  doc,
  updateDoc,
  increment,
  deleteDoc,
  getDoc,
  runTransaction,
  arrayUnion,
  arrayRemove
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let feedUnsubscribe = null;
const SUPER_ADMIN_UID = "HYnkQqkR3cNKUs2Ty3eqGlUXxdV2";
const ADMIN_AVATAR = "https://i.ibb.co/d00DSvT5/IMG-2136.jpg";

const compressImage = (base64Str, maxWidth = 1020, maxHeight = 1020) => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      if (width > height) {
        if (width > maxWidth) { height *= maxWidth / width; width = maxWidth; }
      } else {
        if (height > maxHeight) { width *= maxHeight / height; height = maxHeight; }
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
  });
};

export const initSocialFeed = (auth, db, isAdmin = false) => {
  const container = document.getElementById('feed-container');
  const adminPanel = document.getElementById('feed-admin-panel');
  const postBtn = document.getElementById('feed-submit-post');
  const pollToggle = document.getElementById('btn-toggle-poll');
  const pollCreator = document.getElementById('poll-creator');
  const pollOptionsContainer = document.getElementById('poll-options-container');
  const addOptionBtn = document.getElementById('add-poll-option');
  const imageInput = document.getElementById('feed-image-input');
  const imagePreview = document.getElementById('image-preview');
  const imagePreviewContainer = document.getElementById('image-preview-container');

  if (feedUnsubscribe) { feedUnsubscribe(); feedUnsubscribe = null; }

  let currentImageData = '';
  let isPollActive = false;
  if (!container) return;

  // --- Window Functions ---

  window.toggleAdminMenu = (postId) => {
    const menu = document.getElementById(`admin-menu-${postId}`);
    if (menu) menu.classList.toggle('hidden');
  };

  window.enableEditMode = (postId) => {
    const contentDiv = document.getElementById(`post-content-${postId}`);
    if(!contentDiv) return;

    const menu = document.getElementById(`admin-menu-${postId}`);
    if(menu) menu.classList.add('hidden');

    const currentText = contentDiv.innerText;
    contentDiv.setAttribute('data-original', currentText);

    contentDiv.innerHTML = `
      <textarea id="edit-area-${postId}" class="w-full p-4 border border-neutral-200 rounded-2xl bg-neutral-50 text-black font-bold uppercase tracking-tight text-sm outline-none resize-none mb-3 min-h-[120px] focus:bg-white focus:ring-2 focus:ring-black/5 transition-all shadow-inner">${currentText}</textarea>
      <div class="flex gap-2 justify-end">
        <button onclick="window.cancelEdit('${postId}')" class="px-5 py-2.5 bg-white text-neutral-500 border border-neutral-200 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-neutral-50 transition-colors">CANCEL</button>
        <button onclick="window.saveEdit('${postId}')" class="px-5 py-2.5 bg-black text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-neutral-800 transition-colors shadow-lg shadow-black/20">SAVE</button>
      </div>
    `;
  };

  window.cancelEdit = (postId) => {
    const contentDiv = document.getElementById(`post-content-${postId}`);
    if(!contentDiv) return;
    const original = contentDiv.getAttribute('data-original') || '';
    contentDiv.innerHTML = original;
  };

  window.saveEdit = async (postId) => {
    const textarea = document.getElementById(`edit-area-${postId}`);
    if(!textarea) return;
    const newText = textarea.value.trim();
    const contentDiv = document.getElementById(`post-content-${postId}`);
    if(contentDiv) contentDiv.innerHTML = `<span class="text-neutral-300 font-bold animate-pulse text-xs tracking-widest uppercase">SAVING UPDATE...</span>`;
    try {
      await updateDoc(doc(db, 'social_posts', postId), { text: newText, lastEdited: serverTimestamp() });
    } catch(err) {
      alert("Update failed: " + err.message);
      if(contentDiv) window.enableEditMode(postId);
    }
  };

  window.expandImage = (url) => {
    const overlay = document.createElement('div');
    overlay.className = "fixed inset-0 z-[200] bg-white/95 backdrop-blur-xl flex items-center justify-center p-4 cursor-zoom-out animate-in fade-in duration-200";
    overlay.innerHTML = `<img src="${url}" class="max-w-full max-h-[90vh] rounded-[2rem] shadow-2xl scale-95 animate-in zoom-in-95 duration-300">`;
    overlay.onclick = () => overlay.remove();
    document.body.appendChild(overlay);
  };

  window.likePost = async (postId) => {
    const user = auth.currentUser;
    if (!user) { alert("SIGN IN TO LIKE."); return; }
    const postRef = doc(db, 'social_posts', postId);
    try {
      const snap = await getDoc(postRef);
      if (!snap.exists()) return;
      const data = snap.data();
      const likedBy = data.likedBy || [];
      const isLiked = likedBy.includes(user.uid);
      if (isLiked) {
        await updateDoc(postRef, { likedBy: arrayRemove(user.uid), likes: increment(-1) });
      } else {
        await updateDoc(postRef, { likedBy: arrayUnion(user.uid), likes: increment(1) });
      }
    } catch (err) { console.error("Like failed:", err); }
  };

  window.voteInPoll = async (postId, optionIdx) => {
    const user = auth.currentUser;
    if (!user) { alert("SIGN IN TO VOTE."); return; }
    const voteRef = doc(db, 'social_posts', postId, 'votes', user.uid);
    const postRef = doc(db, 'social_posts', postId);
    try {
      await runTransaction(db, async (transaction) => {
        const voteSnap = await transaction.get(voteRef);
        if (voteSnap.exists()) throw new Error("ALREADY_VOTED");
        const postSnap = await transaction.get(postRef);
        const data = postSnap.data();
        if (!data || !data.pollOptions) return;
        const newOptions = [...data.pollOptions];
        newOptions[optionIdx].votes = (newOptions[optionIdx].votes || 0) + 1;
        transaction.set(voteRef, { userId: user.uid, optionIdx, timestamp: serverTimestamp() });
        transaction.update(postRef, { pollOptions: newOptions });
      });
    } catch (err) { if (err.message !== "ALREADY_VOTED") console.error("Vote failed:", err); }
  };

  // --- UI Listeners ---
  if (pollToggle) {
    pollToggle.onclick = () => {
      isPollActive = !isPollActive;
      pollCreator?.classList.toggle('hidden');
      pollToggle.innerText = isPollActive ? "REMOVE POLL" : "ADD POLL";
    };
  }

  if (addOptionBtn && pollOptionsContainer) {
    addOptionBtn.onclick = () => {
      const currentOptions = pollOptionsContainer.querySelectorAll('.poll-option-input').length;
      const newInput = document.createElement('input');
      newInput.type = 'text';
      newInput.className = 'poll-option-input w-full p-3 bg-white/10 border border-white/20 text-white rounded-xl text-sm mb-2 font-bold placeholder-neutral-500 focus:bg-white/20 transition-all outline-none';
      newInput.placeholder = `OPTION ${currentOptions + 1}`;
      pollOptionsContainer.appendChild(newInput);
    };
  }

  if (imageInput) {
    imageInput.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = async (re) => {
          currentImageData = await compressImage(re.target.result);
          imagePreview.src = currentImageData;
          imagePreviewContainer?.classList.remove('hidden');
        };
        reader.readAsDataURL(file);
      }
    };
  }

  if (postBtn) {
    postBtn.onclick = async () => {
      const user = auth.currentUser;
      const text = document.getElementById('feed-post-text').value.trim();
      if (!text && !currentImageData) return;
      postBtn.innerText = "POSTING...";
      try {
        const postData = {
          text, author: "B. AYMEN", userId: user.uid, timestamp: serverTimestamp(),
          likes: 0, likedBy: [], type: 'text'
        };
        if (currentImageData) { postData.type = 'image'; postData.imageUrl = currentImageData; }
        if (isPollActive) {
          const options = Array.from(document.querySelectorAll('.poll-option-input')).map(i => i.value.trim()).filter(v => v);
          if (options.length >= 2) {
            postData.type = 'poll';
            postData.pollOptions = options.map(opt => ({ text: opt.toUpperCase(), votes: 0 }));
          }
        }
        await addDoc(collection(db, 'social_posts'), postData);
        document.getElementById('feed-post-text').value = '';
        currentImageData = '';
        imagePreviewContainer?.classList.add('hidden');
        isPollActive = false;
        pollCreator?.classList.add('hidden');
        pollToggle.innerText = "ADD POLL";
        pollOptionsContainer.innerHTML = `<input type="text" class="poll-option-input w-full p-3 bg-white/10 border border-white/20 text-white rounded-xl text-sm mb-2 font-bold placeholder-neutral-500 focus:bg-white/20 transition-all outline-none" placeholder="OPTION 1"><input type="text" class="poll-option-input w-full p-3 bg-white/10 border border-white/20 text-white rounded-xl text-sm mb-2 font-bold placeholder-neutral-500 focus:bg-white/20 transition-all outline-none" placeholder="OPTION 2">`;
      } catch (err) { alert("Error: " + err.message); } finally { postBtn.innerText = "POST"; }
    };
  }

  // --- Feed Render ---
  const q = query(collection(db, 'social_posts'), orderBy('timestamp', 'desc'));
  feedUnsubscribe = onSnapshot(q, (snap) => {
    const currentUser = auth.currentUser;
    const isSuperAdmin = isAdmin;

    if (adminPanel) {
      if (isSuperAdmin) {
        adminPanel.classList.remove('hidden');
        adminPanel.style.backgroundColor = '#000000';
        adminPanel.style.borderColor = '#000000';
      } else {
        adminPanel.classList.add('hidden');
      }
    }

    container.innerHTML = snap.docs.map(docSnap => {
      const data = docSnap.data();
      const id = docSnap.id;
      const time = data.timestamp ? new Date(data.timestamp.seconds * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'SYNCING';
      const isAymen = data.userId === SUPER_ADMIN_UID;
      const profilePic = isAymen ? ADMIN_AVATAR : `https://api.dicebear.com/7.x/avataaars/svg?seed=${data.userId}`;
      const displayName = isAymen ? "B. AYMEN" : (data.author ? data.author.split('@')[0].toUpperCase() : 'USER');

      let pollHtml = '';
      if (data.type === 'poll') {
        const totalVotes = (data.pollOptions || []).reduce((acc, opt) => acc + (opt.votes || 0), 0);
        pollHtml = `<div class="space-y-2 mt-5 mb-5">${data.pollOptions.map((opt, idx) => {
          const pct = totalVotes > 0 ? Math.round((opt.votes / totalVotes) * 100) : 0;
          return `<button onclick="window.voteInPoll('${id}', ${idx})" class="group relative w-full h-11 rounded-xl border border-neutral-200 bg-neutral-50 overflow-hidden hover:border-black/20 hover:bg-white transition-all">
                    <div class="absolute inset-y-0 left-0 bg-black/5 transition-all duration-700 ease-out" style="width: ${pct}%"></div>
                    <div class="relative flex justify-between items-center px-4 h-full text-[10px] font-black uppercase tracking-widest text-neutral-500 group-hover:text-black transition-colors">
                        <span>${opt.text}</span>
                        <span>${pct}%</span>
                    </div>
                </button>`;
        }).join('')}<div class="flex justify-end"><span class="text-[9px] font-black text-neutral-300 uppercase tracking-[0.2em] mt-1">${totalVotes} VOTES</span></div></div>`;
      }

      const mainImageHtml = data.imageUrl ? `
            <div class="mt-5 rounded-3xl overflow-hidden border border-neutral-100 shadow-sm cursor-zoom-in group" onclick="window.expandImage('${data.imageUrl}')">
                <img src="${data.imageUrl}" class="w-full object-cover max-h-[500px] grayscale group-hover:grayscale-0 transition-all duration-700 transform group-hover:scale-105">
            </div>` : '';

      const menuHtml = isSuperAdmin ? `
            <div class="relative flex-shrink-0 ml-2">
                <button onclick="window.toggleAdminMenu('${id}')" class="w-8 h-8 flex items-center justify-center rounded-full hover:bg-neutral-100 transition-colors text-neutral-300 hover:text-black">
                    <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
                </button>
                <div id="admin-menu-${id}" class="hidden absolute right-0 mt-2 w-36 bg-white border border-neutral-100 shadow-2xl rounded-2xl z-50 py-1.5 overflow-hidden animate-in fade-in slide-in-from-top-2">
                    <button onclick="window.enableEditMode('${id}')" class="w-full text-left px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-neutral-500 hover:bg-neutral-50 hover:text-black transition-colors border-b border-neutral-50">EDIT</button>
                </div>
            </div>` : '';

      const likeBtnClass = (data.likedBy && data.likedBy.includes(currentUser?.uid)) 
            ? 'bg-black border-black text-white shadow-lg shadow-black/20' 
            : 'bg-white border-neutral-200 text-neutral-300 group-hover:border-black group-hover:text-black';

      const likeIconFill = (data.likedBy && data.likedBy.includes(currentUser?.uid)) ? 'currentColor' : 'none';

      return `
            <div class="stagger-item flex gap-5 p-6 sm:p-8 bg-white border border-neutral-100 rounded-[2.5rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] mb-8 hover:shadow-[0_20px_40px_rgb(0,0,0,0.06)] transition-all duration-500">
                <div class="flex-shrink-0">
                    <div class="w-12 h-12 sm:w-14 sm:h-14 rounded-full border border-neutral-100 flex items-center justify-center overflow-hidden bg-neutral-50 shadow-inner">
                        <img src="${profilePic}" class="w-full h-full object-cover grayscale opacity-90">
                    </div>
                </div>
                <div class="flex-1 min-w-0 pt-1">
                    <div class="flex items-start justify-between mb-3">
                        <div class="flex flex-col">
                            <span class="font-black text-black text-sm uppercase tracking-tight leading-none mb-1">${displayName}</span>
                            <span class="text-neutral-300 text-[10px] font-black uppercase tracking-widest">${time}</span>
                        </div>
                        ${menuHtml}
                    </div>
                    <div id="post-content-${id}" class="text-black text-sm leading-relaxed font-bold uppercase tracking-tight mb-1 whitespace-pre-wrap">${data.text || ''}</div>
                    ${pollHtml}${mainImageHtml}
                    <div class="flex items-center gap-6 mt-6 pt-4 border-t border-dashed border-neutral-100">
                        <button onclick="window.likePost('${id}')" class="flex items-center gap-3 group transition-all active:scale-95">
                            <div class="w-9 h-9 rounded-full flex items-center justify-center border transition-all duration-300 ${likeBtnClass}">
                                <svg class="w-4 h-4" fill="${likeIconFill}" stroke="current
