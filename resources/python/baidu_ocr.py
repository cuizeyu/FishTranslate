"""百度文字识别常驻服务：通过 stdin/stdout JSON 行协议接收图片，返回识别文本。

凭证从同目录下的 baidu_ocr_creds.json 读取：
{
  "apiKey": "你的 API Key",
  "secretKey": "你的 Secret Key"
}

协议：
  请求:  {"id": 1, "image": "<base64 编码的图片>", "language": "CHN_ENG"}
  响应:  {"id": 1, "ok": true, "text": "识别到的文本"}
         {"id": 1, "ok": false, "error": "错误信息"}
"""

import base64
import json
import os
import sys
import time

import requests

if hasattr(sys.stdin, "reconfigure"):
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

TOKEN_URL = "https://aip.baidubce.com/oauth/2.0/token"
OCR_URL = "https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)


def _load_credentials():
    creds_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "baidu_ocr_creds.json")
    if not os.path.exists(creds_path):
        raise RuntimeError("未找到 OCR 凭证文件 baidu_ocr_creds.json，请在 resources/python/ 下创建。")
    with open(creds_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    api_key = data.get("apiKey") or data.get("api_key")
    secret_key = data.get("secretKey") or data.get("secret_key")
    if not api_key or not secret_key:
        raise RuntimeError("baidu_ocr_creds.json 中缺少 apiKey / secretKey。")
    return api_key, secret_key


class OcrClient:
    def __init__(self):
        self._api_key, self._secret_key = _load_credentials()
        self._token = None
        self._token_expires_at = 0.0

    def _ensure_token(self):
        # 提前 5 分钟刷新
        if self._token and time.time() < self._token_expires_at - 300:
            return self._token
        resp = requests.post(
            TOKEN_URL,
            params={
                "grant_type": "client_credentials",
                "client_id": self._api_key,
                "client_secret": self._secret_key,
            },
            headers={"User-Agent": USER_AGENT},
            timeout=15,
        )
        data = resp.json()
        token = data.get("access_token")
        if not token:
            raise RuntimeError(f"获取 access_token 失败: {data}")
        self._token = token
        self._token_expires_at = time.time() + float(data.get("expires_in", 2592000))
        return token

    def recognize(self, image_base64: str, language: str = "CHN_ENG") -> str:
        token = self._ensure_token()
        payload = {
            "image": image_base64,
            "language_type": language,
            "detect_direction": "false",
            "paragraph": "false",
        }
        resp = requests.post(
            OCR_URL,
            params={"access_token": token},
            data=payload,
            headers={"User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded"},
            timeout=30,
        )
        data = resp.json()
        # token 过期错误码 110/111，重试一次
        if data.get("error_code") in (110, 111):
            self._token = None
            token = self._ensure_token()
            resp = requests.post(
                OCR_URL,
                params={"access_token": token},
                data=payload,
                headers={"User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded"},
                timeout=30,
            )
            data = resp.json()

        if data.get("error_code"):
            raise RuntimeError(f"OCR 失败: {data.get('error_code')} {data.get('error_msg')}")

        words_result = data.get("words_result") or []
        lines = [item.get("words", "") for item in words_result]
        return "\n".join(lines)


def serve():
    client = OcrClient()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as e:
            sys.stdout.write(json.dumps({"id": 0, "ok": False, "error": f"无效请求: {e}"}) + "\n")
            sys.stdout.flush()
            continue

        req_id = req.get("id", 0)
        image = req.get("image", "")
        language = req.get("language", "CHN_ENG")
        try:
            text = client.recognize(image, language)
            sys.stdout.write(json.dumps({"id": req_id, "ok": True, "text": text}, ensure_ascii=False) + "\n")
        except Exception as e:  # noqa: BLE001
            sys.stdout.write(json.dumps({"id": req_id, "ok": False, "error": str(e)}, ensure_ascii=False) + "\n")
        sys.stdout.flush()


def main():
    import argparse

    parser = argparse.ArgumentParser(description="百度文字识别")
    parser.add_argument("--serve", action="store_true", help="常驻服务模式")
    parser.add_argument("--image", help="单次识别：图片路径")
    parser.add_argument("--language", default="CHN_ENG", help="语言类型，默认 CHN_ENG")
    args = parser.parse_args()

    if args.serve:
        serve()
        return

    if args.image:
        with open(args.image, "rb") as f:
            image_base64 = base64.b64encode(f.read()).decode("ascii")
        client = OcrClient()
        print(client.recognize(image_base64, args.language))
        return

    parser.print_help()


if __name__ == "__main__":
    main()
