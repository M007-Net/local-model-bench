"""Download/prepare UC Berkeley's published annotated Enron archive (no third-party dependencies)."""
import argparse
import collections
import hashlib
import json
from pathlib import Path
import tarfile
import urllib.request

URL = 'https://bailando.berkeley.edu/enron/enron_with_categories.tar.gz'

def prepare(archive):
    emails, excluded, seen = [], collections.Counter(), set()
    with tarfile.open(archive, 'r:gz') as corpus:
        members = {m.name: m for m in corpus.getmembers() if m.isfile()}
        annotations = sorted((m for m in members.values() if m.name.endswith('.cats')), key=lambda m: m.name)
        for item in annotations:
            raw = corpus.extractfile(item).read().decode('ascii')
            votes = [tuple(map(int, line.split(','))) for line in raw.splitlines() if line.strip()]
            if any(len(v) != 3 or v[2] < 1 for v in votes):
                raise ValueError('Malformed annotations: ' + item.name)
            genres = [(label, count) for section, label, count in votes if section == 1]
            if len(genres) != 1:
                excluded['multiple_or_missing_genres'] += 1
                continue
            genre, count = genres[0]
            if count < 2:
                excluded['no_two_annotator_agreement'] += 1
                continue
            if genre in (7, 8):
                excluded['empty_message_genre'] += 1
                continue
            if genre not in range(1, 7):
                raise ValueError('Unknown genre: ' + item.name)
            msg_name = item.name[:-5] + '.txt'
            if msg_name not in members:
                raise ValueError('Missing email: ' + msg_name)
            # No archive extraction or paths written from member names. UTF-8 with
            # Latin-1 fallback preserves every byte rather than discarding characters.
            msg = corpus.extractfile(members[msg_name]).read()
            try:
                text = msg.decode('utf-8')
            except UnicodeDecodeError:
                text = msg.decode('latin-1')
            if not text.strip():
                excluded['empty_text'] += 1
                continue
            if len(text) > 16000:
                excluded['over_16000_characters'] += 1
                continue
            item_id = Path(item.name).stem
            if item_id in seen:
                raise ValueError('Duplicate email ID: ' + item_id)
            seen.add(item_id)
            emails.append({'id': item_id, 'email': text, 'genre_id': genre})
    emails.sort(key=lambda e: int(e['id']))
    return {'dataset': 'UC Berkeley Enron', 'sourceUrl': URL,
            'archiveSha256': hashlib.sha256(Path(archive).read_bytes()).hexdigest(),
            'originalCount': len(annotations), 'exclusions': dict(excluded),
            'categoryCounts': dict(sorted(collections.Counter(e['genre_id'] for e in emails).items())),
            'emails': emails}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', default='work/email-source/enron_with_categories.tar.gz')
    parser.add_argument('--output', default='work/email-source/prepared.json')
    parser.add_argument('--download', action='store_true')
    args = parser.parse_args()
    archive = Path(args.archive)
    if args.download:
        archive.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(URL, timeout=60) as response:
            archive.write_bytes(response.read(25 * 1024 * 1024 + 1))
        if archive.stat().st_size > 25 * 1024 * 1024:
            raise ValueError('Download exceeds 25 MB')
    prepared = prepare(archive)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(prepared, ensure_ascii=False), encoding='utf-8')
    print(json.dumps({k: v for k, v in prepared.items() if k != 'emails'}))
