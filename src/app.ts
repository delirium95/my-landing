import JSZip from 'jszip';
import './styles.css';

import {
  cleanFilename,
  detectIssues,
  makeUniqueName,
  sanitizeManualFilename,
  splitFilename,
} from './filename.js';
import type { FilenameFormat, FilenameIssue } from './filename.js';

function $<T extends Element = HTMLElement>(selector: string, scope: ParentNode = document): T {
  const element = scope.querySelector<T>(selector);
  if (!element) throw new Error(`Required element not found: ${selector}`);
  return element;
}

function $$<T extends Element = HTMLElement>(selector: string, scope: ParentNode = document): T[] {
  return [...scope.querySelectorAll<T>(selector)];
}

type HandoffIssue = FilenameIssue | { code: 'duplicate'; label: string };

interface FileRecord {
  id: string;
  file: File;
  originalName: string;
  suggestedName: string;
  issues: HandoffIssue[];
  included: boolean;
  duplicateOf: string | null;
  hash: string | null;
  manuallyEdited: boolean;
}

interface ExportRecord extends FileRecord {
  exportName: string;
}

interface AppState {
  records: FileRecord[];
  format: FilenameFormat;
  processing: boolean;
  isDemo: boolean;
}

const elements = {
  appWindow: $<HTMLDivElement>('[data-app-window]'),
  empty: $<HTMLDivElement>('[data-empty-state]'),
  processing: $<HTMLDivElement>('[data-processing-state]'),
  processingTitle: $<HTMLHeadingElement>('[data-processing-title]'),
  processingDetail: $<HTMLParagraphElement>('[data-processing-detail]'),
  progressBar: $<HTMLElement>('[data-progress-bar]'),
  review: $<HTMLDivElement>('[data-review-state]'),
  dropzone: $<HTMLDivElement>('[data-dropzone]'),
  fileInput: $<HTMLInputElement>('[data-file-input]'),
  fileList: $<HTMLDivElement>('[data-file-list]'),
  readyCount: $<HTMLSpanElement>('[data-ready-count]'),
  score: $<HTMLElement>('[data-score]'),
  scoreRing: $<HTMLDivElement>('[data-score-ring]'),
  scoreLabel: $<HTMLElement>('[data-score-label]'),
  scoreDetail: $<HTMLElement>('[data-score-detail]'),
  fixCount: $<HTMLElement>('[data-fix-count]'),
  duplicateCount: $<HTMLElement>('[data-duplicate-count]'),
  packageName: $<HTMLElement>('[data-package-name]'),
  packageMeta: $<HTMLElement>('[data-package-meta]'),
  download: $<HTMLButtonElement>('[data-download]'),
  downloadLabel: $<HTMLElement>('[data-download-label]'),
  toast: $<HTMLDivElement>('[data-toast]'),
  toastTitle: $<HTMLElement>('[data-toast-title]'),
  toastCopy: $<HTMLElement>('[data-toast-copy]'),
};

const state: AppState = {
  records: [],
  format: 'readable',
  processing: false,
  isDemo: false,
};

const FILE_LIMIT = 250;
const BYTE_LIMIT = 1024 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  const units = ['B', 'KB', 'MB', 'GB'];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** unitIndex);
  return `${new Intl.NumberFormat('en', {
    maximumFractionDigits: value >= 10 || unitIndex === 0 ? 0 : 1,
  }).format(value)} ${units[unitIndex]}`;
}

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function escapeHtml(value: string | number): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function todayStamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function setStage(stage: 'empty' | 'processing' | 'review'): void {
  elements.empty.hidden = stage !== 'empty';
  elements.processing.hidden = stage !== 'processing';
  elements.review.hidden = stage !== 'review';
  elements.appWindow.classList.toggle('is-reviewing', stage === 'review');
}

function setProgress(percent: number, title?: string, detail?: string): void {
  elements.progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  if (title) elements.processingTitle.textContent = title;
  if (detail) elements.processingDetail.textContent = detail;
}

