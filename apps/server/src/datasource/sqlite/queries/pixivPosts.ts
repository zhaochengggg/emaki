/**
 * 这些 Pixiv 作品在图库里各有几张（images.pixivPosts）：Pixiv 浏览插件标「已下载」「下了 2/5 张」用，
 * 不管是它下的还是别的工具下的——认的是图片的来源（文件名、Pixiv 证据给的作品号）。
 * - 张数按不同的文件内容（sha256）数：同一页的完全重复只算一张；作品里本来就有几页一模一样（重复的空白页、封面）时，
 *   按 Pixiv 原图名（<投稿号>_p<页>）里有几个不同的页码算（parseSource.ts 的 pixivPageOf）。
 *   回收站里的、文件不在了的、在停用的图库文件夹里的不算（LIVE_IMAGES），排除了的算（文件还在）；
 * - pages 是 Emaki 查 Pixiv 标签时缓存的页数（pixiv_artwork_cache），没缓存过的是 null。
 * 走 idx_images_post，500 个作品号不到 1 毫秒（2026-11-26 在 2.3 万张 Pixiv 图的真实库上量的）
 */
import type { Db } from '../../../db/connection.ts';
import { LIVE_IMAGES } from '../../../readmodel/terms.ts';
import { pixivPageOf } from '../../../services/source/parseSource.ts';

export interface PixivPost {
  /** 图库里有几张（不同内容的） */
  images: number;
  /** 其中几张是动图 */
  animated: number;
  /** 这个作品一共几页（不知道是 null） */
  pages: number | null;
}

export function pixivPosts(db: Db, ids: readonly string[]): Record<string, PixivPost> {
  const out: Record<string, PixivPost> = {};
  const unique = [...new Set(ids)];
  if (!unique.length) return out;
  const marks = unique.map(() => '?').join(',');
  const files = db
    .prepare(
      `SELECT i.source_post_id AS id, i.sha256, i.file_name, i.animated
       FROM images i
       WHERE i.source_site = 'pixiv' AND i.source_post_id IN (${marks}) AND ${LIVE_IMAGES}`,
    )
    .all(...unique) as { id: string; sha256: string; file_name: string; animated: number }[];
  // 每个作品：内容 → 原图名里的页码（认不出的不放）
  const byPost = new Map<string, { contents: Map<string, Set<number>>; animated: Set<string> }>();
  for (const f of files) {
    let post = byPost.get(f.id);
    if (!post) byPost.set(f.id, (post = { contents: new Map(), animated: new Set() }));
    let pages = post.contents.get(f.sha256);
    if (!pages) post.contents.set(f.sha256, (pages = new Set()));
    const page = pixivPageOf(f.file_name);
    if (page?.postId === f.id) pages.add(page.page);
    if (f.animated === 1) post.animated.add(f.sha256);
  }
  const rows = [...byPost].map(([id, p]) => ({
    id,
    images: [...p.contents.values()].reduce((n, pages) => n + Math.max(1, pages.size), 0),
    animated: p.animated.size,
  }));
  if (!rows.length) return out;
  const pages = new Map(
    (
      db
        .prepare(`SELECT post_id AS id, json_extract(artwork, '$.pageCount') AS pages FROM pixiv_artwork_cache WHERE post_id IN (${rows.map(() => '?').join(',')})`)
        .all(...rows.map((r) => r.id)) as { id: string; pages: unknown }[]
    ).map((r) => [r.id, typeof r.pages === 'number' && r.pages > 0 ? r.pages : null]),
  );
  for (const r of rows) out[r.id] = { images: r.images, animated: r.animated, pages: pages.get(r.id) ?? null };
  return out;
}
