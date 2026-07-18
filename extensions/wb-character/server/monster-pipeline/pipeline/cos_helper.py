"""
Object-storage upload helper (qcloud-cos compatible).

Uploads local images and returns a presigned URL for the
optional remote bg-removal API. Falls back to local rembg
when credentials are absent.
"""
import os
import time
import logging
from typing import Optional

from qcloud_cos import CosConfig, CosS3Client

log = logging.getLogger(__name__)

_client: Optional[CosS3Client] = None
_config_cache: Optional[dict] = None


def _load_config() -> dict:
    global _config_cache
    if _config_cache:
        return _config_cache

    import json
    cred_path = os.environ.get("COS_CREDENTIALS", "config/cos-credentials.json")
    with open(cred_path, "r", encoding="utf-8") as f:
        creds = json.load(f)

    _config_cache = {
        "secret_id": creds["secret_id"],
        "secret_key": creds["secret_key"],
        "bucket": creds["bucket"],
        "region": creds.get("region", "ap-guangzhou"),
    }
    return _config_cache


def _get_client() -> CosS3Client:
    global _client
    if _client:
        return _client

    cfg = _load_config()
    cos_config = CosConfig(
        Region=cfg["region"],
        SecretId=cfg["secret_id"],
        SecretKey=cfg["secret_key"],
    )
    _client = CosS3Client(cos_config)
    log.info("COS client initialized, bucket=%s, region=%s", cfg["bucket"], cfg["region"])
    return _client


def upload_file(local_path: str, key_prefix: str = "LightAI_input") -> str:
    """
    上传本地文件到 COS，返回公开可访问的 URL。
    """
    cfg = _load_config()
    client = _get_client()
    ext = os.path.splitext(local_path)[1] or ".png"
    cos_key = f"{key_prefix}_{int(time.time() * 1000)}{ext}"

    client.upload_file(
        Bucket=cfg["bucket"],
        Key=cos_key,
        LocalFilePath=local_path,
    )
    log.info("Uploaded %s -> cos://%s/%s", local_path, cfg["bucket"], cos_key)

    url = client.get_presigned_url(
        Method="GET",
        Bucket=cfg["bucket"],
        Key=cos_key,
        Expired=100 * 365 * 24 * 3600,
    )
    return url


def upload_bytes(data: bytes, key_prefix: str = "LightAI_input", ext: str = ".png") -> str:
    """
    上传字节流到 COS，返回公开可访问的 URL。
    """
    cfg = _load_config()
    client = _get_client()
    cos_key = f"{key_prefix}_{int(time.time() * 1000)}{ext}"

    client.put_object(
        Bucket=cfg["bucket"],
        Key=cos_key,
        Body=data,
    )
    log.info("Uploaded bytes -> cos://%s/%s (%d bytes)", cfg["bucket"], cos_key, len(data))

    url = client.get_presigned_url(
        Method="GET",
        Bucket=cfg["bucket"],
        Key=cos_key,
        Expired=100 * 365 * 24 * 3600,
    )
    return url
