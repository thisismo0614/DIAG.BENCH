#!/usr/bin/env python3
"""website/scripts/build-font-subset.py

Pretendard Variable에서 이 사이트에 필요한 글자만 추려 자체 호스팅용 woff2를 만든다.
결과: website/public/fonts/pretendard-subset.woff2

왜 직접 만드는가 — 배포되는 다른 방식들이 전부 이 사이트에 안 맞았다:

    전체 가변 1파일          2,009 KB   너무 크다
    가변 동적 서브셋         966 KB     34개 파일이 따로 도착해 본문 글꼴이 여러 번 바뀐다
    정적 400+700 동적서브셋   838 KB     같은 문제 + 굵기 제한
    Pretendard Std           285 KB     ⚠ **라틴 전용이다. 한글이 없다.**
                                        커버리지 검사로 잡았다(check-font-coverage.js).

    이 스크립트               ~200 KB    한 파일. 조각나서 도착하지 않는다.

담는 글자:
  1. KS X 1001 상용 한글 2350자 — euc-kr로 인코딩되는 음절이 정확히 이 집합이다.
     본문에 쓰인 글자만 넣으면 나중에 글을 추가할 때 없는 글자가 대체 글꼴로 튄다.
     한 문장 안에서 글꼴이 섞이면 눈에 띄므로 여유를 둔다.
  2. dist/*.html에 실제로 쓰인 글자 — 1번을 벗어나는 것이 있으면 함께 담는다.
  3. 라틴·숫자·문장부호 — 제품명, 명령어, 수치에 쓰인다.

실행 (Python 3 + fonttools + brotli 필요):
    pip install fonttools brotli
    python website/scripts/build-font-subset.py

원본 글꼴은 SIL Open Font License 1.1이다. THIRD-PARTY-NOTICES.md에 고지되어 있다.
"""

import os
import re
import subprocess
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.dirname(HERE)
DIST = os.path.join(WEB, "dist")
FONT_DIR = os.path.join(WEB, "public", "fonts")
# ⚠ 원본(2 MB)은 public/ 바깥에 둔다. build.js가 public/ 전체를 dist로 복사하기 때문에,
#   여기 두면 서브셋을 만든 의미 없이 원본까지 배포된다.
CACHE = os.path.join(WEB, ".cache")
SRC = os.path.join(CACHE, "PretendardVariable.woff2")
OUT = os.path.join(FONT_DIR, "diagbench-sans.woff2")

# OFL 1.1: 개조본에 예약 글꼴 이름("Pretendard")을 쓸 수 없다. 서브셋도 개조본이다.
# 이 이름을 styles.css의 font-family와도 맞춰야 한다.
FAMILY = "DIAGBENCH Sans"

UPSTREAM = (
    "https://raw.githubusercontent.com/orioncactus/pretendard/v1.3.9/"
    "packages/pretendard/dist/web/variable/woff2/PretendardVariable.woff2"
)


def ksx1001_syllables():
    """KS X 1001 상용 한글 2350자.

    ⚠ euc-kr을 쓰면 안 된다. CPython의 euc_kr 코덱은 UHC 확장까지 받아들여
      한글 음절 11,172자가 **전부** 통과한다(실제로 그렇게 만들었다가 결과물이
      1,680 KB가 나왔다). iso2022_kr이 KS X 1001만 인코딩한다.
    """
    out = set()
    for cp in range(0xAC00, 0xD7A4):
        ch = chr(cp)
        try:
            ch.encode("iso2022_kr")
        except UnicodeEncodeError:
            continue
        out.add(ch)
    assert len(out) == 2350, f"KS X 1001은 2350자여야 하는데 {len(out)}자다"
    return out


def chars_used_in_site():
    """빌드된 페이지에서 화면에 실제로 보이는 글자만 모은다."""
    out = set()
    if not os.path.isdir(DIST):
        print(f"[font] ⚠ {DIST} 가 없다. 먼저 `node build.js`를 실행할 것.")
        return out
    for name in os.listdir(DIST):
        if not name.endswith(".html"):
            continue
        with open(os.path.join(DIST, name), encoding="utf-8") as f:
            html = f.read()
        # 구조화 데이터와 스타일은 화면에 보이지 않는다
        html = re.sub(r"<script[\s\S]*?</script>", " ", html)
        html = re.sub(r"<style[\s\S]*?</style>", " ", html)
        html = re.sub(r"<[^>]+>", " ", html)
        out |= set(html)
    return {c for c in out if ord(c) > 32}


