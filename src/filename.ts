export type FilenameFormat = 'readable' | 'web' | 'minimal';

export interface FilenameIssue {
  code: 'copy' | 'separators' | 'versions' | 'unsafe' | 'opaque';
  label: string;
}

const COPY_WORDS = new Set([
  'copy',
  'copies',
  'копія',
  'копии',
  'копия',
  'копії',
  'дублікат',
  'duplicate',
]);

const COMPOUND_EXTENSIONS = ['.tar.gz', '.tar.bz2', '.tar.xz'];

const TRANSLITERATION: Record<string, string> = {
  А: 'A', а: 'a', Б: 'B', б: 'b', В: 'V', в: 'v', Г: 'H', г: 'h', Ґ: 'G', ґ: 'g',
  Д: 'D', д: 'd', Е: 'E', е: 'e', Є: 'Ye', є: 'ie', Ж: 'Zh', ж: 'zh', З: 'Z', з: 'z',
  И: 'Y', и: 'y', І: 'I', і: 'i', Ї: 'Yi', ї: 'i', Й: 'Y', й: 'i', К: 'K', к: 'k',
  Л: 'L', л: 'l', М: 'M', м: 'm', Н: 'N', н: 'n', О: 'O', о: 'o', П: 'P', п: 'p',
  Р: 'R', р: 'r', С: 'S', с: 's', Т: 'T', т: 't', У: 'U', у: 'u', Ф: 'F', ф: 'f',
  Х: 'Kh', х: 'kh', Ц: 'Ts', ц: 'ts', Ч: 'Ch', ч: 'ch', Ш: 'Sh', ш: 'sh', Щ: 'Shch', щ: 'shch',
  Ь: '', ь: '', Ю: 'Yu', ю: 'iu', Я: 'Ya', я: 'ia',
  Ё: 'Yo', ё: 'yo', Ы: 'Y', ы: 'y', Э: 'E', э: 'e', Ъ: '', ъ: '',
};

export function splitFilename(filename: string): { stem: string; extension: string } {
  const safeName = String(filename || '').trim();
  const lower = safeName.toLocaleLowerCase();
  const compound = COMPOUND_EXTENSIONS.find((extension) => lower.endsWith(extension));

  if (compound && safeName.length > compound.length) {
    return {
      stem: safeName.slice(0, -compound.length),
      extension: safeName.slice(-compound.length),
    };
  }

  const dotIndex = safeName.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === safeName.length - 1) {
    return { stem: safeName, extension: '' };
  }

  return {
    stem: safeName.slice(0, dotIndex),
    extension: safeName.slice(dotIndex),
  };
}

export function transliterate(value: string): string {
  return [...String(value)].map((character) => TRANSLITERATION[character] ?? character).join('');
}

function removeCopyNoise(stem: string): string {
  return stem
    .replace(/^\s*(?:copy\s+of|копі(?:я|ї)\s+файлу|копия\s+файла)\s+/giu, '')
    .replace(/\s*\((?:copy|копі(?:я|ї)|копия|duplicate)\)\s*$/giu, '')
    .replace(/\s*\(\d+\)\s*$/gu, '')
    .replace(/\s+-\s+(?:copy|копі(?:я|ї)|копия|duplicate)(?:\s+\d+)?\s*$/giu, '');
}

function deduplicateTokens(tokens: string[]): string[] {
  const result: string[] = [];

  for (const token of tokens) {
    const normalized = token.toLocaleLowerCase();
    if (COPY_WORDS.has(normalized)) continue;

    const prior = result.at(-1)?.toLocaleLowerCase();
    if (prior === normalized) continue;

    result.push(token);
  }

  return result;
}

function smartTitleToken(token: string): string {
  if (!token) return token;
  if (/^v\d+(?:\.\d+)*$/i.test(token)) return token.toUpperCase();
  if (/^(?:q[1-4]|\d+k|\d+p)$/i.test(token)) return token.toUpperCase();
  if (/^(?:final|new|old|draft|copy)$/i.test(token)) {
    return token.charAt(0).toLocaleUpperCase() + token.slice(1).toLocaleLowerCase();
  }
  if (/^[A-Z]{2,4}\d*$/.test(token)) return token;
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;

  return token.charAt(0).toLocaleUpperCase() + token.slice(1).toLocaleLowerCase();
}

