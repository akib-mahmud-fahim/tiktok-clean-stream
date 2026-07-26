import urllib.request
import urllib.parse
import json
import ssl
import re

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
}

def try_ssstik(url):
    print("Testing SSSTik...")
    try:
        # SSSTik initial request to get form token
        req0 = urllib.request.Request("https://ssstik.io/en", headers=headers)
        html = urllib.request.urlopen(req0, context=ctx).read().decode('utf-8')
        tt_match = re.search(r's_tt\s*=\s*["\']([^"\']+)["\']', html)
        tt = tt_match.group(1) if tt_match else ''
        
        post_data = urllib.parse.urlencode({
            'id': url,
            'locale': 'en',
            'tt': tt
        }).encode('utf-8')
        
        req = urllib.request.Request("https://ssstik.io/abc?url=dl", data=post_data, headers={
            **headers,
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'HX-Request': 'true',
            'HX-Target': 'target',
            'HX-Current-URL': 'https://ssstik.io/en'
        })
        res_html = urllib.request.urlopen(req, context=ctx).read().decode('utf-8')
        # Extract download link from response HTML
        download_match = re.search(r'href="([^"]+)"[^>]*class="[^"]*download_link[^"]*"', res_html)
        if download_match:
            print("SSSTik Success! Direct link:", download_match.group(1))
            return download_match.group(1)
        else:
            print("SSSTik output snippet:", res_html[:300])
    except Exception as e:
        print("SSSTik Error:", e)
    return None

def try_lovetik(url):
    print("\nTesting LoveTik...")
    try:
        post_data = urllib.parse.urlencode({'query': url}).encode('utf-8')
        req = urllib.request.Request("https://lovetik.com/api/ajax/search", data=post_data, headers={
            **headers,
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
        })
        res = urllib.request.urlopen(req, context=ctx).read().decode('utf-8')
        data = json.loads(res)
        print("LoveTik response status:", data.get('status'))
        if data.get('links'):
            print("LoveTik direct video link:", data['links'][0].get('a'))
            return data['links'][0].get('a')
    except Exception as e:
        print("LoveTik Error:", e)
    return None

def try_tikwm(url):
    print("\nTesting TikWM GET...")
    try:
        api_url = f"https://www.tikwm.com/api/?url={urllib.parse.quote(url)}&hd=1"
        req = urllib.request.Request(api_url, headers=headers)
        res = urllib.request.urlopen(req, context=ctx).read().decode('utf-8')
        data = json.loads(res)
        print("TikWM code:", data.get('code'), "msg:", data.get('msg'))
        if data.get('data', {}).get('play'):
            print("TikWM direct video link:", data['data']['play'])
            return data['data']['play']
    except Exception as e:
        print("TikWM Error:", e)
    return None

if __name__ == '__main__':
    test_url = "https://www.tiktok.com/@tiktok/video/7106594312292453678"
    try_tikwm(test_url)
    try_ssstik(test_url)
    try_lovetik(test_url)