def main():
    os.makedirs(FONT_DIR, exist_ok=True)
    os.makedirs(CACHE, exist_ok=True)

    if not os.path.exists(SRC):
        print(f"[font] 원본 내려받는 중… ({UPSTREAM.rsplit('/', 1)[-1]})")
        urllib.request.urlretrieve(UPSTREAM, SRC)
    print(f"[font] 원본 {os.path.getsize(SRC) / 1024:,.0f} KB")

    ksx = ksx1001_syllables()
    used = chars_used_in_site()
    latin = set(chr(c) for c in range(0x20, 0x7F))
    # 본문에 쓰는 기호들 — 가운뎃점, 화살표, 따옴표, 줄표, 통화기호 등
    extra = set("·—–…“”‘’→←↑↓×÷±°′″©®™§¶•‧「」『』〈〉《》【】₩№")

    chars = ksx | used | latin | extra
    outside = sorted(c for c in used if c not in ksx and ord(c) >= 0xAC00 and ord(c) <= 0xD7A3)
    if outside:
        print(f"[font] KS X 1001을 벗어난 한글 {len(outside)}자도 함께 담는다: {''.join(outside)}")

    text = "".join(sorted(chars))
    print(f"[font] 담을 글자 {len(chars):,}자 (상용 {len(ksx):,} + 본문 {len(used):,} 합집합)")

    from fontTools import subset
    from fontTools.ttLib import TTFont
    from fontTools.varLib import instancer

    font = TTFont(SRC)

    opts = subset.Options()
    opts.layout_features = ["kern", "liga", "calt"]
    opts.hinting = False
    opts.desubroutinize = True
    opts.name_IDs = [1, 2, 3, 4, 6]
    opts.notdef_outline = True
    opts.drop_tables += ["DSIG"]

    sub = subset.Subsetter(options=opts)
    sub.populate(text=text)
    sub.subset(font)

    # 가변 축을 사이트가 실제로 쓰는 범위로 좁힌다.
    # 원본 wght 축은 45~930인데 이 사이트는 400(본문)~700(제목)만 쓴다.
    # 쓰지 않는 구간의 델타 데이터를 들고 다닐 이유가 없다.
    axes = {a.axisTag: (a.minValue, a.maxValue) for a in font["fvar"].axes}
    if "wght" in axes:
        font = instancer.instantiateVariableFont(font, {"wght": (400, 700)}, updateFontNames=False)

    # OFL 1.1의 예약 글꼴 이름(Reserved Font Name) 조항 —
    # 개조본(서브셋도 개조본이다)에 "Pretendard"라는 이름을 쓸 수 없다.
    # 글꼴 내부 name 테이블과 CSS의 font-family를 모두 다른 이름으로 바꾼다.
    # (저작권 고지는 THIRD-PARTY-NOTICES.md에 남긴다 — 이름을 바꾼다고 고지 의무가 없어지지 않는다.)
    name = font["name"]
    for nid, value in ((1, FAMILY), (4, FAMILY), (6, FAMILY.replace(" ", "")), (16, FAMILY)):
        for rec in list(name.names):
            if rec.nameID == nid:
                name.setName(value, nid, rec.platformID, rec.platEncID, rec.langID)

    font.flavor = "woff2"
    font.save(OUT)

    size = os.path.getsize(OUT)
    print(f"[font] 완료 → {OUT}")
    print(f"[font] {size / 1024:,.0f} KB  (원본 {os.path.getsize(SRC) / 1024:,.0f} KB 대비 "
          f"{size / os.path.getsize(SRC) * 100:.0f}%)")
    print("[font] 다음: node build.js 후 scripts/check-font-coverage.js 로 커버리지 확인")


if __name__ == "__main__":
    main()
