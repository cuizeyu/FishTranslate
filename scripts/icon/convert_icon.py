from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
BUILD_DIR = ROOT / "build"
RESOURCES_DIR = ROOT / "resources"
SOURCE = BUILD_DIR / "icon.png"
BUILD_PNG = BUILD_DIR / "icon.png"
RESOURCE_PNG = RESOURCES_DIR / "icon.png"
ICON = BUILD_DIR / "icon.ico"
MAC_ICON = BUILD_DIR / "icon.icns"

ICO_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
ICNS_SIZES = [(16, 16), (32, 32), (64, 64), (128, 128), (256, 256), (512, 512), (1024, 1024)]


def make_square(image: Image.Image) -> Image.Image:
    width, height = image.size
    side = max(width, height)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.alpha_composite(image, ((side - width) // 2, (side - height) // 2))
    return canvas


def main() -> None:
    if not SOURCE.exists():
        raise FileNotFoundError(f"Icon source not found: {SOURCE}")

    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    RESOURCES_DIR.mkdir(parents=True, exist_ok=True)

    with Image.open(SOURCE) as raw:
        image = make_square(raw.convert("RGBA"))
        image.save(BUILD_PNG, format="PNG")
        image.save(RESOURCE_PNG, format="PNG")
        image.save(ICON, format="ICO", sizes=ICO_SIZES)
        image.save(MAC_ICON, format="ICNS", sizes=ICNS_SIZES)

    print(f"Generated PNG: {BUILD_PNG}")
    print(f"Generated PNG: {RESOURCE_PNG}")
    print(f"Generated ICO: {ICON}")
    print(f"Generated ICNS: {MAC_ICON}")


if __name__ == "__main__":
    main()
