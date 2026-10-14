"""Runs upstream harnesses only inside a network-disabled container.

The local HTTP shim transports OpenAI requests over stdio. It has no host route.
Never import this module as a host-side agent runtime.
"""
import contextlib
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

WIRE = sys.stdout
LOCK = threading.Lock()
REPLIES = queue.Queue()
WIRE_INPUT = None

def emit(kind, **values):
    with LOCK:
        WIRE.write(json.dumps({"kind": kind, **values}, ensure_ascii=True) + "\n")
        WIRE.flush()

def diagnostic():
    # Upstream Mini prints a first-import welcome banner. Keep it off the JSON wire.
    with contextlib.redirect_stdout(sys.stderr):
        from minisweagent.agents.default import DefaultAgent
        from minisweagent.models.litellm_textbased_model import LitellmTextbasedModel
    hermes_version = subprocess.check_output(["/opt/hermes/.venv/bin/python", "-c", "import sys; sys.path.insert(0, '/opt/hermes'); from run_agent import AIAgent; import importlib.metadata; print(importlib.metadata.version('hermes-agent'))"], text=True).strip()
    return {"mini-swe-agent": importlib.metadata.version("mini-swe-agent"),
            "hermes": hermes_version,
            "hermesRevision": Path("/opt/lmb/hermes-revision").read_text(),
            "opencode": subprocess.check_output(["opencode", "--version"], text=True).strip(),
            "runnerHash": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}

