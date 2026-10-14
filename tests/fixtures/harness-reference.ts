// Verification fixtures only. Never included in agent task files or the image.
export const harderRepairs:Record<string,Record<string,string>>={
 'interval-union':{'solution.py':`def solve(intervals):
    out = []
    for a, b in sorted((a, b) for a, b in intervals if b > a):
        if out and a <= out[-1][1]:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return out
`},
 'dependency-order':{'solution.py':`import heapq
def solve(graph):
    nodes = set(graph) | {d for ds in graph.values() for d in ds}
    incoming = {n: set(graph.get(n, [])) for n in nodes}
    ready = [n for n in nodes if not incoming[n]]
    heapq.heapify(ready)
    result = []
    while ready:
        n = heapq.heappop(ready)
        result.append(n)
        for other in nodes:
            if n in incoming[other]:
                incoming[other].remove(n)
                if not incoming[other]:
                    heapq.heappush(ready, other)
    return result if len(result) == len(nodes) else None
`},
 'json-pointer':{'solution.py':`import re
def solve(document, pointer):
    if pointer == '':
        return {'found': True, 'value': document}
    if not pointer.startswith('/'):
        return {'found': False}
    value = document
    for token in pointer[1:].split('/'):
        if re.search(r'~(?![01])', token):
            return {'found': False}
        token = token.replace('~1', '/').replace('~0', '~')
        if isinstance(value, dict) and token in value:
            value = value[token]
        elif isinstance(value, list) and re.fullmatch(r'0|[1-9][0-9]*', token) and int(token) < len(value):
            value = value[int(token)]
        else:
            return {'found': False}
    return {'found': True, 'value': value}
`},
 'lru-cache':{'solution.py':`from collections import OrderedDict
def solve(capacity, operations):
    cache, results = OrderedDict(), []
    for op in operations:
        if op[0] == 'get':
            if op[1] in cache:
                cache.move_to_end(op[1])
                results.append(cache[op[1]])
            else:
                results.append(None)
        else:
            if capacity > 0:
                cache[op[1]] = op[2]
                cache.move_to_end(op[1])
                if len(cache) > capacity:
                    cache.popitem(last=False)
            results.append(None)
    return results
`},
 'safe-expression':{'solution.py':`import ast, operator, re
def solve(text):
    binary = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.FloorDiv: operator.floordiv}
    def visit(n):
        if isinstance(n, ast.Constant) and type(n.value) is int:
            return n.value
        if isinstance(n, ast.UnaryOp) and isinstance(n.op, (ast.UAdd, ast.USub)):
            return visit(n.operand) * (-1 if isinstance(n.op, ast.USub) else 1)
        if isinstance(n, ast.BinOp) and type(n.op) in binary:
            return binary[type(n.op)](visit(n.left), visit(n.right))
        raise ValueError('invalid')
    try:
        if re.search(r'[^0-9\\s()+*/-]', text):
            return {'error': 'invalid'}
        return visit(ast.parse(text.strip(), mode='eval').body)
    except Exception:
        return {'error': 'invalid'}
`},
 'config-merge':{'solution.py':`import copy
def solve(base, override):
    out = copy.deepcopy(base)
    for key, value in override.items():
        if value is None:
            out.pop(key, None)
        elif isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = solve(out[key], value)
        else:
            out[key] = copy.deepcopy(value)
    return out
`},
 'window-counter':{'solution.py':`def solve(events, now, window):
    out = {}
    if window <= 0:
        return out
    for event in events:
        if now - window < event['timestamp'] <= now:
            key = event['key']
            out[key] = out.get(key, 0) + 1
    return out
`},
 'transaction-ledger':{'ledger.py':`def apply(initial, transactions):
    balances, seen = dict(initial), set()
    accepted = rejected = duplicates = 0
    for t in transactions:
        if t['id'] in seen:
            duplicates += 1
            continue
        seen.add(t['id'])
        kind, account, amount = t['kind'], t['account'], t['amount']
        if type(amount) is not int or amount <= 0 or kind not in ('deposit', 'withdraw', 'transfer') or (kind != 'deposit' and balances.get(account, 0) < amount):
            rejected += 1
            continue
        if kind == 'deposit':
            balances[account] = balances.get(account, 0) + amount
        elif kind == 'withdraw':
            balances[account] -= amount
        elif account != t['target']:
            balances[account] -= amount
            balances[t['target']] = balances.get(t['target'], 0) + amount
        accepted += 1
    return {'balances': balances, 'accepted': accepted, 'rejected': rejected, 'duplicates': duplicates}
`},
 'unique-slugs':{'solution.py':`import unicodedata
def solve(names):
    used, out = set(), []
    for name in names:
        base = '-'.join(unicodedata.normalize('NFKC', name).casefold().split()) or 'item'
        candidate, suffix = base, 2
        while candidate in used:
            candidate = base + '-' + str(suffix)
            suffix += 1
        used.add(candidate)
        out.append(candidate)
    return out
`},
 'network-acl':{'solution.py':`import ipaddress
def solve(address, rules):
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return False
    best, allowed = -1, False
    for rule in rules:
        try:
            network = ipaddress.ip_network(rule['cidr'], strict=False)
        except ValueError:
            continue
        if rule['action'] not in ('allow', 'deny'):
            continue
        if ip.version == network.version and ip in network and network.prefixlen > best:
            best, allowed = network.prefixlen, rule['action'] == 'allow'
    return allowed
`},
 'csv-records':{'solution.py':`import csv, io
def solve(text):
    try:
        records = [r for r in csv.reader(io.StringIO(text.lstrip(chr(65279)), newline=''), strict=True) if r]
        if not records:
            return {'rows': []}
        headers = records[0]
        if any(h == '' for h in headers) or len(set(headers)) != len(headers) or any(len(r) != len(headers) for r in records[1:]):
            return {'error': 'invalid'}
        return {'rows': [dict(zip(headers, r)) for r in records[1:]]}
    except csv.Error:
        return {'error': 'invalid'}
`},
 'pagination':{'solution.py':`def solve(pages, start):
    cursor, visited, seen, items = start, [], set(), []
    while cursor is not None and cursor in pages:
        if cursor in visited:
            return {'items': items, 'visited': visited, 'cursorCycle': True}
        visited.append(cursor)
        page = pages[cursor]
        for item in page['items']:
            if item['id'] not in seen:
                seen.add(item['id'])
                items.append(item)
        cursor = page['next']
    return {'items': items, 'visited': visited, 'cursorCycle': False}
`}
};
