/**
 * 自介產生器的範本處理。範本本身不存在這裡：build 時從 mono members/README.md 的
 * 「自介參考範例」取出，依標題把欄位填進 `<…>` 佔位，其餘文字原樣保留。
 * 純函式，不送出任何資料；同時被 React island 與 Vitest 使用。
 */
import { classifyHeading } from '../../graph/parse/intro';

export interface IntroFields {
  name: string;
  github: string;
  about: string;
  contact: string;
  why: string;
  seek: string;
  share: string;
  canHelp: string;
  wantHelp: string;
}

export const emptyFields: IntroFields = {
  name: '',
  github: '',
  about: '',
  contact: '',
  why: '',
  seek: '',
  share: '',
  canHelp: '',
  wantHelp: '',
};

export type FieldHints = Partial<Record<keyof IntroFields, string>>;

/** 取出第一個 markdown fence 區塊，保留較短的內層 fence；未閉合回傳 null。 */
export function extractIntroTemplate(readme: string): string | null {
  const lines = readme.replace(/\r\n?/g, '\n').split('\n');
  for (let start = 0; start < lines.length; start++) {
    const opening = /^ {0,3}(`{3,}|~{3,})markdown[ \t]*$/i.exec(lines[start]);
    if (!opening) continue;
    const fence = opening[1];
    const closing = new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \t]*$`);
    for (let end = start + 1; end < lines.length; end++) {
      if (closing.test(lines[end])) return lines.slice(start + 1, end).join('\n');
    }
    return null;
  }
  return null;
}

export function cleanGithub(v: string): string {
  const t = v.trim().replace(/^@/, '');
  const m = /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9-]+)\/?$/i.exec(t);
  const raw = m ? m[1] : t;
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(raw) && !raw.includes('--')
    ? raw.toLowerCase()
    : '';
}

/** 未填的欄位留下範本的 `<…>` 提示，讓人一眼看出還缺什麼 */
const or = (v: string | undefined, hint: string) => (v?.trim() ? v.trim() : `<${hint}>`);

function fill(template: string, f?: IntroFields): { md: string; hints: FieldHints } {
  const hints: FieldHints = {};
  const out: string[] = [];
  let section: keyof IntroFields | undefined;
  for (const line of template.split('\n')) {
    const title = /^#\s+<(.+)>\s*$/.exec(line);
    if (title) {
      hints.name = title[1];
      out.push(`# ${or(f?.name, title[1])}`);
      continue;
    }
    const heading = /^#{2,6}\s+(.+)$/.exec(line);
    if (heading) {
      const k = classifyHeading(heading[1]);
      section = k && k !== 'rnr' ? k : undefined;
      out.push(line);
      continue;
    }
    // 「GitHub：<…>」「其他聯絡方式或作品連結：<…>」
    const meta = /^([^：:<]+)[：:]\s*<(.+)>\s*$/.exec(line);
    if (meta) {
      const key = /github/i.test(meta[1]) ? 'github' : 'contact';
      hints[key] = meta[2];
      const gh = cleanGithub(f?.github ?? '');
      const v = key === 'github' ? (gh ? `@${gh}` : '') : (f?.contact.trim() ?? '');
      if (v) out.push(`${meta[1]}：${v}`);
      else if (key === 'github') out.push(line); // 聯絡方式是選填，沒填就整行省略
      continue;
    }
    const ph = /^<(.+)>$/.exec(line.trim());
    if (ph && section) {
      hints[section] = ph[1];
      out.push(or(f?.[section], ph[1]));
      continue;
    }
    out.push(line);
  }
  return { md: out.join('\n'), hints };
}

export const buildMarkdown = (template: string, f: IntroFields): string =>
  `${fill(template, f).md}\n`;

/** 範本裡每個欄位的 `<…>` 提示文字，給表單當說明 */
export const templateHints = (template: string): FieldHints => fill(template).hints;

/** 申請檔使用 pending 前綴；正式編號由合併人配置。 */
export function introFilename(f: Pick<IntroFields, 'github' | 'name'>): string {
  const gh = cleanGithub(f.github).toLowerCase();
  return `pending-${gh || 'your-github'}.md`;
}

/** 必填：R&R 必須在提交前寫清楚（members/README） */
export function missingFields(f: IntroFields): (keyof IntroFields)[] {
  const req: (keyof IntroFields)[] = [
    'name',
    'github',
    'about',
    'why',
    'seek',
    'share',
    'canHelp',
    'wantHelp',
  ];
  return req.filter((k) =>
    k === 'github'
      ? !/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(cleanGithub(f.github))
      : !f[k].trim(),
  );
}