class Proxy(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        if self.path != "/v1/chat/completions":
            self.send_error(404)
            return
        size = int(self.headers.get("Content-Length", "0"))
        if size < 1 or size > 2_000_000:
            self.send_error(413)
            return
        body = json.loads(self.rfile.read(size))
        emit("request", body=body)
        reply = REPLIES.get(timeout=3600)
        # Return ordinary JSON: host relay explicitly disables upstream streaming.
        # Both SDKs accept this when their request uses stream=false.
        encoded = json.dumps(reply["body"]).encode()
        if body.get("stream") and reply["status"] == 200:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            data = reply["body"]
            message = data["choices"][0]["message"]
            delta = {"role": "assistant", "content": message.get("content") or ""}
            if message.get("reasoning_content"):
                delta["reasoning_content"] = message["reasoning_content"]
            if message.get("tool_calls"):
                delta["tool_calls"] = [{"index": i, **t} for i, t in enumerate(message["tool_calls"])]
            chunk = {"id": data.get("id", "lmb"), "object": "chat.completion.chunk", "created": data.get("created", 0), "model": data.get("model"), "choices": [{"index": 0, "delta": delta, "finish_reason": None}]}
            self.wfile.write(("data: " + json.dumps(chunk) + "\n\n").encode())
            chunk["choices"] = [{"index": 0, "delta": {}, "finish_reason": data["choices"][0].get("finish_reason", "stop")}]
            chunk["usage"] = data.get("usage")
            self.wfile.write(("data: " + json.dumps(chunk) + "\n\ndata: [DONE]\n\n").encode())
        else:
            self.send_response(reply["status"])
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

def input_loop():
    for line in WIRE_INPUT:
        REPLIES.put(json.loads(line))

def mini(config, task, model):
    import yaml
    import minisweagent
    from minisweagent.agents.default import DefaultAgent
    from minisweagent.environments.local import LocalEnvironment
    from minisweagent.models.litellm_textbased_model import LitellmTextbasedModel
    defaults = yaml.safe_load((Path(minisweagent.__file__).parent / "config/default.yaml").read_text())
    class ObservedEnvironment(LocalEnvironment):
        calls = 0
        def execute(self, action, *args, **kwargs):
            if self.calls >= config["maxToolCalls"]:
                raise RuntimeError("Tool call budget exceeded")
            self.calls += 1
            started = time.monotonic()
            try:
                result = super().execute(action, *args, **kwargs)
                emit("tool", name="bash", arguments=action, result={k: v for k,v in result.items() if k != "extra"}, durationMs=(time.monotonic()-started)*1000)
                return result
            except BaseException as error:
                result = {"returncode":0,"submitted":True} if type(error).__name__ == "Submitted" else {"exception":str(error)}
                emit("tool", name="bash", arguments=action, result=result, durationMs=(time.monotonic()-started)*1000)
                raise
    env = ObservedEnvironment(cwd="/work/project", timeout=min(config["timeoutSec"], 30))
    model_config = defaults.get("model", {}) | {"model_name":"openai/"+model, "cost_tracking":"ignore_errors", "model_kwargs":{"api_base":"http://127.0.0.1:8765/v1", "api_key":"sandbox", "temperature":config["temperature"], "max_tokens":config["maxTokens"], "num_retries":0}}
    llm = LitellmTextbasedModel(**model_config)
    agent_config = defaults["agent"] | {"step_limit":config["maxToolCalls"]+5, "cost_limit":0}
    emit("configuration", harness=agent_config, model=llm.config.model_dump(mode="json"))
    with contextlib.redirect_stdout(sys.stderr):
        agent = DefaultAgent(llm, env, **agent_config)
        result = agent.run(task["description"])
    emit("message", result=result)
    return result

def opencode(config, task, model):
    settings = {"$schema":"https://opencode.ai/config.json", "autoupdate":False, "share":"disabled", "enabled_providers":["lmb"], "provider":{"lmb":{"npm":"@ai-sdk/openai-compatible", "name":"Local Model Bench relay", "options":{"baseURL":"http://127.0.0.1:8765/v1", "apiKey":"sandbox"}, "models":{model:{"name":model,"limit":{"context":config["contextLength"],"output":config["maxTokens"]}}}}}, "permission":{"*":"allow", "external_directory":"deny", "webfetch":"deny", "websearch":"deny", "task":"deny"}, "agent":{"build":{"temperature":config["temperature"], "steps":config["maxToolCalls"]}}, "compaction":{"auto":False}, "lsp":False}
    # OpenCode skips dependency installation for non-writable config directories.
    # All provider SDKs used here are bundled in the pinned binary. Inline config
    # remains supported; no mutable project/global plugin tree is needed.
    env = dict(os.environ, XDG_CONFIG_HOME="/opt/lmb/config", OPENCODE_CONFIG_CONTENT=json.dumps(settings))
    emit("configuration", harness=settings)
    proc = subprocess.Popen(["opencode","run","--format","json","--model","lmb/"+model,task["description"]], cwd="/work/project", env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=sys.stderr, text=True)
    calls = 0
    for line in proc.stdout:
        try:
            data = json.loads(line)
        except ValueError:
            emit("message", text=line[:10000])
            continue
        if data.get("type") == "tool_use":
            calls += 1
            emit("tool", **{"event":data})
            if calls > config["maxToolCalls"]:
                proc.kill()
                raise RuntimeError("Tool call budget exceeded")
        else:
            emit("message", event=data)
    if proc.wait() != 0:
        raise RuntimeError("OpenCode exited with status " + str(proc.returncode))

def hermes(config, task, model):
    # This function is invoked only by the Hermes interpreter inside the same
    # restricted container. 'local' terminal means local to this container.
    sys.path.insert(0, "/opt/hermes")
    os.chdir("/work/project")
    import yaml
    home = Path(os.environ["HERMES_HOME"])
    home.mkdir(parents=True, exist_ok=True)
    settings = {"model": {"default": model, "provider": "custom", "base_url": "http://127.0.0.1:8765/v1", "context_length": config["contextLength"]}, "terminal": {"backend": "local", "cwd": "/work/project", "timeout": min(config["timeoutSec"], 30)}, "compression": {"enabled": False}, "skills": {"auto_load": []}}
    (home / "config.yaml").write_text(yaml.safe_dump(settings))
    starts = {}
    def tool_start(call_id, name, arguments):
        starts[call_id] = time.monotonic()
    def tool_complete(call_id, name, arguments, result):
        started = starts.pop(call_id, None)
        emit("tool", name=name, arguments=arguments, result=result, durationMs=None if started is None else (time.monotonic()-started)*1000)
    with contextlib.redirect_stdout(sys.stderr):
        from run_agent import AIAgent
        agent = AIAgent(model=model, base_url="http://127.0.0.1:8765/v1", api_key="sandbox", provider="custom", api_mode="chat_completions", enabled_toolsets=["terminal", "file"], max_iterations=config["maxToolCalls"]+5, max_tokens=config["maxTokens"], request_overrides={"temperature": config["temperature"]}, quiet_mode=True, skip_memory=True, skip_context_files=True, skip_background_review=True, save_trajectories=False, checkpoints_enabled=False, cwd="/work/project", tool_start_callback=tool_start, tool_complete_callback=tool_complete)
        emit("configuration", harness={"settings": settings, "enabled_toolsets": ["terminal", "file"], "max_iterations": config["maxToolCalls"]+5, "skip_memory": True, "skip_context_files": True, "skip_background_review": True, "save_trajectories": False, "checkpoints_enabled": False, "fallback_model": None}, model={"provider": "custom", "api_mode": "chat_completions", "model": model})
        try:
            result = agent.run_conversation(task["description"])
            emit("message", result=result)
            if result.get("error"):
                raise RuntimeError(str(result["error"]))
        finally:
            agent.close()

def collect(task):
    files = {}
    for name in task["files"]:
        path = Path("/work/project") / name
        # Only declared task files; reject symlinks, devices, oversized artifacts.
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 65536:
            raise RuntimeError("Invalid or oversized artifact: " + name)
        files[name] = path.read_text()
    return files

def main():
    global WIRE_INPUT
    if "--hermes" in sys.argv:
        payload = json.loads(sys.stdin.readline())
        with open(os.devnull, "r") as empty:
            os.dup2(empty.fileno(), sys.stdin.fileno())
        try:
            hermes(payload["config"], payload["task"], payload["model"])
        except BaseException as error:
            emit("error", message="Hermes: "+type(error).__name__+": "+str(error))
            raise
        return
    if "--diagnostic" in sys.argv:
        print(json.dumps(diagnostic()))
        return
    initial = json.loads(sys.stdin.readline())
    # Keep transport input private to its reader. Children must see EOF on stdin,
    # especially OpenCode's CLI, which reads piped input before starting a prompt.
    WIRE_INPUT = os.fdopen(os.dup(sys.stdin.fileno()), "r", encoding="utf-8")
    with open(os.devnull, "r") as empty:
        os.dup2(empty.fileno(), sys.stdin.fileno())
    task, config = initial["task"], initial["config"]
    Path("/work/project").mkdir(parents=True)
    Path("/work/home").mkdir(parents=True)
    for name, content in task["files"].items():
        path = Path("/work/project") / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
    # A real Git boundary keeps OpenCode's project discovery inside the task.
    # Use identical fixed commit metadata for both upstream harnesses.
    git_env = dict(os.environ, GIT_AUTHOR_DATE="2000-01-01T00:00:00+00:00", GIT_COMMITTER_DATE="2000-01-01T00:00:00+00:00")
    for args in (["init","--quiet","--initial-branch=main"], ["config","user.name","LMB task fixture"], ["config","user.email","fixture@invalid.local"], ["add","--","."], ["commit","--quiet","-m","Deterministic initial task"]):
        subprocess.run(["git",*args],cwd="/work/project",env=git_env,check=True,stdout=sys.stderr,stderr=sys.stderr)
    initial_commit = subprocess.check_output(["git","rev-parse","HEAD"],cwd="/work/project",text=True).strip()
    threading.Thread(target=input_loop, daemon=True).start()
    server = HTTPServer(("127.0.0.1",8765), Proxy)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    emit("ready", versions=diagnostic(), initialCommit=initial_commit)
    try:
        if initial["harness"] == "mini-swe-agent":
            mini(config, task, initial["model"])
        elif initial["harness"] == "opencode":
            opencode(config, task, initial["model"])
        elif initial["harness"] == "hermes":
            subprocess.run(["/opt/hermes/.venv/bin/python", "-u", "/opt/lmb/runner.py", "--hermes"], input=json.dumps(initial)+"\n", text=True, check=True, cwd="/work/project", stderr=sys.stderr)
        else:
            raise RuntimeError("Unsupported harness")
        emit("artifacts", files=collect(task))
    except BaseException as error:
        emit("error", message=type(error).__name__+": "+str(error))
        # Failed/limited agents may still have changed files; verification remains separate.
        try:
            emit("artifacts", files=collect(task))
        except Exception:
            pass
    finally:
        server.shutdown()

if __name__ == "__main__":
    main()
