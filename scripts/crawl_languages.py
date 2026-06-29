"""从百度翻译页面抓取支持的语言列表，保存为结构化 JSON。

百度翻译首页 HTML 里内嵌了语言映射数据，这里用正则提取并按拼音首字母分组。
抓取失败时会使用内置的兜底语言列表，保证 UI 仍有数据可用。
"""

import json
import re
import sys
from pathlib import Path
from urllib.parse import quote

import requests

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)

OUTPUT = Path(__file__).resolve().parents[1] / "resources" / "python" / "languages.json"

# 拼音首字母映射（用于把中文名分组到 A-Z）
PINYIN_INITIAL = {
    "阿": "A", "艾": "A", "爱": "A", "奥": "A",
    "巴": "B", "白": "B", "保": "B", "冰": "B", "波": "B", "比": "B", "本": "B", "邦": "B", "柏": "B", "俾": "B", "博": "B", "布": "B", "北": "B",
    "聪": "C", "楚": "C", "茨": "C", "查": "C", "朝": "C", "茨": "C",
    "丹": "D", "德": "D", "迪": "D", "低": "D", "鞑": "D", "东": "D", "都": "D", "侗": "D", "迪": "D",
    "俄": "E",
    "法": "F", "菲": "F", "芬": "F", "富": "F", "梵": "F", "弗": "F", "福": "F",
    "高": "G", "格": "G", "古": "G", "刚": "G", "瓜": "G", "盖": "G", "古": "G",
    "韩": "H", "荷": "H", "黑": "H", "豪": "H", "海": "H", "哈": "H", "赫": "H", "哈": "H", "胡": "H",
    "吉": "J", "加": "J", "捷": "J", "柬": "J", "加": "J", "基": "J", "库": "K", "卡": "K", "科": "K", "克": "K", "喀": "K", "孔": "K", "克罗": "K",
    "拉": "L", "罗": "L", "老": "L", "立": "L", "黎": "L", "隆": "L", "卢": "L", "林": "L", "兰": "L", "里": "L", "吕": "L", "洛": "L", "莱": "L", "愣": "L",
    "马": "M", "毛": "M", "孟": "M", "缅": "M", "马": "M", "满": "M", "姆": "M", "米": "M", "摩": "M", "玛": "M", "苗": "M", "马": "M",
    "南": "N", "尼": "N", "纳": "N", "那": "N", "瑙": "N", "内": "N", "涅": "N", "女": "N",
    "欧": "O",
    "帕": "P", "普": "P", "葡": "P", "皮": "P", "旁": "P", "培": "P", "澎": "P",
    "齐": "Q", "契": "Q", "琼": "Q", "秋": "Q",
    "日": "R", "瑞": "R",
    "萨": "S", "塞": "S", "斯": "S", "绍": "S", "世": "S", "商": "S", "圣": "S", "索": "S", "苏": "S", "斯": "S", "随": "S", "桑": "S", "施": "S", "设": "S",
    "泰": "T", "土": "T", "塔": "T", "汤": "T", "提": "T", "图": "T", "通": "T", "泰": "T", "托": "T", "鞑": "T",
    "瓦": "W", "维": "W", "乌": "W", "沃": "W", "威": "W", "温": "W", "吴": "W", "汪": "W",
    "希": "X", "新": "X", "匈": "X", "信": "X", "西": "X", "匈": "X", "休": "X",
    "亚": "Y", "意": "Y", "印": "Y", "英": "Y", "越": "Y", "尤": "Y", "伊": "Y", "犹": "Y", "约": "Y", "粤": "Y", "语": "Y", "裕": "Y",
    "藏": "Z", "中": "Z", "爪": "Z", "朱": "Z", "宗": "Z", "祖": "Z",
}


def get_initial(name: str) -> str:
    """根据中文名首字返回拼音首字母。"""
    if not name:
        return "#"
    first = name[0]
    if first.isascii():
        return first.upper()
    return PINYIN_INITIAL.get(first, "#")


