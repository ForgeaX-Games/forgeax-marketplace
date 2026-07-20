"""
图像生成模块 — 支持多种 API 后端。

- nanobanana-pro: Google Gemini 3 Pro Image (generateContent 端点)
- dall-e-3: OpenAI DALL-E 3 (images/generations 端点)
- 其他 OpenAI-compatible 端点

凭证解析顺序（与 server/api-plugin.ts 保持一致，避免其他管线能出图、这个管线却
硬要用户手填 key 的割裂体验）：
  1. 请求里显式传来的 api_key（用户在 UI 填了就用这个）
  2. env LLM_PROXY_URL → 走公司 LLM 代理（推荐，无需 key）
  3. env GEMINI_API_KEY
  4. config/gemini-credentials.json（与 Node 端同一个文件）
"""
import os
import json
import base64
import time
import requests
from PIL import Image

from .config import TEMP_DIR

GEMINI_MODEL = "gemini-3-pro-image-preview"
GEMINI_DIRECT_ENDPOINT = (
    f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
)

# Cached after first resolution so we don't hit disk on every image.
_CACHED_GEMINI_KEY: "str | None" = None


def _read_gemini_key_from_config() -> str:
    """Read config/gemini-credentials.json the same way api-plugin.ts does."""
    candidates = [
        os.path.join(os.getcwd(), "config", "gemini-credentials.json"),
        "/app/config/gemini-credentials.json",
    ]
    extra = os.environ.get("GEMINI_CREDENTIALS_PATH")
    if extra:
        candidates.append(extra)
    for path in candidates:
        if os.path.isfile(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    raw = json.load(f)
                if isinstance(raw, dict) and raw.get("api_key"):
                    return raw["api_key"]
            except Exception:
                continue
    return ""


def _resolve_gemini_key(user_key: str = "") -> str:
    """Fallback chain: request → env → credentials file."""
    global _CACHED_GEMINI_KEY
    if user_key:
        return user_key
    if _CACHED_GEMINI_KEY is not None:
        return _CACHED_GEMINI_KEY
    env_key = os.environ.get("GEMINI_API_KEY", "").strip()
    _CACHED_GEMINI_KEY = env_key or _read_gemini_key_from_config()
    return _CACHED_GEMINI_KEY


def _llm_proxy_url() -> str:
    return os.environ.get("LLM_PROXY_URL", "").rstrip("/")


MAX_RETRIES = 3
RETRY_BACKOFF = [5, 15, 30]


def generate_image_api(prompt: str, api_key: str, output_path: str,
                       api_base: str = "",
                       model: str = "nanobanana-pro",
                       size: str = "1024x1024",
                       reference_image: str = "") -> str:
    """
    根据 model 类型分发到对应的 API 后端。
    内置自动重试：网络超时 / 5xx 错误会重试最多 3 次，指数退避。
    """
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    last_err = None
    for attempt in range(MAX_RETRIES):
        try:
            if model in ("nanobanana-pro", "gemini-3-pro-image-preview"):
                return _generate_gemini(prompt, api_key, output_path, reference_image=reference_image)
            else:
                return _generate_openai(prompt, api_key, output_path, api_base, model, size)
        except (requests.exceptions.Timeout,
                requests.exceptions.ConnectionError,
                requests.exceptions.ReadTimeout) as e:
            last_err = e
            wait = RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)]
            print(f"[Retry {attempt+1}/{MAX_RETRIES}] 网络超时/连接错误, {wait}s 后重试: {e}")
            time.sleep(wait)
        except requests.exceptions.HTTPError as e:
            if e.response is not None and e.response.status_code >= 500:
                last_err = e
                wait = RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)]
                print(f"[Retry {attempt+1}/{MAX_RETRIES}] 服务器 {e.response.status_code} 错误, {wait}s 后重试")
                time.sleep(wait)
            else:
                raise
    raise last_err


