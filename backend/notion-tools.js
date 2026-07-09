/**
 * Notion entegrasyonu — internal integration token (XJarvis).
 * Araçlar: notion_search, notion_read, notion_create_note.
 * Env: NOTION_API_KEY, NOTION_NOTES_PARENT (notların yazılacağı ana sayfa id).
 */
const V = '2022-06-28';
const BASE = 'https://api.notion.com/v1';

function key() { return process.env.NOTION_API_KEY || ''; }
function notesParent() { return process.env.NOTION_NOTES_PARENT || ''; }

async function napi(path, method = 'GET', body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${key()}`, 'Notion-Version': V, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}

function titleOf(r) {
  if (!r) return '(?)';
  if (r.object === 'database') return r.title?.[0]?.plain_text || '(başlıksız db)';
  const props = r.properties || {};
  const tp = Object.values(props).find((p) => p.type === 'title');
  return tp?.title?.[0]?.plain_text || '(başlıksız)';
}

function rich(arr) { return (arr || []).map((t) => t.plain_text || t.text?.content || '').join(''); }

function blocksToText(blocks) {
  const out = [];
  for (const b of blocks) {
    const t = b.type;
    const data = b[t];
    if (!data) continue;
    const txt = rich(data.rich_text);
    if (t === 'heading_1') out.push('# ' + txt);
    else if (t === 'heading_2') out.push('## ' + txt);
    else if (t === 'heading_3') out.push('### ' + txt);
    else if (t === 'bulleted_list_item' || t === 'numbered_list_item') out.push('• ' + txt);
    else if (t === 'to_do') out.push((data.checked ? '[x] ' : '[ ] ') + txt);
    else if (t === 'quote') out.push('> ' + txt);
    else if (t === 'callout') out.push('💡 ' + txt);
    else if (txt) out.push(txt);
  }
  return out.join('\n');
}

const TOOLS = [
  { name: 'notion_search', description: 'Notion çalışma alanında (bota paylaşılmış) sayfa/veritabanı ara. Kullanıcı "Notion\'da X notumu bul/var mı" dediğinde kullan.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'notion_read', description: 'Bir Notion sayfasının içeriğini (metnini) oku. page_id, notion_search sonucundan gelir.',
    input_schema: { type: 'object', properties: { page_id: { type: 'string' } }, required: ['page_id'] } },
  { name: 'notion_create_note', description: 'Notion\'a yeni not oluştur (XJarvis Notları altına). Kullanıcı "şunu Notion\'a not al/kaydet" dediğinde kullan.',
    input_schema: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' } }, required: ['title', 'content'] } },
];

const TOOL_IMPL = {
  notion_search: async ({ query }) => {
    const j = await napi('/search', 'POST', { query, page_size: 8 });
    if (j.object === 'error') return 'Notion hata: ' + j.message;
    if (!j.results?.length) return 'eşleşen sayfa yok';
    return j.results.map((r) => `${r.object === 'database' ? '🗂️' : '📄'} ${titleOf(r)} — id:${r.id}`).join('\n');
  },
  notion_read: async ({ page_id }) => {
    const j = await napi(`/blocks/${page_id}/children?page_size=80`);
    if (j.object === 'error') return 'Notion hata: ' + j.message;
    const txt = blocksToText(j.results || []);
    return txt || '(sayfa boş veya sadece alt-sayfa içeriyor)';
  },
  notion_create_note: async ({ title, content }) => {
    const parent = notesParent();
    if (!parent) return 'NOTION_NOTES_PARENT ayarlı değil';
    const j = await napi('/pages', 'POST', {
      parent: { page_id: parent },
      properties: { title: [{ text: { content: String(title).slice(0, 200) } }] },
      children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content: String(content).slice(0, 1900) } }] } }],
    });
    if (j.object === 'error') return 'Notion hata: ' + j.message;
    return 'Not Notion\'a kaydedildi: ' + (j.url || 'tamam');
  },
};

module.exports = { TOOLS, TOOL_IMPL };