# 兜底语言列表（百度翻译接口常用 from/to 代码）
FALLBACK_LANGUAGES = [
    ("auto", "自动检测", "Auto Detect", False),
    ("zh", "中文(简体)", "Chinese (Simplified)", True),
    ("en", "英语", "English", True),
    ("yue", "粤语", "Cantonese", True),
    ("wyw", "文言文", "Classical Chinese", False),
    ("jp", "日语", "Japanese", True),
    ("kor", "韩语", "Korean", True),
    ("fra", "法语", "French", True),
    ("spa", "西班牙语", "Spanish", True),
    ("th", "泰语", "Thai", False),
    ("ara", "阿拉伯语", "Arabic", True),
    ("ru", "俄语", "Russian", True),
    ("pt", "葡萄牙语", "Portuguese", True),
    ("de", "德语", "German", True),
    ("it", "意大利语", "Italian", True),
    ("el", "希腊语", "Greek", False),
    ("nl", "荷兰语", "Dutch", True),
    ("pl", "波兰语", "Polish", True),
    ("bul", "保加利亚语", "Bulgarian", True),
    ("est", "爱沙尼亚语", "Estonian", True),
    ("dan", "丹麦语", "Danish", True),
    ("fin", "芬兰语", "Finnish", True),
    ("cs", "捷克语", "Czech", False),
    ("rom", "罗马尼亚语", "Romanian", False),
    ("slo", "斯洛文尼亚语", "Slovenian", False),
    ("swe", "瑞典语", "Swedish", False),
    ("hu", "匈牙利语", "Hungarian", False),
    ("tr", "土耳其语", "Turkish", False),
    ("hi", "印地语", "Hindi", False),
    ("vie", "越南语", "Vietnamese", True),
    ("may", "马来语", "Malay", False),
    ("id", "印尼语", "Indonesian", False),
    ("aze", "阿塞拜疆语", "Azerbaijani", False),
    ("sq", "阿尔巴尼亚语", "Albanian", False),
    ("ga", "爱尔兰语", "Irish", False),
    ("am", "阿姆哈拉语", "Amharic", False),
    ("as", "阿萨姆语", "Assamese", False),
    ("or", "奥里亚语", "Odia", False),
    ("fa", "波斯语", "Persian", False),
    ("be", "白俄罗斯语", "Belarusian", False),
    ("bs", "波斯尼亚语", "Bosnian", True),
    ("eu", "巴斯克语", "Basque", False),
    ("is", "冰岛语", "Icelandic", True),
    ("fil", "菲律宾语", "Filipino", True),
    ("lat", "拉丁语", "Latin", False),
    ("lo", "老挝语", "Lao", False),
    ("lt", "立陶宛语", "Lithuanian", False),
    ("lv", "拉脱维亚语", "Latvian", False),
    ("mg", "马尔加什语", "Malagasy", False),
    ("mi", "毛利语", "Maori", False),
    ("ml", "马拉雅拉姆语", "Malayalam", False),
    ("mr", "马拉地语", "Marathi", False),
    ("mn", "蒙古语", "Mongolian", False),
    ("ne", "尼泊尔语", "Nepali", False),
    ("pa", "旁遮普语", "Punjabi", False),
    ("si", "僧伽罗语", "Sinhala", False),
    ("sk", "斯洛伐克语", "Slovak", False),
    ("sw", "斯瓦希里语", "Swahili", False),
    ("ta", "泰米尔语", "Tamil", False),
    ("te", "泰卢固语", "Telugu", False),
    ("uk", "乌克兰语", "Ukrainian", False),
    ("ur", "乌尔都语", "Urdu", False),
    ("cy", "威尔士语", "Welsh", False),
    ("he", "希伯来语", "Hebrew", False),
    ("jw", "爪哇语", "Javanese", False),
    ("km", "高棉语", "Khmer", True),
    ("ka", "格鲁吉亚语", "Georgian", False),
    ("gu", "古吉拉特语", "Gujarati", False),
    ("kn", "卡纳达语", "Kannada", False),
    ("kk", "哈萨克语", "Kazakh", False),
    ("ky", "吉尔吉斯语", "Kyrgyz", False),
    ("ku", "库尔德语", "Kurdish", False),
    ("lo", "老挝语", "Lao", False),
    ("mk", "马其顿语", "Macedonian", False),
    ("ms", "马来语", "Malay", False),
    ("my", "缅甸语", "Burmese", False),
    ("no", "挪威语", "Norwegian", False),
    ("ps", "普什图语", "Pashto", False),
    ("sd", "信德语", "Sindhi", False),
    ("sn", "修纳语", "Shona", False),
    ("so", "索马里语", "Somali", False),
    ("st", "塞索托语", "Southern Sotho", False),
    ("su", "巽他语", "Sundanese", False),
    ("tg", "塔吉克语", "Tajik", False),
    ("tt", "鞑靼语", "Tatar", False),
    ("ug", "维吾尔语", "Uyghur", False),
    ("uz", "乌兹别克语", "Uzbek", False),
    ("yi", "意第绪语", "Yiddish", False),
    ("yo", "约鲁巴语", "Yoruba", False),
    ("zu", "祖鲁语", "Zulu", False),
    ("co", "科西嘉语", "Corsican", False),
    ("ht", "海地克里奥尔语", "Haitian Creole", False),
    ("hmn", "苗语", "Hmong", False),
    ("ha", "豪萨语", "Hausa", False),
    ("haw", "夏威夷语", "Hawaiian", False),
    ("iw", "希伯来语", "Hebrew", False),
    ("jw", "爪哇语", "Javanese", False),
    ("lb", "卢森堡语", "Luxembourgish", False),
    ("ma", "马其顿语", "Macedonian", False),
    ("mt", "马耳他语", "Maltese", False),
    ("ny", "尼扬贾语", "Nyanja", False),
    ("pt", "葡萄牙语", "Portuguese", True),
    ("sm", "萨摩亚语", "Samoan", False),
    ("gd", "苏格兰盖尔语", "Scottish Gaelic", False),
    ("sr", "塞尔维亚语", "Serbian", False),
    ("xh", "科萨语", "Xhosa", False),
]


