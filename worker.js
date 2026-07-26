/**
 * Cloudflare Worker for TikTok Clean Video Streaming & iFrame Embed Generator
 * 
 * This single worker handles:
 * - Serving static HTML pages (index, player, CSS)
 * - API endpoints for parsing TikTok URLs and streaming video
 * - CORS headers for cross-origin access
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

        // ──────────────────────────────────────────────────
        // STATIC PAGES
        // ──────────────────────────────────────────────────

        // Home Page
        if (path === '/' || path === '/index.html') {
            return new Response(INDEX_HTML, {
                headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
        }

        // Player Page
        if (path === '/player' || path === '/player.html') {
            return new Response(PLAYER_HTML, {
                headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
        }

        // CSS
        if (path === '/style.css') {
            return new Response(STYLE_CSS, {
                headers: { 'Content-Type': 'text/css; charset=utf-8' }
            });
        }

        // ──────────────────────────────────────────────────
        // API: Parse TikTok Embed Code / URL
        // ──────────────────────────────────────────────────
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
                const streamData = await fetchTikTokData(targetUrl);
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

        // ──────────────────────────────────────────────────
        // API: Stream Proxy Endpoint (Forced Inline video/mp4)
        // ──────────────────────────────────────────────────
        if (path === '/api/stream') {
            const targetStreamUrl = url.searchParams.get('url');
            const vId = url.searchParams.get('v') || url.searchParams.get('id');

            let streamToFetch = targetStreamUrl;

            if (!streamToFetch && vId) {
                const data = await fetchTikTokData(`https://www.tiktok.com/video/${vId}`);
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
                    'Referer': 'https://www.tiktok.com/',
                    'Range': request.headers.get('Range') || ''
                }
            });

            // Clean headers for inline playback
            const newHeaders = new Headers();
            newHeaders.set('Content-Type', 'video/mp4');
            newHeaders.set('Content-Disposition', 'inline');
            newHeaders.set('Access-Control-Allow-Origin', '*');
            newHeaders.set('Accept-Ranges', 'bytes');
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

        // ──────────────────────────────────────────────────
        // Fallthrough: 404
        // ──────────────────────────────────────────────────
        return new Response('Not Found', { status: 404 });
    }
};

// ──────────────────────────────────────────────────
// Helper Functions
// ──────────────────────────────────────────────────

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

async function fetchTikTokData(targetUrl) {
    // Provider 1: TikWM POST
    try {
        const formData = new URLSearchParams();
        formData.append('url', targetUrl);
        formData.append('hd', '1');
        const res = await fetch('https://www.tikwm.com/api/', {
            method: 'POST',
            headers: { ...HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData.toString()
        });
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

    // Provider 2: TikWM GET
    try {
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

    // Provider 3: LoveTik
    try {
        const formData = new URLSearchParams();
        formData.append('query', targetUrl);
        const res = await fetch('https://lovetik.com/api/ajax/search', {
            method: 'POST',
            headers: { ...HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData.toString()
        });
        const json = await res.json();
        if (json.status === 'ok' && json.links && json.links.length > 0) {
            const mp4Link = json.links.find(l => l.a && l.a.includes('http')) || json.links[0];
            if (mp4Link && mp4Link.a) {
                return {
                    streamUrl: mp4Link.a,
                    title: json.desc || '',
                    author: json.author || '',
                    vid: json.vid || ''
                };
            }
        }
    } catch (e) {}

    // Provider 4: Tiklydown
    try {
        const res = await fetch(`https://api.tiklydown.eu.org/api/download?url=${encodeURIComponent(targetUrl)}`, { headers: HEADERS });
        const json = await res.json();
        if (json.video && (json.video.noWatermark || json.video.watermark)) {
            return {
                streamUrl: json.video.noWatermark || json.video.watermark,
                title: json.title || '',
                author: json.author?.name || '',
                vid: json.id || ''
            };
        }
    } catch (e) {}

    // Provider 5: TikTok oEmbed Fallback
    try {
        const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(targetUrl)}`, { headers: HEADERS });
        const json = await res.json();
        if (json.title || json.author_name) {
            return {
                streamUrl: null,
                title: json.title || '',
                author: json.author_name || '',
                vid: json.embed_product_id || ''
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

// ══════════════════════════════════════════════════
// EMBEDDED STATIC FILES
// ══════════════════════════════════════════════════

const STYLE_CSS = `@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');

:root {
    --bg-dark: #090d16;
    --bg-card: rgba(18, 24, 38, 0.75);
    --bg-card-hover: rgba(28, 36, 56, 0.85);
    --border-color: rgba(255, 255, 255, 0.08);
    --border-glow: rgba(99, 102, 241, 0.3);
    --primary: #6366f1;
    --primary-hover: #4f46e5;
    --primary-glow: rgba(99, 102, 241, 0.4);
    --accent: #ec4899;
    --accent-cyan: #06b6d4;
    --emerald: #10b981;
    --text-main: #f8fafc;
    --text-muted: #94a3b8;
    --text-dim: #64748b;
    --radius-sm: 8px;
    --radius-md: 14px;
    --radius-lg: 20px;
    --radius-xl: 24px;
    --font-heading: 'Outfit', sans-serif;
    --font-body: 'Plus Jakarta Sans', sans-serif;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
    background-color: var(--bg-dark);
    background-image: 
        radial-gradient(at 15% 15%, rgba(99, 102, 241, 0.15) 0px, transparent 50%),
        radial-gradient(at 85% 85%, rgba(236, 72, 153, 0.12) 0px, transparent 50%),
        radial-gradient(at 50% 50%, rgba(6, 182, 212, 0.08) 0px, transparent 50%);
    background-attachment: fixed;
    color: var(--text-main);
    font-family: var(--font-body);
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    overflow-x: hidden;
}

.navbar {
    border-bottom: 1px solid var(--border-color);
    background: rgba(9, 13, 22, 0.7);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    position: sticky;
    top: 0;
    z-index: 100;
    padding: 16px 0;
}

.nav-container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.brand {
    display: flex;
    align-items: center;
    gap: 12px;
    text-decoration: none;
}

.brand-icon {
    width: 42px;
    height: 42px;
    background: linear-gradient(135deg, var(--primary), var(--accent));
    border-radius: var(--radius-md);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 8px 20px var(--primary-glow);
    color: white;
}

.brand-title {
    font-family: var(--font-heading);
    font-size: 1.4rem;
    font-weight: 700;
    background: linear-gradient(135deg, #ffffff 30%, var(--text-muted));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
}

.brand-badge {
    background: rgba(99, 102, 241, 0.15);
    border: 1px solid var(--border-glow);
    color: #a5b4fc;
    font-size: 0.75rem;
    font-weight: 600;
    padding: 3px 10px;
    border-radius: 20px;
}

.main-wrapper {
    max-width: 1200px;
    margin: 0 auto;
    padding: 40px 24px;
    width: 100%;
    flex: 1;
}

.hero { text-align: center; margin-bottom: 40px; }

.hero-title {
    font-family: var(--font-heading);
    font-size: 2.6rem;
    font-weight: 700;
    line-height: 1.2;
    margin-bottom: 12px;
    background: linear-gradient(135deg, #ffffff 40%, #a5b4fc 70%, var(--accent));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
}

.hero-subtitle {
    font-size: 1.1rem;
    color: var(--text-muted);
    max-width: 650px;
    margin: 0 auto;
    line-height: 1.6;
}

.glass-card {
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-xl);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    padding: 32px;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4);
    margin-bottom: 36px;
    transition: border-color 0.3s ease, box-shadow 0.3s ease;
}

.glass-card:hover { border-color: rgba(99, 102, 241, 0.25); }

.section-label {
    font-family: var(--font-heading);
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--text-main);
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 16px;
}

.section-label svg { color: var(--primary); }

.input-group { display: flex; flex-direction: column; gap: 16px; }

.code-textarea {
    width: 100%;
    height: 130px;
    background: rgba(5, 8, 15, 0.7);
    border: 1.5px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: 16px;
    color: var(--text-main);
    font-family: 'Fira Code', 'Consolas', monospace;
    font-size: 0.92rem;
    line-height: 1.5;
    resize: vertical;
    transition: all 0.25s ease;
}

.code-textarea:focus {
    outline: none;
    border-color: var(--primary);
    box-shadow: 0 0 0 4px var(--primary-glow);
    background: rgba(5, 8, 15, 0.9);
}

.code-textarea::placeholder { color: var(--text-dim); font-family: var(--font-body); }

.action-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
}

.btn-primary {
    background: linear-gradient(135deg, var(--primary), #4338ca);
    color: white;
    font-family: var(--font-heading);
    font-size: 1rem;
    font-weight: 600;
    padding: 14px 28px;
    border-radius: var(--radius-md);
    border: none;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 10px;
    box-shadow: 0 8px 25px var(--primary-glow);
    transition: all 0.25s ease;
}

.btn-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 12px 30px rgba(99, 102, 241, 0.5);
    background: linear-gradient(135deg, #4f46e5, #3730a3);
}

.btn-primary:active { transform: translateY(0); }

.btn-secondary {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--border-color);
    color: var(--text-main);
    font-family: var(--font-heading);
    font-size: 0.95rem;
    font-weight: 500;
    padding: 12px 20px;
    border-radius: var(--radius-md);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    transition: all 0.2s ease;
}

.btn-secondary:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.2);
}

.btn-icon { padding: 8px; border-radius: var(--radius-sm); }

.spinner {
    width: 20px;
    height: 20px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-radius: 50%;
    border-top-color: white;
    animation: spin 0.8s linear infinite;
    display: none;
}

@keyframes spin { to { transform: rotate(360deg); } }

.result-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 32px;
}

@media (max-width: 900px) {
    .result-grid { grid-template-columns: 1fr; }
}

.player-container {
    background: #000;
    border-radius: var(--radius-lg);
    overflow: hidden;
    position: relative;
    width: 100%;
    aspect-ratio: 9 / 16;
    max-height: 550px;
    margin: 0 auto;
    border: 1px solid var(--border-color);
    box-shadow: 0 15px 35px rgba(0, 0, 0, 0.6);
}

.player-container.landscape { aspect-ratio: 16 / 9; max-height: 400px; }

.player-iframe { width: 100%; height: 100%; border: none; }

.output-box { display: flex; flex-direction: column; gap: 20px; }

.code-field-group { display: flex; flex-direction: column; gap: 8px; }

.code-field-label {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.code-display {
    background: rgba(5, 8, 15, 0.85);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: 14px 16px;
    font-family: 'Fira Code', 'Consolas', monospace;
    font-size: 0.88rem;
    color: #38bdf8;
    word-break: break-all;
    white-space: pre-wrap;
    position: relative;
}

.options-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 12px;
    margin-top: 10px;
}

.option-checkbox {
    display: flex;
    align-items: center;
    gap: 10px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--border-color);
    padding: 10px 14px;
    border-radius: var(--radius-md);
    font-size: 0.85rem;
    color: var(--text-muted);
    cursor: pointer;
    user-select: none;
    transition: all 0.2s ease;
}

.option-checkbox:hover {
    background: rgba(255, 255, 255, 0.06);
    color: var(--text-main);
}

.option-checkbox input[type="checkbox"] {
    accent-color: var(--primary);
    width: 16px;
    height: 16px;
    cursor: pointer;
}

.toast {
    position: fixed;
    bottom: 30px;
    right: 30px;
    background: rgba(16, 185, 129, 0.95);
    color: white;
    font-weight: 600;
    padding: 14px 24px;
    border-radius: var(--radius-md);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    gap: 10px;
    transform: translateY(100px);
    opacity: 0;
    transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    z-index: 1000;
}

.toast.show { transform: translateY(0); opacity: 1; }
.toast.error { background: rgba(239, 68, 68, 0.95); }

footer {
    border-top: 1px solid var(--border-color);
    padding: 24px 0;
    text-align: center;
    color: var(--text-dim);
    font-size: 0.88rem;
    margin-top: auto;
}`;

const INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TikTok Clean Video Player & Embed Link Generator</title>
    <link rel="stylesheet" href="/style.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body>

    <!-- Header Navigation -->
    <header class="navbar">
        <div class="nav-container">
            <a href="/" class="brand">
                <div class="brand-icon">
                    <i class="fa-solid fa-play"></i>
                </div>
                <span class="brand-title">StreamClean</span>
                <span class="brand-badge">TikTok No-Logo Stream</span>
            </a>
            <div class="nav-links">
                <a href="#history-section" class="btn-secondary btn-icon" title="View History">
                    <i class="fa-solid fa-clock-rotate-left"></i> History
                </a>
            </div>
        </div>
    </header>

    <!-- Main Content Wrapper -->
    <main class="main-wrapper">

        <!-- Hero Section -->
        <section class="hero">
            <h1 class="hero-title">Stream TikTok Videos Without Logos or Watermarks</h1>
            <p class="hero-subtitle">Paste any TikTok embed code or video link to extract a clean, original stream. Generate permanent, non-expiring iframe embed codes and player URLs for your streaming website.</p>
        </section>

        <!-- Input Glass Card -->
        <section class="glass-card">
            <div class="section-label">
                <i class="fa-solid fa-code"></i> Paste TikTok Embed Code or Video Link
            </div>
            
            <div class="input-group">
                <textarea id="embedInput" class="code-textarea" placeholder='Paste example:&#10;<blockquote class="tiktok-embed" cite="https://www.tiktok.com/@username/video/123456789..." data-video-id="123456789...">...</blockquote>&#10;or direct TikTok link: https://www.tiktok.com/@username/video/123456789...'></textarea>
                
                <div class="action-row">
                    <div style="display:flex; gap:10px;">
                        <button id="parseBtn" class="btn-primary">
                            <span class="spinner" id="btnSpinner"></span>
                            <i class="fa-solid fa-wand-magic-sparkles" id="btnIcon"></i>
                            Generate Stream Link
                        </button>
                        <button id="clearBtn" class="btn-secondary">
                            <i class="fa-solid fa-eraser"></i> Clear
                        </button>
                    </div>
                    <button id="pasteBtn" class="btn-secondary">
                        <i class="fa-solid fa-paste"></i> Paste from Clipboard
                    </button>
                </div>
            </div>
        </section>

        <!-- Result Preview Section -->
        <section class="glass-card" id="resultSection" style="display: none;">
            <div class="section-label">
                <i class="fa-solid fa-circle-check" style="color: var(--emerald);"></i> Clean Stream Player & Embed Code
            </div>

            <div class="result-grid">
                <!-- Left Column: Video Player Preview -->
                <div>
                    <div class="player-container" id="playerWrapper">
                        <iframe id="previewIframe" class="player-iframe" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>
                    </div>
                    <div style="margin-top: 14px; display:flex; justify-content:flex-end; align-items:center;">
                        <a id="openNewTabBtn" href="#" target="_blank" class="btn-secondary" style="font-size:0.85rem; padding:8px 16px;">
                            <i class="fa-solid fa-up-right-from-square"></i> Open Player in New Tab
                        </a>
                    </div>
                </div>

                <!-- Right Column: Code Outputs & Customizers -->
                <div class="output-box">
                    <!-- Option Switches -->
                    <div>
                        <span style="font-size:0.85rem; font-weight:600; color:var(--text-muted); text-transform:uppercase;">Player Settings</span>
                        <div class="options-grid">
                            <label class="option-checkbox">
                                <input type="checkbox" id="optAutoplay">
                                Autoplay
                            </label>
                            <label class="option-checkbox">
                                <input type="checkbox" id="optLoop" checked>
                                Loop
                            </label>
                            <label class="option-checkbox">
                                <input type="checkbox" id="optMuted">
                                Muted
                            </label>
                        </div>
                    </div>

                    <!-- Clean iFrame Code for Website -->
                    <div class="code-field-group">
                        <div class="code-field-label">
                            <span>Permanent iFrame Embed Code (For Your Website)</span>
                            <button id="copyIframeBtn" class="btn-secondary" style="font-size:0.78rem; padding:4px 10px;">
                                <i class="fa-regular fa-copy"></i> Copy Code
                            </button>
                        </div>
                        <div class="code-display" id="iframeDisplayCode"></div>
                    </div>

                    <!-- Direct Player URL -->
                    <div class="code-field-group">
                        <div class="code-field-label">
                            <span>Permanent Player Stream URL</span>
                            <button id="copyUrlBtn" class="btn-secondary" style="font-size:0.78rem; padding:4px 10px;">
                                <i class="fa-regular fa-copy"></i> Copy URL
                            </button>
                        </div>
                        <div class="code-display" id="playerUrlCode"></div>
                    </div>

                    <!-- Direct Proxy Stream Link -->
                    <div class="code-field-group">
                        <div class="code-field-label">
                            <span>Direct Non-Expiring Proxy Stream Endpoint</span>
                            <button id="copyMp4Btn" class="btn-secondary" style="font-size:0.78rem; padding:4px 10px;">
                                <i class="fa-regular fa-copy"></i> Copy Stream Endpoint
                            </button>
                        </div>
                        <div class="code-display" id="mp4UrlCode" style="color:var(--emerald);"></div>
                    </div>
                </div>
            </div>
        </section>

        <!-- Saved History Section -->
        <section class="glass-card" id="history-section">
            <div class="section-label" style="justify-content:space-between;">
                <span><i class="fa-solid fa-clock-rotate-left"></i> Extracted Videos History</span>
                <button id="clearHistoryBtn" class="btn-secondary" style="font-size:0.8rem; padding:4px 10px;">
                    <i class="fa-solid fa-trash-can"></i> Clear History
                </button>
            </div>
            
            <div id="historyContainer" style="display:flex; flex-direction:column; gap:12px; margin-top:10px;">
                <div style="color:var(--text-dim); text-align:center; padding:20px;">No video history saved yet.</div>
            </div>
        </section>

    </main>

    <!-- Toast Notification -->
    <div id="toast" class="toast">
        <i class="fa-solid fa-circle-check"></i> <span id="toastMsg">Copied to clipboard!</span>
    </div>

    <!-- Footer -->
    <footer>
        <p>&copy; 2026 StreamClean - TikTok Clean Video Player Generator. Built for video streaming platforms.</p>
    </footer>

    <script>
        const embedInput = document.getElementById('embedInput');
        const parseBtn = document.getElementById('parseBtn');
        const btnSpinner = document.getElementById('btnSpinner');
        const btnIcon = document.getElementById('btnIcon');
        const clearBtn = document.getElementById('clearBtn');
        const pasteBtn = document.getElementById('pasteBtn');
        
        const resultSection = document.getElementById('resultSection');
        const previewIframe = document.getElementById('previewIframe');
        const iframeDisplayCode = document.getElementById('iframeDisplayCode');
        const playerUrlCode = document.getElementById('playerUrlCode');
        const mp4UrlCode = document.getElementById('mp4UrlCode');
        const openNewTabBtn = document.getElementById('openNewTabBtn');

        const optAutoplay = document.getElementById('optAutoplay');
        const optLoop = document.getElementById('optLoop');
        const optMuted = document.getElementById('optMuted');

        const copyIframeBtn = document.getElementById('copyIframeBtn');
        const copyUrlBtn = document.getElementById('copyUrlBtn');
        const copyMp4Btn = document.getElementById('copyMp4Btn');
        const historyContainer = document.getElementById('historyContainer');
        const clearHistoryBtn = document.getElementById('clearHistoryBtn');

        let currentData = null;

        pasteBtn.addEventListener('click', async () => {
            try {
                const text = await navigator.clipboard.readText();
                if (text) {
                    embedInput.value = text;
                    showToast('Pasted from clipboard!');
                }
            } catch (err) {
                showToast('Clipboard access permission denied.', true);
            }
        });

        clearBtn.addEventListener('click', () => {
            embedInput.value = '';
            resultSection.style.display = 'none';
        });

        parseBtn.addEventListener('click', async () => {
            const inputVal = embedInput.value.trim();
            if (!inputVal) {
                showToast('Please enter a TikTok embed code or video URL.', true);
                return;
            }

            setLoading(true);

            try {
                const res = await fetch('/api/parse', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ input: inputVal })
                });

                const data = await res.json();
                setLoading(false);

                if (data.status === 'success') {
                    currentData = data;
                    renderResult();
                    saveToHistory(data);
                    showToast('Clean video stream link generated successfully!');
                } else {
                    showToast(data.message || 'Failed to extract video stream.', true);
                }
            } catch (err) {
                setLoading(false);
                showToast('Error connecting to the server.', true);
            }
        });

        function setLoading(isLoading) {
            if (isLoading) {
                btnSpinner.style.display = 'inline-block';
                btnIcon.style.display = 'none';
                parseBtn.disabled = true;
            } else {
                btnSpinner.style.display = 'none';
                btnIcon.style.display = 'inline-block';
                parseBtn.disabled = false;
            }
        }

        function renderResult() {
            if (!currentData) return;

            let finalPlayerUrl = currentData.playerUrl;
            let params = [];
            if (optAutoplay.checked) params.push('autoplay=1');
            if (optLoop.checked) params.push('loop=1');
            if (optMuted.checked) params.push('muted=1');

            if (params.length > 0) {
                finalPlayerUrl += (finalPlayerUrl.includes('?') ? '&' : '?') + params.join('&');
            }

            const iframeCode = '<iframe src="' + finalPlayerUrl + '" width="100%" height="450" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>';

            previewIframe.src = finalPlayerUrl;
            iframeDisplayCode.textContent = iframeCode;
            playerUrlCode.textContent = finalPlayerUrl;
            mp4UrlCode.textContent = currentData.directProxyStream;
            openNewTabBtn.href = finalPlayerUrl;

            resultSection.style.display = 'block';
            resultSection.scrollIntoView({ behavior: 'smooth' });
        }

        [optAutoplay, optLoop, optMuted].forEach(opt => {
            opt.addEventListener('change', renderResult);
        });

        copyIframeBtn.addEventListener('click', () => {
            copyToClipboard(iframeDisplayCode.textContent, 'iFrame Embed Code copied!');
        });
        copyUrlBtn.addEventListener('click', () => {
            copyToClipboard(playerUrlCode.textContent, 'Player Stream URL copied!');
        });
        copyMp4Btn.addEventListener('click', () => {
            copyToClipboard(mp4UrlCode.textContent, 'Direct Proxy Stream URL copied!');
        });

        function copyToClipboard(text, msg) {
            navigator.clipboard.writeText(text).then(() => {
                showToast(msg);
            });
        }

        function showToast(msg, isError = false) {
            const toast = document.getElementById('toast');
            const toastMsg = document.getElementById('toastMsg');
            toastMsg.textContent = msg;
            if (isError) {
                toast.classList.add('error');
            } else {
                toast.classList.remove('error');
            }
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 3000);
        }

        function getHistory() {
            return JSON.parse(localStorage.getItem('tiktok_stream_history') || '[]');
        }

        function saveToHistory(item) {
            let history = getHistory();
            history = history.filter(h => h.videoId !== item.videoId);
            history.unshift({
                videoId: item.videoId,
                playerUrl: item.playerUrl,
                timestamp: new Date().toLocaleTimeString()
            });
            if (history.length > 10) history = history.slice(0, 10);
            localStorage.setItem('tiktok_stream_history', JSON.stringify(history));
            renderHistory();
        }

        function renderHistory() {
            const history = getHistory();
            if (history.length === 0) {
                historyContainer.innerHTML = '<div style="color:var(--text-dim); text-align:center; padding:20px;">No video history saved yet.</div>';
                return;
            }
            historyContainer.innerHTML = history.map(item => 
                '<div style="background:rgba(255,255,255,0.03); border:1px solid var(--border-color); padding:12px 16px; border-radius:var(--radius-md); display:flex; justify-content:space-between; align-items:center;">' +
                    '<div>' +
                        '<div style="font-weight:600; font-size:0.9rem; color:#e2e8f0;">TikTok Video ID: ' + item.videoId + '</div>' +
                        '<div style="font-size:0.75rem; color:var(--text-dim);">' + item.timestamp + '</div>' +
                    '</div>' +
                    '<div style="display:flex; gap:8px;">' +
                        '<a href="' + item.playerUrl + '" target="_blank" class="btn-secondary" style="font-size:0.75rem; padding:4px 8px;">' +
                            '<i class="fa-solid fa-play"></i> Play' +
                        '</a>' +
                        '<button onclick="navigator.clipboard.writeText(\\'' + item.playerUrl + '\\'); showToast(\\'Player URL copied!\\');" class="btn-secondary" style="font-size:0.75rem; padding:4px 8px;">' +
                            '<i class="fa-regular fa-copy"></i>' +
                        '</button>' +
                    '</div>' +
                '</div>'
            ).join('');
        }

        clearHistoryBtn.addEventListener('click', () => {
            localStorage.removeItem('tiktok_stream_history');
            renderHistory();
            showToast('History cleared.');
        });

        renderHistory();
    </script>
</body>
</html>`;

const PLAYER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Clean Video Player</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body, html {
            width: 100%; height: 100%;
            background-color: #000;
            overflow: hidden;
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
            user-select: none;
        }
        .player-wrapper {
            position: relative; width: 100%; height: 100%;
            display: flex; align-items: center; justify-content: center;
            background: #000;
        }
        video { width: 100%; height: 100%; object-fit: contain; outline: none; }
        .controls-bar {
            position: absolute; bottom: 0; left: 0; right: 0;
            padding: 12px 20px 16px 20px;
            background: linear-gradient(0deg, rgba(0, 0, 0, 0.85) 0%, rgba(0, 0, 0, 0.4) 60%, transparent 100%);
            display: flex; flex-direction: column; gap: 10px;
            opacity: 0; transition: opacity 0.3s ease; z-index: 10;
        }
        .player-wrapper:hover .controls-bar,
        .player-wrapper.user-active .controls-bar { opacity: 1; }
        .progress-container {
            width: 100%; height: 6px;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 3px; cursor: pointer;
            position: relative; transition: height 0.15s ease;
        }
        .progress-container:hover { height: 9px; }
        .progress-filled {
            height: 100%; width: 0%;
            background: linear-gradient(90deg, #6366f1, #ec4899);
            border-radius: 3px; position: relative;
        }
        .progress-handle {
            position: absolute; right: -6px; top: 50%;
            transform: translateY(-50%);
            width: 12px; height: 12px;
            background: #fff; border-radius: 50%;
            box-shadow: 0 0 8px rgba(0, 0, 0, 0.5);
            opacity: 0; transition: opacity 0.15s ease;
        }
        .progress-container:hover .progress-handle { opacity: 1; }
        .controls-row { display: flex; align-items: center; justify-content: space-between; }
        .controls-left, .controls-right { display: flex; align-items: center; gap: 14px; }
        .ctrl-btn {
            background: none; border: none; color: #fff;
            cursor: pointer; padding: 4px;
            display: flex; align-items: center; justify-content: center;
            opacity: 0.85; transition: opacity 0.2s ease, transform 0.15s ease;
        }
        .ctrl-btn:hover { opacity: 1; transform: scale(1.1); }
        .ctrl-btn svg { width: 22px; height: 22px; fill: currentColor; }
        .time-display { font-size: 0.8rem; color: #cbd5e1; font-variant-numeric: tabular-nums; }
        .volume-group { display: flex; align-items: center; gap: 6px; }
        .volume-slider { width: 60px; height: 4px; accent-color: #6366f1; cursor: pointer; }
        .speed-select {
            background: rgba(255, 255, 255, 0.15); color: #fff;
            border: none; border-radius: 4px; padding: 2px 6px;
            font-size: 0.75rem; cursor: pointer; outline: none;
        }
        .speed-select option { background: #1e293b; color: #fff; }
        .big-play-btn {
            position: absolute; width: 64px; height: 64px;
            border-radius: 50%; background: rgba(99, 102, 241, 0.85);
            backdrop-filter: blur(8px);
            display: flex; align-items: center; justify-content: center;
            color: #fff; cursor: pointer;
            box-shadow: 0 8px 25px rgba(0, 0, 0, 0.5);
            transition: all 0.25s ease; z-index: 5; pointer-events: auto;
            border: none;
        }
        .big-play-btn:hover { transform: scale(1.1); background: rgba(99, 102, 241, 1); }
        .big-play-btn.hidden { display: none; }
    </style>
</head>
<body>

<div class="player-wrapper" id="playerWrapper">
    <button class="big-play-btn" id="bigPlayBtn">
        <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor">
            <path d="M8 5v14l11-7z"/>
        </svg>
    </button>

    <video id="videoElement" playsinline preload="auto"></video>

    <div class="controls-bar" id="controlsBar">
        <div class="progress-container" id="progressContainer">
            <div class="progress-filled" id="progressFilled">
                <div class="progress-handle"></div>
            </div>
        </div>

        <div class="controls-row">
            <div class="controls-left">
                <button class="ctrl-btn" id="playBtn" title="Play / Pause">
                    <svg id="playIcon" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    <svg id="pauseIcon" viewBox="0 0 24 24" style="display:none;"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                </button>

                <div class="volume-group">
                    <button class="ctrl-btn" id="muteBtn" title="Mute / Unmute">
                        <svg id="volumeIcon" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>
                        <svg id="muteIcon" viewBox="0 0 24 24" style="display:none;"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>
                    </button>
                    <input type="range" class="volume-slider" id="volumeSlider" min="0" max="1" step="0.05" value="1">
                </div>

                <div class="time-display">
                    <span id="currentTime">0:00</span> / <span id="duration">0:00</span>
                </div>
            </div>

            <div class="controls-right">
                <select class="speed-select" id="speedSelect" title="Playback Speed">
                    <option value="0.5">0.5x</option>
                    <option value="1" selected>1.0x</option>
                    <option value="1.25">1.25x</option>
                    <option value="1.5">1.5x</option>
                    <option value="2">2.0x</option>
                </select>

                <button class="ctrl-btn" id="pipBtn" title="Picture in Picture">
                    <svg viewBox="0 0 24 24"><path d="M19 7h-8v6h8V7zm2-4H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14z"/></svg>
                </button>

                <button class="ctrl-btn" id="fsBtn" title="Fullscreen">
                    <svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>
                </button>
            </div>
        </div>
    </div>
</div>

<script>
    const urlParams = new URLSearchParams(window.location.search);
    const videoId = urlParams.get('v') || urlParams.get('id');
    const directUrl = urlParams.get('url');

    const isAutoplay = urlParams.get('autoplay') === '1';
    const isLoop = urlParams.get('loop') === '1';
    const isMuted = urlParams.get('muted') === '1';

    const video = document.getElementById('videoElement');
    const playerWrapper = document.getElementById('playerWrapper');
    const playBtn = document.getElementById('playBtn');
    const bigPlayBtn = document.getElementById('bigPlayBtn');
    const playIcon = document.getElementById('playIcon');
    const pauseIcon = document.getElementById('pauseIcon');
    const muteBtn = document.getElementById('muteBtn');
    const volumeIcon = document.getElementById('volumeIcon');
    const muteIcon = document.getElementById('muteIcon');
    const volumeSlider = document.getElementById('volumeSlider');
    const currentTimeEl = document.getElementById('currentTime');
    const durationEl = document.getElementById('duration');
    const progressContainer = document.getElementById('progressContainer');
    const progressFilled = document.getElementById('progressFilled');
    const speedSelect = document.getElementById('speedSelect');
    const pipBtn = document.getElementById('pipBtn');
    const fsBtn = document.getElementById('fsBtn');

    if (directUrl) {
        video.src = '/api/stream?url=' + encodeURIComponent(directUrl);
    } else if (videoId) {
        video.src = '/api/stream?v=' + encodeURIComponent(videoId);
    }

    if (isLoop) video.loop = true;
    if (isMuted) {
        video.muted = true;
        volumeSlider.value = 0;
        updateVolumeIcons();
    }

    let hideTimeout;
    function showControls() {
        playerWrapper.classList.add('user-active');
        clearTimeout(hideTimeout);
        hideTimeout = setTimeout(() => {
            if (!video.paused) {
                playerWrapper.classList.remove('user-active');
            }
        }, 3000);
    }
    playerWrapper.addEventListener('mousemove', showControls);
    playerWrapper.addEventListener('click', (e) => {
        if (e.target.closest('#controlsBar') || e.target.closest('#bigPlayBtn')) return;
        togglePlay();
    });

    function togglePlay() {
        if (video.paused) {
            video.play().then(() => {
                playIcon.style.display = 'none';
                pauseIcon.style.display = 'block';
                bigPlayBtn.classList.add('hidden');
            }).catch(e => console.log("Play blocked:", e));
        } else {
            video.pause();
            playIcon.style.display = 'block';
            pauseIcon.style.display = 'none';
            bigPlayBtn.classList.remove('hidden');
        }
    }

    playBtn.addEventListener('click', togglePlay);
    bigPlayBtn.addEventListener('click', togglePlay);

    if (isAutoplay) {
        video.muted = true;
        video.play().then(() => {
            playIcon.style.display = 'none';
            pauseIcon.style.display = 'block';
            bigPlayBtn.classList.add('hidden');
        }).catch(() => {});
    }

    function formatTime(secs) {
        if (isNaN(secs)) return '0:00';
        const m = Math.floor(secs / 60);
        const s = Math.floor(secs % 60);
        return m + ':' + (s < 10 ? '0' : '') + s;
    }

    video.addEventListener('timeupdate', () => {
        const pct = (video.currentTime / video.duration) * 100;
        progressFilled.style.width = pct + '%';
        currentTimeEl.textContent = formatTime(video.currentTime);
    });

    video.addEventListener('loadedmetadata', () => {
        durationEl.textContent = formatTime(video.duration);
    });

    progressContainer.addEventListener('click', (e) => {
        const rect = progressContainer.getBoundingClientRect();
        const pos = (e.clientX - rect.left) / rect.width;
        video.currentTime = pos * video.duration;
    });

    volumeSlider.addEventListener('input', (e) => {
        video.volume = e.target.value;
        video.muted = e.target.value == 0;
        updateVolumeIcons();
    });

    muteBtn.addEventListener('click', () => {
        video.muted = !video.muted;
        volumeSlider.value = video.muted ? 0 : video.volume;
        updateVolumeIcons();
    });

    function updateVolumeIcons() {
        if (video.muted || video.volume == 0) {
            volumeIcon.style.display = 'none';
            muteIcon.style.display = 'block';
        } else {
            volumeIcon.style.display = 'block';
            muteIcon.style.display = 'none';
        }
    }

    speedSelect.addEventListener('change', (e) => {
        video.playbackRate = parseFloat(e.target.value);
    });

    pipBtn.addEventListener('click', async () => {
        try {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
            } else {
                await video.requestPictureInPicture();
            }
        } catch (err) {
            console.error("PiP error:", err);
        }
    });

    fsBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) {
            playerWrapper.requestFullscreen().catch(err => console.error(err));
        } else {
            document.exitFullscreen();
        }
    });
</script>

</body>
</html>`;