def _build_gemini_payload(prompt: str, reference_image: str) -> dict:
    parts = []

    if reference_image and os.path.isfile(reference_image):
        with open(reference_image, "rb") as f:
            img_data = base64.b64encode(f.read()).decode("utf-8")
        mime = "image/png"
        # Cheap sniff for JPEG so we don't mislabel jpeg uploads as png.
        with open(reference_image, "rb") as f:
            head = f.read(3)
        if head.startswith(b"\xff\xd8\xff"):
            mime = "image/jpeg"
        parts.append({"inlineData": {"mimeType": mime, "data": img_data}})
        parts.append({
            "text": (
                "Above is the DEFINITIVE character reference image (hero art). "
                "You MUST match this character's design EXACTLY: same colors, same proportions, "
                "same markings, same body shape, same accessories. "
                "Do NOT change any visual feature.\n\n"
                "IMPORTANT: The reference image shows a 3/4 view. The task below asks for a "
                "SPECIFIC DIRECTION (compass heading). You must rotate the character to face "
                "that exact direction as viewed from a top-down bird's eye camera. "
                "The direction is LOCKED — every pose in the output MUST face the same direction.\n\n"
                + prompt
            )
        })
    else:
        parts.append({"text": prompt})

    return {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
        },
    }


def _save_first_image_part(data: dict, output_path: str) -> str:
    for candidate in data.get("candidates", []):
        for part in candidate.get("content", {}).get("parts", []):
            inline = part.get("inlineData") or part.get("inline_data")
            if inline and inline.get("mimeType", "").startswith("image/"):
                img_bytes = base64.b64decode(inline["data"])
                with open(output_path, "wb") as f:
                    f.write(img_bytes)
                return output_path
    block_reason = (data.get("promptFeedback") or {}).get("blockReason", "")
    if block_reason:
        raise RuntimeError(f"Gemini 拒绝生成（{block_reason}），请调整描述或更换参考图")
    raise RuntimeError("Gemini API 未返回图片数据，请检查 prompt 或 API Key")


def _generate_gemini(prompt: str, api_key: str, output_path: str,
                     reference_image: str = "") -> str:
    """
    生成策略：
      1. 若配置了 LLM_PROXY_URL 且可达 → 走代理（无需客户端 key，与其他管线一致）。
      2. 否则用 _resolve_gemini_key(api_key) 直接打 Google generativelanguage API。
    """
    payload = _build_gemini_payload(prompt, reference_image)

    proxy_url = _llm_proxy_url()
    if proxy_url:
        url = f"{proxy_url}/v1/gemini/generateContent/{GEMINI_MODEL}"
        try:
            resp = requests.post(
                url,
                headers={"Content-Type": "application/json"},
                json=payload,
                timeout=180,
            )
            if resp.status_code == 200:
                return _save_first_image_part(resp.json(), output_path)
            # 非 2xx：记录并降级到直连
            print(
                f"[image_gen] LLM proxy returned {resp.status_code}, "
                f"falling back to direct Gemini API: {resp.text[:200]}"
            )
        except requests.exceptions.RequestException as e:
            print(f"[image_gen] LLM proxy unreachable ({e}), falling back to direct API")

    key = _resolve_gemini_key(api_key)
    if not key:
        raise RuntimeError(
            "未找到可用的 Gemini 凭证：既没配置 LLM_PROXY_URL，"
            "也没设置 GEMINI_API_KEY / config/gemini-credentials.json。"
        )
    resp = requests.post(
        f"{GEMINI_DIRECT_ENDPOINT}?key={key}",
        headers={"Content-Type": "application/json"},
        json=payload,
        timeout=180,
    )
    resp.raise_for_status()
    return _save_first_image_part(resp.json(), output_path)


def _generate_openai(prompt: str, api_key: str, output_path: str,
                     api_base: str, model: str, size: str) -> str:
    """调用 OpenAI-compatible images/generations 端点。"""
    if not api_base:
        api_base = "https://api.openai.com/v1"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "prompt": prompt,
        "n": 1,
        "size": size,
        "response_format": "url",
    }

    resp = requests.post(
        f"{api_base}/images/generations",
        headers=headers,
        json=payload,
        timeout=120,
    )
    resp.raise_for_status()
    data = resp.json()

    image_url = data["data"][0]["url"]
    img_resp = requests.get(image_url, timeout=60)
    img_resp.raise_for_status()

    with open(output_path, "wb") as f:
        f.write(img_resp.content)

    return output_path


def save_uploaded_image(file_bytes: bytes, output_path: str) -> str:
    """保存用户上传的图片。"""
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(file_bytes)
    return output_path


def get_raw_image_path(monster_name: str, direction: str, pair_key: str) -> str:
    """返回原始图片（去背景前）的标准存储路径。"""
    return os.path.join(TEMP_DIR, monster_name, "raw", direction, f"{pair_key}.png")


def get_nobg_image_path(monster_name: str, direction: str, pair_key: str) -> str:
    """返回去背景后图片的标准存储路径。"""
    return os.path.join(TEMP_DIR, monster_name, "nobg", direction, f"{pair_key}.png")
