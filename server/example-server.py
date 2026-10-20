#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
示例 TTS 服务 —— 实现 dsh-voice 需要的最小契约。

    GET  /health  -> {"ok": true, "ready": true}
    POST /tts     body {"text": "...", "out": "D:\\tts\\out\\a.wav"}
                  -> {"ok": true, "path": "...", "dur": 2.31}

本文件以 CosyVoice 3 为例；其它后端（edge-tts / Moss / 自建模型）照这个接口写就行。

⚠️ 这个示例**不含模型，也不含参考音频**。请自己准备：
   COSYVOICE_ROOT / COSYVOICE_MODEL / VOICE_REF_WAV / VOICE_REF_TXT 四个环境变量，
   或者直接改下面的常量。

⚠️ 长文本必须分句：CosyVoice 对超长文本会**静默截断**（不报错，只是少一句）。
"""
import json
import os
import re
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = os.environ.get("VOICE_HOST", "127.0.0.1")
PORT = int(os.environ.get("VOICE_PORT", "8765"))

CV = os.environ.get("COSYVOICE_ROOT", r"C:\CosyVoice")
MODEL_DIR = os.environ.get(
    "COSYVOICE_MODEL", os.path.join(CV, "pretrained_models", "Fun-CosyVoice3-0.5B")
)
REF_WAV = os.environ.get("VOICE_REF_WAV", r"C:\voice\reference.wav")
REF_TXT = os.environ.get(
    "VOICE_REF_TXT",
    "You are a helpful assistant.<|endofprompt|>这里放你参考音频逐字对应的文本。",
)
DEFAULT_OUT_DIR = os.environ.get("VOICE_OUT_DIR", r"D:\tts\out")
FFMPEG = os.environ.get("FFMPEG", "ffmpeg")

import sys

sys.path.append(CV)
sys.path.append(os.path.join(CV, "third_party", "Matcha-TTS"))

model = None
lock = __import__("threading").Lock()


def load_model():
    global model
    t0 = time.time()
    from cosyvoice.cli.cosyvoice import AutoModel

    model = AutoModel(model_dir=MODEL_DIR)
    print("[server] model ready in %.1fs" % (time.time() - t0), flush=True)


def split_text(text, max_len=60):
    """按句末标点切句，短句合并到 max_len 以内。"""
    chunks = [c.strip() for c in re.split(r"(?<=[。！？；\n])", text) if c.strip()]
    out, buf = [], ""
    for c in chunks:
        if buf and len(buf) + len(c) > max_len:
            out.append(buf)
            buf = c
        else:
            buf += c
    if buf:
        out.append(buf)
    return out or [text]


def synth(text, out_path):
    import soundfile as sf

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    pieces = split_text(text)
    print("[server] synth: %d chars -> %d pieces" % (len(text), len(pieces)), flush=True)
    parts = []
    with lock:
        for si, piece in enumerate(pieces):
            for k, chunk in enumerate(
                model.inference_zero_shot(piece, REF_TXT, REF_WAV, stream=False)
            ):
                part = "%s.part%d_%d.wav" % (out_path, si, k)
                sf.write(
                    part,
                    chunk["tts_speech"].squeeze(0).cpu().numpy(),
                    model.sample_rate,
                )
                parts.append(part)
    if not parts:
        raise RuntimeError("no audio generated")
    if len(parts) == 1:
        os.replace(parts[0], out_path)
    else:
        import subprocess

        args = [FFMPEG, "-y"]
        for p in parts:
            args += ["-i", p]
        filt = "".join("[%d:a]" % i for i in range(len(parts)))
        filt += "concat=n=%d:v=0:a=1[out]" % len(parts)
        args += [
            "-filter_complex", filt,
            "-map", "[out]",
            "-c:a", "pcm_s16le", "-ar", "24000", "-ac", "1", out_path,
        ]
        subprocess.run(args, capture_output=True)
        for p in parts:
            try:
                os.remove(p)
            except Exception:
                pass
    with wave.open(out_path) as w:
        return w.getnframes() / w.getframerate()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return

    def _json(self, code, obj):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"ok": True, "ready": model is not None})
        else:
            self._json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        if self.path != "/tts":
            self._json(404, {"ok": False, "error": "not found"})
            return
        try:
            n = int(self.headers.get("content-length", 0))
            body = json.loads(self.rfile.read(n).decode("utf-8"))
            text = (body.get("text") or "").strip()
            if not text:
                self._json(400, {"ok": False, "error": "empty text"})
                return
            out = body.get("out") or os.path.join(
                DEFAULT_OUT_DIR, "tts-%s.wav" % time.strftime("%Y%m%d-%H%M%S")
            )
            t0 = time.time()
            dur = synth(text, out)
            self._json(
                200,
                {
                    "ok": True,
                    "path": out,
                    "dur": round(dur, 2),
                    "ms": int((time.time() - t0) * 1000),
                },
            )
        except Exception as e:
            self._json(500, {"ok": False, "error": str(e)[:300]})


def main():
    load_model()
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    print("[server] listening on http://%s:%d" % (HOST, PORT), flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