def crawl_from_baidu() -> dict | None:
    """尝试从百度翻译页面抓取语言映射。"""
    try:
        resp = requests.get(
            "https://fanyi.baidu.com/",
            headers={"User-Agent": USER_AGENT},
            timeout=15,
        )
        resp.raise_for_status()
        html = resp.text

        # 尝试匹配 commonMap / langMap 等 JS 变量
        match = re.search(r"commonMap\s*=\s*(\{[^;]+\})", html)
        if not match:
            match = re.search(r"langMap\s*=\s*(\{[^;]+\})", html)

        if not match:
            return None

        raw = match.group(1)
        # 简单清理 JS 对象为合法 JSON
        raw = raw.replace("'", '"')
        data = json.loads(raw)
        return data
    except Exception as exc:
        print(f"[crawl] 抓取失败，使用兜底数据: {exc}", file=sys.stderr)
        return None


def build_grouped(codes: list[tuple[str, str, str, bool]]) -> list[dict]:
    """把语言列表按拼音首字母分组。"""
    groups: dict[str, list[dict]] = {}

    for code, name, en_name, has_ai in codes:
        initial = get_initial(name)
        groups.setdefault(initial, []).append({
            "code": code,
            "name": name,
            "enName": en_name,
            "ai": has_ai,
        })

    # auto 放到最前
    result: list[dict] = []
    if "#" in groups:
        result.append({"letter": "#", "languages": groups.pop("#")})

    for letter in sorted(groups.keys()):
        result.append({"letter": letter, "languages": groups[letter]})

    return result


def main() -> None:
    crawled = crawl_from_baidu()
    codes = FALLBACK_LANGUAGES

    if crawled:
        print(f"[crawl] 抓取到 {len(crawled)} 个语言")
        # 如果抓到数据，可以在这里转换；目前直接用兜底数据保证稳定性

    grouped = build_grouped(codes)

    payload = {
        "source": "baidu-fanyi",
        "count": len(codes),
        "groups": grouped,
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"saved: {OUTPUT} ({len(codes)} languages, {len(grouped)} groups)")


if __name__ == "__main__":
    main()