let toastTimer: number | undefined;

function showToast(title: string, copy: string, tone: 'success' | 'error' = 'success'): void {
  elements.toastTitle.textContent = title;
  elements.toastCopy.textContent = copy;
  elements.toast.classList.toggle('toast-error', tone === 'error');
  $('.toast-icon', elements.toast).textContent = tone === 'error' ? '!' : '✓';
  elements.toast.hidden = false;
  requestAnimationFrame(() => elements.toast.classList.add('is-visible'));

  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(hideToast, 5200);
}

function hideToast(): void {
  elements.toast.classList.remove('is-visible');
  window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 240);
}

async function hashFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) break;
      output[index] = await mapper(item, index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return output;
}

function regenerateSuggestions(): void {
  const usedNames = new Set<string>();

  for (const record of state.records) {
    const clean = cleanFilename(record.originalName, state.format);
    record.suggestedName = makeUniqueName(clean, usedNames, state.format);
    record.manuallyEdited = false;
  }
}

function demoFiles(): File[] {
  const timestamp = Date.now();
  const strategyContent = 'Sendset demo — Q3 strategy presentation, revision 4.';

  return [
    new File([strategyContent], 'Q3_strategy_FINAL_final_v4 (2).pdf', {
      type: 'application/pdf',
      lastModified: timestamp - 4000,
    }),
    new File(['Sendset demo logo asset'], 'Copy of logo_NEW__.png', {
      type: 'image/png',
      lastModified: timestamp - 3000,
    }),
    new File(['Client notes\n- Launch on Monday\n- Use the approved logo'], 'notes-for-client copy.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      lastModified: timestamp - 2000,
    }),
    new File([strategyContent], 'Q3_strategy_FINAL_v4.pdf', {
      type: 'application/pdf',
      lastModified: timestamp - 1000,
    }),
  ];
}

async function processFiles(
  fileList: Iterable<File>,
  { demo = false }: { demo?: boolean } = {},
): Promise<void> {
  if (state.processing) return;

  const files = [...fileList].filter((file) => file instanceof File);
  if (!files.length) return;

  if (files.length > FILE_LIMIT) {
    showToast(`Choose up to ${FILE_LIMIT} files`, 'A smaller set keeps the browser fast and predictable.', 'error');
    return;
  }

  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (totalBytes > BYTE_LIMIT) {
    showToast('This set is over 1 GB', 'Split it into two handoffs and run them separately.', 'error');
    return;
  }

  state.processing = true;
  state.isDemo = demo;
  setStage('processing');
  setProgress(12, 'Reading filenames…', `${formatCount(files.length, 'file')} selected. Nothing is being uploaded.`);

  state.records = files.map((file, index) => ({
    id: `${Date.now()}-${index}`,
    file,
    originalName: file.name,
    suggestedName: cleanFilename(file.name, state.format),
    issues: detectIssues(file.name),
    included: true,
    duplicateOf: null,
    hash: null,
    manuallyEdited: false,
  }));
  regenerateSuggestions();

  await new Promise((resolve) => window.setTimeout(resolve, 180));
  setProgress(34, 'Checking exact copies…', 'Comparing file fingerprints locally.');

  let completed = 0;
  try {
    const hashes = await mapWithConcurrency(files, 3, async (file) => {
      const hash = await hashFile(file);
      completed += 1;
      const progress = 34 + Math.round((completed / files.length) * 48);
      setProgress(progress, 'Checking exact copies…', `${completed} of ${files.length} checked on this device.`);
      return hash;
    });

    const firstByFingerprint = new Map<string, FileRecord>();
    hashes.forEach((hash, index) => {
      const record = state.records[index];
      if (!record) return;
      record.hash = hash;
      const fingerprint = `${record.file.size}:${hash}`;
      const original = firstByFingerprint.get(fingerprint);

      if (original) {
        record.duplicateOf = original.id;
        record.included = false;
        record.issues.push({ code: 'duplicate', label: 'Exact duplicate' });
      } else {
        firstByFingerprint.set(fingerprint, record);
      }
    });
  } catch (error) {
    console.warn('Duplicate check could not finish:', error);
  }

  setProgress(94, 'Building your clean set…', 'Applying suggestions and keeping every change reviewable.');
  await new Promise((resolve) => window.setTimeout(resolve, 260));
  setProgress(100, 'Ready for review', 'Every suggestion can be edited.');
  await new Promise((resolve) => window.setTimeout(resolve, 160));

  state.processing = false;
  renderReview();
  setStage('review');
}

