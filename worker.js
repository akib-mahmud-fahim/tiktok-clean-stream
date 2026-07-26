/**
 * Cloudflare Worker for TikTok Clean Video Streaming & iFrame Embed Generator
 * Deploy directly to Cloudflare Workers or Cloudflare Pages Functions
 */

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*'
};

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;

        // Handle CORS Preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type'
                }
            });
        }

        // 1. API: Parse TikTok Embed Code / URL
        if (path === '/api/parse' && request.method === 'POST') {
            try {
                const body = await request.json();
                const input = body.input || '';

                const videoId = extractVideoId(input);
                let targetUrl = extractUrl(input);

                if (!videoId && !targetUrl) {
                    return jsonResponse({ status: 'error', message: 'Invalid TikTok URL or Embed code' }, 400);
                }

                if (!targetUrl && videoId) {
                    targetUrl = `https://www.tiktok.com/video/${videoId}`;
                }

                // Extract direct stream link using TikWM API
                const streamData = await fetchTikWM(targetUrl);
                const vid = streamData?.vid || videoId || 'stream';
                const hostUrl = `${url.protocol}//${url.host}`;
                
                const streamUrl = streamData?.streamUrl;
                let permanentPlayerUrl = '';
                let directProxyStream = '';

                if (streamUrl) {
                    permanentPlayerUrl = `${hostUrl}/player?v=${vid}&url=${encodeURIComponent(streamUrl)}`;
                    directProxyStream = `${hostUrl}/api/stream?url=${encodeURIComponent(streamUrl)}`;
                } else {
                    permanentPlayerUrl = `${hostUrl}/player?v=${vid}`;
                    directProxyStream = `${hostUrl}/api/stream?v=${vid}`;
                }

                const iframeCode = `<iframe src="${permanentPlayerUrl}" width="100%" height="450" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`;

                return jsonResponse({
                    status: 'success',
                    videoId: vid,
                    title: streamData?.title || '',
                    author: streamData?.author || '',
                    streamUrl: streamUrl || targetUrl,
                    directProxyStream: directProxyStream,
                    playerUrl: permanentPlayerUrl,
                    iframeCode: iframeCode
                });

            } catch (err) {
                return jsonResponse({ status: 'error', message: err.message }, 500);
            }
        }

        // 2. API: Stream Proxy Endpoint (Forced Inline video/mp4)
        if (path === '/api/stream') {
            const targetStreamUrl = url.searchParams.get('url');
            const vId = url.searchParams.get('v') || url.searchParams.get('id');

            let streamToFetch = targetStreamUrl;

            if (!streamToFetch && vId) {
                const data = await fetchTikWM(`https://www.tiktok.com/video/${vId}`);
                if (data && data.streamUrl) {
                    streamToFetch = data.streamUrl;
                } else {
                    return Response.redirect(`https://www.tiktok.com/embed/v2/${vId}`, 302);
                }
            }

            if (!streamToFetch) {
                return new Response('Stream URL missing', { status: 400 });
            }

            // Fetch video stream from TikTok CDN
            const videoRes = await fetch(streamToFetch, {
                headers: {
                    'User-Agent': HEADERS['User-Agent'],
                    'Range': request.headers.get('Range') || ''
                }
            });

            // Clean headers for inline playback
            const newHeaders = new Headers();
            newHeaders.set('Content-Type', 'video/mp4');
            newHeaders.set('Content-Disposition', 'inline');
            newHeaders.set('Access-Control-Allow-Origin', '*');
            if (videoRes.headers.get('content-length')) {
                newHeaders.set('Content-Length', videoRes.headers.get('content-length'));
            }
            if (videoRes.headers.get('content-range')) {
                newHeaders.set('Content-Range', videoRes.headers.get('content-range'));
            }

            return new Response(videoRes.body, {
                status: videoRes.status,
                headers: newHeaders
            });
        }

        // Fallthrough for static assets if using Cloudflare Pages / Workers
        return new Response('StreamClean Worker Active', { status: 200 });
    }
};

function extractVideoId(text) {
    const vidMatch = text.match(/data-video-id=["'](\d+)["']/);
    if (vidMatch) return vidMatch[1];
    const urlIdMatch = text.match(/\/video\/(\d+)/);
    if (urlIdMatch) return urlIdMatch[1];
    return null;
}

function extractUrl(text) {
    const citeMatch = text.match(/cite=["'](https?:\/\/[^"']+)["']/);
    if (citeMatch) return citeMatch[1];
    const urlMatch = text.match(/https?:\/\/[^\s<>"']+/);
    return urlMatch ? urlMatch[0] : null;
}

async function fetchTikWM(targetUrl) {
    try:
        const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(targetUrl)}&hd=1`;
        const res = await fetch(apiUrl, { headers: HEADERS });
        const json = await res.json();
        if (json.code === 0 && json.data && json.data.play) {
            return {
                streamUrl: json.data.play,
                title: json.data.title || '',
                author: json.data.author?.nickname || '',
                vid: json.data.id || ''
            };
        }
    } catch (e) {}
    return null;
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        }
    });
}
