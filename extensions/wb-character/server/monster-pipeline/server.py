"""
怪物生成平台 — Flask 后端服务。

启动: python server.py
访问: http://localhost:5000
"""
import os
import sys
import json
import time
import uuid
import threading
from datetime import datetime

from flask import Flask, request, jsonify, Response, send_from_directory, send_file

# 将 pipeline 包加入路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pipeline.config import (
    BASE_DIR, OUTPUT_DIR, TEMP_DIR,
    DIRS, ALL_DIRS, ANIMS, PAIR_KEYS, FLIP_MAP, HISTORY_FILE,
)
from pipeline.prompt_gen import generate_all_prompts
from pipeline.image_gen import (
    generate_image_api, save_uploaded_image,
    get_raw_image_path, get_nobg_image_path,
)
from pipeline.bg_removal import remove_background
from pipeline.assembler import DirectionAssembler, flip_direction
from pipeline.hero_gen import generate_hero
from pipeline.packager import (
    verify_monster, build_config, save_config,
    create_preview_html, create_zip,
)

app = Flask(__name__, static_folder="static")
# 允许客户端上传的 boss 参考图最多 32 MB（dataURL 前端已压缩到 ~300 KB，
# 这里留充足余量；没设置过 werkzeug 2.3+ 会用保守默认导致大 JSON 挂断）。
app.config["MAX_CONTENT_LENGTH"] = 32 * 1024 * 1024

# ─── 全局状态 ───

pipelines = {}  # pipeline_id -> pipeline_state


def new_pipeline_state(config: dict) -> dict:
    return {
        "id": str(uuid.uuid4())[:8],
        "config": config,
        "status": "idle",        # idle / running / done / error
        "stage": 0,              # 0-4
        "stage_name": "设计",
        "progress": 0.0,         # 0.0 ~ 1.0
        "log": [],
        "prompts": {},
        "hero_path": None,       # hero_512.png 路径
        "gen_status": {},        # "S_idle_01": "pending"|"done"|"error"
        "assemble_status": {},   # "S": "pending"|"done"|"error"
        "flip_status": {},       # "SW": "done"|"error"
        "qa_result": {},
        "created_at": datetime.now().isoformat(),
        "error": None,
    }


def add_log(state: dict, msg: str):
    state["log"].append({"time": datetime.now().strftime("%H:%M:%S"), "msg": msg})


# ─── 历史记录 ───

