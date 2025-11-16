let modal: HTMLElement | null;
let modalTitle: HTMLElement | null;
let modalBody: HTMLElement | null;
let modalClose: HTMLElement | null;
const closeHandlers: Array<() => void> = [];

export function initModal() {
  modal = document.getElementById('charModal');
  modalTitle = document.getElementById('charModalTitle');
  modalBody = document.getElementById('charModalBody');
  modalClose = document.getElementById('charModalClose');
  modalClose?.addEventListener('click', closeModal);
  modal?.querySelector('[data-overlay]')?.addEventListener('click', closeModal);
}

function onEscClose(e: KeyboardEvent) { if (e.key === 'Escape') closeModal(); }

export function openModal(title: string, initialHtml?: string) {
  if (!modal) initModal();
  if (!modal || !modalBody) return;
  if (modalTitle) modalTitle.textContent = title;
  modalBody.innerHTML = initialHtml ?? '';
  modal.style.display = 'block';
  document.addEventListener('keydown', onEscClose);
}

export function setModalBody(html: string) {
  if (!modalBody) modalBody = document.getElementById('charModalBody');
  if (modalBody) modalBody.innerHTML = html;
}

export function setModalLoading(text = 'Loading details…') {
  setModalBody(`<div class="muted">${text}</div>`);
}

export function closeModal() {
  if (!modal) modal = document.getElementById('charModal');
  if (!modal) return;
  modal.style.display = 'none';
  document.removeEventListener('keydown', onEscClose);
  try { closeHandlers.forEach(fn => fn()); } catch {}
}

export function onModalClose(handler: () => void) {
  closeHandlers.push(handler);
}
