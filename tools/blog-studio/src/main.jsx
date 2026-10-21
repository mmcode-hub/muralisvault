import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import './style.css';
import './ux.css';

const sections = [
  ['profession', 'Profession'], ['travel', 'Travel'], ['my-thoughts', 'My Thoughts'],
  ['temple-architecture/temple-stories', 'Temple stories'],
  ['temple-architecture/places', 'Temple places'],
  ['temple-architecture/architectural-elements', 'Architectural elements'],
];
const emptyPost = () => ({ title: '', summary: '', section: 'profession', slug: '', date: new Date().toISOString().slice(0, 10), draft: true, image: '', imageAlt: '', imageCaption: '', body: '' });
const slugify = (value) => value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
const api = async (url, options = {}) => { const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Request failed'); return result; };
const readFile = (file) => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
const writingStats = (body) => {
  const plain = body.replace(/{{[<%][\s\S]*?[%>]}}/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[[^\]]*\]\([^)]*\)/g, ' ').replace(/[#*_`>~-]/g, ' ');
  const words = plain.trim().match(/\S+/g)?.length || 0;
  return { words, minutes: Math.max(1, Math.ceil(words / 220)) };
};

function StudioDialog({ config, onClose }) {
  const element = useRef(null);
  const [value, setValue] = useState(config.initial || '');
  useEffect(() => {
    element.current?.showModal();
    return () => { if (element.current?.open) element.current.close(); };
  }, []);
  const submit = (event) => { event.preventDefault(); onClose(config.kind === 'confirm' ? true : value.trim()); };
  const canSubmit = config.kind === 'confirm' || (config.expected ? value.trim() === config.expected : Boolean(value.trim()));
  return <dialog ref={element} className="studio-dialog" aria-labelledby="studio-dialog-title" aria-describedby="studio-dialog-description" onCancel={(event) => { event.preventDefault(); onClose(null); }}>
    <form onSubmit={submit}>
      <span className={`dialog-symbol ${config.danger ? 'danger' : ''}`}>{config.danger ? '!' : '＋'}</span>
      <h2 id="studio-dialog-title">{config.title}</h2>
      <p id="studio-dialog-description">{config.description}</p>
      {config.kind !== 'confirm' && <label>{config.label}<input autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder={config.placeholder || ''} autoComplete="off" spellCheck={config.expected ? false : undefined} /></label>}
      <div className="dialog-actions"><button type="button" onClick={() => onClose(null)}>Cancel</button><button className={config.danger ? 'dialog-danger' : 'dialog-primary'} type="submit" disabled={!canSubmit}>{config.confirmLabel || 'Add'}</button></div>
    </form>
  </dialog>;
}

function Studio() {
  const editor = useCreateBlockNote();
  const [posts, setPosts] = useState([]);
  const [deletedPosts, setDeletedPosts] = useState([]);
  const [post, setPost] = useState(emptyPost);
  const [cover, setCover] = useState(null);
  const [inlineFiles, setInlineFiles] = useState([]);
  const [status, setStatus] = useState(null);
  const [activeTab, setActiveTab] = useState('write');
  const [sourceMode, setSourceMode] = useState(false);
  const [sourceText, setSourceText] = useState('');
  const [editorMarkdown, setEditorMarkdown] = useState('');
  const [focusMode, setFocusMode] = useState(false);
  const [coverPreview, setCoverPreview] = useState('');
  const [dirty, setDirty] = useState(false);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState({ text: 'Start a new entry or select one from the library.', type: 'hint' });
  const [query, setQuery] = useState('');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [log, setLog] = useState('');
  const [dialog, setDialog] = useState(null);
  const dialogResolver = useRef(null);
  const loadingEditor = useRef(false);
  const slugEdited = useRef(false);
  const previousAuthOutput = useRef('');

  const ask = (config) => new Promise((resolve) => {
    if (dialogResolver.current) return resolve(null);
    dialogResolver.current = resolve;
    setDialog({ ...config, id: crypto.randomUUID() });
  });
  const closeDialog = (answer) => {
    dialogResolver.current?.(answer);
    dialogResolver.current = null;
    setDialog(null);
  };

  useEffect(() => {
    if (!cover) { setCoverPreview(''); return; }
    const url = URL.createObjectURL(cover);
    setCoverPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [cover]);

  const notify = (text, type = 'info') => setMessage({ text, type });
  const fail = (error) => notify(error.message || String(error), 'error');
  const refreshPosts = async () => setPosts((await api('/api/posts')).posts);
  const refreshDeleted = async () => setDeletedPosts((await api('/api/deleted')).posts);
  const refreshStatus = async () => {
    const next = await api('/api/status'); setStatus(next);
    if (next.github?.output && next.github.output !== previousAuthOutput.current) {
      previousAuthOutput.current = next.github.output; setLog(next.github.output); setLogOpen(true);
    }
  };

  useEffect(() => {
    refreshPosts().catch(fail); refreshDeleted().catch(fail); refreshStatus().catch(fail);
    const timer = setInterval(() => refreshStatus().catch(() => {}), 8000);
    const beforeUnload = (event) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { clearInterval(timer); window.removeEventListener('beforeunload', beforeUnload); };
  }, [dirty]);

  const confirmLeave = async () => !dirty || await ask({ kind: 'confirm', title: 'Discard unsaved changes?', description: 'Your changes to this entry have not been saved locally.', confirmLabel: 'Discard changes', danger: true });
  const markDirty = () => { setDirty(true); setVerified(false); };
  const setField = (key, value) => { setPost((current) => ({ ...current, [key]: value })); markDirty(); };
  const setTitle = (value) => { setPost((current) => ({ ...current, title: value, slug: !current.path && !slugEdited.current ? slugify(value) : current.slug })); markDirty(); };
  const installBody = async (body) => {
    loadingEditor.current = true;
    const hasShortcodes = /{{[<%]/.test(body || '');
    setSourceMode(hasShortcodes);
    setSourceText(body || '');
    setEditorMarkdown(body || '');
    if (!hasShortcodes) {
      const blocks = await editor.tryParseMarkdownToBlocks(body || '');
      editor.replaceBlocks(editor.document, blocks.length ? blocks : [{ type: 'paragraph', content: '' }]);
    }
    queueMicrotask(() => { loadingEditor.current = false; });
  };
  const selectPost = async (path) => {
    if (!await confirmLeave()) return;
    try {
      const selected = (await api(`/api/posts?path=${encodeURIComponent(path)}`)).posts[0];
      await installBody(selected.body);
      setPost(selected); setCover(null); setInlineFiles([]); setDirty(false); setVerified(false); setActiveTab('write'); setLibraryOpen(false);
      slugEdited.current = true; notify(`Opened ${selected.title}.`, 'hint');
    } catch (error) { fail(error); }
  };
  const newPost = async () => {
    if (!await confirmLeave()) return;
    await installBody(''); setPost(emptyPost()); setCover(null); setInlineFiles([]); setDirty(false); setVerified(false); setActiveTab('write'); setLibraryOpen(false);
    slugEdited.current = false; notify('A new entry is ready. Give it a title and start writing.', 'hint');
  };
  const selectDeleted = async (item) => {
    if (!await confirmLeave()) return;
    setPost(item); setCover(null); setInlineFiles([]); setDirty(false); setVerified(false); setActiveTab('write'); setLibraryOpen(false);
    notify(`${item.title} is in local trash. You can restore it${item.tracked ? ' or create a removal pull request' : ''}.`, 'hint');
  };
  const switchToSource = async () => {
    if (!sourceMode) { const markdown = editor.blocksToMarkdownLossy(editor.document); setEditorMarkdown(markdown); setSourceText(markdown); setSourceMode(true); }
    setActiveTab('source');
  };
  const switchToWrite = async () => {
    if (sourceMode) {
      if (/{{[<%]/.test(sourceText)) { notify('This post contains Hugo embeds. Edit its Markdown in Source to preserve them.', 'hint'); setActiveTab('source'); return; }
      loadingEditor.current = true;
      const blocks = await editor.tryParseMarkdownToBlocks(sourceText);
      editor.replaceBlocks(editor.document, blocks.length ? blocks : [{ type: 'paragraph', content: '' }]);
      setEditorMarkdown(sourceText);
      queueMicrotask(() => { loadingEditor.current = false; });
      setSourceMode(false);
    }
    setActiveTab('write');
  };
  const formatBlock = (type, props) => {
    editor.updateBlock(editor.getTextCursorPosition().block, { type, ...(props ? { props } : {}) });
    markDirty(); editor.focus();
  };
  const toggleStyle = (style) => { editor.toggleStyles({ [style]: true }); markDirty(); editor.focus(); };
  const addLink = async () => {
    const raw = await ask({ kind: 'text', title: 'Add a link', description: 'The selected text will link to this address.', label: 'Web or email address', placeholder: 'https://example.com', confirmLabel: 'Add link' });
    if (!raw) return;
    let url;
    try { url = new URL(raw); } catch { return notify('Enter a valid link.', 'error'); }
    if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) return notify('Use an HTTP, HTTPS, or email link.', 'error');
    editor.createLink(url.href); markDirty(); editor.focus();
  };
  const insertEmbed = async (kind) => {
    const currentBody = sourceMode ? sourceText : editor.blocksToMarkdownLossy(editor.document);
    if (kind === 'youtube') {
      const raw = await ask({ kind: 'text', title: 'Add a YouTube video', description: 'Paste the video link. The Studio will insert a Hugo embed in Markdown.', label: 'YouTube link', placeholder: 'https://www.youtube.com/watch?v=…', confirmLabel: 'Add video' }); if (!raw) return;
      let id = '';
      try { const url = new URL(raw); id = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v') || url.pathname.split('/').filter(Boolean).at(-1); } catch { /* handled below */ }
      if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return notify('Enter a valid YouTube video link.', 'error');
      setSourceText(`${currentBody.trim()}\n\n{{< youtubeLite id="${id}" >}}\n`);
    } else {
      const raw = await ask({ kind: 'text', title: 'Add a video file', description: 'Use a direct HTTPS link to a video file.', label: 'Video file URL', placeholder: 'https://example.com/video.mp4', confirmLabel: 'Add video' }); if (!raw) return;
      try { if (new URL(raw).protocol !== 'https:') throw new Error(); } catch { return notify('Enter a direct HTTPS video link.', 'error'); }
      setSourceText(`${currentBody.trim()}\n\n{{< video src="${raw.replaceAll('"', '%22')}" >}}\n`);
    }
    setSourceMode(true); setActiveTab('source'); markDirty();
    notify('Media embed inserted in Markdown. Save to see it on the Hugo preview.', 'info');
  };
  const addInlineImage = async (file) => {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return notify('Choose a JPEG, PNG, or WebP image.', 'error');
    const alt = await ask({ kind: 'text', title: 'Describe this image', description: `Add a short description of ${file.name} for readers using a screen reader.`, label: 'Image description', placeholder: 'What does the image show?', confirmLabel: 'Add image' });
    if (!alt?.trim()) return notify('An image description is required.', 'error');
    setInlineFiles((current) => [...current, { file, alt: alt.trim() }]);
    const current = sourceMode ? sourceText : editor.blocksToMarkdownLossy(editor.document);
    setSourceText(`${current.trim()}\n\n{{< figure src="${file.name}" alt="${alt.trim().replaceAll('"', '\\"')}" >}}\n`);
    setSourceMode(true); setActiveTab('source'); markDirty();
    notify('Image added to the page bundle. Save to see it in the Hugo preview.', 'info');
  };
  const save = async () => {
    if (post.deleted) { notify('Restore this entry before editing it.', 'error'); return null; }
    if (!post.title.trim() || !post.summary.trim() || !post.slug.trim()) { notify('Add a title, summary, and slug before saving.', 'error'); return null; }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(post.slug)) { notify('The slug can contain lowercase letters, numbers, and hyphens.', 'error'); return null; }
    if (cover && !post.imageAlt.trim()) { notify('Add alternative text for the cover image.', 'error'); return null; }
    try {
      setBusy('Saving');
      const assets = [];
      if (cover) assets.push({ name: cover.name, content: await readFile(cover) });
      for (const entry of inlineFiles) assets.push({ name: entry.file.name, content: await readFile(entry.file) });
      const body = sourceMode ? sourceText : editor.blocksToMarkdownLossy(editor.document);
      const saved = await api('/api/posts', { method: 'POST', body: JSON.stringify({ ...post, body, image: cover?.name || post.image, assets, existingPath: post.path }) });
      setPost((current) => ({ ...current, ...saved, body, image: cover?.name || current.image }));
      setCover(null); setInlineFiles([]); setDirty(false); setVerified(false);
      await refreshPosts(); notify('Saved locally. Open Preview to inspect the page, then verify the production build.', 'success');
      return { ...post, ...saved };
    } catch (error) { fail(error); return null; } finally { setBusy(''); }
  };
  const openPreview = async () => {
    if (post.deleted || busy) return;
    const tab = window.open('', '_blank');
    if (!tab) return notify('Allow the Studio to open a preview tab in your browser.', 'error');
    tab.document.title = 'Preparing preview…';
    tab.document.body.style.cssText = 'display:grid;place-items:center;min-height:100vh;margin:0;background:#f5f7f8;color:#20384d;font:16px system-ui,sans-serif';
    tab.document.body.textContent = 'Preparing your page preview…';
    try {
      const current = dirty || !post.path ? await save() : post;
      if (!current) { tab.close(); return; }
      const result = await api(`/api/preview?section=${encodeURIComponent(current.section)}&slug=${encodeURIComponent(current.slug)}`);
      tab.location.replace(result.url);
    } catch (error) { tab.close(); fail(error); }
  };
  const deleteEntry = async () => {
    if (!post.path || post.deleted || busy) return;
    const answer = await ask({ kind: 'text', title: 'Move entry to local trash?', description: `“${post.title}” and its images will move to local trash. You can restore them later.${dirty ? ' Unsaved editor changes will be discarded.' : ''}`, label: `Type ${post.slug} to confirm`, placeholder: post.slug, expected: post.slug, confirmLabel: 'Move to trash', danger: true });
    if (answer !== post.slug) return;
    try {
      setBusy('Deleting');
      const deleted = await api('/api/posts', { method: 'DELETE', body: JSON.stringify({ path: post.path }) });
      setPost(deleted); setCover(null); setInlineFiles([]); setDirty(false); setVerified(false); setActiveTab('write');
      await Promise.all([refreshPosts(), refreshDeleted()]);
      notify(deleted.tracked ? 'Entry moved to local trash. Verify the site, then create a removal PR.' : 'Entry moved to local trash. You can restore it from the sidebar.', 'success');
    } catch (error) { fail(error); } finally { setBusy(''); }
  };
  const restoreEntry = async () => {
    if (!post.deleted || busy) return;
    try {
      setBusy('Restoring');
      const restored = await api('/api/posts/restore', { method: 'POST', body: JSON.stringify({ trashId: post.trashId }) });
      await installBody(restored.body);
      setPost(restored); setDirty(false); setVerified(false); setActiveTab('write');
      await Promise.all([refreshPosts(), refreshDeleted()]); notify('Entry restored.', 'success');
    } catch (error) { fail(error); } finally { setBusy(''); }
  };
  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!busy && !post.deleted && !dialogResolver.current) save(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });
  const validate = async () => {
    if (dirty) return notify('Save your changes before verification.', 'error');
    try { setBusy('Verifying'); const result = await api('/api/validate', { method: 'POST', body: '{}' }); setVerified(true); setLog(result.output); notify('Production checks passed. This entry is ready for a pull request.', 'success'); }
    catch (error) { setVerified(false); setLog(error.message); setLogOpen(true); fail(error); } finally { setBusy(''); }
  };
  const publish = async () => {
    if (!verified || dirty) return notify('Save and verify the latest changes first.', 'error');
    try { setBusy('Creating PR'); const result = await api('/api/publish', { method: 'POST', body: JSON.stringify(post) }); setPost((current) => ({ ...current, pr: result.pr })); notify(`Pull request #${result.pr.number} created. GitHub Actions will check it before merge.`, 'success'); }
    catch (error) { fail(error); } finally { setBusy(''); }
  };
  const merge = async () => {
    try { setBusy('Merging'); const result = await api('/api/merge', { method: 'POST', body: JSON.stringify({ ...post.pr, trashId: post.deleted ? post.trashId : undefined }) }); setPost((current) => current.deleted ? emptyPost() : { ...current, pr: null }); setVerified(false); notify(result.output, 'success'); await Promise.all([refreshPosts(), refreshDeleted()]); }
    catch (error) { fail(error); } finally { setBusy(''); }
  };
  const login = async () => { try { await api('/api/github/login', { method: 'POST', body: '{}' }); setLogOpen(true); notify('Follow the GitHub device instructions below to finish connecting.', 'info'); await refreshStatus(); } catch (error) { fail(error); } };
  const visiblePosts = posts.filter((item) => `${item.title} ${item.section}`.toLowerCase().includes(query.toLowerCase()));
  const hasSaved = Boolean(post.path); const canVerify = hasSaved && !dirty && !busy && (!post.deleted || post.tracked);
  const canPublish = canVerify && verified && !post.pr && status?.github?.authenticated;
  const stats = writingStats(sourceMode ? sourceText : editorMarkdown);

  return <div className={`studio-shell ${focusMode ? 'focus-mode' : ''}`}>
    <aside className={`sidebar ${libraryOpen ? 'library-open' : ''}`} aria-label="Post library">
      <div className="brand"><span className="brand-mark">M</span><div><strong>Murali’s Vault</strong><small>Writing studio</small></div></div>
      <button className="new-post" onClick={newPost}><span>＋</span> New entry</button>
      <button className="mobile-library-toggle" aria-expanded={libraryOpen} onClick={() => setLibraryOpen((open) => !open)}>Entries ({posts.length}) {libraryOpen ? '⌃' : '⌄'}</button>
      <div className="library-heading"><span>Your entries <b>{posts.length}</b></span><button title="Refresh entries" aria-label="Refresh entries" onClick={() => Promise.all([refreshPosts(), refreshDeleted()]).catch(fail)}>↻</button></div>
      <input className="library-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search entries…" aria-label="Search entries" />
      <nav className="library">{visiblePosts.length ? visiblePosts.map((item) => <button key={item.path} className={`library-item ${item.path === post.path ? 'selected' : ''}`} onClick={() => selectPost(item.path)}><strong>{item.title}</strong><span>{sections.find(([value]) => value === item.section)?.[1] || item.section} · {item.draft ? 'Draft' : 'Published'}</span></button>) : <p className="library-empty">{query ? 'No matching entries' : 'No entries yet'}</p>}</nav>
      {deletedPosts.length > 0 && <div className="deleted-library"><div className="library-heading">Local trash <b>{deletedPosts.length}</b></div>{deletedPosts.map((item) => <button key={item.trashId} className={`library-item deleted-item ${item.trashId === post.trashId ? 'selected' : ''}`} onClick={() => selectDeleted(item)}><strong>{item.title}</strong><span>{item.tracked ? 'Pending removal PR' : 'Local entry'} · Restore available</span></button>)}</div>}
      <div className="sidebar-footer"><div className="connection"><span className={`dot ${status?.github?.authenticated ? 'connected' : ''}`} /><span>{status?.github?.authenticated ? status.github.account : status?.github?.running ? 'Connecting…' : 'GitHub disconnected'}</span></div><button className="connect" onClick={login} disabled={status?.github?.running}>{status?.github?.authenticated ? 'Reconnect GitHub' : 'Connect GitHub'} →</button></div>
    </aside>
    <main className="workspace">
      <header className="topbar"><div className="topbar-title">Blog Studio <span>/</span> {hasSaved ? post.title : 'New entry'}</div><div className="topbar-tools"><button className="focus-toggle" onClick={() => setFocusMode((value) => !value)} aria-pressed={focusMode}>{focusMode ? 'Exit focus' : 'Focus mode'}</button><div className="topbar-status"><span className={`save-dot ${dirty ? 'unsaved' : !hasSaved ? 'empty' : ''}`} />{post.deleted ? 'In local trash' : dirty ? 'Unsaved changes' : hasSaved ? 'Saved locally' : 'Not saved yet'}</div></div></header>
      <div className="workspace-inner">
        {!status?.ready && status && <div className="setup-note"><strong>Publishing setup</strong><span>{status.problems.join(' · ')}</span>{!status.github?.authenticated && <button onClick={login}>Connect GitHub</button>}</div>}
        <div className="page-heading"><div><p className="eyebrow">{post.deleted ? 'LOCAL TRASH' : hasSaved ? (post.draft ? 'DRAFT ENTRY' : 'PUBLISHABLE ENTRY') : 'NEW ENTRY'}</p><h1>{post.title || 'Create an entry'}</h1><p>{post.deleted ? 'Restore this entry or finish removing it through a pull request.' : 'Write, preview, verify, and send your story for publication.'}</p></div><button className="preview-link" onClick={openPreview} disabled={post.deleted || Boolean(busy)}>Preview page ↗</button></div>
        <div className={`message ${message.type}`} role="status">{message.text}</div>
        <div className={`studio-grid ${post.deleted ? 'is-deleted' : ''}`}>
          <section className="composer" aria-label="Entry editor">
            {post.deleted ? <div className="deleted-pane"><span className="deleted-icon">↺</span><h2>Moved to local trash</h2><p>{post.tracked ? 'The entry and its images have been removed locally. Verify the site, then create a pull request to remove them from GitHub.' : 'This entry was only local. Restore it to keep working on it.'}</p><button onClick={restoreEntry} disabled={Boolean(busy) || Boolean(post.pr)}>Restore entry</button></div> : <>
            <div className="entry-fields"><label>Title<input autoFocus value={post.title} onChange={(event) => setTitle(event.target.value)} placeholder="Give this story a title" /></label><label>Summary<textarea value={post.summary} onChange={(event) => setField('summary', event.target.value)} placeholder="One or two sentences for the homepage and search results" maxLength={260} /></label><small>{post.summary.length}/260 characters</small></div>
            <div className="editor-tabs"><div className="editor-tab-switch" role="tablist" aria-label="Editor view"><button role="tab" aria-selected={activeTab === 'write'} onClick={switchToWrite}>Write</button><button role="tab" aria-selected={activeTab === 'source'} onClick={switchToSource}>Markdown</button></div><button className="external-preview" onClick={openPreview} disabled={Boolean(busy)}>Preview in new tab ↗</button></div>
            {activeTab === 'write' && !sourceMode && <div className="format-toolbar" role="toolbar" aria-label="Text formatting" onMouseDown={(event) => { if (event.target.closest('button')) event.preventDefault(); }}><div className="toolbar-group"><button title="Paragraph" aria-label="Paragraph" onClick={() => formatBlock('paragraph')}>Text</button><button title="Heading 2" aria-label="Heading 2" onClick={() => formatBlock('heading', { level: 2 })}>H2</button><button title="Heading 3" aria-label="Heading 3" onClick={() => formatBlock('heading', { level: 3 })}>H3</button></div><span className="toolbar-divider" /><div className="toolbar-group"><button title="Bold" aria-label="Bold" onClick={() => toggleStyle('bold')}><b>B</b></button><button title="Italic" aria-label="Italic" onClick={() => toggleStyle('italic')}><i>I</i></button><button title="Strikethrough" aria-label="Strikethrough" onClick={() => toggleStyle('strike')}><s>S</s></button><button title="Inline code" aria-label="Inline code" onClick={() => toggleStyle('code')}><code>&lt;/&gt;</code></button><button title="Insert link" aria-label="Insert link" onClick={addLink}>Link</button></div><span className="toolbar-divider" /><div className="toolbar-group"><button title="Bulleted list" onClick={() => formatBlock('bulletListItem')}>• List</button><button title="Numbered list" onClick={() => formatBlock('numberedListItem')}>1. List</button><button title="Quote" onClick={() => formatBlock('quote')}>“ Quote</button></div><span className="toolbar-spacer" /><div className="toolbar-group"><button title="Undo" aria-label="Undo" onClick={() => editor.undo()}>↶</button><button title="Redo" aria-label="Redo" onClick={() => editor.redo()}>↷</button></div></div>}
            <div className="editor-content">{activeTab === 'source' || sourceMode ? <div className="source-pane"><p>Hugo embeds stay intact in Markdown. Save to render them in the page preview.</p><textarea aria-label="Article Markdown" value={sourceText} onChange={(event) => { setSourceText(event.target.value); markDirty(); }} spellCheck="false" /></div> : <div className="rich-editor"><div className="rich-tip">Type <kbd>/</kbd> for blocks, or select text to format it.</div><BlockNoteView editor={editor} theme="light" onChange={() => { if (!loadingEditor.current) { setEditorMarkdown(editor.blocksToMarkdownLossy(editor.document)); markDirty(); } }} /></div>}</div>
            <div className="composer-footer"><span>{stats.words} {stats.words === 1 ? 'word' : 'words'} · {stats.minutes} min read <span className="footer-hint">· {sourceMode ? 'Markdown with Hugo embeds' : 'Ctrl/⌘ + S to save'}</span></span><div><label className="small-upload">＋ Add image<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { addInlineImage(event.target.files?.[0]); event.target.value = ''; }} /></label><button onClick={() => insertEmbed('youtube')}>＋ YouTube</button><button onClick={() => insertEmbed('video')}>＋ Video</button></div></div>
            </>}
          </section>
          {!post.deleted && <aside className="inspector" aria-label="Entry settings"><section><div className="panel-heading"><h2>Entry settings</h2><span>01</span></div><label>Section<select value={post.section} disabled={hasSaved} onChange={(event) => setField('section', event.target.value)}>{sections.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>URL slug<input value={post.slug} disabled={hasSaved} onChange={(event) => { slugEdited.current = true; setField('slug', event.target.value); }} placeholder="story-url" /></label><label>Date<input type="date" value={post.date} onChange={(event) => setField('date', event.target.value)} /></label><label className="check-row"><input type="checkbox" checked={post.draft} onChange={(event) => setField('draft', event.target.checked)} /><span><strong>Keep as draft</strong><small>It stays hidden after merge</small></span></label></section>
            <section><div className="panel-heading"><h2>Cover image</h2><span>02</span></div>{coverPreview && <img className="cover-preview" src={coverPreview} alt="Selected cover preview" />}<label className="cover-upload"><span>＋ Choose JPEG, PNG or WebP</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { setCover(event.target.files?.[0] || null); markDirty(); }} /></label>{(cover || post.image) && <p className="image-name">{cover?.name || post.image}</p>}<label>Image description<input value={post.imageAlt || ''} onChange={(event) => setField('imageAlt', event.target.value)} placeholder="Describe what the image shows" /></label><label>Caption <span className="optional">optional</span><input value={post.imageCaption || ''} onChange={(event) => setField('imageCaption', event.target.value)} placeholder="Credit or context" /></label></section>
            <section className="workflow-card"><div className="panel-heading"><h2>Publish workflow</h2><span>03</span></div><ol><li className={hasSaved && !dirty ? 'done' : ''}>Save the entry</li><li className={verified && !dirty ? 'done' : ''}>Verify the site</li><li className={post.pr ? 'done' : ''}>Review the pull request</li></ol>{post.pr && <a href={post.pr.url} target="_blank" rel="noreferrer">Open PR #{post.pr.number} ↗</a>}</section>
            {hasSaved && <section className="entry-management"><h2>Entry actions</h2><p>Move this entry and its images to local trash.</p><button onClick={deleteEntry} disabled={Boolean(busy) || Boolean(post.pr)}>Move to trash</button></section>}
          </aside>}
        </div>
        <div className="action-bar"><div className="action-context">{busy ? `${busy}…` : post.pr ? `Pull request #${post.pr.number} is open` : post.deleted ? post.tracked ? 'Entry removed locally; create a PR to remove it from GitHub' : 'Local entry is in trash' : dirty ? 'Save changes before preview or verification' : verified ? 'Production checks passed' : hasSaved ? 'Saved locally; verify when ready' : 'Your entry starts locally'}</div><div className="action-buttons">{post.deleted ? <button className="primary" onClick={restoreEntry} disabled={Boolean(busy) || Boolean(post.pr)}>Restore entry</button> : <button className="primary" onClick={save} disabled={Boolean(busy)}>{busy === 'Saving' ? 'Saving…' : dirty || !hasSaved ? 'Save entry' : 'Save again'}</button>}{(!post.deleted || post.tracked) && <><button onClick={validate} disabled={!canVerify}>Verify</button><button onClick={publish} disabled={!canPublish}>{post.deleted ? 'Create removal PR' : 'Create PR'}</button><button onClick={merge} disabled={!post.pr || Boolean(busy)}>Merge PR</button></>}</div></div>
        {logOpen && <section className="activity"><div><h2>Activity</h2><button onClick={() => setLogOpen(false)}>Hide</button></div><pre>{log || 'Waiting for GitHub…'}</pre></section>}{!logOpen && log && <button className="show-activity" onClick={() => setLogOpen(true)}>Show activity log</button>}
      </div>
    </main>
    {dialog && <StudioDialog key={dialog.id} config={dialog} onClose={closeDialog} />}
  </div>;
}

createRoot(document.querySelector('#app')).render(<Studio />);