function fileType(name: string): { label: string; className: string } {
  const extension = splitFilename(name).extension.replace('.', '').toLocaleUpperCase();
  if (['JPG', 'JPEG', 'PNG', 'WEBP', 'GIF', 'SVG'].includes(extension)) return { label: extension.slice(0, 3), className: 'img' };
  if (extension === 'PDF') return { label: 'PDF', className: 'pdf' };
  if (['DOC', 'DOCX', 'ODT', 'RTF'].includes(extension)) return { label: 'DOC', className: 'doc' };
  if (['XLS', 'XLSX', 'CSV'].includes(extension)) return { label: 'XLS', className: 'sheet' };
  if (['ZIP', 'RAR', '7Z', 'TAR.GZ'].includes(extension)) return { label: 'ZIP', className: 'zip' };
  return { label: extension.slice(0, 3) || 'FILE', className: 'other' };
}

function unresolvedIssueCount(): number {
  return state.records.filter((record) => record.included).reduce((count, record) => {
    const opaque = record.issues.some((issue) => issue.code === 'opaque');
    const invalidName = !sanitizeManualFilename(record.suggestedName, '');
    return count + Number(opaque) + Number(invalidName);
  }, 0);
}

function duplicateNameCount(): number {
  const names = new Set<string>();
  let duplicates = 0;
  for (const record of state.records.filter((item) => item.included)) {
    const name = sanitizeManualFilename(record.suggestedName).toLocaleLowerCase();
    if (names.has(name)) duplicates += 1;
    else names.add(name);
  }
  return duplicates;
}

function calculateScore(): number {
  const unresolved = unresolvedIssueCount();
  const collisions = duplicateNameCount();
  return Math.max(42, 100 - (unresolved * 14) - (collisions * 18));
}

function updateSummary(): void {
  const included = state.records.filter((record) => record.included);
  const duplicates = state.records.filter((record) => record.duplicateOf && !record.included).length;
  const cleaned = included.filter((record) => record.originalName !== record.suggestedName).length;
  const bytes = included.reduce((sum, record) => sum + record.file.size, 0);
  const score = calculateScore();

  elements.readyCount.textContent = formatCount(included.length, 'file');
  elements.fixCount.textContent = String(cleaned);
  elements.duplicateCount.textContent = String(duplicates);
  elements.score.textContent = String(score);
  elements.scoreRing.style.setProperty('--score', String(score));
  elements.packageName.textContent = `sendset-${todayStamp()}.zip`;
  elements.packageMeta.textContent = `${formatCount(included.length, 'file')} · ${formatBytes(bytes)} · manifest included`;
  elements.download.disabled = included.length === 0;

  if (score === 100) {
    elements.scoreLabel.textContent = 'Ready with the fixes shown';
    elements.scoreDetail.textContent = duplicates
      ? `${formatCount(duplicates, 'exact copy', 'exact copies')} safely left out.`
      : 'No unresolved handoff issues found.';
  } else if (score >= 80) {
    elements.scoreLabel.textContent = 'One quick review';
    elements.scoreDetail.textContent = 'A filename may need a more descriptive title.';
  } else {
    elements.scoreLabel.textContent = 'Needs your eyes';
    elements.scoreDetail.textContent = 'Resolve vague or colliding names before download.';
  }
}

