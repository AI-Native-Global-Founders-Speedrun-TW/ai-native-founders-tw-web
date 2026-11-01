import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGraph } from '../src/graph/build-graph';
import { publicIntro, publicPerson } from '../src/graph/public';

const root = resolve(__dirname, '..');
const mono = process.env.MONO_PATH ?? join(root, '.cache', 'mono');
const quiet = { writeCache: false, githubToken: '', log: () => {} };

describe('buildGraph', () => {
  it('找不到 mono 時不丟例外，只警告；網站的 credits 仍在', async () => {
    const g = await buildGraph({
      ...quiet,
      webRoot: root,
      monoPath: mkdtempSync(join(tmpdir(), 'no-mono-')),
    });
    expect(g.sources.mono).toBeNull();
    expect(g.warnings.some((w) => w.includes('找不到 mono'))).toBe(true);
    expect(g.contributions.some((c) => c.target === 'website' && c.label === 'Owner')).toBe(true);
    expect(g.intros).toEqual([]);
  });

  it.skipIf(!existsSync(join(mono, 'specs')))('真實 mono：別名合併、文件署名、行動表', async () => {
    const g = await buildGraph({ ...quiet, webRoot: root, monoPath: mono });
    const byName = (n: string) => g.people.find((p) => p.name === n);

    // 「Ray（Ray貓）」「Ray」「Ray 貓」合併成同一人；網站貢獻依現行 credits。
    const ray = byName('Ray 貓');
    expect(ray).toBeDefined();
    expect(g.people.filter((p) => /^ray/i.test(p.name))).toHaveLength(1);
    const rayTargets = new Set(
      g.contributions.filter((c) => c.person === ray?.id).map((c) => c.target),
    );
    expect(rayTargets.has('website')).toBe(true);
    expect(ray?.roles?.some((r) => r.source === 'A5')).toBe(true);

    // Yapi → yayapipi、有平（Chris）→ 有平、kun → Kun
    expect(byName('Yapi')).toBeUndefined();
    expect(byName('yayapipi')).toBeDefined();
    expect(byName('Chris')).toBeUndefined();
    expect(byName('kun')).toBeUndefined();

    // 會議 credit 保留在會議；願景不再從已移除的彙整檔複製署名。
    const vision = g.documents.find((d) => d.path.endsWith('vision.md'));
    expect(vision).toBeDefined();
    expect(g.documents.some((d) => d.path.endsWith('資訊貢獻者.md'))).toBe(false);

    // 文案協作（品毅）來自 credits.yml，A13 來自行動表
    const pinyi = byName('品毅');
    expect(g.contributions.some((c) => c.person === pinyi?.id && c.kind === 'copy')).toBe(true);
    expect(pinyi?.roles?.some((r) => r.source === 'A13')).toBe(true);

    // 活動
    expect(g.events[0]?.url).toMatch(/^https:\/\/discord\.com\//);
    // 沒有自介時是空陣列，不是錯誤
    expect(Array.isArray(g.intros)).toBe(true);
    expect(g.people.filter((p) => p.hasIntro)).toHaveLength(g.intros.length);
  });
});

it('members 總表、assignment 與 pending 不是自介；正式編號保留在輸出', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'member-number-'));
  mkdirSync(join(dir, 'specs'));
  mkdirSync(join(dir, 'members'));
  const intro = '# 測試成員\n\n## 我是誰\nMember ID：000042\nGitHub：@numbered-test\n測試用自介';
  for (const file of [
    'members.md',
    'r-and-r-assignment.md',
    'pending-another.md',
    '000042-numbered-test.md',
  ]) {
    writeFileSync(join(dir, 'members', file), intro);
  }
  const g = await buildGraph({ ...quiet, webRoot: root, monoPath: dir });
  expect(g.intros).toHaveLength(1);
  expect(g.intros[0].file).toBe('members/000042-numbered-test.md');
  expect(g.intros[0].memberId).toBe('000042');
  expect(g.people.find((p) => p.github === 'numbered-test')?.memberId).toBe('000042');
});

