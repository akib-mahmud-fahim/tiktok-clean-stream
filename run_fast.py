import requests
import urllib.parse
import re

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*'
}

def try_tikwm(url):
    try:
        r = requests.get(f"https://www.tikwm.com/api/?url={urllib.parse.quote(url)}&hd=1", headers=HEADERS, timeout=3.5)
        if r.status_code == 200:
            d = r.json()
            if d.get('code') == 0 and d.get('data') and d['data'].get('play'):
                return {
                    'streamUrl': d['data']['play'],
                    'title': d['data'].get('title', ''),
                    'author': d['data'].get('author', {}).get('nickname', ''),
                    'cover': d['data'].get('cover', ''),
                    'vid': d['data'].get('id', '')
                }
    except Exception as e:
        print("TikWM err:", e)
    return None

def try_tikmate(url):
    try:
        r = requests.post('https://api.tikmate.app/api/lookup', data={'url': url}, headers=HEADERS, timeout=3.5)
        if r.status_code == 200:
            d = r.json()
            if d.get('success') and d.get('token') and d.get('id'):
                return {
                    'streamUrl': f"https://tikmate.app/download/{d['token']}/{d['id']}.mp4",
                    'title': d.get('author_name', ''),
                    'author': d.get('author_id', ''),
                    'cover': '',
                    'vid': d.get('id', '')
                }
    except Exception as e:
        print("TikMate err:", e)
    return None

def try_ssstik(url):
    try:
        session = requests.Session()
        res0 = session.get("https://ssstik.io/en", headers=HEADERS, timeout=3.5)
        tt_match = re.search(r's_tt\s*=\s*["\']([^"\']+)["\']', res0.text)
        tt = tt_match.group(1) if tt_match else ''
        res = session.post("https://ssstik.io/abc?url=dl", data={'id': url, 'locale': 'en', 'tt': tt}, headers={
            **HEADERS,
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'HX-Request': 'true',
            'HX-Target': 'target',
            'HX-Current-URL': 'https://ssstik.io/en'
        }, timeout=3.5)
        match = re.search(r'href="([^"]+)"[^>]*class="[^"]*download_link[^"]*"', res.text)
        if match:
            return {'streamUrl': match.group(1)}
    except Exception as e:
        print("SSSTik err:", e)
    return None

def get_clean_stream(url):
    return try_tikwm(url) or try_tikmate(url) or try_ssstik(url)

test_list = [
    "https://www.tiktok.com/@huhindustryy/video/7665362380813045006",
    "https://www.tiktok.com/@khaby.lame/video/6954236312450845957",
    "https://www.tiktok.com/@zachking/video/6768504823332392198",
    "https://www.tiktok.com/@charlidamelio/video/6744007872721456389"
]

results = []
for u in test_list:
    res = get_clean_stream(u)
    if res and res.get('streamUrl'):
        results.append(f"[SUCCESS] {u} -> {res['streamUrl'][:70]}")
    else:
        results.append(f"[FAILED] {u}")

with open('fast_results.txt', 'w', encoding='utf-8') as f:
    f.write('\n'.join(results))