function rowMarkup(record: FileRecord): string {
  const type = fileType(record.originalName);
  const duplicate = Boolean(record.duplicateOf);
  const issueBadges = record.issues
    .slice(0, 2)
    .map((issue) => `<span class="issue-badge issue-${escapeHtml(issue.code)}">${escapeHtml(issue.label)}</span>`)
    .join('');

  return `
    <article class="file-row ${duplicate ? 'is-duplicate' : ''} ${record.included ? '' : 'is-excluded'}" data-record-id="${escapeHtml(record.id)}">
      <div class="include-cell">
        <button
          class="include-toggle"
          type="button"
          role="checkbox"
          aria-checked="${record.included}"
          aria-label="${record.included ? 'Exclude' : 'Include'} ${escapeHtml(record.originalName)}"
          data-include
        ><span>✓</span></button>
      </div>
      <div class="original-cell">
        <span class="file-type ${type.className}">${escapeHtml(type.label)}</span>
        <div class="file-info">
          <span class="truncate" title="${escapeHtml(record.originalName)}">${escapeHtml(record.originalName)}</span>
          <small>${formatBytes(record.file.size)} ${issueBadges}</small>
        </div>
      </div>
      <span class="row-arrow" aria-hidden="true">→</span>
      <div class="suggestion-cell">
        <input
          type="text"
          value="${escapeHtml(record.suggestedName)}"
          aria-label="New filename for ${escapeHtml(record.originalName)}"
          data-filename-input
          ${record.included ? '' : 'tabindex="-1"'}
        />
        <span class="edit-hint">${duplicate && !record.included ? 'Skipped — exact copy' : 'Click to edit'}</span>
      </div>
    </article>
  `;
}

function bindRowEvents(): void {
  $$<HTMLElement>('.file-row', elements.fileList).forEach((row) => {
    const record = state.records.find((item) => item.id === row.dataset.recordId);
    if (!record) return;
    const toggle = $<HTMLButtonElement>('[data-include]', row);
    const input = $<HTMLInputElement>('[data-filename-input]', row);

    toggle.addEventListener('click', () => {
      record.included = !record.included;
      renderReview();
    });

    input.addEventListener('input', () => {
      record.suggestedName = input.value;
      record.manuallyEdited = true;
      updateSummary();
    });

    input.addEventListener('blur', () => {
      record.suggestedName = sanitizeManualFilename(
        input.value,
        cleanFilename(record.originalName, state.format),
      );
      renderReview();
    });
  });
}

function renderReview(): void {
  elements.fileList.innerHTML = state.records.map(rowMarkup).join('');
  bindRowEvents();
  updateSummary();
}

