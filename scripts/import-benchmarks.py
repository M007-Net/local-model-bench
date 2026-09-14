"""Build bundled packs from the downloaded upstream snapshots; never execute dataset code."""
import ast
import hashlib
import json
import math
from pathlib import Path

root = Path(__file__).resolve().parents[1]
source = root / 'work/benchmark-sources'
dest = root / 'src/benchmark-data'
dest.mkdir(exist_ok=True)
protocol = 'lmb-generation-v1'
sources = {
    'gsm8k': 'https://raw.githubusercontent.com/openai/grade-school-math/master/grade_school_math/data/test.jsonl',
    'ifeval': 'https://raw.githubusercontent.com/google-research/google-research/master/instruction_following_eval/data/input_data.jsonl',
    'cruxeval': 'https://raw.githubusercontent.com/facebookresearch/cruxeval/main/data/cruxeval.jsonl',
}
supported = {'punctuation:no_comma', 'detectable_format:number_bullet_lists', 'detectable_format:json_format',
    'keywords:existence', 'keywords:frequency', 'keywords:forbidden_words', 'combination:two_responses',
    'combination:repeat_prompt', 'startend:end_checker', 'detectable_format:title', 'startend:quotation'}

def json_value(v):
    if v is None or type(v) in (str, bool): return True
    if type(v) in (int, float): return math.isfinite(v) and abs(v) <= 2**53 - 1
    if type(v) is list: return all(json_value(x) for x in v)
    if type(v) is dict: return all(type(k) is str and json_value(x) for k,x in v.items())
    return False

packs = []
for pack_id in sources:
    raw = (source / (pack_id + '.txt')).read_bytes()
    rows = [json.loads(line) for line in raw.decode('utf-8').splitlines() if line.strip()]
    digest = hashlib.sha256(raw).hexdigest()
    tests = []
    for i, row in enumerate(rows):
        item_id = str(row.get('id', row.get('key', i)))
        meta = {'packId':pack_id,'itemId':item_id,'datasetHash':digest,'protocol':protocol}
        if pack_id == 'gsm8k':
            answer = row['answer'].rsplit('####',1)[1].strip().replace(',','')
            assert math.isfinite(float(answer))
            prompt = row['question'] + '\n\nSolve the problem. Put your final numeric answer on the last line in the form #### 42. You may explain your work before that line.'
            rules = [{'id':'final-answer','label':'Correct final numeric answer','type':'final-number','expected':answer,'weight':1}]
            key = '#### ' + answer
            rubric = 'Compare the final numeric answer with the published GSM8K answer. Reasoning prose is not graded. Published solution: ' + row['answer']
        elif pack_id == 'cruxeval':
            value = ast.literal_eval(row['output'])
            if not json_value(value): continue
            key = json.dumps({'answer':value}, ensure_ascii=False)
            prompt = 'Read this Python function and predict its return value for the supplied input. Do not run code.\n\n' + row['code'] + '\n\nFunction call: f(' + row['input'] + ')\n\nReturn JSON only, with one key named "answer" containing the predicted value. Use JSON arrays for Python lists, JSON objects for dictionaries, null for None, and true/false for booleans. Do not include an explanation or code fence.'
            rules = [{'id':'output','label':'Correct predicted return value','type':'json-equal','expected':key,'weight':1}]
            rubric = 'CRUXEval-O output prediction using the published input/output pair. Local JSON response adaptation; only JSON-representable outputs are included. No candidate code is executed.'
        else:
            if not row['instruction_id_list'] or not set(row['instruction_id_list']) <= supported: continue
            # Supported parameters must be fully specified; no randomized defaults.
            requirements = dict(zip(row['instruction_id_list'], row['kwargs']))
            required = {'keywords:existence':['keywords'], 'keywords:frequency':['keyword','frequency','relation'], 'keywords:forbidden_words':['forbidden_words'], 'combination:repeat_prompt':['prompt_to_repeat'], 'startend:end_checker':['end_phrase'], 'detectable_format:number_bullet_lists':['num_bullets']}
            if any(any(k not in args or args[k] is None for k in required.get(kind,[])) for kind,args in zip(row['instruction_id_list'],row['kwargs'])): continue
            prompt = row['prompt']
            key = ''
            checks = [{'kind':kind,'args':args} for kind,args in zip(row['instruction_id_list'],row['kwargs'])]
            rules = [{'id':'instructions','label':'All verifiable instructions followed','type':'ifeval','expected':json.dumps(checks),'weight':1}]
            rubric = 'IFEval prompt-level strict-style local evaluator for the supported instruction subset. All listed constraints must pass. Does not grade factual accuracy or prose quality. No loose-response transformations.'
        tests.append({'id':f'bench-{pack_id}-{item_id}','name':f'{pack_id.upper()} · {item_id}', 'category':'Published benchmark','version':1,'kind':'quality','maxTokens':2048,'prompt':prompt,'answerKey':key,'rules':rules,'rubric':rubric,'benchmark':meta})
    packs.append({'id':pack_id,'source':sources[pack_id],'datasetHash':digest,'protocol':protocol,'originalCount':len(rows),'count':len(tests),'tests':tests})
    print(pack_id, len(tests), 'of', len(rows), digest)
(dest/'packs.json').write_text(json.dumps(packs, ensure_ascii=False, separators=(',',':')),encoding='utf-8')
licenses = root/'vendor/benchmark-licenses'
licenses.mkdir(exist_ok=True)
for original,name in [('gsmLicense','GSM8K-MIT.txt'),('cruxLicense','CRUXEval-MIT.txt'),('googleLicense','IFEval-Apache-2.0.txt')]:
    (licenses/name).write_bytes((source/(original+'.txt')).read_bytes())
(licenses/'NOTICE.txt').write_text('GSM8K: Copyright (c) 2021 OpenAI. CRUXEval: Copyright (c) 2023 Meta. IFEval data and adapted check logic: Copyright Google LLC, Apache-2.0.\nBundled September 12, 2026. Sources and SHA-256 snapshot hashes are in each saved benchmark test. Prompts/output formats and scoring are adapted for this local app and are not official leaderboard protocols.\n',encoding='utf-8')