function cleanExtension(extension: string): string {
  return extension ? extension.toLocaleLowerCase() : '';
}

function cleanMinimal(stem: string): string {
  return removeCopyNoise(stem)
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/gu, ' ')
    .replace(/\s{2,}/gu, ' ')
    .replace(/_{3,}/gu, '__')
    .trim()
    .replace(/[.\s]+$/gu, '');
}

function cleanReadable(stem: string): string {
  const normalized = removeCopyNoise(stem)
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/gu, ' ')
    .replace(/[_.·•]+/gu, ' ')
    .replace(/[–—-]+/gu, ' ')
    .replace(/[()[\]{}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

  const tokens = deduplicateTokens(normalized.split(' ').filter(Boolean));
  return tokens.map(smartTitleToken).join(' ');
}

function cleanWebSafe(stem: string): string {
  const readable = transliterate(cleanReadable(stem))
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .replace(/-{2,}/gu, '-');

  return readable;
}

function fallbackStem(extension: string, format: FilenameFormat): string {
  const type = extension.replace(/^\./u, '').toLocaleLowerCase();
  const label = type === 'jpg' || type === 'jpeg' || type === 'png' || type === 'webp'
    ? 'image'
    : type === 'pdf' || type === 'doc' || type === 'docx' || type === 'txt'
      ? 'document'
      : 'file';

  return format === 'readable' ? smartTitleToken(label) : label;
}

export function cleanFilename(filename: string, format: FilenameFormat = 'readable'): string {
  const { stem, extension } = splitFilename(filename);
  let cleanedStem;

  if (format === 'web') cleanedStem = cleanWebSafe(stem);
  else if (format === 'minimal') cleanedStem = cleanMinimal(stem);
  else cleanedStem = cleanReadable(stem);

  cleanedStem = cleanedStem || fallbackStem(extension, format);
  return `${cleanedStem}${cleanExtension(extension)}`;
}

export function detectIssues(filename: string): FilenameIssue[] {
  const { stem } = splitFilename(filename);
  const issues: FilenameIssue[] = [];
  const normalized = stem.normalize('NFC');

  if (
    /\(\d+\)\s*$/u.test(normalized)
    || /(?:^|[\s_-])(?:copy|copies|копі(?:я|ї)|копия|duplicate)(?:[\s_-]|$)/iu.test(normalized)
  ) {
    issues.push({ code: 'copy', label: 'Copy marker' });
  }

  if (/_{2,}|-{2,}|\s{2,}/u.test(normalized)) {
    issues.push({ code: 'separators', label: 'Messy separators' });
  }

  const versionWords = normalized.match(/(?:^|[\s_.-])(final|draft|new|old|фінал|финал)(?=[\s_.-]|$)/giu) || [];
  if (versionWords.length > 1 || /(?:final.*draft|draft.*final)/iu.test(normalized)) {
    issues.push({ code: 'versions', label: 'Version clutter' });
  }

  if (/[<>:"/\\|?*\u0000-\u001F]/u.test(normalized)) {
    issues.push({ code: 'unsafe', label: 'Unsafe characters' });
  }

  const compact = normalized.replace(/[^\p{L}\p{N}]/gu, '');
  if (
    /^[0-9a-f]{10,}$/iu.test(compact)
    || /^[0-9a-f]{8}(?:[0-9a-f]{4}){3}[0-9a-f]{12}$/iu.test(compact)
    || /^\d{6,}$/u.test(compact)
  ) {
    issues.push({ code: 'opaque', label: 'Needs context' });
  }

  return issues;
}

export function makeUniqueName(
  filename: string,
  usedNames: Set<string>,
  format: FilenameFormat = 'readable',
): string {
  const { stem, extension } = splitFilename(filename);
  let candidate = filename;
  let index = 2;
  const separator = format === 'web' ? '-' : ' ';

  while (usedNames.has(candidate.toLocaleLowerCase())) {
    candidate = `${stem}${separator}${index}${extension}`;
    index += 1;
  }

  usedNames.add(candidate.toLocaleLowerCase());
  return candidate;
}

export function sanitizeManualFilename(filename: string, fallback = 'file'): string {
  const value = String(filename || '')
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/[.\s]+$/gu, '');

  return value || fallback;
}
