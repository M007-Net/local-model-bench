"""Trusted parent compares results from a separate candidate Python process.
The agent container never receives hidden cases or verifier code at runtime.
"""
import json
from pathlib import Path
import subprocess
import sys

payload = json.loads(sys.stdin.readline())
Path('/work/project').mkdir(parents=True)
for name, source in payload['files'].items():
    path = Path('/work/project') / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(source)
module, function = payload['entry'].split(':')
child = 'import importlib,json,sys; p=json.load(sys.stdin); result=getattr(importlib.import_module(p["module"]),p["function"])(*p["args"]); print(json.dumps(result,allow_nan=False))'
passed = True
for index, case in enumerate(payload['cases']):
    try:
        result = subprocess.run([sys.executable,'-c',child], cwd='/work/project', input=json.dumps({'module':module,'function':function,'args':case['args']}), capture_output=True, text=True, timeout=5)
        ok = result.returncode == 0 and json.loads(result.stdout) == case['expected']
        print(json.dumps({'case':index+1,'passed':ok,'stderr':result.stderr[:2000]}), flush=True)
    except Exception as error:
        ok = False
        print(json.dumps({'case':index+1,'passed':False,'error':str(error)}), flush=True)
    passed = passed and ok
sys.exit(0 if passed else 1)
