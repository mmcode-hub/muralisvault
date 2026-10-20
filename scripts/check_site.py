"""Check the generated site, including its configured deployment path and draft boundary."""
import json
import sys
import tomllib
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit
import xml.etree.ElementTree as ET

root = Path(sys.argv[1] if len(sys.argv) > 1 else 'public')
config = tomllib.loads(Path('hugo.toml').read_text())
base = config['baseURL']
prefix = urlsplit(base).path
host = urlsplit(base).netloc
errors = []

class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
        self.ids = set()
        self.h1 = 0
        self.main = 0
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        self.h1 += tag == 'h1'
        self.main += tag == 'main'
        if 'id' in attrs:
            self.ids.add(attrs['id'])
        for key in ('href', 'src'):
            if attrs.get(key):
                self.links.append(attrs[key])

pages = {}
for path in root.rglob('*.html'):
    page = Page()
    page.feed(path.read_text())
    pages[path] = page
    if page.h1 != 1 or page.main != 1:
        errors.append(f'{path}: expected exactly one h1 and main')

def check_link(link, source_url, source):
    target = urlsplit(urljoin(source_url, link))
    if target.scheme not in ('http', 'https') or target.netloc != host:
        return
    if not target.path.startswith(prefix):
        errors.append(f'{source}: URL escapes deployment path: {link}')
        return
    path = root / unquote(target.path[len(prefix):])
    if path.is_dir():
        path /= 'index.html'
    if not path.is_file():
        errors.append(f'{source}: missing target {link}')
    elif target.fragment and path in pages and unquote(target.fragment) not in pages[path].ids:
        errors.append(f'{source}: missing anchor {link}')

for path, page in pages.items():
    relative = path.relative_to(root).as_posix()
    url = base + (relative[:-10] if relative.endswith('index.html') else relative)
    for link in page.links:
        check_link(link, url, path)

for required in ('about', 'profession', 'travel', 'temple-architecture', 'my-thoughts',
                 'temple-architecture/temple-stories', 'temple-architecture/places',
                 'temple-architecture/architectural-elements',
                 'profession/teaching', 'profession/research', 'profession/python-community',
                 'profession/publications', 'travel/india', 'travel/international',
                 'my-thoughts/reflections', 'my-thoughts/education', 'my-thoughts/technology'):
    if not (root / required / 'index.html').is_file():
        errors.append(f'Missing section: {required}')

index = json.loads((root / 'index.json').read_text())
for entry in index:
    check_link(entry['permalink'], base, 'search index')
for name in ('sitemap.xml', 'index.xml'):
    tree = ET.parse(root / name)
    for element in tree.iter():
        if element.tag.rsplit('}', 1)[-1] in ('loc', 'link') and element.text:
            check_link(element.text, base, name)

# Draft titles and URLs must never enter HTML, search, sitemap or RSS.
for source in Path('content').rglob('*.md'):
    text = source.read_text()
    if '\ndraft: true\n' in text:
        title = next(line.split(':', 1)[1].strip().strip('"') for line in text.splitlines() if line.startswith('title:'))
        for output in root.rglob('*'):
            if output.suffix in ('.html', '.json', '.xml') and title in output.read_text():
                errors.append(f'Draft leaked: {source} into {output}')
if errors:
    raise SystemExit('\n'.join(errors))
print(f'PASS: {len(pages)} HTML pages, local links/assets/anchors, search, feeds, sections and draft exclusion.')
