/**
 * Campus Unfolded — Scrapbook
 * A gallery of all the student's notes, paginated 5 at a time.
 *
 * Features:
 * - Fetch all notes for the current user
 * - Paginate 5 per page
 * - Rotate through 5 pastel paper colors
 * - Edit note → opens sticky-paper modal → updates Firestore
 * - Delete note → confirmation dialog → deletes from Firestore
 */

(function () {
  'use strict';

  // ============================================
  // CONFIG
  // ============================================
  const CONFIG = Object.freeze({
    COLLECTION: 'notes',
    PAGE_SIZE: 5,
    MAX_CHARS: 1500,
    WORD_LIMIT: 200,
    PAPER_COLORS: 5
  });

  // ============================================
  // STATE
  // ============================================
  let currentUser = null;
  let allNotes = [];
  let displayedCount = 0;
  let isUserReady = false;
  let snapshotUnsub = null;
  let editingDocId = null;
  let pendingDeleteDocId = null;
  let pendingDeleteVideoTitle = '';

  // ============================================
  // UTIL
  // ============================================
  const $ = (id) => document.getElementById(id);

  function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }

  function countWords(text) {
    if (!text) return 0;
    return text.trim().split(/\s+/).filter(Boolean).length;
  }

  function relativeTime(ts) {
    if (!ts) return 'just now';
    let ms;
    if (ts && typeof ts.toMillis === 'function') ms = ts.toMillis();
    else if (ts instanceof Date) ms = ts.getTime();
    else if (typeof ts === 'number') ms = ts;
    else return 'just now';

    const diff = Date.now() - ms;
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const days = Math.floor(hr / 24);
    if (days < 7) return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    if (weeks < 4) return `${weeks}w ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    const years = Math.floor(days / 365);
    return `${years}y ago`;
  }

  function showToast(message, type = 'success') {
    const toast = $('scrapbookToast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = 'scrapbook-toast show' + (type === 'error' ? ' error' : '');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.classList.remove('show');
    }, 2500);
  }

  // ============================================
  // AUTH GATE
  // ============================================
  function hideAuthGate() {
    const gate = $('authGate');
    if (gate) gate.classList.remove('active');
    $('scrapbookRoot')?.removeAttribute('hidden');
    document.body.style.overflow = 'auto';
  }

  function redirectToLogin() {
    try { localStorage.removeItem('session'); } catch (_) {}
    window.location.replace('index.html');
  }

  // ============================================
  // INIT
  // ============================================
  function bootstrap() {
    auth.onAuthStateChanged(async (user) => {
      if (!user) {
        redirectToLogin();
        return;
      }

      currentUser = user;

      // Verify whitelist
      try {
        const email = (user.email || '').toLowerCase();
        const doc = await db.collection('whitelist').doc(email).get();
        if (!doc.exists || doc.data().active !== true) {
          await auth.signOut();
          redirectToLogin();
          return;
        }
      } catch (err) {
        console.warn('[Scrapbook] Whitelist check failed:', err.code);
        redirectToLogin();
        return;
      }

      isUserReady = true;
      await loadNotes();
      startRealtimeListener();
      hideAuthGate();

      // Update header
      const nameEl = $('scrapbookSubtitle');
      if (nameEl) {
        try {
          const email = (user.email || '').toLowerCase();
          const doc = await db.collection('whitelist').doc(email).get();
          const name = doc.exists ? (doc.data().studentName || '') : '';
          const displayName = name || user.displayName || (user.email || '').split('@')[0];
          nameEl.textContent = `${displayName}'s notes — all in one place`;
        } catch (_) {}
      }
    }, (err) => {
      console.warn('[Scrapbook] Auth error:', err);
      redirectToLogin();
    });
  }

  // ============================================
  // FETCH NOTES
  // ============================================
  async function loadNotes() {
    try {
      const snap = await db.collection(CONFIG.COLLECTION)
        .where('userId', '==', currentUser.uid)
        .get();

      allNotes = snap.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          videoId: data.videoId || '',
          videoTitle: data.videoTitle || 'Untitled video',
          content: data.content || '',
          createdAt: data.createdAt,
          updatedAt: data.updatedAt || data.createdAt
        };
      });

      // Sort by most recent first
      allNotes.sort((a, b) => {
        const ta = a.updatedAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0;
        const tb = b.updatedAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0;
        return tb - ta;
      });

      displayedCount = 0;
      renderNotes();

      const countEl = $('noteCount');
      if (countEl) countEl.textContent = allNotes.length;
    } catch (err) {
      console.warn('[Scrapbook] Load failed:', err.code);
      if (err.code === 'permission-denied') {
        redirectToLogin();
      }
    }
  }

  function startRealtimeListener() {
    if (snapshotUnsub) snapshotUnsub();

    snapshotUnsub = db.collection(CONFIG.COLLECTION)
      .where('userId', '==', currentUser.uid)
      .onSnapshot((snap) => {
        // Rebuild allNotes from current snapshot
        allNotes = snap.docs.map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            videoId: data.videoId || '',
            videoTitle: data.videoTitle || 'Untitled video',
            content: data.content || '',
            createdAt: data.createdAt,
            updatedAt: data.updatedAt || data.createdAt
          };
        });

        allNotes.sort((a, b) => {
          const ta = a.updatedAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0;
          const tb = b.updatedAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0;
          return tb - ta;
        });

        // Keep displayed count reasonable
        displayedCount = Math.min(
          Math.max(displayedCount, CONFIG.PAGE_SIZE),
          allNotes.length
        );
        renderNotes();

        const countEl = $('noteCount');
        if (countEl) countEl.textContent = allNotes.length;
      }, (err) => {
        if (err.code === 'permission-denied') {
          redirectToLogin();
        }
      });
  }

  // ============================================
  // RENDER
  // ============================================
  function renderNotes() {
    const grid = $('scrapbookGrid');
    const empty = $('scrapbookEmpty');
    const loadMoreBtn = $('loadMoreBtn');
    const loadMoreText = $('loadMoreText');
    if (!grid) return;

    // Empty state
    if (allNotes.length === 0) {
      grid.innerHTML = '';
      if (empty) empty.style.display = 'block';
      if (loadMoreBtn) loadMoreBtn.style.display = 'none';
      return;
    }

    if (empty) empty.style.display = 'none';

    // Reset and render batch
    const start = 0;
    const end = Math.min(displayedCount || CONFIG.PAGE_SIZE, allNotes.length);
    const batch = allNotes.slice(start, end);

    grid.innerHTML = batch.map((note, i) => renderNoteCard(note, i)).join('');

    // Load more
    if (loadMoreBtn) {
      if (end < allNotes.length) {
        loadMoreBtn.style.display = 'flex';
        if (loadMoreText) {
          loadMoreText.textContent = `Load More (${allNotes.length - end} remaining)`;
        }
      } else {
        loadMoreBtn.style.display = 'none';
      }
    }

    // Wire card actions
    grid.querySelectorAll('[data-edit-note]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const docId = btn.dataset.editNote;
        openEditModal(docId);
      });
    });

    grid.querySelectorAll('[data-delete-note]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const docId = btn.dataset.deleteNote;
        const title = btn.dataset.deleteTitle || '';
        openDeleteModal(docId, title);
      });
    });
  }

  function renderNoteCard(note, index) {
    const colorIndex = index % CONFIG.PAPER_COLORS;
    const title = escapeHtml(note.videoTitle || 'Untitled video');
    const content = escapeHtml(note.content || '');
    const time = relativeTime(note.updatedAt || note.createdAt);
    const idAttr = escapeHtml(note.id);
    const titleForDelete = escapeHtml(note.videoTitle || 'Untitled video');

    return `
      <article class="scrapbook-card" data-color="${colorIndex}">
        <div class="scrapbook-card-tape" aria-hidden="true"></div>

        <div class="scrapbook-card-title-row">
          <a class="scrapbook-card-video" href="dashboard.html" title="Back to dashboard">
            <span class="material-icons">play_circle</span>
            <span class="scrapbook-card-video-text">${title}</span>
          </a>
          <span class="scrapbook-card-time">${escapeHtml(time)}</span>
        </div>

        <div class="scrapbook-card-body">${content}</div>

        <div class="scrapbook-card-actions">
          <button class="scrapbook-action" data-edit-note="${idAttr}" type="button">
            <span class="material-icons">edit</span>
            Edit
          </button>
          <button class="scrapbook-action scrapbook-action-delete"
                  data-delete-note="${idAttr}"
                  data-delete-title="${titleForDelete}"
                  type="button">
            <span class="material-icons">delete_outline</span>
            Delete
          </button>
        </div>
      </article>
    `;
  }

  // ============================================
  // LOAD MORE
  // ============================================
  function handleLoadMore() {
    displayedCount = Math.min(displayedCount + CONFIG.PAGE_SIZE, allNotes.length);
    renderNotes();
  }

  // ============================================
  // EDIT MODAL
  // ============================================
  function openEditModal(docId) {
    const note = allNotes.find((n) => n.id === docId);
    if (!note) {
      showToast('Note not found', 'error');
      return;
    }

    editingDocId = docId;

    const modal = $('noteEditModal');
    const videoTitleEl = $('noteEditVideoTitle');
    const textarea = $('noteEditTextarea');
    const wordCount = $('noteEditWordCount');

    if (videoTitleEl) videoTitleEl.textContent = note.videoTitle || '';
    if (textarea) {
      textarea.value = note.content || '';
      autoGrow(textarea);
    }
    if (wordCount) {
      const words = countWords(note.content || '');
      wordCount.textContent = `${words} / ${CONFIG.WORD_LIMIT} words`;
      wordCount.classList.remove('near-limit', 'over-limit');
      if (words > CONFIG.WORD_LIMIT * 0.8) wordCount.classList.add('near-limit');
    }

    modal?.classList.add('active');
    document.body.style.overflow = 'hidden';

    setTimeout(() => textarea?.focus(), 200);
  }

  function closeEditModal() {
    const modal = $('noteEditModal');
    modal?.classList.remove('active');
    document.body.style.overflow = 'auto';
    editingDocId = null;
  }

  function autoGrow(textarea) {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, window.innerHeight * 0.5) + 'px';
  }

  async function saveEdit() {
    if (!editingDocId || !currentUser) return;

    const textarea = $('noteEditTextarea');
    const saveBtn = $('noteEditSaveBtn');
    if (!textarea || !saveBtn) return;

    const content = textarea.value.trim();

    if (!content) {
      showToast('Note cannot be empty. Use Delete instead.', 'error');
      return;
    }

    if (content.length > CONFIG.MAX_CHARS) {
      showToast('Note is too long', 'error');
      return;
    }

    const originalBtn = saveBtn.innerHTML;
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="material-icons">hourglass_empty</span> Saving...';

    try {
      await db.collection(CONFIG.COLLECTION).doc(editingDocId).update({
        content,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      showToast('Note updated');
      closeEditModal();
    } catch (err) {
      console.warn('[Scrapbook] Save failed:', err.code);
      showToast('Failed to save', 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = originalBtn;
    }
  }

  // ============================================
  // DELETE MODAL
  // ============================================
  function openDeleteModal(docId, videoTitle) {
    pendingDeleteDocId = docId;
    pendingDeleteVideoTitle = videoTitle;

    const modal = $('noteDeleteModal');
    const msg = $('noteDeleteMessage');
    if (msg) {
      msg.textContent = `The note from "${videoTitle || 'this video'}" will be permanently deleted.`;
    }
    modal?.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeDeleteModal() {
    const modal = $('noteDeleteModal');
    modal?.classList.remove('active');
    document.body.style.overflow = 'auto';
    pendingDeleteDocId = null;
    pendingDeleteVideoTitle = '';
  }

  async function confirmDelete() {
    if (!pendingDeleteDocId) return;

    const btn = $('noteDeleteConfirmBtn');
    if (!btn) return;

    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Deleting...';

    try {
      await db.collection(CONFIG.COLLECTION).doc(pendingDeleteDocId).delete();
      showToast('Note deleted');
      closeDeleteModal();
    } catch (err) {
      console.warn('[Scrapbook] Delete failed:', err.code);
      showToast('Failed to delete', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  // ============================================
  // EVENT WIRING
  // ============================================
  document.addEventListener('DOMContentLoaded', () => {
    // Load more
    $('loadMoreBtn')?.addEventListener('click', handleLoadMore);

    // Edit modal
    $('noteEditCloseBtn')?.addEventListener('click', closeEditModal);
    $('noteEditCancelBtn')?.addEventListener('click', closeEditModal);
    $('noteEditSaveBtn')?.addEventListener('click', saveEdit);

    const editTextarea = $('noteEditTextarea');
    if (editTextarea) {
      editTextarea.addEventListener('input', () => {
        const words = countWords(editTextarea.value);
        const counter = $('noteEditWordCount');
        if (counter) {
          counter.textContent = `${Math.min(words, CONFIG.WORD_LIMIT)} / ${CONFIG.WORD_LIMIT} words`;
          counter.classList.toggle('near-limit', words > CONFIG.WORD_LIMIT * 0.8 && words <= CONFIG.WORD_LIMIT);
          counter.classList.toggle('over-limit', words > CONFIG.WORD_LIMIT);
        }

        if (words > CONFIG.WORD_LIMIT) {
          const trimmed = editTextarea.value.trim().split(/\s+/).slice(0, CONFIG.WORD_LIMIT).join(' ');
          editTextarea.value = trimmed;
        }

        autoGrow(editTextarea);
      });
    }

    // Click outside edit modal
    $('noteEditModal')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeEditModal();
    });

    // Delete modal
    $('noteDeleteCancelBtn')?.addEventListener('click', closeDeleteModal);
    $('noteDeleteConfirmBtn')?.addEventListener('click', confirmDelete);
    $('noteDeleteModal')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeDeleteModal();
    });

    // Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeEditModal();
        closeDeleteModal();
      }
    });

    // Boot
    if (typeof firebase !== 'undefined' && firebase.auth) {
      bootstrap();
    }
  });
})();