it('相同稱呼的不同成員編號與帳號不合併，帳號更名仍保留永久編號', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'same-name-members-'));
  mkdirSync(join(dir, 'specs'));
  mkdirSync(join(dir, 'members'));
  const intro = (memberId: string, github: string) =>
    `# 相同稱呼\n\n## 我是誰\nMember ID：${memberId}\nGitHub：@${github}\n測試自介`;
  writeFileSync(join(dir, 'members', '000042-account-one.md'), intro('000042', 'account-one'));
  writeFileSync(join(dir, 'members', '000043-account-two.md'), intro('000043', 'account-two'));
  const g = await buildGraph({ ...quiet, webRoot: root, monoPath: dir });
  expect(g.intros).toHaveLength(2);
  expect(new Set(g.intros.map((i) => i.person)).size).toBe(2);
  expect(
    g.people
      .filter((p) => p.memberId)
      .map((p) => p.memberId)
      .sort(),
  ).toEqual(['000042', '000043']);
  writeFileSync(join(dir, 'members', '000042-account-one.md'), intro('000042', 'renamed-account'));
  const updated = await buildGraph({ ...quiet, webRoot: root, monoPath: dir });
  expect(updated.people.find((p) => p.github === 'renamed-account')?.memberId).toBe('000042');
  writeFileSync(join(dir, 'members', '000099-duplicate.md'), intro('000099', 'account-two'));
  const duplicate = await buildGraph({ ...quiet, webRoot: root, monoPath: dir });
  expect(duplicate.intros).toHaveLength(2);
  expect(duplicate.warnings.some((w) => w.includes('成員編號或 GitHub 帳號重複'))).toBe(true);
});

it('文件署名與網站別名合併，移除來源署名後不沿用舊的組織貢獻', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'source-credits-'));
  mkdirSync(join(dir, 'specs'));
  const document = join(dir, 'specs', 'knowledge.md');
  writeFileSync(document, '# 測試知識\n\n## 資訊貢獻者\n\n- Ray（Ray貓）\n');

  const credited = await buildGraph({ ...quiet, webRoot: root, monoPath: dir });
  const ray = credited.people.find((p) => p.name === 'Ray 貓');
  expect(ray).toBeDefined();
  expect(credited.people.filter((p) => /^ray/i.test(p.name))).toHaveLength(1);
  expect(credited.documents.find((d) => d.path === 'specs/knowledge.md')?.contributors).toEqual([
    ray?.id,
  ]);
  expect(credited.contributions.filter((c) => c.person === ray?.id && c.target === 'org')).toEqual([
    expect.objectContaining({ kind: 'info', source: 'specs/knowledge.md', label: '測試知識' }),
  ]);
  expect(credited.contributions.some((c) => c.person === ray?.id && c.target === 'website')).toBe(
    true,
  );

  writeFileSync(document, '# 測試知識\n\n依現行來源維護內容。\n');
  const updated = await buildGraph({ ...quiet, webRoot: root, monoPath: dir });
  expect(updated.documents.find((d) => d.path === 'specs/knowledge.md')?.contributors).toEqual([]);
  expect(updated.contributions.filter((c) => c.target === 'org')).toEqual([]);
  expect(updated.contributions.some((c) => c.person === ray?.id && c.target === 'website')).toBe(
    true,
  );
});

it('忠實保留來源的全零起始個案，不以讀取層改寫公開編號', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'source-zero-member-'));
  mkdirSync(join(dir, 'specs'));
  mkdirSync(join(dir, 'members'));
  writeFileSync(
    join(dir, 'members', '000000-test-founder.md'),
    '# 測試者\n\n## 我是誰\nMember ID：000000\nGitHub：@test-founder\n測試來源原值；不配置或裁定資格。',
  );
  const g = await buildGraph({ ...quiet, webRoot: root, monoPath: dir });
  const intro = g.intros.find((i) => i.memberId === '000000');
  const person = g.people.find((p) => p.memberId === '000000');
  expect(intro).toBeDefined();
  expect(person).toBeDefined();
  expect(publicIntro(person!, intro!).memberId).toBe('000000');
  expect(publicPerson(person!).memberId).toBe('000000');
});