def _load_history() -> list:
    if os.path.isfile(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []
    return []


def _save_history(history: list):
    with open(HISTORY_FILE, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, indent=2)


def _add_history_entry(monster_name: str, hero_path: str, config: dict):
    history = _load_history()
    entry = {
        "id": str(uuid.uuid4())[:8],
        "monster_name": monster_name,
        "hero_path": hero_path,
        "display_name": config.get("display_name", monster_name),
        "feature_lock": config.get("feature_lock", ""),
        "style": config.get("style", "CEL_2D"),
        "morphology": config.get("morphology", "quadruped"),
        "created_at": datetime.now().isoformat(),
        "dirs": ALL_DIRS,
    }
    history.insert(0, entry)
    if len(history) > 100:
        history = history[:100]
    _save_history(history)
    return entry


# ─── 前端 ───

@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/static/<path:path>")
def serve_static(path):
    return send_from_directory("static", path)


# ─── API: 配置 ───

@app.route("/api/config", methods=["POST"])
def save_monster_config():
    config = request.json
    pid = config.get("pipeline_id")
    if pid and pid in pipelines:
        pipelines[pid]["config"] = config
    return jsonify({"ok": True})


# ─── API: 生成提示词 ───

@app.route("/api/prompts", methods=["POST"])
def gen_prompts():
    data = request.json
    feature_lock = data.get("feature_lock", "")
    camera_angle = data.get("camera_angle", 60)
    style = data.get("style", "CEL_2D")
    prompts = generate_all_prompts(feature_lock, camera_angle, style)
    return jsonify(prompts)


# ─── API: 启动管线 ───

@app.route("/api/pipeline/start", methods=["POST"])
def start_pipeline():
    config = request.json
    state = new_pipeline_state(config)
    pid = state["id"]
    pipelines[pid] = state

    mode = config.get("mode", "prompt")  # "prompt" or "api"

    prompts = generate_all_prompts(
        config.get("feature_lock", ""),
        config.get("camera_angle", 60),
        config.get("style", "CEL_2D"),
    )
    state["prompts"] = prompts

    for d in DIRS:
        for pk in PAIR_KEYS:
            state["gen_status"][f"{d}_{pk}"] = "pending"
        state["assemble_status"][d] = "pending"

    for flip_d in FLIP_MAP:
        state["assemble_status"][flip_d] = "pending"

    if mode == "api":
        state["status"] = "running"
        t = threading.Thread(target=run_full_pipeline, args=(pid,), daemon=True)
        t.start()
    else:
        state["status"] = "waiting_upload"
        add_log(state, "提示词已生成，等待用户上传图片...")

    return jsonify({"pipeline_id": pid, "prompts": prompts, "status": state["status"]})


# ─── API: 上传图片 ───

@app.route("/api/upload/<pid>/<direction>/<pair_key>", methods=["POST"])
def upload_image(pid, direction, pair_key):
    if pid not in pipelines:
        return jsonify({"error": "管线不存在"}), 404

    state = pipelines[pid]
    monster_name = state["config"].get("monster_name", "Monster")

    if "file" not in request.files:
        return jsonify({"error": "未找到文件"}), 400

    file = request.files["file"]
    raw_path = get_raw_image_path(monster_name, direction, pair_key)
    save_uploaded_image(file.read(), raw_path)

    add_log(state, f"已上传 {direction}/{pair_key}")

    nobg_path = get_nobg_image_path(monster_name, direction, pair_key)
    try:
        remove_background(raw_path, nobg_path)
        state["gen_status"][f"{direction}_{pair_key}"] = "done"
        add_log(state, f"去背景完成 {direction}/{pair_key}")
    except Exception as e:
        state["gen_status"][f"{direction}_{pair_key}"] = "error"
        add_log(state, f"去背景失败 {direction}/{pair_key}: {e}")
        return jsonify({"error": str(e)}), 500

    check_and_assemble_direction(pid, direction)

    return jsonify({"ok": True, "status": state["gen_status"][f"{direction}_{pair_key}"]})


# ─── API: 上传已去背景的图片（跳过去背景步骤）───

@app.route("/api/upload-nobg/<pid>/<direction>/<pair_key>", methods=["POST"])
def upload_nobg_image(pid, direction, pair_key):
    if pid not in pipelines:
        return jsonify({"error": "管线不存在"}), 404

    state = pipelines[pid]
    monster_name = state["config"].get("monster_name", "Monster")

    if "file" not in request.files:
        return jsonify({"error": "未找到文件"}), 400

    file = request.files["file"]
    nobg_path = get_nobg_image_path(monster_name, direction, pair_key)
    save_uploaded_image(file.read(), nobg_path)

    state["gen_status"][f"{direction}_{pair_key}"] = "done"
    add_log(state, f"已上传去背景图 {direction}/{pair_key}")

    check_and_assemble_direction(pid, direction)

    return jsonify({"ok": True})


def check_and_assemble_direction(pid: str, direction: str):
    """检查某方向的 10 张图是否全部就绪，若是则自动触发组装。"""
    state = pipelines[pid]
    all_done = all(
        state["gen_status"].get(f"{direction}_{pk}") == "done"
        for pk in PAIR_KEYS
    )
    if all_done and state["assemble_status"].get(direction) == "pending":
        t = threading.Thread(
            target=assemble_one_direction, args=(pid, direction), daemon=True
        )
        t.start()


def assemble_one_direction(pid: str, direction: str):
    """在后台线程中组装一个方向。"""
    state = pipelines[pid]
    monster_name = state["config"].get("monster_name", "Monster")

    state["assemble_status"][direction] = "running"
    add_log(state, f"开始组装 {direction} 方向...")

    try:
        out_dir = os.path.join(OUTPUT_DIR, monster_name, direction)
        asm = DirectionAssembler(output_dir=out_dir)

        paths = {}
        for pk in PAIR_KEYS:
            paths[pk] = get_nobg_image_path(monster_name, direction, pk)

        asm.load_pair_images(paths)

        def on_progress(step, detail):
            add_log(state, f"[{direction}] {detail}")

        result = asm.assemble(on_progress=on_progress)

        state["assemble_status"][direction] = "done"
        add_log(state, f"{direction} 方向组装完成 (cell={result['cell_w']}x{result['cell_h']}, scale={result['scale']:.3f})")

        check_all_assembled(pid)

    except Exception as e:
        state["assemble_status"][direction] = "error"
        add_log(state, f"{direction} 方向组装失败: {e}")


def check_all_assembled(pid: str):
    """检查是否所有方向（含镜像）都已组装完成，若是则自动打包。"""
    state = pipelines[pid]
    all_done = all(
        state["assemble_status"].get(d) == "done" for d in DIRS
    )
    if not all_done:
        return

    monster_name = state["config"].get("monster_name", "Monster")
    base_dir = os.path.join(OUTPUT_DIR, monster_name)

    add_log(state, "所有方向组装完成，开始质检与打包...")

    state["stage"] = 3
    state["stage_name"] = "后处理"

    qa = verify_monster(base_dir)
    state["qa_result"] = qa

    if qa["ok"]:
        add_log(state, f"质检通过 — 共 {qa['total_files']} 个文件")
    else:
        for d, vr in qa["directions"].items():
            if not vr["ok"]:
                add_log(state, f"质检警告 [{d}] 缺失: {', '.join(vr['missing'])}")

    state["stage"] = 4
    state["stage_name"] = "打包"

    cfg = build_config(
        monster_name, base_dir,
        style=state["config"].get("style", "CEL_2D"),
        morphology=state["config"].get("morphology", "quadruped"),
        display_name=state["config"].get("display_name", ""),
        description=state["config"].get("description", ""),
        feature_lock=state["config"].get("feature_lock", ""),
    )
    save_config(cfg, base_dir)
    create_preview_html(monster_name, base_dir)

    zip_path = os.path.join(OUTPUT_DIR, f"{monster_name}.zip")
    create_zip(base_dir, zip_path)

    hero_path = state.get("hero_path") or ""
    if hero_path:
        _add_history_entry(monster_name, hero_path, state["config"])

    state["status"] = "done"
    state["progress"] = 1.0
    add_log(state, f"打包完成 — {monster_name}.zip（8方向 = 5生成 + 3镜像）")


# ─── API 模式全自动管线 ───

def _bg_remove_task(state, key, raw_path, nobg_path, counter_lock, done_counter, total):
    """在独立线程中执行去背景，完成后更新状态。"""
    try:
        remove_background(raw_path, nobg_path)
        state["gen_status"][key] = "done"
        with counter_lock:
            done_counter["n"] += 1
            state["progress"] = 0.05 + done_counter["n"] / total * 0.55
        add_log(state, f"完成 {key} ({done_counter['n']}/{total})")
    except Exception as e:
        add_log(state, f"去背景失败 {key}: {e}")
        state["gen_status"][key] = "error"


def run_full_pipeline(pid: str):
    """API 模式：立绘 → 5 方向并行生成 → 镜像翻转 → 组装打包。"""
    import concurrent.futures

    state = pipelines[pid]
    config = state["config"]
    monster_name = config.get("monster_name", "Monster")
    api_key = config.get("api_key", "")
    api_base = config.get("api_base", "")
    model = config.get("model", "nanobanana-pro")
    feature_lock = config.get("feature_lock", "")
    style = config.get("style", "CEL_2D")

    # api_key 可以为空：image_gen._resolve_gemini_key 会走
    # LLM_PROXY_URL / env GEMINI_API_KEY / config/gemini-credentials.json
    # 做兜底，无需用户在 UI 上填。

    # ── 阶段 0: 立绘 ──
    # 关键：如果用户已经通过 /api/generate-hero 做好了立绘（图 1），
    # 必须直接复用 hero_512.png 作为后续所有帧的多模态参考，
    # 绝不能再跑一次 generate_hero — 第二次调用没有参考图 / 上传图信息，
    # 生成的立绘跟用户那张会完全不是一只怪物（就是图 2 狮子那个 bug）。
    state["stage"] = 0
    state["stage_name"] = "立绘"
    existing_hero = os.path.join(OUTPUT_DIR, monster_name, "hero_512.png")

    if os.path.isfile(existing_hero):
        state["hero_path"] = existing_hero
        state["progress"] = 0.05
        add_log(state, f"复用已有立绘作为动画参考: {os.path.basename(existing_hero)}")
    else:
        add_log(state, f"未检测到已有立绘，重新生成 — 模型: {model}")
        try:
            hero_path = generate_hero(
                monster_name, feature_lock,
                api_key=api_key, model=model,
                api_base=api_base, style=style,
            )
            state["hero_path"] = hero_path
            state["progress"] = 0.05
            add_log(state, f"立绘生成完成: {os.path.basename(hero_path)}")
        except Exception as e:
            add_log(state, f"立绘生成失败 (非致命，继续生成方向): {e}")

    # ── 阶段 1: 5 方向并行生成 ──
    state["stage"] = 1
    state["stage_name"] = "生成"
    add_log(state, f"启动自动生成 — 模型: {model}，5 方向并行")

    prompts = state["prompts"]
    total = len(DIRS) * len(PAIR_KEYS)
    done_counter = {"n": 0}
    counter_lock = threading.Lock()

    api_cooldown = 0.2
    pair_workers = 3
    bg_workers = 4

    bg_pool = concurrent.futures.ThreadPoolExecutor(max_workers=bg_workers)
    bg_futures = []

    def gen_one_pair(d, pk):
        key = f"{d}_{pk}"
        state["gen_status"][key] = "running"
        add_log(state, f"生成 {d}/{pk}...")

        raw_path = get_raw_image_path(monster_name, d, pk)
        nobg_path = get_nobg_image_path(monster_name, d, pk)

        try:
            prompt = prompts.get(d, {}).get(pk, "")
            hero_ref = state.get("hero_path", "") or ""
            generate_image_api(prompt, api_key, raw_path,
                               api_base=api_base, model=model,
                               reference_image=hero_ref)
            bg_futures.append(bg_pool.submit(_bg_remove_task, state, key, raw_path, nobg_path, counter_lock, done_counter, total))
        except Exception as e:
            add_log(state, f"失败 {d}/{pk}: {e} (已用尽所有重试)")
            state["gen_status"][key] = "error"

    def gen_direction(d):
        with concurrent.futures.ThreadPoolExecutor(max_workers=pair_workers) as pair_pool:
            pair_futures = []
            for idx, pk in enumerate(PAIR_KEYS):
                if idx > 0:
                    time.sleep(api_cooldown)
                pair_futures.append(pair_pool.submit(gen_one_pair, d, pk))
            concurrent.futures.wait(pair_futures)

    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        futures = {pool.submit(gen_direction, d): d for d in DIRS}
        concurrent.futures.wait(futures)

    concurrent.futures.wait(bg_futures)
    bg_pool.shutdown(wait=False)

    for d in DIRS:
        all_done = all(
            state["gen_status"].get(f"{d}_{pk}") == "done" for pk in PAIR_KEYS
        )
        if not all_done:
            state["assemble_status"][d] = "error"
            add_log(state, f"跳过 {d} 组装 — 有图片生成失败")
            continue

        state["assemble_status"][d] = "running"
        add_log(state, f"开始组装 {d} 方向...")
        try:
            out_dir = os.path.join(OUTPUT_DIR, monster_name, d)
            asm = DirectionAssembler(output_dir=out_dir)
            paths = {pk: get_nobg_image_path(monster_name, d, pk) for pk in PAIR_KEYS}
            asm.load_pair_images(paths)
            asm.assemble()
            state["assemble_status"][d] = "done"
            add_log(state, f"{d} 方向组装完成")
        except Exception as e:
            state["assemble_status"][d] = "error"
            add_log(state, f"{d} 方向组装失败: {e}")

    # ── 阶段 2: 镜像翻转 SW/W/NW ──
    state["stage"] = 2
    state["stage_name"] = "镜像"
    state["progress"] = 0.75
    add_log(state, "开始镜像翻转: E→W, SE→SW, NE→NW")

    for flip_dir, src_dir in FLIP_MAP.items():
        if state["assemble_status"].get(src_dir) != "done":
            state["flip_status"][flip_dir] = "error"
            add_log(state, f"跳过 {flip_dir} 镜像 — 源方向 {src_dir} 未完成")
            continue
        try:
            src_path = os.path.join(OUTPUT_DIR, monster_name, src_dir)
            dst_path = os.path.join(OUTPUT_DIR, monster_name, flip_dir)
            flip_direction(src_path, dst_path)
            state["assemble_status"][flip_dir] = "done"
            state["flip_status"][flip_dir] = "done"
            add_log(state, f"镜像完成: {src_dir} → {flip_dir}")
        except Exception as e:
            state["flip_status"][flip_dir] = "error"
            add_log(state, f"镜像失败 {flip_dir}: {e}")

    state["progress"] = 0.85

    check_all_assembled(pid)


# ─── API: 实时状态 (SSE) ───

@app.route("/api/pipeline/status/<pid>")
def pipeline_status(pid):
    if pid not in pipelines:
        return jsonify({"error": "管线不存在"}), 404

    def generate():
        last_log_len = 0
        while True:
            state = pipelines.get(pid)
            if not state:
                break

            payload = {
                "status": state["status"],
                "stage": state["stage"],
                "stage_name": state["stage_name"],
                "progress": state["progress"],
                "hero_path": state.get("hero_path"),
                "gen_status": state["gen_status"],
                "assemble_status": state["assemble_status"],
                "flip_status": state.get("flip_status", {}),
                "qa_result": state["qa_result"],
                "new_logs": state["log"][last_log_len:],
                "error": state["error"],
            }
            last_log_len = len(state["log"])
            yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

            if state["status"] in ("done", "error"):
                break
            time.sleep(0.8)

    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ─── API: 获取状态快照 ───

@app.route("/api/pipeline/state/<pid>")
def pipeline_state_snapshot(pid):
    if pid not in pipelines:
        return jsonify({"error": "管线不存在"}), 404
    state = pipelines[pid]
    return jsonify({
        "status": state["status"],
        "stage": state["stage"],
        "stage_name": state["stage_name"],
        "progress": state["progress"],
        "hero_path": state.get("hero_path"),
        "gen_status": state["gen_status"],
        "assemble_status": state["assemble_status"],
        "flip_status": state.get("flip_status", {}),
        "qa_result": state["qa_result"],
        "log": state["log"][-50:],
        "error": state["error"],
    })


# ─── API: 预览文件 ───

@app.route("/api/preview/<monster>/<path:filepath>")
def preview_file(monster, filepath):
    base = os.path.join(OUTPUT_DIR, monster)
    return send_from_directory(base, filepath)


# ─── API: 下载 ZIP ───

@app.route("/api/download/<monster>")
def download_zip(monster):
    zip_path = os.path.join(OUTPUT_DIR, f"{monster}.zip")
    if not os.path.isfile(zip_path):
        base_dir = os.path.join(OUTPUT_DIR, monster)
        if os.path.isdir(base_dir):
            create_zip(base_dir, zip_path)
        else:
            return jsonify({"error": "资产不存在"}), 404
    return send_file(zip_path, as_attachment=True, download_name=f"{monster}.zip")


# ─── API: 手动触发组装 ───

@app.route("/api/pipeline/assemble/<pid>/<direction>", methods=["POST"])
def trigger_assemble(pid, direction):
    if pid not in pipelines:
        return jsonify({"error": "管线不存在"}), 404

    state = pipelines[pid]
    if direction not in DIRS:
        return jsonify({"error": f"无效方向: {direction}"}), 400

    all_done = all(
        state["gen_status"].get(f"{direction}_{pk}") == "done"
        for pk in PAIR_KEYS
    )
    if not all_done:
        return jsonify({"error": f"{direction} 方向图片不完整"}), 400

    if state["assemble_status"].get(direction) in ("running", "done"):
        return jsonify({"ok": True, "msg": "已在处理中或已完成"})

    state["stage"] = 2
    state["stage_name"] = "动画"
    state["status"] = "running"

    t = threading.Thread(
        target=assemble_one_direction, args=(pid, direction), daemon=True
    )
    t.start()

    return jsonify({"ok": True})


# ─── API: 重试单个图像对 ───

@app.route("/api/pipeline/retry/<pid>/<direction>/<pair_key>", methods=["POST"])
def retry_pair(pid, direction, pair_key):
    if pid not in pipelines:
        return jsonify({"error": "管线不存在"}), 404

    state = pipelines[pid]
    state["gen_status"][f"{direction}_{pair_key}"] = "pending"
    state["assemble_status"][direction] = "pending"
    add_log(state, f"已重置 {direction}/{pair_key}，请重新上传")

    return jsonify({"ok": True})


# ─── API: 列出已有怪物 ───

@app.route("/api/monsters")
def list_monsters():
    monsters = []
    if os.path.isdir(OUTPUT_DIR):
        for name in os.listdir(OUTPUT_DIR):
            d = os.path.join(OUTPUT_DIR, name)
            if os.path.isdir(d):
                cfg_path = os.path.join(d, "monster_config.json")
                has_config = os.path.isfile(cfg_path)
                monsters.append({"name": name, "has_config": has_config})
    return jsonify(monsters)


# ─── API: 历史记录 ───

@app.route("/api/history")
def get_history():
    history = _load_history()
    return jsonify(history)


@app.route("/api/history/<entry_id>", methods=["DELETE"])
def delete_history_entry(entry_id):
    history = _load_history()
    history = [h for h in history if h["id"] != entry_id]
    _save_history(history)
    return jsonify({"ok": True})


# ─── API: 单独生成立绘 ───

@app.route("/api/generate-hero", methods=["POST"])
def generate_hero_only():
    """单独生成怪物立绘，不启动完整管线。

    可选字段 `upload_image_base64`：用户上传的 boss 参考图（纯 base64 或
    dataURL），保存后作为多模态 reference_image 喂给生成模型，用户选
    择 style=MATCH_REFERENCE 时还会保留原图画风。
    """
    import base64
    config = request.json
    monster_name = config.get("monster_name", f"hero_{uuid.uuid4().hex[:6]}")
    feature_lock = config.get("feature_lock", "")
    api_key = config.get("api_key", "")
    api_base = config.get("api_base", "")
    model = config.get("model", "nanobanana-pro")
    # style / angle 都允许空字符串——hero_gen 会根据是否有参考图自适应。
    style = config.get("style", "") or ""
    angle = config.get("angle", "") or ""
    hero_size = int(config.get("hero_size", 1024) or 1024)
    upscale = bool(config.get("upscale", False))
    upload_b64 = config.get("upload_image_base64", "") or ""

    # api_key 可以为空：image_gen._resolve_gemini_key 会自动回退到
    # LLM_PROXY_URL / env GEMINI_API_KEY / config/gemini-credentials.json，
    # 与其他管线凭证解析链保持一致，不再要求用户在 UI 手填。
    # 只要有上传图，即便 feature_lock 空也允许生成——图本身就是主要来源。
    if not feature_lock and not upload_b64:
        return jsonify({"error": "未提供怪物描述，也未上传参考图"}), 400

    reference_path = ""
    if upload_b64:
        # dataURL 前缀去掉，支持 image/png | image/jpeg | image/webp 等
        if upload_b64.startswith("data:"):
            comma = upload_b64.find(",")
            if comma >= 0:
                upload_b64 = upload_b64[comma + 1:]
        try:
            img_bytes = base64.b64decode(upload_b64)
        except Exception as e:
            return jsonify({"error": f"上传参考图解码失败: {e}"}), 400
        reference_path = os.path.join(TEMP_DIR, monster_name, "user_upload.png")
        os.makedirs(os.path.dirname(reference_path), exist_ok=True)
        with open(reference_path, "wb") as f:
            f.write(img_bytes)
        # feature_lock 空时给个最小兜底，让 prompt 不完全空白
        if not feature_lock:
            feature_lock = "boss monster — identity derived entirely from the attached reference image"

    try:
        hero_path = generate_hero(
            monster_name, feature_lock,
            api_key=api_key, model=model,
            api_base=api_base, style=style,
            reference_image=reference_path,
            angle=angle,
            hero_size=hero_size,
            upscale=upscale,
        )
        _add_history_entry(monster_name, hero_path, config)
        return jsonify({
            "ok": True,
            "monster_name": monster_name,
            "hero_url": f"/api/hero/{monster_name}",
            "from_upload": bool(reference_path),
            "hero_size": hero_size,
        })
    except Exception as e:
        return jsonify({"error": f"立绘生成失败: {e}"}), 500


# ─── API: 立绘图片 ───

@app.route("/api/hero/<monster>")
def serve_hero(monster):
    hero_path = os.path.join(OUTPUT_DIR, monster, "hero_512.png")
    if not os.path.isfile(hero_path):
        return jsonify({"error": "立绘不存在"}), 404
    return send_file(hero_path, mimetype="image/png")


# ─── 启动 ───

if __name__ == "__main__":
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    os.makedirs(TEMP_DIR, exist_ok=True)
    print("=" * 50)
    print("  怪物生成平台 V2")
    print("  http://localhost:5000")
    print("=" * 50)
    # 用 waitress 代替 Flask 自带的 werkzeug dev server：
    # werkzeug 在 debug=True + threaded=True + 长耗时 Gemini 请求（>=24s）
    # 场景下会随机 RST 套接字，前端看到 "代理错误: ECONNRESET: socket hang up"。
    # waitress 是生产级 WSGI，稳定处理长请求 / 并发 / 大 JSON。
    try:
        from waitress import serve
        print("  Using waitress (production WSGI)")
        print("=" * 50, flush=True)
        # channel_timeout=600 允许 10 分钟内 Gemini 生成不被提前切断；
        # threads=16 够同时跑立绘+序列帧+历史查询。
        serve(app, host="0.0.0.0", port=5000, threads=16, channel_timeout=600)
    except ImportError:
        print("  WARN: waitress 未安装，回退到 werkzeug dev server (可能 RST)", flush=True)
        app.run(host="0.0.0.0", port=5000, debug=False, threaded=True, use_reloader=False)