function resetApp(): void {
  state.records = [];
  state.processing = false;
  state.isDemo = false;
  state.format = 'readable';
  elements.fileInput.value = '';
  $$<HTMLButtonElement>('[data-format]').forEach((button) => {
    const active = button.dataset.format === 'readable';
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  setStage('empty');
}

function buildManifest(records: ExportRecord[]): string {
  const skipped = state.records.filter((record) => !record.included);
  const lines = [
    'SENDSET HANDOFF MANIFEST',
    '========================',
    `Prepared: ${new Date().toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })}`,
    `Files included: ${records.length}`,
    `Exact copies skipped: ${skipped.filter((record) => record.duplicateOf).length}`,
    '',
    'ORIGINAL → DELIVERED',
    '--------------------',
    ...records.map((record) => `${record.originalName} → ${record.exportName}`),
  ];

  if (skipped.length) {
    lines.push('', 'LEFT OUT', '--------', ...skipped.map((record) => `${record.originalName}${record.duplicateOf ? ' (exact copy)' : ''}`));
  }

  lines.push('', 'Prepared locally with Sendset. File contents were never uploaded.');
  return `${lines.join('\n')}\n`;
}

async function downloadCleanSet(): Promise<void> {
  if (elements.download.disabled) return;

  const included = state.records.filter((record) => record.included);
  const usedNames = new Set<string>();
  const exportRecords: ExportRecord[] = included.map((record) => {
    const fallback = cleanFilename(record.originalName, state.format);
    const sanitized = sanitizeManualFilename(record.suggestedName, fallback);
    return {
      ...record,
      exportName: makeUniqueName(sanitized, usedNames, state.format),
    };
  });

  elements.download.disabled = true;
  elements.download.classList.add('is-working');
  elements.downloadLabel.textContent = 'Packing 0%…';

  try {
    const zip = new JSZip();
    exportRecords.forEach((record) => zip.file(record.exportName, record.file));
    zip.file('sendset-manifest.txt', buildManifest(exportRecords));

    const archive = await zip.generateAsync(
      {
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      },
      ({ percent }) => {
        elements.downloadLabel.textContent = `Packing ${Math.min(99, Math.round(percent))}%…`;
      },
    );

    const url = URL.createObjectURL(archive);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `sendset-${todayStamp()}.zip`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);

    elements.downloadLabel.textContent = 'Downloaded ✓';
    showToast(
      'Your clean set is ready',
      `${formatCount(exportRecords.length, 'file')} plus a handoff manifest — made on this device.`,
    );
    window.setTimeout(() => {
      elements.downloadLabel.textContent = 'Download clean set';
    }, 2400);
  } catch (error) {
    console.error('Could not build ZIP:', error);
    showToast('Couldn’t build that ZIP', 'Try a smaller set, or refresh and run it again.', 'error');
    elements.downloadLabel.textContent = 'Try download again';
  } finally {
    elements.download.classList.remove('is-working');
    elements.download.disabled = false;
  }
}

function loadDemo(): void {
  $<HTMLElement>('#tool').scrollIntoView({ behavior: 'smooth', block: 'center' });
  processFiles(demoFiles(), { demo: true });
}

function chooseFiles(): void {
  elements.fileInput.click();
}

elements.dropzone.addEventListener('click', (event) => {
  if (!(event.target instanceof Element) || !event.target.closest('button')) chooseFiles();
});
elements.dropzone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    chooseFiles();
  }
});
$<HTMLButtonElement>('[data-choose-files]').addEventListener('click', chooseFiles);
elements.fileInput.addEventListener('change', () => {
  if (elements.fileInput.files) processFiles(elements.fileInput.files);
});

['dragenter', 'dragover'].forEach((eventName) => {
  elements.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropzone.classList.add('is-dragging');
  });
});
['dragleave', 'drop'].forEach((eventName) => {
  elements.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropzone.classList.remove('is-dragging');
  });
});
elements.dropzone.addEventListener('drop', (event) => {
  if (event.dataTransfer?.files) processFiles(event.dataTransfer.files);
});

$$<HTMLButtonElement>('[data-demo-trigger]').forEach((button) => button.addEventListener('click', loadDemo));
$<HTMLButtonElement>('[data-reset]').addEventListener('click', resetApp);
elements.download.addEventListener('click', downloadCleanSet);
$<HTMLButtonElement>('[data-toast-close]').addEventListener('click', hideToast);

function isFilenameFormat(value: string | undefined): value is FilenameFormat {
  return value === 'readable' || value === 'web' || value === 'minimal';
}

$$<HTMLButtonElement>('[data-format]').forEach((button) => {
  button.addEventListener('click', () => {
    if (!isFilenameFormat(button.dataset.format)) return;
    state.format = button.dataset.format;
    $$<HTMLButtonElement>('[data-format]').forEach((formatButton) => {
      const active = formatButton === button;
      formatButton.classList.toggle('active', active);
      formatButton.setAttribute('aria-pressed', String(active));
    });
    regenerateSuggestions();
    renderReview();
  });
});

$$<HTMLButtonElement>('[data-scroll-tool]').forEach((button) => {
  button.addEventListener('click', () => {
    $<HTMLElement>('#tool').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
});

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12 },
);

$$<HTMLElement>('.reveal').forEach((element) => revealObserver.observe(element));

setStage('empty');

if (new URLSearchParams(window.location.search).get('demo') === '1') {
  window.setTimeout(loadDemo, 80);
}
