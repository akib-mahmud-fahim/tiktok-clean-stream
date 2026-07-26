import re
import ssl
import json
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from flask import Flask, request, jsonify, send_from_directory, Response, redirect
from flask_cors import CORS
import requests

app = Flask(__name__, static_folder='static', static_url_path='')
CORS(app)

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
}

def extract_tiktok_info(input_text):
    """
    Extracts TikTok URL and Video ID from raw input text (Embed code or direct URL).
    """
    if not input_text:
        return None, None

    vid_match = re.search(r'data-video-id=["\'](\d+)["\']', input_text)
    video_id = vid_match.group(1) if vid_match else None

    cite_match = re.search(r'cite=["\'](https?://[^"\']+)["\']', input_text)
    if cite_match:
        url = cite_match.group(1)
    else:
        url_match = re.search(r'https?://[^\s<>"\']+', input_text)
        url = url_match.group(0) if url_match else None

    if not url and input_text.startswith('http'):
        url = input_text.strip()

    if not video_id and url:
        id_in_url = re.search(r'/video/(\d+)', url)
        if id_in_url:
            video_id = id_in_url.group(1)

    return url, video_id

def resolve_short_url(url):
    """Resolves short links like vt.tiktok.com, vm.tiktok.com or /t/ to full canonical URL"""
    if url and ('vt.tiktok.com' in url or 'vm.tiktok.com' in url or '/t/' in url):
        try:
            res = requests.head(url, headers=HEADERS, allow_redirects=True, timeout=3)
            return res.url
        except Exception:
            pass
    return url

def fetch_tikwm(url):
    try:
        res = requests.get(f"https://www.tikwm.com/api/?url={urllib.parse.quote(url)}&hd=1", headers=HEADERS, timeout=2.5)
        if res.status_code == 200:
            data = res.json()
            if data.get('code') == 0 and data.get('data') and data['data'].get('play'):
                item = data['data']
                return {
                    'streamUrl': item.get('play'),
                    'title': item.get('title', ''),
                    'author': item.get('author', {}).get('nickname', ''),
                    'cover': item.get('cover', ''),
                    'vid': item.get('id', '')
                }
    except Exception:
        pass
    return None

def fetch_tikmate(url):
    try:
        res = requests.post('https://api.tikmate.app/api/lookup', data={'url': url}, headers=HEADERS, timeout=2.5)
        if res.status_code == 200:
            data = res.json()
            if data.get('success') and data.get('token') and data.get('id'):
                return {
                    'streamUrl': f"https://tikmate.app/download/{data['token']}/{data['id']}.mp4",
                    'title': data.get('author_name', ''),
                    'author': data.get('author_id', ''),
                    'vid': data.get('id', '')
                }
    except Exception:
        pass
    return None

def fetch_ssstik(url):
    try:
        session = requests.Session()
        res0 = session.get("https://ssstik.io/en", headers=HEADERS, timeout=2)
        tt_match = re.search(r's_tt\s*=\s*["\']([^"\']+)["\']', res0.text)
        tt = tt_match.group(1) if tt_match else ''
        
        post_data = {'id': url, 'locale': 'en', 'tt': tt}
        res = session.post("https://ssstik.io/abc?url=dl", data=post_data, headers={
            **HEADERS,
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'HX-Request': 'true',
            'HX-Target': 'target',
            'HX-Current-URL': 'https://ssstik.io/en'
        }, timeout=2.5)
        
        download_match = re.search(r'href="([^"]+)"[^>]*class="[^"]*download_link[^"]*"', res.text)
        if download_match:
            return {'streamUrl': download_match.group(1)}
    except Exception:
        pass
    return None

def get_clean_stream_fast(url):
    funcs = [fetch_tikwm, fetch_tikmate, fetch_ssstik]
    with ThreadPoolExecutor(max_workers=len(funcs)) as executor:
        futures = [executor.submit(f, url) for f in funcs]
        for future in as_completed(futures):
            try:
                res = future.result()
                if res and res.get('streamUrl'):
                    return res
            except Exception:
                pass
    return None

