/**
 * Campus Unfolded — Video Notes
 * Sticky-note style notes attached to each video, saved per student.
 *
 * Public API (window.*):
 *   openNote(videoId, videoTitle)   — open the note editor
 *   hasNote(videoId)                — boolean, does the current user have a note
 *   getNoteCount()                  — total notes
 *   refreshNoteBadges()             — re-sync all badges
 */

(function () {
  'use strict';

  const COLLECTION = 'notes';
  const MAX_CHARS = 1500;
  const WORD_LIMIT = 200;
  const DOC_ID_SEPARATOR = '__';
  const SAVE_DEBOUNCE_MS = 800;
  const MODAL_ID = 'noteModal';

  let currentUserId = null;
  let currentVideoId = null;
  let currentVideoTitle = '';
  let saveTimer = null;
  let notesCache = new Map();
  let isReady = false;
  let snapshotUnsub = null;

  const $ = (id) => document.getElementById(id);

  function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }

  function docIdFor(userId, videoId) {
    return `${userId}${DOC_ID_SEPARATOR}${videoId}`;
  }

  function countWords(text) {
    if (!text) return 0;
    return text.trim().split(/\s+/).filter(Boolean).length;
  }

  function hasContent(videoId) {
    const entry = notesCache.get(videoId);
    return !!(entry && entry.content && entry.content.trim().length > 0);
  }

  // ============================================
  // INIT
  // ============================================
  async function init() {
    await new Promise((resolve) => {
      if (typeof window.onUserReady === 'function') {
        window.onUserReady(resolve);
      } else {
        const t0 = Date.now();
        const tick = setInterval(() => {
          if (auth.currentUser) { clearInterval(tick); resolve(); }
          else if (Date.now() - t0 > 10000) { clearInterval(tick); resolve(); }
        }, 150);
      }
    });

    const user = auth.currentUser;
    if (!user) return;
    currentUserId = user.uid;

    await loadAllNotes();
    setupRealtimeListener();

    isReady = true;
    refreshAllNoteBadges();
  }

  async function loadAllNotes() {
    try {
      const snap = await db.collection(COLLECTION)
        .where('userId', '==', currentUserId)
        .get();

      snap.forEach((doc) => {
        const data = doc.data();
        if (!data.videoId) return;
        notesCache.set(data.videoId, {
          content: data.content || '',
          updatedAt: data.updatedAt || data.createdAt
        });
      });
    } catch (err) {
      console.warn('[Notes] Load failed:', err.code);
    }
  }

  function setupRealtimeListener() {
    if (snapshotUnsub) snapshotUnsub();

    snapshotUnsub = db.collection(COLLECTION)
      .where('userId', '==', currentUserId)
      .onSnapshot((snap) => {
        let changed = false;
        snap.docChanges().forEach((change) => {
          const data = change.doc.data();
          if (!data.videoId) return;

          if (change.type === 'added' || change.type === 'modified') {
            const prev = notesCache.get(data.videoId);
            const next = { content: data.content || '', updatedAt: data.updatedAt || data.createdAt };
            if (!prev || prev.content !== next.content) {
              notesCache.set(data.videoId, next);
              changed = true;
            }
          }
          if (change.type === 'removed') {
            if (notesCache.has(data.videoId)) {
              notesCache.delete(data.videoId);
              changed = true;
            }
          }
        });
        if (changed) refreshAllNoteBadges();
      }, (err) => {
        if (err.code === 'permission-denied') {
          console.warn('[Notes] Access revoked');
        }
      });
  }

  // ============================================
  // BADGE SYNC — across all layouts
  // ============================================
  function refreshAllNoteBadges() {
    // 1. Grid / List cards
    document.querySelectorAll('[data-item-id]').forEach((card) => {
      const videoId = card.dataset.itemId;
      if (!videoId) return;
      updateCardBadge(card, videoId);
    });

    // 2. Cover Flow action buttons
    document.querySelectorAll('.coverflow-card').forEach((card) => {
      const noteBtn = card.querySelector('[data-note-id]');
      if (!noteBtn) return;
      const videoId = noteBtn.dataset.noteId;
      if (!videoId) return;
      const has = hasContent(videoId);
      noteBtn.classList.toggle('has-note', has);
      noteBtn.setAttribute('title', has ? 'View note' : 'Add note');
      noteBtn.setAttribute('aria-label', has ? 'View note' : 'Add note');
    });
  }

  function updateCardBadge(card, videoId) {
    const indicator = card.querySelector('.note-indicator');
    if (!indicator) return;
    const has = hasContent(videoId);

    if (has) {
      indicator.classList.add('has-note');
      indicator.innerHTML = `
        <span class="material-icons">sticky_note_2</span>
        <span>View note</span>
      `;
    } else {
      indicator.classList.remove('has-note');
      indicator.innerHTML = `
        <span class="material-icons">sticky_note_2</span>
        <span>Add note</span>
      `;
    }
  }

  // ============================================
  // MODAL
  // ============================================
  function ensureModal() {
    if ($(MODAL_ID)) return;

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'note-modal-overlay';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'noteModalTitle');
    modal.innerHTML = `
      <div class="note-modal-content">
        <div class="note-paper">
          <div class="note-tape" aria-hidden="true"></div>

          <div class="note-header">
            <div class="note-header-left">
              <span class="material-icons" aria-hidden="true">sticky_note_2</span>
              <h3 id="noteModalTitle">My Notes</h3>
            </div>
            <button class="note-close-btn" aria-label="Close note" id="noteCloseBtn">
              <span class="material-icons">close</span>
            </button>
          </div>

          <div class="note-video-title" id="noteVideoTitle"></div>

          <textarea
            id="noteTextarea"
            class="note-textarea"
            placeholder="What did you learn from this lecture? Write in your own words..."
            maxlength="${MAX_CHARS}"
            spellcheck="true"
            aria-label="Your notes for this video"></textarea>

          <div class="note-footer">
            <div class="note-meta">
              <span class="note-word-count" id="noteWordCount">0 / ${WORD_LIMIT} words</span>
              <span class="note-save-status" id="noteSaveStatus"></span>
            </div>
            <div class="note-actions">
              <button class="note-btn note-btn-clear" id="noteClearBtn">
                <span class="material-icons">delete_outline</span>
                Clear
              </button>
              <button class="note-btn note-btn-save" id="noteSaveBtn">
                <span class="material-icons">check</span>
                Save
              </button>
            </div>
          </div>

          <div class="note-hint">
            <span class="material-icons" aria-hidden="true">info</span>
            <span>Notes are private — only you can see them.</span>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    $('noteCloseBtn').addEventListener('click', closeModal);
    $('noteSaveBtn').addEventListener('click', () => saveNote(true));
    $('noteClearBtn').addEventListener('click', clearNote);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    const textarea = $('noteTextarea');
    textarea.addEventListener('input', () => {
      updateWordCount();
      autoGrow(textarea);
      scheduleSave();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('active')) {
        closeModal();
      }
    });
  }

  function updateWordCount() {
    const textarea = $('noteTextarea');
    const counter = $('noteWordCount');
    if (!textarea || !counter) return;
    const words = countWords(textarea.value);
    counter.textContent = `${words} / ${WORD_LIMIT} words`;

    counter.classList.toggle('over-limit', words > WORD_LIMIT);
    counter.classList.toggle('near-limit', words > WORD_LIMIT * 0.8 && words <= WORD_LIMIT);

    if (words > WORD_LIMIT) {
      const trimmed = textarea.value.trim().split(/\s+/).slice(0, WORD_LIMIT).join(' ');
      textarea.value = trimmed;
      counter.textContent = `${WORD_LIMIT} / ${WORD_LIMIT} words`;
    }
  }

  function autoGrow(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, window.innerHeight * 0.5) + 'px';
  }

  function setSaveStatus(text, type = '') {
    const el = $('noteSaveStatus');
    if (!el) return;
    el.textContent = text;
    el.className = 'note-save-status ' + type;
  }

  // ============================================
  // OPEN / CLOSE
  // ============================================
  async function openNote(videoId, videoTitle) {
    if (!isReady) {
      if (auth.currentUser) await init();
      if (!isReady) {
        window.showToast?.('Please wait, loading...', 'error');
        return;
      }
    }

    ensureModal();

    currentVideoId = videoId;
    currentVideoTitle = videoTitle || '';

    const existing = notesCache.get(videoId);
    const textarea = $('noteTextarea');
    textarea.value = existing?.content || '';
    updateWordCount();
    autoGrow(textarea);
    setSaveStatus(existing ? 'Saved' : '');

    $('noteVideoTitle').textContent = videoTitle || '';
    $('noteModalTitle').textContent = existing ? 'My Notes' : 'New Note';

    const overlay = $(MODAL_ID);
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    setTimeout(() => textarea.focus(), 250);
  }

  function closeModal() {
    const overlay = $(MODAL_ID);
    if (!overlay) return;
    overlay.classList.remove('active');
    document.body.style.overflow = 'auto';

    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      saveNote(false);
    }
  }

  // ============================================
  // SAVE
  // ============================================
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    setSaveStatus('Saving...', 'saving');
    saveTimer = setTimeout(() => saveNote(false), SAVE_DEBOUNCE_MS);
  }

  async function saveNote(explicit) {
    if (!currentVideoId || !currentUserId) return;

    const textarea = $('noteTextarea');
    if (!textarea) return;

    const content = textarea.value.trim();
    const docId = docIdFor(currentUserId, currentVideoId);
    const docRef = db.collection(COLLECTION).doc(docId);

    if (!content) {
      if (notesCache.has(currentVideoId)) {
        try {
          await docRef.delete();
          notesCache.delete(currentVideoId);
          refreshAllNoteBadges();
          refreshExternalBadges();
          setSaveStatus('Cleared');
          if (explicit) window.showToast?.('Note cleared', 'info');
        } catch (err) {
          console.warn('[Notes] Delete failed:', err.code);
          setSaveStatus('Failed to clear', 'error');
        }
      }
      return;
    }

    if (content.length > MAX_CHARS) {
      setSaveStatus('Note too long', 'error');
      return;
    }

    try {
      const existing = notesCache.has(currentVideoId);
      if (existing) {
        await docRef.update({
          content,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      } else {
        await docRef.set({
          userId: currentUserId,
          videoId: currentVideoId,
          videoTitle: currentVideoTitle,
          content,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }

      notesCache.set(currentVideoId, {
        content,
        updatedAt: new Date()
      });

      setSaveStatus('Saved ✓', 'saved');
      refreshAllNoteBadges();
      refreshExternalBadges();

      if (explicit) {
        window.showToast?.('Note saved', 'success');
        closeModal();
      }
    } catch (err) {
      console.warn('[Notes] Save failed:', err.code);
      setSaveStatus('Failed to save', 'error');
      if (explicit) window.showToast?.('Could not save note', 'error');
    }
  }

  async function clearNote() {
    if (!currentVideoId || !currentUserId) return;
    const textarea = $('noteTextarea');
    if (!textarea) return;

    textarea.value = '';
    updateWordCount();
    autoGrow(textarea);

    const docId = docIdFor(currentUserId, currentVideoId);
    try {
      await db.collection(COLLECTION).doc(docId).delete();
      notesCache.delete(currentVideoId);
      refreshAllNoteBadges();
      refreshExternalBadges();
      setSaveStatus('Cleared');
      window.showToast?.('Note cleared', 'info');
    } catch (err) {
      if (err.code === 'not-found') {
        notesCache.delete(currentVideoId);
        refreshAllNoteBadges();
        refreshExternalBadges();
        setSaveStatus('Cleared');
        return;
      }
      console.warn('[Notes] Clear failed:', err.code);
      setSaveStatus('Failed to clear', 'error');
    }
  }

  // ============================================
  // EXTERNAL REFRESH — tell coverflow + story to update
  // ============================================
  function refreshExternalBadges() {
    // Coverflow view: re-render to update button states
    if (typeof window.__CU_refreshCoverflow === 'function') {
        window.__CU_refreshCoverflow();
    }
}

  // ============================================
  // PUBLIC API
  // ============================================
  window.openNote = openNote;
  window.hasNote = (videoId) => hasContent(videoId);
  window.getNoteCount = () => notesCache.size;
  window.refreshNoteBadges = refreshAllNoteBadges;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
