"""百度在线翻译客户端：支持命令行单次翻译和 Electron 常驻服务模式。"""

import argparse
import base64
import hashlib
import json
import sys
import time

import requests
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad

if hasattr(sys.stdin, "reconfigure"):
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

INDEX_URL = "https://fanyi.baidu.com/"
TRANS_URL = "https://fanyi.baidu.com/ait/text/translate"
REFERER = "https://fanyi.baidu.com/mtpe-individual/transText"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)

ACS_KEY = "kwoigaeecyumqcya"
ACS_IV = "1234567887654321"
ACS_PREFIX = "1777312805494"


def _to_base32(num: int) -> str:
    if num == 0:
        return "0"
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    result = ""
    while num > 0:
        result = digits[num % 32] + result
        num //= 32
    return result


def _aes_encrypt(data: str) -> str:
    cipher = AES.new(ACS_KEY.encode(), AES.MODE_CBC, ACS_IV.encode())
    encrypted = cipher.encrypt(pad(data.encode(), 16))
    return base64.b64encode(encrypted).decode()


def _make_acs_token(session: requests.Session, client_time: int) -> str:
    baiduid = session.cookies.get("BAIDUID", "")
    salt_head = f"if2glnrf99c{_to_base32(client_time)}"
    salt = f"{salt_head}___false_0__0"
    d78 = int(hashlib.sha1(salt.encode()).hexdigest()[:4], 16)
    payload = (
        f'{{"d0":"{salt_head}","ua":"{USER_AGENT}","baiduid":"{baiduid}",'
        f'"platform":"Win32","d23":1,"hfe":"","d1":"","d2":0,"d420":0,'
        f'"clientTs":{client_time},"version":"1.4.0.3","extra":"","odkp":0,'
        f'"hf":"","d78":{d78},"h0":false,"h1":0}}'
    )
    return f"{ACS_PREFIX}_{client_time}_{_aes_encrypt(payload)}"


def _parse_sse(text: str) -> list[dict]:
    messages = []
    for line in text.splitlines():
        if line.startswith("data:"):
            messages.append(json.loads(line[5:].strip()))
    return messages


def _extract_translation(messages: list[dict]) -> str:
    parts: list[str] = []
    for msg in messages:
        if msg.get("errno") not in (0, None):
            raise RuntimeError(msg.get("errmsg") or f"接口错误: {msg.get('errno')}")

        data = msg.get("data") or {}
        if data.get("event") != "Translating":
            continue

        for item in data.get("list") or []:
            dst = (item.get("dst") or "").strip()
            if dst:
                parts.append(dst)

    if not parts:
        raise RuntimeError("未获取到翻译结果，请稍后重试")
    return "\n".join(parts)


class BaiduTranslator:
    def __init__(self) -> None:
        self.session = requests.Session()
        self.headers = {
            "User-Agent": USER_AGENT,
            "Referer": REFERER,
            "Origin": "https://fanyi.baidu.com",
            "Accept-Language": "zh-CN,zh;q=0.9",
        }
        self._ready = False

    def _request(self, method: str, url: str, **kwargs) -> requests.Response:
        last_error: Exception | None = None
        headers = {**self.headers, **kwargs.pop("headers", {})}
        for attempt in range(3):
            try:
                fn = self.session.get if method == "GET" else self.session.post
                return fn(url, headers=headers, timeout=30, **kwargs)
            except requests.RequestException as exc:
                last_error = exc
                if attempt < 2:
                    time.sleep(1.5)
        raise last_error  # type: ignore[misc]

    def _warm_up(self) -> None:
        if self._ready:
            return
        try:
            self._request("GET", "https://www.baidu.com/")
        except requests.RequestException:
            pass
        self._request("GET", INDEX_URL)
        self._ready = True

    def translate(self, text: str) -> str:
        text = text.strip()
        if not text:
            raise ValueError("输入内容不能为空")

        self._warm_up()

        start_time = int(time.time() * 1000)
        acs_token = _make_acs_token(self.session, start_time + 3001)

        response = self._request(
            "POST",
            TRANS_URL,
            json={
                "query": text,
                "from": "zh",
                "to": "en",
                "reference": "",
                "corpusIds": [],
                "needPhonetic": False,
                "domain": "common",
                "detectLang": "",
                "milliTimestamp": start_time + 1,
            },
            headers={
                **self.headers,
                "Content-Type": "application/json",
                "Acs-Token": acs_token,
            },
        )
        response.raise_for_status()
        return _extract_translation(_parse_sse(response.text))


def translate_text(text: str) -> str:
    translator = BaiduTranslator()
    return translator.translate(text)


def translate_once(text: str) -> int:
    try:
        print(translate_text(text), flush=True)
        return 0
    except requests.RequestException as exc:
        print(f"网络错误: {exc}", file=sys.stderr, flush=True)
    except Exception as exc:
        print(f"翻译失败: {exc}", file=sys.stderr, flush=True)
    return 1


def _write_json_line(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def serve() -> None:
    translator = BaiduTranslator()

    for line in sys.stdin:
        payload: dict = {}
        try:
            payload = json.loads(line)
            request_id = payload.get("id")
            text = str(payload.get("text") or "")

            result = translator.translate(text)
            _write_json_line({"id": request_id, "ok": True, "result": result})
        except requests.RequestException as exc:
            _write_json_line({"id": payload.get("id"), "ok": False, "error": f"网络错误: {exc}"})
        except Exception as exc:
            request_id = payload.get("id")
            _write_json_line({"id": request_id, "ok": False, "error": f"翻译失败: {exc}"})


def main() -> None:
    parser = argparse.ArgumentParser(description="百度翻译（中文 -> 英文）")
    parser.add_argument("--text", help="要翻译的中文文本；传入后只执行一次并输出英文结果")
    parser.add_argument("--serve", action="store_true", help="以常驻进程模式运行，通过 stdin/stdout 接收 JSON 行")
    args = parser.parse_args()

    if args.serve:
        serve()
        return

    if args.text is not None:
        raise SystemExit(translate_once(args.text))

    print("百度翻译（中文 -> 英文）")
    print("输入中文后回车翻译，直接回车退出\n")

    translator = BaiduTranslator()

    while True:
        try:
            text = input("请输入中文: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n已退出")
            break

        if not text:
            print("已退出")
            break

        try:
            result = translator.translate(text)
            print(f"英文: {result}\n")
        except requests.RequestException as exc:
            print(f"网络错误: {exc}\n")
        except Exception as exc:
            print(f"翻译失败: {exc}\n")


if __name__ == "__main__":
    main()