@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

@app.route('/player')
def player_page():
    return send_from_directory('static', 'player.html')

@app.route('/api/parse', methods=['POST'])
def parse_video():
    data = request.get_json() or {}
    embed_input = data.get('input', '').strip()

    if not embed_input:
        return jsonify({'status': 'error', 'message': 'No TikTok embed code or URL provided.'}), 400

    url, video_id = extract_tiktok_info(embed_input)
    if not url and not video_id:
        return jsonify({'status': 'error', 'message': 'Could not parse TikTok link or Video ID from input.'}), 400

    resolved_url = resolve_short_url(url) if url else f"https://www.tiktok.com/video/{video_id}"
    
    result = get_clean_stream_fast(resolved_url)
    vid = (result and result.get('vid')) or video_id or 'stream'
    host_url = request.host_url.rstrip('/')
    
    stream_url = result['streamUrl'] if (result and result.get('streamUrl')) else None

    # Generated Player and Proxy Stream endpoints
    if stream_url:
        permanent_player_url = f"{host_url}/player?v={vid}&url={urllib.parse.quote(stream_url)}"
        direct_proxy_stream = f"{host_url}/api/stream?url={urllib.parse.quote(stream_url)}"
    else:
        permanent_player_url = f"{host_url}/player?v={vid}"
        direct_proxy_stream = f"{host_url}/api/stream?v={vid}"

    clean_iframe_code = f'<iframe src="{permanent_player_url}" width="100%" height="450" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>'

    return jsonify({
        'status': 'success',
        'videoId': vid,
        'title': result.get('title', '') if result else '',
        'author': result.get('author', '') if result else '',
        'cover': result.get('cover', '') if result else '',
        'streamUrl': stream_url or resolved_url,
        'directProxyStream': direct_proxy_stream,
        'playerUrl': permanent_player_url,
        'iframeCode': clean_iframe_code,
        'originalUrl': resolved_url
    })

@app.route('/api/stream')
def stream_by_video_id():
    """
    Robust Video Stream Proxy Endpoint.
    Fixes 416 Range header mismatch & redirects seamlessly if direct CDN link expires or fails!
    """
    video_id = request.args.get('v') or request.args.get('id')
    direct_url = request.args.get('url')

    if not direct_url and video_id:
        target = f"https://www.tiktok.com/video/{video_id}"
        stream_data = get_clean_stream_fast(target)
        if stream_data and stream_data.get('streamUrl'):
            direct_url = stream_data['streamUrl']
        else:
            return redirect(f"https://www.tiktok.com/embed/v2/{video_id}")

    if not direct_url:
        return redirect('https://www.tiktok.com/')

    stream_headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://www.tiktok.com/',
        'Accept': '*/*',
    }
    if request.headers.get('Range'):
        stream_headers['Range'] = request.headers.get('Range')

    try:
        resp = requests.get(direct_url, headers=stream_headers, stream=True, timeout=10)
        
        # If upstream rejects range with HTTP 416, retry without Range header
        if resp.status_code == 416:
            stream_headers.pop('Range', None)
            resp = requests.get(direct_url, headers=stream_headers, stream=True, timeout=10)

        if resp.status_code not in [200, 206]:
            return redirect(direct_url)

        headers = []
        excluded_keys = ['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'content-disposition', 'content-type', 'set-cookie']
        
        for name, value in resp.raw.headers.items():
            if name.lower() not in excluded_keys:
                headers.append((name, value))
        
        response = Response(resp.iter_content(chunk_size=1024*128), resp.status_code, headers)
        response.headers['Content-Type'] = 'video/mp4'
        response.headers['Content-Disposition'] = 'inline'
        response.headers['Accept-Ranges'] = 'bytes'
        return response
    except Exception as e:
        print("Proxy exception, fallback redirecting:", e)
        return redirect(direct_url)

if __name__ == '__main__':
    print("Starting TikTok Clean Video Stream Server on http://localhost:5000...")
    app.run(host='0.0.0.0', port=5000, debug=False)
